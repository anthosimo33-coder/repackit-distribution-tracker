/**
 * Couche API Whop — appel réseau externe (API v1), DESTINÉ à être appelé depuis
 * une action Convex (convex/whopSync.ts) : `fetch` n'est dispo que dans le
 * runtime action. Interroge le compte Whop d'un projet pour lister ses paiements,
 * puis les NORMALISE vers notre schéma (brut/frais/net + statut normalisé).
 *
 * 🔐 La clé API Whop est passée en argument (lue depuis l'env par l'appelant) et
 * transmise UNIQUEMENT dans l'en-tête `Authorization` — jamais dans l'URL, jamais
 * loguée (les messages d'erreur ne reprennent que le statut/corps de l'API).
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. La normalisation des statuts
 * délègue à convex/whopRevenue.ts (réplique de lib/whop-revenue, testée là-bas).
 *
 * Réf. API (vérifié 2026-07) : GET https://api.whop.com/api/v1/payments
 *   ?company_id=biz_… — auth `Bearer <company API key>` — pagination CURSEUR
 *   (`first` + `page_info.has_next_page`/`end_cursor`). Champs : id, status,
 *   substatus, total/subtotal (brut créateur), application_fee.amount (frais),
 *   amount_after_fees (net), refunded_amount, currency, paid_at, plan.id, membership.id.
 */
import { normalizeWhopStatus, type WhopStatus } from "./whopRevenue";

const WHOP_PAYMENTS_ENDPOINT = "https://api.whop.com/api/v1/payments";
const WHOP_PLANS_ENDPOINT = "https://api.whop.com/api/v1/plans";
const WHOP_MEMBERSHIPS_ENDPOINT = "https://api.whop.com/api/v1/memberships";
const PAGE_SIZE = 100;
/** Borne de sécurité : 50 × 100 = 5000 paiements/sync (anti-boucle infinie). */
const MAX_PAGES = 50;

/** Paiement Whop NORMALISÉ (montants en devise, prêt pour whopPayments). */
export interface NormalizedWhopPayment {
  whopId: string;
  status: WhopStatus;
  rawStatus: string;
  currency: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  refundedAmount: number;
  paidAt: number;
  planId?: string;
  membershipId?: string;
  /** Pseudo Whop du client (username, sinon nom) — identifie un litige à traiter. */
  memberName?: string;
  /** Échéance de réponse au litige EN COURS (needs_response_by) — ms. Urgent. */
  disputeDueAt?: number;
  /** Motif du litige en cours (reason), si fourni par l'API. */
  disputeReason?: string;
}

export interface FetchWhopPaymentsResult {
  payments: NormalizedWhopPayment[];
  /** Pages réellement lues. */
  pages: number;
  /** true si la borne MAX_PAGES a coupé la pagination (données plus anciennes non lues). */
  truncated: boolean;
  /** Message d'erreur (réseau / HTTP / 429) — non null = sync partielle/annulée. */
  error: string | null;
}

// ─── Extraction défensive (réponse API = unknown) ────────────────────────────

function asRecord(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === "object" ? (x as Record<string, unknown>) : null;
}

function toAmount(x: unknown): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function getStr(x: unknown): string | undefined {
  return typeof x === "string" && x.length > 0 ? x : undefined;
}

/** ISO-8601 (ou epoch s/ms) → ms epoch ; 0 si illisible. */
function toMs(x: unknown): number {
  if (typeof x === "number" && Number.isFinite(x)) {
    // Heuristique s vs ms (Whop renvoie de l'ISO, mais on couvre l'epoch).
    return x < 1e12 ? Math.round(x * 1000) : Math.round(x);
  }
  if (typeof x === "string" && x.trim() !== "") {
    const t = Date.parse(x);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Détail d'un LITIGE (chargeback) EN COURS. Whop expose un tableau `disputes`
 * (selon la ressource, `resolutions`) : chaque entrée porte un `status`, une
 * échéance `needs_response_by` (délai pour répondre — « 6 jours pour répondre »
 * côté Whop) et un `reason`. On retient le litige OUVERT le plus URGENT (échéance
 * la plus proche) ; les litiges résolus (won/lost/closed) ne demandent plus de
 * réponse et sont ignorés. Défensif : la forme exacte varie selon l'API/permissions
 * — un champ absent laisse `dueAt` indéfini (l'UI dégrade sans jamais inventer).
 */
function extractOpenDispute(r: Record<string, unknown>): {
  dueAt?: number;
  reason?: string;
} {
  const arrays = [r.disputes, r.resolutions].filter((x): x is unknown[] =>
    Array.isArray(x),
  );
  let dueAt: number | undefined;
  let reason: string | undefined;
  for (const arr of arrays) {
    for (const d of arr) {
      const dd = asRecord(d);
      if (!dd) continue;
      const st = (getStr(dd.status) ?? "").toLowerCase();
      if (st === "won" || st === "lost" || st === "closed") continue; // résolu
      const due = toMs(dd.needs_response_by ?? dd.due_by ?? dd.response_due_at);
      const rsn = getStr(dd.reason);
      if (due > 0 && (dueAt === undefined || due < dueAt)) {
        dueAt = due;
        reason = rsn ?? reason;
      } else if (reason === undefined && rsn) {
        reason = rsn;
      }
    }
  }
  return { dueAt, reason };
}

/** Normalise un paiement brut de l'API v1 → NormalizedWhopPayment (null si pas d'id). */
export function normalizeWhopPayment(raw: unknown): NormalizedWhopPayment | null {
  const r = asRecord(raw);
  if (!r) return null;
  const whopId = getStr(r.id);
  if (!whopId) return null;

  const rawStatus = String(r.substatus ?? r.status ?? "");
  const status = normalizeWhopStatus(rawStatus);

  const fee = toAmount(asRecord(r.application_fee)?.amount);
  // Brut CRÉATEUR (hors frais acheteur) : total → subtotal → settlement_amount.
  const grossRaw =
    r.total ?? r.subtotal ?? r.settlement_amount ?? undefined;
  let gross: number;
  let net: number;
  if (r.amount_after_fees !== undefined && r.amount_after_fees !== null) {
    net = toAmount(r.amount_after_fees);
    gross = grossRaw !== undefined ? toAmount(grossRaw) : round2(net + fee);
  } else {
    gross = grossRaw !== undefined ? toAmount(grossRaw) : 0;
    net = round2(gross - fee); // fallback : net dérivé (brut − frais)
  }
  const refundedAmount = toAmount(r.refunded_amount);
  const currency = (getStr(r.currency) ?? "usd").toLowerCase();
  const paidAt = toMs(r.paid_at) || toMs(r.created_at);
  const planId = getStr(asRecord(r.plan)?.id);
  const membershipId = getStr(asRecord(r.membership)?.id);
  // Client (pseudo public) — pour identifier un litige à traiter côté Whop.
  const memberName =
    getStr(asRecord(r.user)?.username) ??
    getStr(asRecord(r.user)?.name) ??
    getStr(asRecord(r.member)?.username);
  const { dueAt: disputeDueAt, reason: disputeReason } = extractOpenDispute(r);

  return {
    whopId,
    status,
    rawStatus,
    currency,
    grossAmount: gross,
    feeAmount: fee,
    netAmount: net,
    refundedAmount,
    paidAt,
    planId,
    membershipId,
    memberName,
    disputeDueAt,
    disputeReason,
  };
}

// ─── Offres (plans) : libellé lisible, un seul appel, tolérant à l'échec ──────

/** Offre Whop NORMALISÉE — tout est optionnel (l'API ne fournit pas toujours un nom). */
export interface NormalizedWhopPlan {
  planId: string;
  name?: string;
  price?: number;
  currency?: string;
  interval?: string;
}

export interface FetchWhopPlansResult {
  plans: NormalizedWhopPlan[];
  error: string | null;
}

/** Cadence lisible depuis une période Whop en jours (7 → « semaine », 30/31 → « mois »). */
function intervalLabel(days: unknown): string | undefined {
  const n = toAmount(days);
  if (!(n > 0)) return undefined;
  if (n <= 1) return "jour";
  if (n <= 7) return "semaine";
  if (n <= 31) return "mois";
  if (n <= 92) return "trimestre";
  if (n <= 366) return "an";
  return undefined;
}

/**
 * Normalise un plan brut de l'API : ID obligatoire, le reste au mieux. Le NOM est
 * cherché dans les champs candidats connus (title/name/internal_notes) SANS rien
 * fabriquer — null si l'API n'en donne pas, l'UI retombe alors sur le prix.
 */
export function normalizeWhopPlan(raw: unknown): NormalizedWhopPlan | null {
  const r = asRecord(raw);
  if (!r) return null;
  const planId = getStr(r.id);
  if (!planId) return null;
  const product = asRecord(r.product);
  const name =
    getStr(r.title) ??
    getStr(r.name) ??
    getStr(r.internal_notes) ??
    getStr(product?.title) ??
    getStr(product?.name);
  const priceRaw = r.renewal_price ?? r.initial_price ?? r.base_price ?? r.price;
  const price = priceRaw !== undefined && priceRaw !== null ? toAmount(priceRaw) : undefined;
  const currency = getStr(r.base_currency) ?? getStr(r.currency);
  const interval =
    intervalLabel(r.billing_period) ?? getStr(r.billing_period_label) ?? getStr(r.plan_type);
  return {
    planId,
    name,
    price: price !== undefined && price > 0 ? round2(price) : undefined,
    currency: currency ? currency.toLowerCase() : undefined,
    interval,
  };
}

/**
 * Liste les offres du compte Whop `companyId` (un appel, borné à une page : un
 * compte a une poignée de plans). `planIds` restreint aux offres du projet. Toute
 * erreur réseau/HTTP est CAPTURÉE et renvoyée (les libellés existants sont
 * conservés, l'UI garde le prix) — la clé n'est jamais mise en URL ni loguée.
 */
export async function fetchWhopPlans(
  apiKey: string,
  companyId: string,
  opts: { planIds?: string[]; fetchImpl?: typeof fetch } = {},
): Promise<FetchWhopPlansResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams();
  params.set("company_id", companyId);
  params.set("first", String(PAGE_SIZE));
  for (const pid of opts.planIds ?? []) params.append("plan_ids", pid);

  let res: Response;
  try {
    res = await fetchImpl(`${WHOP_PLANS_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
  } catch (e) {
    return { plans: [], error: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) return { plans: [], error: await readWhopError(res) };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { plans: [], error: "réponse Whop illisible (JSON invalide)" };
  }
  const root = asRecord(json);
  const data = Array.isArray(root?.data) ? (root!.data as unknown[]) : [];
  const plans: NormalizedWhopPlan[] = [];
  for (const raw of data) {
    const norm = normalizeWhopPlan(raw);
    if (norm) plans.push(norm);
  }
  return { plans, error: null };
}

// ─── Abonnements (memberships) : l'état qui FAIT FOI pour le churn ────────────

/** Abonnement Whop NORMALISÉ — dates en ms, tout optionnel sauf l'id et le statut. */
export interface NormalizedWhopMembership {
  whopMembershipId: string;
  whopUserId?: string;
  planId?: string;
  status: string;
  valid?: boolean;
  createdAt: number;
  canceledAt?: number;
  accessEndsAt?: number;
}

export interface FetchWhopMembershipsResult {
  memberships: NormalizedWhopMembership[];
  pages: number;
  truncated: boolean;
  error: string | null;
}

/** Normalise un membership brut (défensif : champs Whop variables selon l'API). */
export function normalizeWhopMembership(raw: unknown): NormalizedWhopMembership | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = getStr(r.id) ?? getStr(r.membership_id);
  if (!id) return null;
  const whopUserId =
    getStr(asRecord(r.user)?.id) ??
    getStr(r.user_id) ??
    getStr(r.user) ??
    getStr(asRecord(r.member)?.id) ??
    getStr(r.member_id);
  const planId =
    getStr(asRecord(r.plan)?.id) ?? getStr(r.plan_id) ?? getStr(r.plan);
  const status = (getStr(r.status) ?? getStr(r.substatus) ?? "unknown").toLowerCase();
  const valid = typeof r.valid === "boolean" ? r.valid : undefined;
  const createdAt =
    toMs(r.created_at) || toMs(r.started_at) || toMs(r.renewal_period_start);
  const canceledMs = toMs(r.canceled_at ?? r.cancelled_at);
  const accessMs = toMs(
    r.expires_at ?? r.valid_until ?? r.renewal_period_end ?? r.expiration,
  );
  return {
    whopMembershipId: id,
    whopUserId,
    planId,
    status,
    valid,
    createdAt,
    canceledAt: canceledMs || undefined,
    accessEndsAt: accessMs || undefined,
  };
}

/**
 * Liste TOUS les abonnements du compte Whop `companyId` (pagination curseur, plus
 * récents d'abord), normalisés. Même contrat de robustesse que fetchWhopPayments :
 * un 429 / une erreur HTTP arrête proprement et retourne ce qui a été lu. La clé
 * n'est jamais en URL ni loguée. `fetchImpl` injectable pour les tests.
 */
export async function fetchWhopMemberships(
  apiKey: string,
  companyId: string,
  opts: { planIds?: string[]; fetchImpl?: typeof fetch } = {},
): Promise<FetchWhopMembershipsResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const memberships: NormalizedWhopMembership[] = [];
  let after: string | undefined;
  let pages = 0;

  for (let i = 0; i < MAX_PAGES; i++) {
    const params = new URLSearchParams();
    params.set("company_id", companyId);
    params.set("first", String(PAGE_SIZE));
    if (after) params.set("after", after);
    for (const pid of opts.planIds ?? []) params.append("plan_ids", pid);

    let res: Response;
    try {
      res = await fetchImpl(`${WHOP_MEMBERSHIPS_ENDPOINT}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
    } catch (e) {
      return {
        memberships,
        pages,
        truncated: false,
        error: `network: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (res.status === 429) {
      return { memberships, pages, truncated: true, error: "rate_limited (429)" };
    }
    if (!res.ok) {
      return { memberships, pages, truncated: false, error: await readWhopError(res) };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { memberships, pages, truncated: false, error: "réponse Whop illisible (JSON invalide)" };
    }
    const { data, endCursor, hasNextPage } = parsePage(json);
    for (const raw of data) {
      const norm = normalizeWhopMembership(raw);
      if (norm) memberships.push(norm);
    }
    pages += 1;
    if (!hasNextPage || !endCursor) {
      return { memberships, pages, truncated: false, error: null };
    }
    after = endCursor;
  }
  return { memberships, pages, truncated: true, error: null };
}

function parsePage(json: unknown): {
  data: unknown[];
  endCursor: string | undefined;
  hasNextPage: boolean;
} {
  const root = asRecord(json);
  const data = Array.isArray(root?.data) ? (root!.data as unknown[]) : [];
  const pageInfo = asRecord(root?.page_info);
  return {
    data,
    endCursor: getStr(pageInfo?.end_cursor),
    hasNextPage: pageInfo?.has_next_page === true,
  };
}

async function readWhopError(res: Response): Promise<string> {
  try {
    const body = asRecord(await res.json());
    const err = asRecord(body?.error);
    const msg = err?.message ?? body?.message;
    if (typeof msg === "string") return `HTTP ${res.status}: ${msg}`;
  } catch {
    // corps non-JSON
  }
  return `HTTP ${res.status} ${res.statusText}`.trim();
}

/**
 * Liste TOUS les paiements du compte Whop `companyId` (pagination curseur, plus
 * récents d'abord), normalisés. `planIds` restreint aux produits du projet
 * (anti-mélange). Un 429 (rate limit) ou une erreur HTTP/réseau ARRÊTE proprement
 * et retourne ce qui a été lu (la sync est idempotente : le prochain cron reprend).
 * `fetchImpl` est injectable pour les tests. La clé n'est JAMAIS mise en URL/log.
 */
export async function fetchWhopPayments(
  apiKey: string,
  companyId: string,
  opts: { planIds?: string[]; fetchImpl?: typeof fetch } = {},
): Promise<FetchWhopPaymentsResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const payments: NormalizedWhopPayment[] = [];
  let after: string | undefined;
  let pages = 0;

  for (let i = 0; i < MAX_PAGES; i++) {
    const params = new URLSearchParams();
    params.set("company_id", companyId);
    params.set("first", String(PAGE_SIZE));
    params.set("order", "created_at");
    params.set("direction", "desc");
    if (after) params.set("after", after);
    for (const pid of opts.planIds ?? []) params.append("plan_ids", pid);

    let res: Response;
    try {
      res = await fetchImpl(`${WHOP_PAYMENTS_ENDPOINT}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });
    } catch (e) {
      return {
        payments,
        pages,
        truncated: false,
        error: `network: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (res.status === 429) {
      return { payments, pages, truncated: true, error: "rate_limited (429)" };
    }
    if (!res.ok) {
      return { payments, pages, truncated: false, error: await readWhopError(res) };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { payments, pages, truncated: false, error: "réponse Whop illisible (JSON invalide)" };
    }
    const { data, endCursor, hasNextPage } = parsePage(json);
    for (const raw of data) {
      const norm = normalizeWhopPayment(raw);
      if (norm) payments.push(norm);
    }
    pages += 1;
    if (!hasNextPage || !endCursor) {
      return { payments, pages, truncated: false, error: null };
    }
    after = endCursor;
  }
  // Sortie par la borne MAX_PAGES : il reste des pages non lues.
  return { payments, pages, truncated: true, error: null };
}

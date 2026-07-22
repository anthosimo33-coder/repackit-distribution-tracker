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
  };
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

/**
 * Couche API Whop — GRAND LIVRE (GET /financial_activity), pour l'onglet Compta.
 * Appelée depuis une action Convex (convex/compta.ts) : `fetch` n'existe que dans
 * le runtime action.
 *
 * Réf. API (spec OpenAPI api-v1-native, lue le 2026-10-01) :
 *   GET https://api.whop.com/api/v1/financial_activity?account_id=biz_…
 *   - le chemin a un SOULIGNÉ (« /financial-activity » n'existe pas) ;
 *   - scope requis `company:balance:read` (403 sinon) ;
 *   - pagination curseur : `limit` ≤ 100, `cursor`, `page_info.end_cursor` /
 *     `has_next_page` ;
 *   - `amount` = chaîne SIGNÉE en unités de `currency.precision` (100000000 pour
 *     l'USD : ce ne sont pas des centimes) ;
 *   - `posted_after` / `posted_before` en ISO 8601.
 *
 * 🔐 La clé est passée en argument et ne voyage que dans `Authorization` — jamais
 * dans l'URL, jamais dans un log.
 *
 * Aucune donnée personnelle du client n'est conservée (ni nom, ni e-mail) : la
 * compta n'en a pas besoin, et le grand livre en porte sur chaque paiement.
 */
import { ledgerAmount } from "./comptaMath";

const WHOP_LEDGER_ENDPOINT = "https://api.whop.com/api/v1/financial_activity";
const PAGE_SIZE = 100;
/**
 * Borne de sécurité : 1 000 pages × 100 = 100 000 lignes par passage. Snytch en
 * produit ≈ 3 000 par mois : l'historique complet tient en une fois pendant des
 * années. Au-delà, le passage s'arrête proprement et le signale (`truncated`).
 */
const MAX_PAGES = 1000;

/** Une ligne du grand livre, normalisée pour `whopLedgerLines`. */
export interface NormalizedLedgerLine {
  whopId: string;
  lineType: string;
  /** Signé, dans `currency` (unités pleines : 9.99, pas 999000000). */
  amount: number;
  currency: string;
  postedAt: number;
  paymentId?: string;
  /** Offre du paiement (`product_name`, sinon `plan_name`). */
  label?: string;
  /** Identifiant de la source quand elle en a un (ex. un retrait `wdrl_…`). */
  sourceId?: string;
  /** Destination d'un retrait, telle que Whop l'affiche (masquée). */
  destination?: string;
  /** Statut de la source (ex. statut d'un retrait). */
  sourceStatus?: string;
}

export interface FetchWhopLedgerResult {
  lines: NormalizedLedgerLine[];
  pages: number;
  /** Lignes illisibles (montant ou date) — comptées, jamais devinées. */
  skipped: number;
  truncated: boolean;
  error: string | null;
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}

function getStr(x: unknown): string | undefined {
  return typeof x === "string" && x.length > 0 ? x : undefined;
}

/**
 * Normalise UNE ligne de `data[]`. `null` si elle est inexploitable (pas d'id,
 * pas de type, montant ou date illisible) : l'appelant la compte en `skipped`.
 */
export function normalizeLedgerLine(raw: unknown): NormalizedLedgerLine | null {
  const r = asRecord(raw);
  if (!r) return null;
  const whopId = getStr(r.id);
  const lineType = getStr(r.line_type);
  const cur = asRecord(r.currency);
  const currency = getStr(cur?.code)?.toLowerCase();
  if (!whopId || !lineType || !currency) return null;
  const amount = ledgerAmount(r.amount, cur?.precision);
  if (amount === null) return null;
  const postedAt = Date.parse(getStr(r.posted_at) ?? "");
  if (!Number.isFinite(postedAt)) return null;

  const source = asRecord(r.source);
  const dest = asRecord(source?.payout_destination);
  const label = getStr(r.product_name) ?? getStr(r.plan_name);
  const destination =
    getStr(source?.payout_token_nickname) ??
    getStr(dest?.payer_name) ??
    getStr(source?.payer_name);

  return {
    whopId,
    lineType,
    amount,
    currency,
    postedAt,
    ...(getStr(r.payment_id) ? { paymentId: getStr(r.payment_id) } : {}),
    ...(label ? { label } : {}),
    ...(getStr(source?.id) ? { sourceId: getStr(source?.id) } : {}),
    ...(destination ? { destination } : {}),
    ...(getStr(source?.status) ? { sourceStatus: getStr(source?.status) } : {}),
  };
}

async function readWhopError(res: Response): Promise<string> {
  if (res.status === 403) {
    return "HTTP 403 : la clé Whop n'a pas le droit company:balance:read (grand livre).";
  }
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
 * Lit le grand livre du compte `accountId`, de `postedAfter` (exclu, ISO) à
 * maintenant — tout l'historique sans borne. Un 429 ou une erreur ARRÊTE
 * proprement et rend ce qui a été lu : l'import est idempotent (dédup par id),
 * le passage suivant reprend.
 */
export async function fetchWhopLedger(
  apiKey: string,
  accountId: string,
  opts: { postedAfter?: number; fetchImpl?: typeof fetch; maxPages?: number } = {},
): Promise<FetchWhopLedgerResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const lines: NormalizedLedgerLine[] = [];
  let skipped = 0;
  let cursor: string | undefined;
  let pages = 0;

  for (let i = 0; i < maxPages; i++) {
    const params = new URLSearchParams();
    params.set("account_id", accountId);
    params.set("limit", String(PAGE_SIZE));
    if (opts.postedAfter !== undefined) {
      params.set("posted_after", new Date(opts.postedAfter).toISOString());
    }
    if (cursor) params.set("cursor", cursor);

    let res: Response;
    try {
      res = await fetchImpl(`${WHOP_LEDGER_ENDPOINT}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
    } catch (e) {
      return {
        lines,
        pages,
        skipped,
        truncated: false,
        error: `network: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (res.status === 429) {
      return { lines, pages, skipped, truncated: true, error: "rate_limited (429)" };
    }
    if (!res.ok) {
      return { lines, pages, skipped, truncated: false, error: await readWhopError(res) };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return {
        lines,
        pages,
        skipped,
        truncated: false,
        error: "réponse Whop illisible (JSON invalide)",
      };
    }
    const root = asRecord(json);
    const data = Array.isArray(root?.data) ? (root!.data as unknown[]) : [];
    for (const raw of data) {
      const line = normalizeLedgerLine(raw);
      if (line) lines.push(line);
      else skipped += 1;
    }
    pages += 1;
    const pageInfo = asRecord(root?.page_info);
    const next = getStr(pageInfo?.end_cursor);
    if (pageInfo?.has_next_page !== true || !next) {
      return { lines, pages, skipped, truncated: false, error: null };
    }
    cursor = next;
  }
  return { lines, pages, skipped, truncated: true, error: null };
}

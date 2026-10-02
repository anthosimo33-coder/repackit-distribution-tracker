/**
 * COMPTA — calculs PURS de l'onglet Compta (grand livre Whop, charges, seuils).
 *
 * Module sans aucun import `_generated` : lu par le serveur (convex/compta.ts)
 * ET par l'écran (components/compta/*), testé depuis lib/compta-math.test.ts.
 * Même patron que convex/permissions.ts — la règle A6 interdit à `convex/`
 * d'importer `lib/`, pas l'inverse : il n'y a donc qu'UNE implémentation.
 *
 * ── LE CLASSEMENT D'UNE LIGNE DU GRAND LIVRE ─────────────────────────────────
 * Whop range chaque mouvement d'argent sous un `line_type` (≈ 300 valeurs, cf
 * GET /financial_activity). Une ligne va dans UNE colonne, décidée ainsi :
 *   1. la table intégrée ci-dessous (types dont le sens est certain) ;
 *   2. sinon, la règle que l'utilisateur a choisie depuis la page pour ce type ;
 *   3. sinon « non classé » : la ligne n'entre dans AUCUNE colonne, et l'écran
 *      le dit. Elle n'est jamais ignorée en silence — un type ajouté par Whop
 *      demain doit se voir, pas disparaître du résultat.
 * La table intégrée ne se surcharge PAS depuis la page : une erreur de clic ne
 * doit pas pouvoir déplacer tout le chiffre d'affaires.
 */

// ─── Colonnes ────────────────────────────────────────────────────────────────

/**
 * Les colonnes où une ligne Whop peut aller. Les quatre premières composent le
 * NET ; `transfers` est de la trésorerie (l'argent quitte Whop vers la banque,
 * il n'est pas dépensé) ; `internal` regroupe ce qui déplace l'argent sans en
 * créer (réserves, conversions internes, ou argent déjà compté ailleurs).
 */
export const COMPTA_BUCKETS = [
  "gross",
  "refunds",
  "disputes",
  "fees",
  "transfers",
  "internal",
] as const;
export type ComptaBucket = (typeof COMPTA_BUCKETS)[number];
export type LineBucket = ComptaBucket | "unclassified";

/** Les colonnes qui forment le net Whop. */
export const NET_BUCKETS: readonly ComptaBucket[] = [
  "gross",
  "refunds",
  "disputes",
  "fees",
];

export function isComptaBucket(x: string): x is ComptaBucket {
  return (COMPTA_BUCKETS as readonly string[]).includes(x);
}

/**
 * Types dont le sens est certain. Les `…_reversal` vont avec leur ligne : un
 * remboursement annulé revient dans « Remboursements » en positif, un litige
 * gagné revient dans « Litiges ».
 */
const BUILTIN_EXACT: Readonly<Record<string, ComptaBucket>> = {
  payment_gross: "gross",
  payment_gross_reversal: "gross",
  payment_refund: "refunds",
  payment_refund_reversal: "refunds",
  resolution_center_refund: "refunds",
  payment_dispute: "disputes",
  payment_dispute_adjustment: "disputes",
  payment_dispute_reversal: "disputes",
  withdrawal: "transfers",
  withdrawal_reversal: "transfers",
  balance_reservation: "internal",
  balance_reservation_hold: "internal",
  balance_reservation_release: "internal",
  balance_reservation_reversal: "internal",
  currency_conversion_incoming: "internal",
  currency_conversion_outgoing: "internal",
  dispute_hold_adjustment: "internal",
  dispute_hold_blocked: "internal",
};

/**
 * Colonne intégrée d'un type, ou `null` s'il est inconnu. Tout type qui se
 * termine par `_fee` (ou `_fee_reversal`) est un frais : traitement, carte
 * étrangère, change, 3-D Secure, litige, virement… La liste Whop en compte une
 * quarantaine et en ajoute régulièrement ; le suffixe est la convention de leur
 * nomenclature, pas une devinette.
 */
export function builtinBucketOf(lineType: string): ComptaBucket | null {
  const exact = BUILTIN_EXACT[lineType];
  if (exact) return exact;
  if (/_fee(_reversal)?$/.test(lineType)) return "fees";
  return null;
}

export function isBuiltinLineType(lineType: string): boolean {
  return builtinBucketOf(lineType) !== null;
}

/** Les types intégrés exacts, pour l'écran « Comment chaque colonne est calculée ». */
export function builtinLineTypes(bucket: ComptaBucket): string[] {
  return Object.entries(BUILTIN_EXACT)
    .filter(([, b]) => b === bucket)
    .map(([t]) => t);
}

/** Un `line_type` Whop bien formé : minuscules, chiffres, soulignés. */
export function isValidLineType(lineType: string): boolean {
  return /^[a-z][a-z0-9_]{1,79}$/.test(lineType);
}

/** Règles choisies depuis la page : type inconnu → colonne. */
export type LineRules = Readonly<Record<string, ComptaBucket>>;

export function bucketOf(lineType: string, rules: LineRules): LineBucket {
  return builtinBucketOf(lineType) ?? rules[lineType] ?? "unclassified";
}

// ─── Montants Whop ───────────────────────────────────────────────────────────

/**
 * Montant d'une ligne Whop : une CHAÎNE signée en « unités de précision » de la
 * devise (`currency.precision`, ex. 100000000 pour l'USD — pas des centimes).
 * `null` si l'un des deux est illisible : on ne devine pas un ordre de grandeur.
 */
export function ledgerAmount(amount: unknown, precision: unknown): number | null {
  const a = toFiniteNumber(amount);
  const p = toFiniteNumber(precision);
  if (a === null || p === null || p <= 0) return null;
  return a / p;
}

function toFiniteNumber(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100;
}

// ─── Devises ─────────────────────────────────────────────────────────────────

/**
 * Taux de l'écran : `target` est la devise de référence (celle du revenu), et
 * `rates[c]` le nombre d'unités de `target` pour 1 unité de `c`. `target` lui-même
 * vaut 1. Une devise absente n'est PAS convertible : le montant est mis de côté
 * et l'écran le dit, jamais additionné à 1:1.
 */
export type ComptaFx = {
  target: string | null;
  rates: Readonly<Record<string, number>>;
};

export function buildComptaFx(
  target: string | null,
  conversions: readonly { from: string; rate: number }[] | null,
): ComptaFx {
  const rates: Record<string, number> = {};
  for (const c of conversions ?? []) {
    const cur = c.from.trim().toLowerCase();
    if (cur !== "" && c.rate > 0) rates[cur] = c.rate;
  }
  const t = target?.trim().toLowerCase() || null;
  if (t) rates[t] = 1;
  return { target: t, rates };
}

export function rateOf(currency: string, fx: ComptaFx): number | null {
  if (fx.target === null) return null;
  const r = fx.rates[currency.trim().toLowerCase()];
  return typeof r === "number" && r > 0 ? r : null;
}

export function convert(amount: number, currency: string, fx: ComptaFx): number | null {
  const r = rateOf(currency, fx);
  return r === null ? null : amount * r;
}

/**
 * Devise de référence d'un projet : la SEULE devise rencontrée qui n'a pas de
 * taux. C'est la règle de `summarizeWhopRevenue` (convex/whopRevenue) : chaque
 * taux ramène une devise vers celle du revenu, la cible est donc celle qui n'en
 * a pas. Aucune, ou deux, ⇒ `null` : on ne sait pas vers quoi convertir.
 */
export function referenceCurrency(
  seen: Iterable<string>,
  conversions: readonly { from: string; rate: number }[] | null,
): string | null {
  const withRate = new Set(
    (conversions ?? []).filter((c) => c.rate > 0).map((c) => c.from.trim().toLowerCase()),
  );
  const sansTaux = new Set<string>();
  for (const s of seen) {
    const c = s.trim().toLowerCase();
    if (c !== "" && !withRate.has(c)) sansTaux.add(c);
  }
  return sansTaux.size === 1 ? [...sansTaux][0] : null;
}

// ─── Agrégat d'un mois du grand livre ────────────────────────────────────────

/** Une case de l'agrégat : un jour de Paris × un type × une devise. */
export type LedgerDayCell = {
  day: string; // "YYYY-MM-DD", heure de Paris
  lineType: string;
  currency: string;
  amount: number; // signé, dans `currency`
  count: number;
};

/** Agrège des lignes en cases jour × type × devise (montants en devise d'origine). */
export function aggregateLedgerDays(
  lines: readonly { postedAt: number; lineType: string; currency: string; amount: number }[],
): LedgerDayCell[] {
  const map = new Map<string, LedgerDayCell>();
  for (const l of lines) {
    const day = parisDayKey(l.postedAt);
    const key = `${day}|${l.lineType}|${l.currency}`;
    const cell = map.get(key);
    if (cell) {
      cell.amount += l.amount;
      cell.count += 1;
    } else {
      map.set(key, { day, lineType: l.lineType, currency: l.currency, amount: l.amount, count: 1 });
    }
  }
  return [...map.values()]
    .map((c) => ({ ...c, amount: roundLedger(c.amount) }))
    .sort((a, b) =>
      a.day === b.day ? a.lineType.localeCompare(b.lineType) : a.day < b.day ? -1 : 1,
    );
}

/** 8 décimales : la précision des devises crypto de Whop, sans bruit flottant. */
function roundLedger(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

/** Total d'un type de ligne sur un ensemble de cases, par devise. */
export type LedgerTypeTotal = {
  lineType: string;
  currency: string;
  amount: number;
  count: number;
  bucket: LineBucket;
  /** Contre-valeur dans la devise de référence, `null` sans taux. */
  converted: number | null;
};

export function totalsByType(
  cells: readonly LedgerDayCell[],
  rules: LineRules,
  fx: ComptaFx,
): LedgerTypeTotal[] {
  const map = new Map<string, { lineType: string; currency: string; amount: number; count: number }>();
  for (const c of cells) {
    const key = `${c.lineType}|${c.currency}`;
    const t = map.get(key);
    if (t) {
      t.amount += c.amount;
      t.count += c.count;
    } else {
      map.set(key, { lineType: c.lineType, currency: c.currency, amount: c.amount, count: c.count });
    }
  }
  return [...map.values()]
    .map((t) => {
      const amount = roundLedger(t.amount);
      const conv = convert(amount, t.currency, fx);
      return {
        ...t,
        amount,
        bucket: bucketOf(t.lineType, rules),
        converted: conv === null ? null : round2(conv),
      };
    })
    .sort((a, b) => Math.abs(b.converted ?? b.amount) - Math.abs(a.converted ?? a.amount));
}

/** Totaux d'un mois (ou d'une période) du grand livre, dans la devise de référence. */
export type LedgerTotals = {
  gross: number;
  refunds: number; // signé (≤ 0 en général)
  disputes: number; // signé
  fees: number; // signé (≤ 0)
  net: number;
  /** Virements reçus sur le compte bancaire, en POSITIF. */
  transfersReceived: number;
  internal: number;
  unclassified: { count: number; amount: number; lineTypes: string[] };
  /** Devises sans taux : montants mis de côté, jamais additionnés. */
  unconverted: { currency: string; amount: number; count: number }[];
  lineCount: number;
};

export function ledgerTotals(
  cells: readonly LedgerDayCell[],
  rules: LineRules,
  fx: ComptaFx,
): LedgerTotals {
  const sums: Record<LineBucket, number> = {
    gross: 0,
    refunds: 0,
    disputes: 0,
    fees: 0,
    transfers: 0,
    internal: 0,
    unclassified: 0,
  };
  let unclassifiedCount = 0;
  const unclassifiedTypes = new Set<string>();
  const unconverted = new Map<string, { currency: string; amount: number; count: number }>();
  let lineCount = 0;
  for (const c of cells) {
    lineCount += c.count;
    const bucket = bucketOf(c.lineType, rules);
    if (bucket === "unclassified") {
      unclassifiedCount += c.count;
      unclassifiedTypes.add(c.lineType);
    }
    const conv = convert(c.amount, c.currency, fx);
    if (conv === null) {
      const u = unconverted.get(c.currency);
      if (u) {
        u.amount += c.amount;
        u.count += c.count;
      } else unconverted.set(c.currency, { currency: c.currency, amount: c.amount, count: c.count });
      continue;
    }
    sums[bucket] += conv;
  }
  const net = NET_BUCKETS.reduce((s, b) => s + sums[b], 0);
  return {
    gross: round2(sums.gross),
    refunds: round2(sums.refunds),
    disputes: round2(sums.disputes),
    fees: round2(sums.fees),
    net: round2(net),
    transfersReceived: round2(-sums.transfers),
    internal: round2(sums.internal),
    unclassified: {
      count: unclassifiedCount,
      amount: round2(sums.unclassified),
      lineTypes: [...unclassifiedTypes].sort(),
    },
    unconverted: [...unconverted.values()].map((u) => ({ ...u, amount: roundLedger(u.amount) })),
    lineCount,
  };
}

/**
 * Solde du grand livre par devise, en devise d'origine : TOUTES les lignes,
 * classées ou non. C'est le seul solde qui ne dépend d'aucun taux.
 */
export function balanceByCurrency(
  cells: readonly LedgerDayCell[],
): { currency: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const c of cells) map.set(c.currency, (map.get(c.currency) ?? 0) + c.amount);
  return [...map.entries()]
    .map(([currency, amount]) => ({ currency, amount: roundLedger(amount) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** CA brut par jour (devise de référence), règles comprises. */
export function grossByDay(
  cells: readonly LedgerDayCell[],
  rules: LineRules,
  fx: ComptaFx,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cells) {
    if (bucketOf(c.lineType, rules) !== "gross") continue;
    const conv = convert(c.amount, c.currency, fx);
    if (conv === null) continue;
    out.set(c.day, (out.get(c.day) ?? 0) + conv);
  }
  return out;
}

// ─── Créatrices : ce qui est SORTI, au jour où c'est sorti ───────────────────

/**
 * Décaissements d'un cycle de paie, au jour du virement — pas l'engagé :
 * l'onglet compte en trésorerie, comme le CA est compté à l'encaissement.
 *   - chaque ACOMPTE sort à sa date ;
 *   - le SOLDE sort au marquage « payé » : ce que vaut le cycle moins les
 *     acomptes déjà versés (cf convex/payments : « un cycle payé ne reste rien,
 *     quels qu'aient été les acomptes qui l'ont précédé »). Jamais négatif.
 */
export type PaymentRowLike = {
  status: string;
  paidAt?: number | null;
  totalDue: number;
  advances?: readonly { amount: number; at: number }[] | null;
};

export type CashOut = { at: number; amount: number; kind: "advance" | "settlement" };

export function creatorCashOuts(row: PaymentRowLike): CashOut[] {
  const out: CashOut[] = [];
  let advanced = 0;
  for (const a of row.advances ?? []) {
    if (a.amount > 0) {
      out.push({ at: a.at, amount: round2(a.amount), kind: "advance" });
      advanced += a.amount;
    }
  }
  if (row.status === "paid" && typeof row.paidAt === "number") {
    const rest = round2(row.totalDue - advanced);
    if (rest > 0) out.push({ at: row.paidAt, amount: rest, kind: "settlement" });
  }
  return out;
}

// ─── Autres charges : les récurrences ────────────────────────────────────────

/**
 * Catégories d'une charge. `scans` est à part : une charge « scans » (paiement
 * réel au fournisseur des scans) n'entre PAS dans « Autres charges » mais dans
 * la colonne Scans, où elle remplace l'estimation `cost_usd` du mois.
 */
export const CHARGE_CATEGORIES = ["hosting", "tools", "subscriptions", "ads", "scans", "other"] as const;
export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];
export function isChargeCategory(x: string): x is ChargeCategory {
  return (CHARGE_CATEGORIES as readonly string[]).includes(x);
}

export type ChargeLike = {
  id: string;
  /** Série : l'id de la PREMIÈRE charge, partagé par ses recopies. */
  seriesId: string;
  day: string; // "YYYY-MM-DD"
  recurring: boolean;
};

/**
 * Occurrences PRÉVUES d'une charge « chaque mois » : pour chaque série dont la
 * DERNIÈRE charge saisie est récurrente, une occurrence par mois écoulé depuis,
 * jusqu'au mois courant inclus — jamais dans le futur. Le jour du mois est
 * conservé (borné à la fin du mois) : un abonnement prélevé le 5 l'est encore
 * le 5.
 *
 * Elles sont CALCULÉES, pas écrites : rien ne se crée tout seul en base. On les
 * confirme (elles deviennent une vraie charge, éditable) ou on arrête la série.
 */
export function plannedOccurrences<T extends ChargeLike>(
  charges: readonly T[],
  currentMonth: string,
): { source: T; day: string; month: string }[] {
  const latest = new Map<string, T>();
  for (const c of charges) {
    const cur = latest.get(c.seriesId);
    if (!cur || c.day > cur.day) latest.set(c.seriesId, c);
  }
  const out: { source: T; day: string; month: string }[] = [];
  for (const c of latest.values()) {
    if (!c.recurring) continue;
    let month = nextMonthKey(c.day.slice(0, 7));
    // Borne de sécurité : jamais plus de 36 occurrences prévues par série.
    for (let i = 0; i < 36 && month <= currentMonth; i++) {
      out.push({ source: c, month, day: sameDayInMonth(c.day, month) });
      month = nextMonthKey(month);
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// ─── Calendrier (Paris) ──────────────────────────────────────────────────────

/** "YYYY-MM-DD" du jour de Paris d'un instant. Même construction que dateFr. */
export function parisDayKey(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));
}

export function nextMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function previousMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function sameDayInMonth(day: string, month: string): string {
  const d = Math.min(Number(day.slice(8, 10)), daysInMonth(month));
  return `${month}-${String(d).padStart(2, "0")}`;
}

/** Ajoute `n` jours à un jour "YYYY-MM-DD" (arithmétique de calendrier, sans fuseau). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Nombre de jours de `from` à `to`, bornes incluses (0 si `to` < `from`). */
export function daysInclusive(from: string, to: string): number {
  if (to < from) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" (le format qu'attend un tableur français). */
export function dayKeyToFr(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

// ─── Seuils de CA ────────────────────────────────────────────────────────────

/**
 * Seuils de la franchise en base de TVA, prestations de services (seuil et
 * seuil majoré), tels que donnés pour Snytch. EN EUROS : le compteur ne s'affiche
 * que si la devise de référence du projet est l'euro.
 */
export const VAT_THRESHOLDS_EUR = { base: 37_500, majored: 41_250 } as const;

export type ThresholdStatus = "below" | "between" | "above";

export function thresholdStatus(cumul: number): ThresholdStatus {
  if (cumul > VAT_THRESHOLDS_EUR.majored) return "above";
  if (cumul > VAT_THRESHOLDS_EUR.base) return "between";
  return "below";
}

/**
 * Où en est le CA brut cumulé de l'année face aux deux seuils.
 *
 * Rythme = CA brut des 30 DERNIERS JOURS COMPLETS (hier inclus, aujourd'hui
 * exclu : un jour entamé ferait baisser le rythme à chaque matin). Projection
 * LINÉAIRE à ce rythme à partir de demain — un repère, pas une prévision.
 * Un seuil déjà franchi donne le jour RÉEL du franchissement, lu dans la série.
 * Sur une année close (ou pas encore ouverte), pas de projection.
 */
export type ThresholdView = {
  cumul: number;
  status: ThresholdStatus;
  dailyRate: number | null;
  base: { remaining: number; reachedOn: string | null; reached: boolean };
  majored: { remaining: number; reachedOn: string | null; reached: boolean };
  endOfYear: number | null;
};

export function thresholdView(input: {
  year: number;
  today: string; // jour de Paris, "YYYY-MM-DD"
  grossByDay: ReadonlyMap<string, number>; // devise de référence
}): ThresholdView {
  const { year, today } = input;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const days = [...input.grossByDay.entries()]
    .filter(([d]) => d >= yearStart && d <= yearEnd)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  let cumul = 0;
  let baseOn: string | null = null;
  let majoredOn: string | null = null;
  for (const [d, v] of days) {
    cumul += v;
    if (baseOn === null && cumul > VAT_THRESHOLDS_EUR.base) baseOn = d;
    if (majoredOn === null && cumul > VAT_THRESHOLDS_EUR.majored) majoredOn = d;
  }
  cumul = round2(cumul);

  const yearOpen = today >= yearStart && today <= yearEnd;
  let dailyRate: number | null = null;
  let endOfYear: number | null = null;
  if (yearOpen) {
    const from = addDays(today, -30);
    const to = addDays(today, -1);
    let last30 = 0;
    for (const [d, v] of input.grossByDay) if (d >= from && d <= to) last30 += v;
    dailyRate = round2(last30 / 30);
    endOfYear = round2(cumul + dailyRate * daysInclusive(addDays(today, 1), yearEnd));
  }

  const project = (threshold: number, reachedOn: string | null) => {
    if (reachedOn !== null) return { remaining: 0, reachedOn, reached: true };
    const remaining = round2(threshold - cumul);
    if (!yearOpen || dailyRate === null || dailyRate <= 0) {
      return { remaining, reachedOn: null, reached: false };
    }
    const day = addDays(today, Math.ceil(remaining / dailyRate));
    return { remaining, reachedOn: day <= yearEnd ? day : null, reached: false };
  };

  return {
    cumul,
    status: thresholdStatus(cumul),
    dailyRate,
    base: project(VAT_THRESHOLDS_EUR.base, baseOn),
    majored: project(VAT_THRESHOLDS_EUR.majored, majoredOn),
    endOfYear,
  };
}

// ─── Usage d'un virement (annotation, jamais un poste) ───────────────────────

/**
 * À quoi a servi un virement Whop → banque. ANNOTATION SEULE : elle ne touche
 * jamais le résultat. L'argent viré pour payer une créatrice est déjà compté
 * dans « Créatrices » au marquage « payé » ; le compter ici aussi le ferait
 * apparaître deux fois. « À récupérer » : l'argent a quitté Whop mais n'est
 * pas arrivé (bloqué, en transit) — il reste signalé tant qu'on ne change pas
 * l'usage.
 */
export const TRANSFER_USAGES = [
  "pay",
  "creators",
  "provision",
  "business",
  "recover",
  "other",
] as const;
export type TransferUsage = (typeof TRANSFER_USAGES)[number];
export function isTransferUsage(x: string): x is TransferUsage {
  return (TRANSFER_USAGES as readonly string[]).includes(x);
}

// ─── Ventilation d'un virement ───────────────────────────────────────────────

/**
 * Une PART d'un virement Whop → banque : un montant (devise du virement), à quoi
 * il a servi, et — pour une dépense de l'activité seulement — la catégorie sous
 * laquelle il est COMPTÉ EN CHARGE (il rejoint alors les charges du mois).
 */
export type TransferPart = {
  id: string;
  amount: number;
  usage: TransferUsage;
  note?: string;
  countedAs?: ChargeCategory;
};

export const MAX_TRANSFER_PARTS = 20;

/**
 * Raison du refus d'une ventilation, ou `null` si elle est valide. Les parts
 * peuvent laisser un reste (« sans motif »), jamais dépasser le virement. Seule
 * une part « Charges de l'activité » se compte en charge, et elle doit dire ce
 * qu'elle a payé : c'est le libellé de la charge créée.
 */
export function transferPartsError(
  parts: readonly { id: string; amount: number; usage: string; note?: string; countedAs?: string }[],
  total: number,
): "count" | "id" | "amount" | "sum" | "usage" | "counted" | "note" | null {
  if (parts.length > MAX_TRANSFER_PARTS) return "count";
  const ids = new Set<string>();
  let sum = 0;
  for (const p of parts) {
    if (p.id.trim() === "" || p.id.length > 40 || ids.has(p.id)) return "id";
    ids.add(p.id);
    if (!Number.isFinite(p.amount) || p.amount <= 0) return "amount";
    if (!isTransferUsage(p.usage)) return "usage";
    if ((p.note ?? "").length > 500) return "note";
    if (p.countedAs !== undefined) {
      if (p.usage !== "business" || !isChargeCategory(p.countedAs)) return "counted";
      if ((p.note ?? "").trim() === "") return "note";
    }
    sum += p.amount;
  }
  if (sum > total + 0.005) return "sum";
  return null;
}

/**
 * Les parts d'un virement. Une annotation d'avant la ventilation (un usage et
 * un motif sur tout le virement) se lit comme UNE part du montant entier.
 */
export function transferPartsOf(
  line: {
    usage?: string;
    note?: string;
    parts?: readonly { id: string; amount: number; usage: string; note?: string; countedAs?: string }[];
  },
  total: number,
): TransferPart[] {
  if (line.parts && line.parts.length > 0) {
    return line.parts
      .filter((p) => isTransferUsage(p.usage))
      .map((p) => ({
        id: p.id,
        amount: p.amount,
        usage: p.usage as TransferUsage,
        ...(p.note ? { note: p.note } : {}),
        ...(p.countedAs && isChargeCategory(p.countedAs) ? { countedAs: p.countedAs } : {}),
      }));
  }
  if (line.usage && isTransferUsage(line.usage)) {
    return [{ id: "legacy", amount: total, usage: line.usage, ...(line.note ? { note: line.note } : {}) }];
  }
  if (line.note) return [{ id: "legacy", amount: total, usage: "other", note: line.note }];
  return [];
}

/**
 * Un retrait a-t-il ÉCHOUÉ ? Whop le rend sur le solde par une ligne
 * `withdrawal_reversal` qui porte le MÊME identifiant de retrait (`wdrl_…`) —
 * c'est le signal qui fait foi. À défaut, le statut du retrait (annulé, refusé,
 * échoué, retourné).
 */
export function isFailedWithdrawal(status: string | null | undefined, hasReversal: boolean): boolean {
  if (hasReversal) return true;
  return status !== null && status !== undefined && /(fail|cancel|denied|revers|return)/i.test(status);
}

// ─── Contrôles ───────────────────────────────────────────────────────────────

/**
 * Sous cette part de l'estimation, des paiements de scans RÉELS sont suspects :
 * un seul paiement compté remplace TOUTE l'estimation du mois, donc un mois où
 * il en manque paraît bien moins cher qu'il ne l'est.
 */
export const SCAN_PAID_LOW_RATIO = 0.5;

/** Les paiements réels d'un mois sont-ils bien en dessous de l'estimation ? */
export function isScanPaidLow(paid: number | null, estimate: number | null): boolean {
  if (paid === null || estimate === null || estimate <= 0) return false;
  return paid < estimate * SCAN_PAID_LOW_RATIO;
}

export type ScanSide = { kind: "paid" | "estimate" | "none"; value: number | null };

/**
 * Les scans d'un mois AVANT et APRÈS l'ajout de paiements réels : dès qu'un
 * paiement existe, la somme des paiements remplace l'estimation. `paid` sont les
 * paiements déjà comptés (contre-valeurs, `null` = sans taux), `added` ceux
 * qu'on s'apprête à compter. L'écart est `null` si un côté n'est pas chiffré.
 */
export function scansSwap(input: {
  estimate: number | null;
  paid: readonly (number | null)[];
  added: readonly (number | null)[];
}): { before: ScanSide; after: ScanSide; delta: number | null } {
  const side = (list: readonly (number | null)[]): ScanSide => {
    if (list.length === 0) {
      return input.estimate === null ? { kind: "none", value: null } : { kind: "estimate", value: input.estimate };
    }
    if (list.some((x) => x === null)) return { kind: "paid", value: null };
    return { kind: "paid", value: round2(list.reduce<number>((s, x) => s + (x ?? 0), 0)) };
  };
  const before = side(input.paid);
  const after = side([...input.paid, ...input.added]);
  const delta =
    before.value === null && before.kind !== "none"
      ? null
      : after.value === null
        ? null
        : round2(after.value - (before.value ?? 0));
  return { before, after, delta };
}

/** Tolérance d'écart entre la paie versée et l'argent sorti pour elle. */
export const CREATORS_GAP_MIN = 10;
export const CREATORS_GAP_SHARE = 0.05;

/**
 * Contrôle créatrices d'un mois : ce que Paiements dit VERSÉ (cycles marqués
 * payés, acomptes) face à ce qui est SORTI de Whop pour elles d'après la
 * ventilation. `null` tant qu'aucune part « Paiement créatrices » n'existe ce
 * mois — sans ventilation, il n'y a rien à comparer. L'écart est positif quand
 * il est sorti PLUS que ce qui est marqué versé.
 */
export function creatorsControl(
  paid: number | null,
  sent: number | null,
  partsCount: number,
): { paid: number | null; sent: number | null; gap: number | null; significant: boolean } | null {
  if (partsCount === 0) return null;
  if (paid === null || sent === null) return { paid, sent, gap: null, significant: false };
  const gap = round2(sent - paid);
  const tolerance = Math.max(CREATORS_GAP_MIN, CREATORS_GAP_SHARE * Math.max(paid, sent));
  return { paid, sent, gap, significant: Math.abs(gap) > tolerance };
}

// ─── Scans (PostHog cost_usd) ────────────────────────────────────────────────

export type ScanMonth = {
  lightUsd: number;
  fullUsd: number;
  otherUsd: number;
  runs: number;
  withCost: number;
};

/**
 * Coût des scans d'un mois en dollars, ou `null` s'il n'est pas mesurable :
 * des scans ont tourné sans qu'aucun ne porte `cost_usd`. Zéro scan = 0 $ (une
 * vraie mesure) ; scans sans coût = inconnu (jamais un 0 inventé).
 */
export function scanCostUsd(s: ScanMonth | null | undefined): number | null {
  if (!s) return null;
  if (s.runs > 0 && s.withCost === 0) return null;
  return round2(s.lightUsd + s.fullUsd + s.otherUsd);
}

/**
 * RÉCAP D'UNE PÉRIODE de la Compta — l'image qu'on partage à l'équipe : le CA,
 * le net, le résultat, où est allé le net, la trésorerie du jour et quelques
 * points à retenir. Logique PURE : elle somme les lignes mensuelles de
 * `getComptaOverview` (les mêmes chiffres que l'onglet), compare à la période
 * d'avant de même durée et trie ce qui a fait bouger le résultat. Le texte, lui,
 * est écrit par l'écran (traduit) et reste modifiable avant le téléchargement.
 */

import { previousMonthKey, type ChargeCategory } from "../convex/comptaMath";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ce que le récap lit d'une ligne mensuelle de getComptaOverview. */
export type RecapRow = {
  month: string;
  inProgress: boolean;
  ledger: { gross: number; refunds: number; disputes: number; fees: number; net: number };
  creators: number | null;
  scans: number | null;
  scanSource: "paid" | "estimate" | null;
  other: number;
  otherByCategory: { category: ChargeCategory; amount: number }[];
  alertFees: { count: number; amount: number };
  result: number;
  incomplete: string[];
};

export type RecapTotals = {
  gross: number;
  net: number;
  creators: number;
  scans: number;
  other: number;
  result: number;
  alertFees: { count: number; amount: number };
};

/** Un poste qui fait bouger le résultat, et de combien (signé : + = il l'a monté). */
export type RecapDriver = { key: "net" | "creators" | "scans" | "other"; effect: number };

export type ComptaRecap = RecapTotals & {
  from: string;
  to: string;
  months: string[];
  inProgress: boolean;
  /** Un montant non chiffré (devise sans taux, scans sans coût) : le total est en dessous du vrai. */
  incomplete: boolean;
  /** Frais Whop, remboursements et litiges : ce qui sépare le CA brut du net (négatif). */
  deductions: number;
  scanSource: "paid" | "estimate" | "mixed" | null;
  otherByCategory: { category: ChargeCategory; amount: number }[];
  /** Résultat ÷ net, en %, arrondi ; `null` sans net positif. */
  margin: number | null;
  previous: (RecapTotals & { from: string; to: string }) | null;
  /** Variation du CA brut contre la période d'avant, en % arrondi ; `null` sans base. */
  grossChange: number | null;
  /** Au plus deux postes, ceux qui ont le plus poussé le résultat dans le sens où il a bougé. */
  drivers: RecapDriver[];
};

/** Les mois de `from` à `to` inclus (AAAA-MM). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let m = to;
  while (m >= from) {
    out.unshift(m);
    m = previousMonthKey(m);
  }
  return out;
}

/** Les `n` mois qui précèdent `from`, du plus ancien au plus récent. */
export function previousPeriod(from: string, n: number): string[] {
  const out: string[] = [];
  let m = from;
  for (let i = 0; i < n; i++) {
    m = previousMonthKey(m);
    out.unshift(m);
  }
  return out;
}

function totalsOf(rows: readonly RecapRow[]): RecapTotals {
  const sum = (pick: (r: RecapRow) => number | null) => round2(rows.reduce((s, r) => s + (pick(r) ?? 0), 0));
  return {
    gross: sum((r) => r.ledger.gross),
    net: sum((r) => r.ledger.net),
    creators: sum((r) => r.creators),
    scans: sum((r) => r.scans),
    other: sum((r) => r.other),
    result: sum((r) => r.result),
    alertFees: {
      count: rows.reduce((s, r) => s + r.alertFees.count, 0),
      amount: sum((r) => r.alertFees.amount),
    },
  };
}

/**
 * Le récap de `from`…`to`. `rows` = les lignes mensuelles disponibles (une ou
 * deux années de getComptaOverview) : un mois sans ligne n'a rien eu. La
 * période d'avant n'est comparée que si l'un de ses mois a une ligne — avant le
 * premier mois d'activité, comparer à zéro ne dit rien.
 */
export function buildComptaRecap(rows: readonly RecapRow[], from: string, to: string): ComptaRecap {
  const months = monthRange(from, to);
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const cur = months.flatMap((m) => byMonth.get(m) ?? []);
  const prevMonths = previousPeriod(from, months.length);
  const prevRows = prevMonths.flatMap((m) => byMonth.get(m) ?? []);
  const totals = totalsOf(cur);
  const previous =
    prevRows.length === 0 ? null : { ...totalsOf(prevRows), from: prevMonths[0], to: prevMonths[prevMonths.length - 1] };

  const categories = new Map<ChargeCategory, number>();
  for (const r of cur) for (const c of r.otherByCategory) categories.set(c.category, (categories.get(c.category) ?? 0) + c.amount);
  const sources = new Set(cur.map((r) => r.scanSource).filter((s) => s !== null));

  let drivers: RecapDriver[] = [];
  if (previous) {
    const delta = round2(totals.result - previous.result);
    const all: RecapDriver[] = [
      { key: "net", effect: round2(totals.net - previous.net) },
      { key: "creators", effect: round2(previous.creators - totals.creators) },
      { key: "scans", effect: round2(previous.scans - totals.scans) },
      { key: "other", effect: round2(previous.other - totals.other) },
    ];
    drivers = all
      .filter((d) => d.effect !== 0 && Math.sign(d.effect) === Math.sign(delta))
      .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
      .slice(0, 2);
  }

  return {
    ...totals,
    from,
    to,
    months,
    inProgress: cur.some((r) => r.inProgress),
    incomplete: cur.some((r) => r.incomplete.some((x) => x !== "unclassified")),
    deductions: round2(cur.reduce((s, r) => s + r.ledger.refunds + r.ledger.disputes + r.ledger.fees, 0)),
    scanSource: sources.size === 0 ? null : sources.size > 1 ? "mixed" : [...sources][0],
    otherByCategory: [...categories.entries()]
      .map(([category, amount]) => ({ category, amount: round2(amount) }))
      .filter((c) => c.amount !== 0)
      .sort((a, b) => b.amount - a.amount),
    margin: totals.net > 0 ? Math.round((totals.result / totals.net) * 100) : null,
    previous,
    grossChange:
      previous && previous.gross > 0 ? Math.round(((totals.gross - previous.gross) / previous.gross) * 100) : null,
    drivers,
  };
}

/**
 * Les parts du net pour la barre « où est allé le net » : résultat, créatrices,
 * scans, autres charges, en % de la barre. Un résultat négatif n'a pas de
 * segment (les charges dépassent le net : la barre mesure alors les charges).
 */
export function netShares(r: Pick<ComptaRecap, "net" | "creators" | "scans" | "other" | "result">): {
  key: "result" | "creators" | "scans" | "other";
  amount: number;
  share: number;
}[] {
  const parts = [
    { key: "result" as const, amount: r.result },
    { key: "creators" as const, amount: r.creators },
    { key: "scans" as const, amount: r.scans },
    { key: "other" as const, amount: r.other },
  ];
  const positive = parts.filter((p) => p.amount > 0);
  const whole = positive.reduce((s, p) => s + p.amount, 0);
  if (whole <= 0) return [];
  return positive.map((p) => ({ ...p, share: Math.round((p.amount / whole) * 10_000) / 100 }));
}

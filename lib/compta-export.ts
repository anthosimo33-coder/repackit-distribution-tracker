/**
 * EXPORT COMPTABLE d'un mois — construit les lignes du CSV envoyé au comptable.
 *
 * Module PUR : les libellés arrivent TRADUITS de l'écran (`ExportLabels`), les
 * données arrivent de `compta.getComptaJournal`. Testé dans
 * lib/compta-export.test.ts.
 *
 * FORMAT : un tableur français doit l'ouvrir tel quel — séparateur « ; »,
 * virgule décimale sans séparateur de milliers, dates JJ/MM/AAAA. L'export des
 * Paiements utilise « , » et le point : Excel en français met alors tout dans la
 * colonne A. Chaque montant garde sa devise d'origine, le taux appliqué et sa
 * contre-valeur dans la devise de référence : le comptable refait le calcul.
 */
import {
  dayKeyToFr,
  isChargeCategory,
  type ChargeCategory,
  type ComptaBucket,
  type LineBucket,
  type TransferUsage,
} from "../convex/comptaMath";

/** `-1234.5` → `-1234,50` : deux décimales, virgule, aucun séparateur de milliers. */
export function csvNumberFr(n: number): string {
  const fixed = (Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100).toFixed(2);
  return (fixed === "-0.00" ? "0.00" : fixed).replace(".", ",");
}

/** Taux : jusqu'à 6 décimales utiles, virgule. `1` reste `1`. */
export function csvRateFr(rate: number): string {
  return String(Math.round(rate * 1e6) / 1e6).replace(".", ",");
}

const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** CSV « ; » (RFC 4180 pour les guillemets), lignes séparées par CRLF. */
export function toSemicolonCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(quote).join(";")).join("\r\n");
}

export type JournalData = {
  month: string;
  currency: string | null;
  rates: Readonly<Record<string, number>>;
  payCurrency: string | null;
  ledger: readonly {
    day: string;
    lineType: string;
    bucket: LineBucket;
    amount: number;
    currency: string;
    reference: string;
    label: string | null;
    destination: string | null;
    /** Ventilation d'un retrait : à quoi a servi chaque part. */
    parts: readonly { amount: number; usage: string; note: string | null }[];
  }[];
  creators: readonly {
    day: string;
    name: string | null;
    period: string;
    kind: "advance" | "settlement";
    amount: number;
  }[];
  scan: {
    lightUsd: number;
    fullUsd: number;
    otherUsd: number;
    runs: number;
    withCost: number;
  } | null;
  charges: readonly {
    day: string;
    label: string;
    category: string;
    amount: number;
    currency: string;
    planned: boolean;
  }[];
};

export type ExportLabels = {
  header: {
    date: string;
    nature: string;
    post: string;
    label: string;
    reference: string;
    amount: string;
    currency: string;
    rate: string;
    /** En-tête de la contre-valeur, devise comprise (« Montant EUR »). */
    converted: (currency: string) => string;
  };
  nature: Record<"revenue" | "refund" | "dispute" | "fee" | "treasury" | "internal" | "unclassified" | "expense", string>;
  bucket: Record<ComptaBucket | "unclassified", string>;
  creators: string;
  scans: string;
  other: (category: string) => string;
  category: Record<ChargeCategory, string>;
  creatorLine: (name: string, period: string) => string;
  advanceLine: (name: string) => string;
  unknownCreator: string;
  scanLine: (kind: "light" | "full" | "other") => string;
  plannedSuffix: string;
  transferLine: (destination: string | null) => string;
  usage: Record<TransferUsage, string>;
  /** Poste du récapitulatif. */
  summary: {
    month: string;
    post: string;
    gross: string;
    refunds: string;
    disputes: string;
    fees: string;
    net: string;
    creators: string;
    scans: string;
    otherCategory: (category: string) => string;
    result: string;
    transfers: string;
    unclassified: string;
  };
};

const NATURE_OF: Record<LineBucket, keyof ExportLabels["nature"]> = {
  gross: "revenue",
  refunds: "refund",
  disputes: "dispute",
  fees: "fee",
  transfers: "treasury",
  internal: "internal",
  unclassified: "unclassified",
};

/** Date « YYYY-MM-DD » ou période « YYYY-MM » d'un cycle, lisible. */
function periodFr(period: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(period) ? dayKeyToFr(period) : period;
}

type Row = { day: string; order: number; cells: string[] };

/**
 * Journal détaillé : une ligne par mouvement, triée par jour. Une devise sans
 * taux laisse la contre-valeur VIDE — jamais 1:1.
 */
export function buildJournalRows(data: JournalData, l: ExportLabels): string[][] {
  const ref = (data.currency ?? "").toUpperCase();
  const rate = (cur: string): number | null => {
    const r = data.rates[cur.toLowerCase()];
    return typeof r === "number" && r > 0 ? r : null;
  };
  const line = (
    day: string,
    order: number,
    nature: string,
    post: string,
    label: string,
    reference: string,
    amount: number,
    currency: string,
  ): Row => {
    const r = rate(currency);
    return {
      day,
      order,
      cells: [
        dayKeyToFr(day),
        nature,
        post,
        label,
        reference,
        csvNumberFr(amount),
        currency.toUpperCase(),
        r === null ? "" : csvRateFr(r),
        r === null ? "" : csvNumberFr(amount * r),
      ],
    };
  };

  const rows: Row[] = [];
  for (const g of data.ledger) {
    let label: string;
    if (g.bucket === "transfers") {
      // Ventilé : « Rémunération 1500,00 : Ma paie ; Charges de l'activité 200,00 : TikTok Ads ».
      // Une part unique du montant entier se lit sans montant.
      const whole = g.parts.length === 1 && Math.abs(g.parts[0].amount + g.amount) < 0.005;
      const parts = g.parts
        .map((p) => {
          const usage = p.usage in l.usage ? l.usage[p.usage as TransferUsage] : p.usage;
          const head = whole ? usage : `${usage} ${csvNumberFr(p.amount)}`;
          return p.note ? `${head} : ${p.note}` : head;
        })
        .join(" ; ");
      label = [l.transferLine(g.destination), parts].filter((x) => x !== "").join(" — ");
    } else {
      label = g.label ? `${g.lineType} — ${g.label}` : g.lineType;
    }
    rows.push(
      line(g.day, 0, l.nature[NATURE_OF[g.bucket]], l.bucket[g.bucket], label, g.reference, g.amount, g.currency),
    );
  }
  for (const c of data.creators) {
    const name = c.name ?? l.unknownCreator;
    rows.push(
      line(
        c.day,
        1,
        l.nature.expense,
        l.creators,
        c.kind === "advance" ? l.advanceLine(name) : l.creatorLine(name, periodFr(c.period)),
        "",
        -c.amount,
        data.payCurrency ?? "",
      ),
    );
  }
  const paidScans = data.charges.some((c) => c.category === "scans");
  for (const c of data.charges) {
    const cat = isChargeCategory(c.category) ? l.category[c.category] : c.category;
    rows.push(
      line(
        c.day,
        2,
        l.nature.expense,
        c.category === "scans" ? l.scans : l.other(cat),
        c.planned ? `${c.label} ${l.plannedSuffix}` : c.label,
        "",
        -c.amount,
        c.currency,
      ),
    );
  }
  // L'estimation cost_usd n'entre au journal que si aucun paiement réel au
  // fournisseur des scans n'est saisi ce mois-là : sinon elle le compterait deux fois.
  if (data.scan && !paidScans) {
    const last = `${data.month}-${String(new Date(Date.UTC(Number(data.month.slice(0, 4)), Number(data.month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
    const parts = [
      ["light", data.scan.lightUsd],
      ["full", data.scan.fullUsd],
      ["other", data.scan.otherUsd],
    ] as const;
    for (const [kind, usd] of parts) {
      if (usd === 0) continue;
      rows.push(line(last, 3, l.nature.expense, l.scans, l.scanLine(kind), "", -usd, "usd"));
    }
  }

  rows.sort((a, b) => (a.day === b.day ? a.order - b.order : a.day < b.day ? -1 : 1));
  return [
    [
      l.header.date,
      l.header.nature,
      l.header.post,
      l.header.label,
      l.header.reference,
      l.header.amount,
      l.header.currency,
      l.header.rate,
      l.header.converted(ref),
    ],
    ...rows.map((r) => r.cells),
  ];
}

/**
 * Récapitulatif : une ligne par poste, dans la devise de référence. Recalculé
 * depuis le MÊME journal que le détail : les deux fichiers ne peuvent pas se
 * contredire. Un poste qui contient un montant sans taux (ou des scans sans
 * coût mesuré) reste VIDE, ainsi que le résultat : jamais un zéro inventé. Le
 * poste « non classé » n'apparaît que s'il y a des lignes.
 */
export function buildSummaryRows(data: JournalData, l: ExportLabels): string[][] {
  type Acc = { v: number; ok: boolean };
  const acc = (): Acc => ({ v: 0, ok: true });
  const add = (a: Acc, amount: number, currency: string) => {
    const r = data.rates[currency.toLowerCase()];
    if (typeof r === "number" && r > 0) a.v += amount * r;
    else a.ok = false;
  };
  const sum: Record<LineBucket, Acc> = {
    gross: acc(),
    refunds: acc(),
    disputes: acc(),
    fees: acc(),
    transfers: acc(),
    internal: acc(),
    unclassified: acc(),
  };
  let unclassifiedCount = 0;
  for (const g of data.ledger) {
    add(sum[g.bucket], g.amount, g.currency);
    if (g.bucket === "unclassified") unclassifiedCount += 1;
  }
  const creators = acc();
  for (const c of data.creators) add(creators, c.amount, data.payCurrency ?? "");
  const scans = acc();
  const paidScans = data.charges.filter((c) => c.category === "scans");
  if (paidScans.length > 0) {
    for (const c of paidScans) add(scans, c.amount, c.currency);
  } else if (data.scan) {
    if (data.scan.runs > 0 && data.scan.withCost === 0) scans.ok = false;
    else add(scans, data.scan.lightUsd + data.scan.fullUsd + data.scan.otherUsd, "usd");
  }
  const byCat = new Map<string, Acc>();
  for (const c of data.charges) {
    if (c.category === "scans") continue;
    const cat = isChargeCategory(c.category) ? l.category[c.category] : c.category;
    const a = byCat.get(cat) ?? acc();
    add(a, c.amount, c.currency);
    byCat.set(cat, a);
  }
  const cell = (a: Acc, sign = 1) => (a.ok ? csvNumberFr(sign * a.v) : "");
  const netParts = [sum.gross, sum.refunds, sum.disputes, sum.fees];
  const net: Acc = { v: netParts.reduce((s, a) => s + a.v, 0), ok: netParts.every((a) => a.ok) };
  const charges = [creators, scans, ...byCat.values()];
  const result: Acc = {
    v: net.v - charges.reduce((s, a) => s + a.v, 0),
    ok: net.ok && charges.every((a) => a.ok),
  };
  const ref = (data.currency ?? "").toUpperCase();
  const m = data.month;
  const rows: string[][] = [
    [l.summary.month, l.summary.post, l.header.converted(ref)],
    [m, l.summary.gross, cell(sum.gross)],
    [m, l.summary.refunds, cell(sum.refunds)],
    [m, l.summary.disputes, cell(sum.disputes)],
    [m, l.summary.fees, cell(sum.fees)],
    [m, l.summary.net, cell(net)],
    [m, l.summary.creators, cell(creators, -1)],
    [m, l.summary.scans, cell(scans, -1)],
    ...[...byCat.entries()].map(([cat, a]) => [m, l.summary.otherCategory(cat), cell(a, -1)]),
    [m, l.summary.result, cell(result)],
    [m, l.summary.transfers, cell(sum.transfers, -1)],
  ];
  if (unclassifiedCount > 0) rows.push([m, l.summary.unclassified, cell(sum.unclassified)]);
  return rows;
}

import { describe, it, expect } from "vitest";
import {
  buildJournalRows,
  buildSummaryRows,
  csvNumberFr,
  toSemicolonCsv,
  type ExportLabels,
  type JournalData,
} from "./compta-export";

/**
 * EXPORT COMPTABLE — le fichier que le comptable ouvre dans Excel en français.
 * Données à la forme de la prod : un mois Snytch en euros avec des paiements en
 * dollars et en dinars, une créatrice payée en dollars, un abonnement en
 * dollars, un virement annoté.
 */

const L: ExportLabels = {
  header: {
    date: "Date",
    nature: "Nature",
    post: "Poste",
    label: "Libellé",
    reference: "Référence",
    amount: "Montant",
    currency: "Devise",
    rate: "Taux",
    converted: (c) => `Montant ${c}`,
  },
  nature: {
    revenue: "Recette",
    refund: "Remboursement",
    dispute: "Litige",
    fee: "Frais",
    treasury: "Trésorerie",
    internal: "Hors résultat",
    unclassified: "Non classé",
    expense: "Charge",
  },
  bucket: {
    gross: "CA brut",
    refunds: "Remboursements",
    disputes: "Litiges",
    fees: "Frais Whop",
    transfers: "Virement reçu",
    internal: "Hors résultat",
    unclassified: "Non classé",
  },
  creators: "Créatrices",
  scans: "Scans",
  other: (cat) => `Autres — ${cat}`,
  category: { hosting: "Hébergement", tools: "Outils", subscriptions: "Abonnements", other: "Autre" },
  creatorLine: (name, period) => `${name} — cycle du ${period}`,
  advanceLine: (name) => `${name} — acompte`,
  unknownCreator: "Créatrice supprimée",
  scanLine: (k) => (k === "light" ? "Scans légers" : k === "full" ? "Scans complets" : "Autres scans"),
  plannedSuffix: "(prévue)",
  transferLine: (d) => `Virement Whop → ${d ?? "banque"}`,
  usage: {
    pay: "Rémunération",
    creators: "Paiement créatrices",
    provision: "Mise de côté",
    business: "Charges de l'activité",
    other: "Autre",
  },
  summary: {
    month: "Mois",
    post: "Poste",
    gross: "CA brut encaissé",
    refunds: "Remboursements",
    disputes: "Litiges",
    fees: "Frais Whop",
    net: "Net Whop",
    creators: "Créatrices",
    scans: "Scans",
    otherCategory: (c) => `Autres charges — ${c}`,
    result: "Résultat",
    transfers: "Virements reçus",
    unclassified: "Non classé",
  },
};

const DATA: JournalData = {
  month: "2026-09",
  currency: "eur",
  rates: { eur: 1, usd: 0.86, rsd: 0.00852 },
  payCurrency: "usd",
  ledger: [
    { day: "2026-09-16", lineType: "payment_gross", bucket: "gross", amount: 11.99, currency: "usd", reference: "pay_Hc9", label: "Snytch Pro 3 Targets - Weekly", destination: null, usage: null, note: null },
    { day: "2026-09-01", lineType: "payment_gross", bucket: "gross", amount: 9.99, currency: "eur", reference: "pay_mJJosdR2XyYjLl", label: "Snytch Pro 3 cibles — Hebdo", destination: null, usage: null, note: null },
    { day: "2026-09-01", lineType: "payment_processing_percentage_fee", bucket: "fees", amount: -0.55, currency: "eur", reference: "pay_mJJosdR2XyYjLl", label: null, destination: null, usage: null, note: null },
    { day: "2026-09-11", lineType: "payment_gross", bucket: "gross", amount: 599, currency: "rsd", reference: "pay_Rs1", label: "Snytch Pro 3 cilja — Nedeljno", destination: null, usage: null, note: null },
    { day: "2026-09-05", lineType: "withdrawal", bucket: "transfers", amount: -2000, currency: "eur", reference: "wdrl_2Lk9Xq7Tz", label: null, destination: "SEPA ••4821", usage: "pay", note: "Ma paie de septembre" },
  ],
  creators: [
    { day: "2026-09-16", name: "Kelly Moreau", period: "2026-08-02", kind: "settlement", amount: 1074.57 },
  ],
  scan: { lightUsd: 540.63, fullUsd: 562.39, otherUsd: 0, runs: 179177, withCost: 179177 },
  charges: [
    { day: "2026-09-01", label: "Vercel Pro", category: "hosting", amount: 20, currency: "usd", planned: false },
  ],
};

describe("format des nombres", () => {
  it("virgule décimale, deux décimales, aucun séparateur de milliers", () => {
    expect(csvNumberFr(-1074.57)).toBe("-1074,57");
    expect(csvNumberFr(9901.3)).toBe("9901,30");
    expect(csvNumberFr(-0.001)).toBe("0,00");
  });
  it("séparateur « ; » et guillemets doublés", () => {
    expect(toSemicolonCsv([["a;b", 'dit "oui"'], ["1", "2"]])).toBe('"a;b";"dit ""oui"""\r\n"1";"2"');
  });
});

describe("journal détaillé", () => {
  const rows = buildJournalRows(DATA, L);
  it("trie par jour, date en JJ/MM/AAAA", () => {
    expect(rows[0]).toEqual([
      "Date", "Nature", "Poste", "Libellé", "Référence", "Montant", "Devise", "Taux", "Montant EUR",
    ]);
    expect(rows.slice(1).map((r) => r[0])).toEqual([
      "01/09/2026", "01/09/2026", "01/09/2026", "05/09/2026", "11/09/2026", "16/09/2026", "16/09/2026", "30/09/2026", "30/09/2026",
    ]);
  });
  it("garde le montant d'origine, le taux et la contre-valeur", () => {
    const usd = rows.find((r) => r[4] === "pay_Hc9")!;
    expect(usd.slice(5)).toEqual(["11,99", "USD", "0,86", "10,31"]);
    const rsd = rows.find((r) => r[4] === "pay_Rs1")!;
    expect(rsd.slice(5)).toEqual(["599,00", "RSD", "0,00852", "5,10"]);
  });
  it("la créatrice sort en charge, en dollars convertis", () => {
    const k = rows.find((r) => r[3].startsWith("Kelly Moreau"))!;
    expect(k).toEqual([
      "16/09/2026", "Charge", "Créatrices", "Kelly Moreau — cycle du 02/08/2026", "", "-1074,57", "USD", "0,86", "-924,13",
    ]);
  });
  it("le virement porte son usage et son motif", () => {
    const w = rows.find((r) => r[4] === "wdrl_2Lk9Xq7Tz")!;
    expect(w[1]).toBe("Trésorerie");
    expect(w[3]).toBe("Virement Whop → SEPA ••4821 — Rémunération : Ma paie de septembre");
    expect(w[5]).toBe("-2000,00");
  });
  it("une devise sans taux laisse la contre-valeur VIDE, jamais 1:1", () => {
    const sansRsd = buildJournalRows({ ...DATA, rates: { eur: 1, usd: 0.86 } }, L);
    const rsd = sansRsd.find((r) => r[4] === "pay_Rs1")!;
    expect(rsd.slice(5)).toEqual(["599,00", "RSD", "", ""]);
  });
});

describe("récapitulatif", () => {
  it("un poste par ligne, recalculé depuis le journal", () => {
    expect(buildSummaryRows(DATA, L)).toEqual([
      ["Mois", "Poste", "Montant EUR"],
      ["2026-09", "CA brut encaissé", "25,40"],
      ["2026-09", "Remboursements", "0,00"],
      ["2026-09", "Litiges", "0,00"],
      ["2026-09", "Frais Whop", "-0,55"],
      ["2026-09", "Net Whop", "24,85"],
      ["2026-09", "Créatrices", "-924,13"],
      ["2026-09", "Scans", "-948,60"],
      ["2026-09", "Autres charges — Hébergement", "-17,20"],
      ["2026-09", "Résultat", "-1865,07"],
      ["2026-09", "Virements reçus", "2000,00"],
    ]);
  });
  it("des scans sans coût mesuré laissent Scans ET Résultat vides", () => {
    const rows = buildSummaryRows(
      { ...DATA, scan: { lightUsd: 0, fullUsd: 0, otherUsd: 0, runs: 4122, withCost: 0 } },
      L,
    );
    expect(rows.find((r) => r[1] === "Scans")![2]).toBe("");
    expect(rows.find((r) => r[1] === "Résultat")![2]).toBe("");
    // Présence : le net, lui, reste chiffré.
    expect(rows.find((r) => r[1] === "Net Whop")![2]).toBe("24,85");
  });
});

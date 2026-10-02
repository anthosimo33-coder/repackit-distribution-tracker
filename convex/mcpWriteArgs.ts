/**
 * Lecture des ARGUMENTS des outils MCP d'écriture (pur, sans base) : les usages,
 * catégories et colonnes s'écrivent comme à l'écran ou par leur code ; les
 * montants à la française ; les jours en AAAA-MM-JJ.
 */

import type { ChargeCategory, ComptaBucket, TransferUsage } from "./comptaMath";

/** Sans accents, sans casse, espaces réduits : « Paiement Créatrices » = « paiement creatrices ». */
export const plierTexte = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const USAGES: Record<TransferUsage, readonly string[]> = {
  pay: ["remuneration", "paie", "ma paie"],
  creators: ["paiement createurs", "paiement creatrices", "createurs", "creatrices"],
  provision: ["mise de cote", "mise de cote (impots, urssaf)", "impots", "urssaf"],
  business: ["charges de l'activite", "charge de l'activite", "depense", "charges"],
  recover: ["a recuperer", "a recuperer (bloque, en transit)", "bloque", "en transit"],
  other: ["autre"],
};
const CATEGORIES: Record<ChargeCategory, readonly string[]> = {
  hosting: ["hebergement"],
  tools: ["outils", "outil"],
  subscriptions: ["abonnements", "abonnement"],
  ads: ["publicite", "pub"],
  scans: ["scans", "scan"],
  other: ["autre"],
};
const COLONNES: Record<ComptaBucket, readonly string[]> = {
  gross: ["ca brut", "chiffre d'affaires"],
  refunds: ["remboursements", "remboursement"],
  disputes: ["litiges", "litige"],
  fees: ["frais whop", "frais"],
  transfers: ["virements", "virements vers la banque", "virement"],
  internal: ["mouvements internes", "mouvements internes (hors resultat)", "interne"],
};

function depuis<K extends string>(table: Record<K, readonly string[]>, texte: unknown): K | null {
  if (typeof texte !== "string") return null;
  const t = plierTexte(texte);
  for (const [code, libelles] of Object.entries(table) as [K, readonly string[]][]) {
    if (t === code || libelles.includes(t)) return code;
  }
  return null;
}

/** Un usage de part de virement, écrit comme à l'écran ou par son code. */
export const usageDepuis = (texte: unknown): TransferUsage | null => depuis(USAGES, texte);
/** Une catégorie de charge, écrite comme à l'écran ou par son code. */
export const categorieDepuis = (texte: unknown): ChargeCategory | null => depuis(CATEGORIES, texte);
/** Une colonne du grand livre, écrite comme à l'écran ou par son code. */
export const colonneDepuis = (texte: unknown): ComptaBucket | null => depuis(COLONNES, texte);

/** Un montant : nombre, ou texte à la française (« 1 337,49 », « 1337.49 »). */
export function montantDepuis(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x !== "string" || x.trim() === "") return null;
  const n = Number(x.replace(/[\s  €$]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Un jour AAAA-MM-JJ ; absent = aujourd'hui (Paris). */
export function jourDepuis(x: unknown, aujourdhui: string): string | null {
  if (x === undefined || x === null || x === "") return aujourdhui;
  return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.trim()) ? x.trim() : null;
}

/** « 1337,49 EUR » : lisible au journal, sans dépendre de la locale du runtime. */
export const montantTexte = (n: number, devise: string) =>
  `${n.toFixed(2).replace(".", ",")} ${devise.toUpperCase()}`;

export const LIBELLE_COLONNE: Record<ComptaBucket, string> = {
  gross: "CA brut",
  refunds: "remboursements",
  disputes: "litiges",
  fees: "frais Whop",
  transfers: "virements",
  internal: "mouvements internes",
};

/** « 05/09/2025 » : un jour AAAA-MM-JJ, lisible au journal. */
export const jourTexte = (day: string) => {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
};

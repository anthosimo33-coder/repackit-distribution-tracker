/**
 * DEVISE DE PAIE PAR BARÈME — module PUR (aucun import), partagé par le serveur
 * et par l'écran (via lib/currency, règle A6 : convex/ n'importe rien de lib/).
 *
 * Jusqu'au 2026-10-03, la paie avait UNE devise par projet (`projects.payCurrency`).
 * Les créatrices françaises de Snytch étaient payées en euros, mais leurs barèmes
 * se saisissaient en dollars convertis à la main : « 400 €/mois » stocké à 465.
 * La devise vit désormais sur le BARÈME (`pricings.currency`), figée sur chaque
 * vidéo comme le fixe et le CPM (`pricingSnapshot.currency`).
 *
 * TROIS RÈGLES, qui tiennent tout le reste :
 *
 *  1. UNE DEVISE PAR CRÉATRICE (`creators.payCurrency`, absente ⇒ celle du
 *     projet). Le serveur refuse de lui assigner un barème d'une autre devise :
 *     ses cycles, ses paiements gelés, ses acomptes et son portail restent ainsi
 *     dans une seule monnaie, et le moteur de paie n'additionne jamais deux
 *     devises. Le plafond par vidéo (150) s'applique dans la devise du barème.
 *
 *  2. ABSENT ⇒ DEVISE DU PROJET. Toutes les données d'avant (barèmes, snapshots,
 *     paliers, paiements) n'ont pas de devise : elles étaient, par construction,
 *     dans la devise du projet. 0 migration.
 *
 *  3. LES TOTAUX DU PROJET NE MÉLANGENT JAMAIS. L'écran Paiements sépare les
 *     devises ; les écrans d'analyse (coût, marge, marchés) ramènent chaque
 *     montant dans la devise de paie du projet avec les taux DÉJÀ réglés
 *     (`payCurrencyFactor`). Une devise sans chemin de conversion est refusée
 *     dès la création du barème, jamais devinée à la lecture.
 */

/** Devises proposées au choix sur un barème. */
export const PAY_CURRENCY_CHOICES = ["usd", "eur"] as const;

/** Code devise normalisé (minuscules, sans espaces) ; `null` si absent ou vide. */
export function normalizeCurrency(c?: string | null): string | null {
  const t = c?.trim().toLowerCase();
  return t ? t : null;
}

/**
 * Devise EFFECTIVE d'un montant de paie : la sienne si elle est posée, sinon
 * celle du projet (règle 2). `null` si ni l'une ni l'autre — le montant
 * s'affiche alors sans symbole, jamais avec une devise inventée.
 */
export function resolvePayCurrency(
  own: string | null | undefined,
  projectPayCurrency: string | null | undefined,
): string | null {
  return normalizeCurrency(own) ?? normalizeCurrency(projectPayCurrency);
}

/** Ce qu'il faut savoir d'un projet pour convertir une devise de paie. */
export interface PayFxProject {
  payCurrency?: string | null;
  /** 1 unité de payCurrency = ce nombre d'unités de la devise du revenu. */
  fxRateToRevenue?: number | null;
  /** Les AUTRES devises, chacune vers la devise du revenu. */
  fxRatesToRevenue?: readonly { currency: string; rate: number }[] | null;
}

/**
 * FACTEUR DE CONVERSION d'une devise de paie vers la devise de paie du PROJET :
 * 1 unité de `currency` = `facteur` unités de `project.payCurrency`.
 *
 *  - même devise (ou absente) → 1 : rien ne bouge, c'est le cas de tous les
 *    montants d'avant les barèmes en devise ;
 *  - devise avec son propre taux vers le revenu → taux / taux de la paie ;
 *  - devise SANS taux propre → c'est la devise du REVENU, la cible de tous les
 *    taux (chez Snytch : l'euro, 1 $ = 0,86 € ⇒ 1 € = 1 / 0,86 $). Cette
 *    lecture n'est sûre que parce que `assertPayCurrencyConvertible` l'a
 *    vérifiée à la création du barème ;
 *  - aucun taux de paie réglé → `null` : on ne sait pas, on ne devine pas.
 */
export function payCurrencyFactor(
  currency: string | null | undefined,
  project: PayFxProject | null | undefined,
): number | null {
  const pay = normalizeCurrency(project?.payCurrency);
  const c = normalizeCurrency(currency) ?? pay;
  if (c === null || c === pay) return 1;
  const payRate = project?.fxRateToRevenue;
  if (typeof payRate !== "number" || !(payRate > 0)) return null;
  const own = (project?.fxRatesToRevenue ?? []).find(
    (r) => normalizeCurrency(r.currency) === c,
  );
  if (own && own.rate > 0) return own.rate / payRate;
  return 1 / payRate;
}

/**
 * Une devise de paie est-elle CONVERTIBLE dans ce projet ? Oui si c'est la
 * sienne, si elle a son propre taux vers le revenu, ou si c'est la devise de
 * référence du revenu elle-même (et que la paie du projet a un taux vers elle).
 * C'est la condition pour que `payCurrencyFactor` ne mente jamais.
 */
export function isPayCurrencyConvertible(
  currency: string,
  project: PayFxProject | null | undefined,
  revenueReferenceCurrency: string | null | undefined,
): boolean {
  const c = normalizeCurrency(currency);
  if (c === null) return false;
  const pay = normalizeCurrency(project?.payCurrency);
  if (c === pay) return true;
  const payRate = project?.fxRateToRevenue;
  if (typeof payRate !== "number" || !(payRate > 0)) return false;
  const own = (project?.fxRatesToRevenue ?? []).some(
    (r) => normalizeCurrency(r.currency) === c && r.rate > 0,
  );
  return own || c === normalizeCurrency(revenueReferenceCurrency);
}

/**
 * TOTAUX PAR DEVISE — une entrée par devise, jamais fondues. Pour les écrans et
 * les outils qui additionnent la paie de plusieurs créatrices : on vire des
 * euros d'un côté, des dollars de l'autre, et leur somme n'existe dans aucune
 * banque. Un projet où tout le monde est payé dans la même devise rend une
 * seule entrée — le total d'avant.
 */
export type MoneyByCurrency = { currency: string | null; amount: number }[];

/** Somme des montants, une entrée par devise, la plus grosse d'abord. */
export function sumByCurrency(
  items: Iterable<{ amount: number; currency: string | null | undefined }>,
): MoneyByCurrency {
  const acc = new Map<string | null, number>();
  for (const it of items) {
    const c = normalizeCurrency(it.currency);
    acc.set(c, Math.round(((acc.get(c) ?? 0) + it.amount) * 100) / 100);
  }
  return [...acc.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount);
}

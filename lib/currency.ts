/**
 * DEVISES du produit — il y en a DEUX, jamais un défaut.
 *  - PAIE créatrices (fixe, CPM, bonus, paliers, dû, cycles) : DOLLARS, code dans
 *    projects.payCurrency ;
 *  - REVENU Whop (net encaissé, économie par offre, frais) : EUROS, code dans
 *    whopPayments.currency.
 *
 * Règle absolue : les deux ne sont JAMAIS additionnées ni comparées sans
 * conversion explicite. La marge (revenu − coût) croise les deux → elle n'existe
 * que si un taux de change les relie (projects.fxRateToRevenue), sinon elle n'est
 * pas calculée (jamais inventée).
 *
 * Module PUR (aucune dép Convex/React), testé côté lib.
 */

/** Symbole d'une devise (« $ », « € ») via Intl ; "" si code absent/inconnu. */
export function currencySymbol(
  currency?: string | null,
  locale: string = "fr-FR",
): string {
  if (!currency || currency.trim() === "") return "";
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.trim().toUpperCase(),
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? "";
  } catch {
    return "";
  }
}

/** Deux codes devise désignent-ils la même monnaie (casse/espaces ignorés) ? */
export function sameCurrency(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Taux EFFECTIF pour exprimer la devise de la PAIE dans celle du REVENU :
 *  - mêmes devises → 1 (aucune conversion nécessaire) ;
 *  - devises différentes → le taux du projet (fxRateToRevenue) s'il est renseigné
 *    et strictement positif ;
 *  - sinon `null` = marge NON calculable (on ne mélange jamais deux devises).
 */
export function effectiveFxRate(
  payCurrency: string | null | undefined,
  revenueCurrency: string | null | undefined,
  fxRateToRevenue: number | null | undefined,
): number | null {
  if (sameCurrency(payCurrency, revenueCurrency)) return 1;
  if (typeof fxRateToRevenue === "number" && fxRateToRevenue > 0) {
    return fxRateToRevenue;
  }
  return null;
}

/**
 * Un montant prêt à AFFICHER : sa valeur dans la devise retenue, et de quoi
 * dire d'où elle vient.
 */
export interface DisplayAmount {
  /** Valeur à afficher, exprimée dans `currency`. */
  value: number;
  /** Devise d'affichage (celle du REVENU dès qu'une conversion est possible). */
  currency: string | null | undefined;
  /** true si `value` a été convertie depuis la devise de paie. */
  converted: boolean;
  /** Valeur d'origine, en devise de paie — pour la mention « 10,62 $ converti ». */
  sourceValue: number;
  /** Devise de paie. */
  sourceCurrency: string | null | undefined;
  /** Taux appliqué (1 si même devise, null si aucune conversion possible). */
  rate: number | null;
}

/**
 * Exprime un montant de PAIE (dollars) dans la devise du REVENU (euros), pour
 * que tout un écran se lise dans une seule unité.
 *
 * POURQUOI CE MODULE. La conversion existait déjà, appliquée à deux endroits
 * (RPM promo, Rétention) et oubliée partout ailleurs : « Coût d'acquisition »
 * et « Coût complet du moteur » sortaient en dollars, posés à côté d'un
 * « Revenu net par client » en euros comme s'ils étaient comparables. Relevé en
 * prod le 2026-08-30 : 10,62 $ face à 11,10 € — soit 9,13 € une fois converti.
 * L'erreur se lisait donc dans le MAUVAIS SENS, la marge réelle étant meilleure
 * que ce que l'écran montrait.
 *
 * SANS TAUX RÉGLÉ (`fxRateToRevenue` absent — cas des projets autres que
 * Snytch), le montant RESTE dans sa devise de paie et `converted` vaut false :
 * forcer l'euro sans taux inventerait un chiffre. L'écran doit alors le dire.
 */
export function payAmountInRevenueCurrency(
  amount: number,
  payCurrency: string | null | undefined,
  revenueCurrency: string | null | undefined,
  fxRateToRevenue: number | null | undefined,
): DisplayAmount {
  const rate = effectiveFxRate(payCurrency, revenueCurrency, fxRateToRevenue);
  if (rate === null) {
    return {
      value: amount,
      currency: payCurrency,
      converted: false,
      sourceValue: amount,
      sourceCurrency: payCurrency,
      rate: null,
    };
  }
  return {
    // rate === 1 : mêmes devises, aucune conversion — on le dit (converted:false)
    // plutôt que d'afficher « converti » sur un montant qui n'a pas bougé.
    value: rate === 1 ? amount : Math.round(amount * rate * 100) / 100,
    currency: rate === 1 ? payCurrency : revenueCurrency,
    converted: rate !== 1,
    sourceValue: amount,
    sourceCurrency: payCurrency,
    rate,
  };
}

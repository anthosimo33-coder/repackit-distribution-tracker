/**
 * Phase PROMO d'une publication (LOT 3) — logique PURE, testée Vitest. Répond à
 * « ce post compte-t-il dans les VUES PROMO / les taux de conversion ? ».
 * INDÉPENDANT de la paie (`isRemunerated`, lib/remunerate) : un post peut être
 * payé sans être promo (cas Kelly) et inversement.
 *
 * ⚠️ Règle A6 : jumeau STRICTEMENT IDENTIQUE en `convex/promoPhase.ts` ; la parité
 * est verrouillée par `lib/promo-phase.test.ts` (importe LES DEUX versions).
 */

export interface PromoPost {
  /** Fait éditorial : le contenu ne mentionne pas l'app. */
  isWarmup?: boolean;
  /** Exception EXPLICITE par post (nullable) : prend le dessus sur la date. */
  est_promo_override?: boolean;
  /** Date de publication (ms). */
  datePubli: number;
}

/**
 * Un post est-il en phase PROMO ? Ordre de priorité (décision produit, documenté) :
 *  1. `isWarmup === true` → false — le flag éditorial gagne TOUJOURS sur la date
 *     (un post postérieur à datePromoStart mais marqué warmup n'est PAS promo) ;
 *  2. `est_promo_override != null` → sa valeur — exception explicite à la date,
 *     dans les DEUX sens (true = force un post d'avant la date ; false = retire
 *     un post d'après la date) ;
 *  3. `datePromoStart` absent → false — phase non définie (0 vue promo) ;
 *  4. sinon → `datePubli >= datePromoStart`.
 *
 * La combinaison `isWarmup=true` + `est_promo_override=true` est INTERDITE en amont
 * (mutations, cf `isWarmupPromoConflict`) → les règles 1 et 2 ne peuvent pas se
 * contredire en pratique ; la règle 1 d'abord reste une garde défensive.
 */
export function isPromo(
  post: PromoPost,
  datePromoStart: number | null | undefined,
): boolean {
  if (post.isWarmup === true) return false;
  if (post.est_promo_override != null) return post.est_promo_override;
  if (datePromoStart == null) return false;
  return post.datePubli >= datePromoStart;
}

/**
 * Combinaison INTERDITE : un post à la fois warmup (« ne mentionne pas l'app ») ET
 * forcé promo (`est_promo_override=true`). État incohérent → toute mutation qui
 * aboutirait à ce couple ÉCHOUE avec un message explicite (jamais silencieux : un
 * override qui « ne fait rien » serait un piège). Depuis que `remunere` est
 * explicite sur toutes les publications, retirer le flag warmup n'affecte plus la
 * paie → corriger un post mal flaggé est gratuit, aucun chemin détourné à garder.
 */
export function isWarmupPromoConflict(
  isWarmup: boolean | undefined,
  estPromoOverride: boolean | null | undefined,
): boolean {
  return isWarmup === true && estPromoOverride === true;
}

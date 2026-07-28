/**
 * Phase PROMO d'une publication — RÉPLIQUE SERVEUR de `lib/promo-phase.ts` (règle
 * A6 : un module `convex/` ne peut pas importer `lib/`). DOIT rester STRICTEMENT
 * IDENTIQUE. La parité est verrouillée par `lib/promo-phase.test.ts`.
 *
 * Cf `lib/promo-phase.ts` pour la sémantique et l'ordre de priorité.
 */

export interface PromoPost {
  /** Fait éditorial : le contenu ne mentionne pas l'app. */
  isWarmup?: boolean;
  /** Exception EXPLICITE par post (nullable) : prend le dessus sur la date. */
  est_promo_override?: boolean;
  /** Date de publication (ms). */
  datePubli: number;
}

/** Un post est-il en phase PROMO ? Cf lib/promo-phase (DOIT rester identique). */
export function isPromo(
  post: PromoPost,
  datePromoStart: number | null | undefined,
): boolean {
  if (post.isWarmup === true) return false;
  if (post.est_promo_override != null) return post.est_promo_override;
  if (datePromoStart == null) return false;
  return post.datePubli >= datePromoStart;
}

/** Combinaison warmup + forcé-promo INTERDITE. Cf lib/promo-phase (identique). */
export function isWarmupPromoConflict(
  isWarmup: boolean | undefined,
  estPromoOverride: boolean | null | undefined,
): boolean {
  return isWarmup === true && estPromoOverride === true;
}

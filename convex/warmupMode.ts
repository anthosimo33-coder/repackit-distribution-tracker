/**
 * Mode de lecture WARMUP — RÉPLIQUE SERVEUR de `lib/warmup-mode.ts` (règle A6 :
 * un module `convex/` ne peut pas importer `lib/`). DOIT rester STRICTEMENT
 * IDENTIQUE (mêmes valeurs, même sémantique). La parité est verrouillée par
 * `lib/warmup-mode.test.ts`, qui importe LES DEUX versions.
 *
 * Point de décision UNIQUE « inclure / exclure les posts de chauffe » pour tout
 * agrégat de métriques serveur (vues, likes, saves, subsGained, comments).
 * Cf `lib/warmup-mode.ts` pour la justification complète (TD-019).
 */

/**
 * Tri-état EXPLICITE (jamais un booléen positionnel) :
 *  - "all"     : toutes les publications, warmup compris ;
 *  - "exclude" : posts monétisés seulement (warmup retiré) — DÉFAUT produit ;
 *  - "only"    : posts warmup seulement (contrôle du volume de chauffe).
 */
export type WarmupMode = "all" | "exclude" | "only";

/** Défaut = "exclude". Cf `lib/warmup-mode.ts` pour le pourquoi. */
export const DEFAULT_WARMUP_MODE: WarmupMode = "exclude";

/** Un post (via son flag `isWarmup`) passe-t-il le mode ? Cf `WarmupMode`. */
export function passesWarmupMode(isWarmup: boolean, mode: WarmupMode): boolean {
  if (mode === "all") return true;
  if (mode === "only") return isWarmup;
  return !isWarmup; // "exclude"
}

/**
 * Filtre une LISTE selon le mode warmup. `getIsWarmup` lit le flag d'un item —
 * les items ne sont pas forcément des publications brutes. C'est LE helper de
 * liste unique côté serveur.
 */
export function filterByWarmupMode<T>(
  items: readonly T[],
  getIsWarmup: (item: T) => boolean,
  mode: WarmupMode,
): T[] {
  return items.filter((it) => passesWarmupMode(getIsWarmup(it), mode));
}

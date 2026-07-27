/**
 * Rémunération d'un post — RÉPLIQUE SERVEUR de `lib/remunerate.ts` (règle A6 : un
 * module `convex/` ne peut pas importer `lib/`). DOIT rester STRICTEMENT IDENTIQUE.
 * La parité est verrouillée par `lib/remunerate.test.ts`, qui importe LES DEUX.
 *
 * Le point de décision UNIQUE « ce post est-il PAYÉ ? » (fait FINANCIER, LOT 2),
 * INDÉPENDANT du fait éditorial warmup. Cf `lib/remunerate.ts` pour le pourquoi.
 */

export interface RemunerationFlags {
  /** Fait éditorial : le contenu ne mentionne pas l'app. */
  isWarmup: boolean;
  /** Fait financier explicite. Absent → retombe sur `!isWarmup`. */
  remunere?: boolean;
}

/**
 * Un post compte-t-il dans la paie (CPM + fixe/vidéo + cumul de paliers) ?
 * `remunere` prime, sinon `!isWarmup`.
 */
export function isRemunerated(p: RemunerationFlags): boolean {
  return p.remunere ?? !p.isWarmup;
}

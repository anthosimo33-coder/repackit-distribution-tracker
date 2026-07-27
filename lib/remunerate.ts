/**
 * Rémunération d'un post — le point de décision UNIQUE « ce post est-il PAYÉ ? »
 * (fait FINANCIER, LOT 2). INDÉPENDANT du fait ÉDITORIAL warmup (`lib/warmup-mode`).
 *
 * `remunere` explicite prime ; à défaut (posts non migrés) on retombe sur
 * l'ancienne règle « payé ssi pas warmup » → paie STRICTEMENT INCHANGÉE tant que
 * `remunere` est absent. Cas Kelly : isWarmup=true + remunere=true → PAYÉ
 * (remunere) MAIS hors promo (isWarmup pilote vues_promo, cf LOT 3/4).
 *
 * ⚠️ Règle A6 : jumeau STRICTEMENT IDENTIQUE en `convex/remunerate.ts` ; la parité
 * est verrouillée par `lib/remunerate.test.ts` (importe LES DEUX versions).
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

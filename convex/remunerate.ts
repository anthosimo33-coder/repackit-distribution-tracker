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

/**
 * Le post s'écarte-t-il de la règle par défaut « payé ssi pas warmup » ?
 *
 * C'est la SEULE question qui mérite un stockage explicite (cf
 * `normalizeRemunere`), et la liste de ces posts est exactement l'ensemble à
 * piloter à la main.
 */
export function divergesFromWarmup(p: RemunerationFlags): boolean {
  return p.remunere !== undefined && p.remunere !== !p.isWarmup;
}

/**
 * Forme STOCKÉE de `remunere` — explicite UNIQUEMENT quand elle diverge de
 * `!isWarmup`, sinon `undefined`.
 *
 * POURQUOI cette normalisation (et pas « toujours écrire la valeur ») :
 * `isRemunerated` fait primer la valeur explicite, donc un `remunere` posé même
 * quand il ne fait que répéter la déduction ÉPINGLE le post — basculer son
 * warmup ne change alors plus rien à la paie, en silence. C'est exactement ce
 * qu'avait produit `backfillRemunere` sur 143 publications : la bascule warmup
 * était devenue inopérante sur les posts antérieurs au backfill, et opérante sur
 * les suivants, sans que rien ne le montre à l'écran.
 *
 * En ne stockant que la DIVERGENCE, on garantit deux choses : la bascule warmup
 * reste opérante partout où l'admin n'a pas explicitement décidé le contraire,
 * et `remunere !== undefined` désigne exactement les cas à piloter à la main.
 *
 * La valeur EFFECTIVE est préservée dans tous les cas :
 * `isRemunerated({isWarmup, remunere: normalizeRemunere(isWarmup, r)}) === r`.
 */
export function normalizeRemunere(
  isWarmup: boolean,
  remunere: boolean,
): boolean | undefined {
  return remunere === !isWarmup ? undefined : remunere;
}

/**
 * Forme STOCKÉE de `remunere` APRÈS une bascule du warmup (règle appliquée par
 * `setPublicationWarmup`). `remunere` absent → on ne stocke RIEN et la paie SUIT
 * le nouveau warmup ; `remunere` explicite → valeur effective conservée, forme
 * renormalisée. Cf `lib/remunerate.ts` pour le pourquoi complet (et le bug
 * d'épinglage silencieux que cette règle corrige).
 */
export function remunereAfterWarmupToggle(
  nextIsWarmup: boolean,
  currentRemunere: boolean | undefined,
): boolean | undefined {
  if (currentRemunere === undefined) return undefined;
  return normalizeRemunere(nextIsWarmup, currentRemunere);
}

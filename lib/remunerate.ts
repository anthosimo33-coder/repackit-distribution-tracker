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
 * Forme STOCKÉE de `remunere` APRÈS une bascule du warmup — c'est la règle que
 * `setPublicationWarmup` applique.
 *
 * Deux cas, et un seul est une décision :
 *  - `remunere` ABSENT (le post suit la règle par défaut) → il continue de la
 *    suivre : on ne stocke RIEN et la paie SUIT le nouveau warmup. Poser une
 *    valeur ici épinglerait un post que personne n'a jamais décidé d'épingler.
 *  - `remunere` EXPLICITE (l'admin a décidé le fait financier) → sa valeur
 *    EFFECTIVE est conservée, et seule sa forme stockée est renormalisée face au
 *    nouveau warmup. Si l'écart devient la règle par défaut, on l'efface (même
 *    effet, plus d'épinglage) ; sinon on le garde.
 *
 * POURQUOI cette fonction existe : `setPublicationWarmup` calculait la valeur
 * effective sur l'ANCIEN warmup, ce qui revenait à « la bascule warmup ne change
 * jamais la paie » — et transformait tout post implicite en post ÉPINGLÉ, en
 * silence. C'est exactement le mode de panne que `normalizeRemunere` ci-dessus
 * documente avoir déjà subi (`backfillRemunere`, 143 publications). La protection
 * était écrite juste au-dessus du code qui la contournait.
 *
 * ⚠️ Conséquence à connaître : un post DIVERGENT redevient implicite après une
 * bascule, car un écart vis-à-vis de l'ancien warmup EST la règle par défaut
 * vis-à-vis du nouveau (diverger ⇔ `remunere === isWarmup`). Sa valeur payée ne
 * bouge pas — seule la trace « à piloter à la main » disparaît, ce qui est
 * correct : il n'y a plus rien à piloter.
 */
export function remunereAfterWarmupToggle(
  nextIsWarmup: boolean,
  currentRemunere: boolean | undefined,
): boolean | undefined {
  if (currentRemunere === undefined) return undefined;
  return normalizeRemunere(nextIsWarmup, currentRemunere);
}

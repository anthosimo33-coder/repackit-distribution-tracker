/**
 * Mode de lecture WARMUP — le point de décision UNIQUE « inclure / exclure les
 * posts de chauffe » pour TOUT agrégat de métriques (vues, likes, saves,
 * subsGained, comments) du produit.
 *
 * Pourquoi un seul helper (TD-019) : ~20 agrégats sommaient les métriques sans
 * jamais lire `publications.isWarmup`, gonflant les chiffres et faussant les
 * ratios d'engagement DANS LES DEUX SENS (warmup au numérateur = gonflé ; au
 * dénominateur = sous-estimé). On centralise ici la seule logique d'exclusion —
 * aucun agrégat ne réimplémente `if (isWarmup) continue`.
 *
 * ⚠️ Règle A6 — un module `convex/` ne peut pas importer `lib/`. Ce fichier a un
 * JUMEAU STRICTEMENT IDENTIQUE en `convex/warmupMode.ts` ; la parité est
 * verrouillée par un test (`lib/warmup-mode.test.ts`) qui importe LES DEUX.
 *
 * ⚠️ À ne PAS confondre avec le warmup de COMPTE (`lib/warmup.ts` : rodage d'un
 * compte). Ici c'est le flag PAR POST `publications.isWarmup` (fait éditorial :
 * le contenu ne mentionne pas l'app), sans aucune parenté.
 */

/**
 * Tri-état EXPLICITE (jamais un booléen positionnel) :
 *  - "all"     : toutes les publications, warmup compris ;
 *  - "exclude" : posts monétisés seulement (warmup retiré) — DÉFAUT produit ;
 *  - "only"    : posts warmup seulement (contrôle du volume de chauffe).
 */
export type WarmupMode = "all" | "exclude" | "only";

/**
 * Défaut = "exclude". Le warmup CHAUFFE des comptes, il ne mesure pas la
 * performance du contenu : ses métriques n'ont rien à faire dans un agrégat de
 * performance ni au dénominateur d'un ratio d'engagement. Déjà exclu de la paie
 * et de la rentabilité — le reste des surfaces s'aligne. La chauffe ne se rend
 * visible qu'explicitement ("all"/"only"), jamais par accident.
 */
export const DEFAULT_WARMUP_MODE: WarmupMode = "exclude";

/** Un post (via son flag `isWarmup`) passe-t-il le mode ? Cf `WarmupMode`. */
export function passesWarmupMode(isWarmup: boolean, mode: WarmupMode): boolean {
  if (mode === "all") return true;
  if (mode === "only") return isWarmup;
  return !isWarmup; // "exclude"
}

/**
 * Filtre une LISTE selon le mode warmup. `getIsWarmup` lit le flag d'un item —
 * les items ne sont pas forcément des publications brutes (snapshots joints,
 * lignes projetées, tuples métriques) : le seul contrat est de savoir dire si
 * l'item est un post de chauffe. C'est LE helper de liste unique.
 */
export function filterByWarmupMode<T>(
  items: readonly T[],
  getIsWarmup: (item: T) => boolean,
  mode: WarmupMode,
): T[] {
  return items.filter((it) => passesWarmupMode(getIsWarmup(it), mode));
}

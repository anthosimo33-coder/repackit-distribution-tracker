/**
 * N'ÉCRIRE QUE CE QUI CHANGE — module PUR (testé par lib/changed-fields.test.ts).
 *
 * Une écriture Convex, même à l'identique, relance TOUTES les queries abonnées
 * qui ont lu la row. La synchro Whop réécrivait chaque heure ~1 900 lignes
 * inchangées en 20 commits ; chaque commit relançait les écrans analytics
 * ouverts (getMarketPnl 5,4 MB, getReliability 6,2 MB…), vu dans les journaux
 * prod le 2026-09-16. Comparer avant d'écrire supprime ces relances.
 *
 * Comparaison par `===`, champ par champ : les rows concernées ne portent que
 * des scalaires. Un champ absent et un champ `undefined` sont ÉGAUX — c'est
 * ce que `db.patch(id, { x: undefined })` produit (le champ est retiré).
 */
export function changedFields<T extends Record<string, unknown>>(
  existing: Partial<T>,
  next: T,
): Partial<T> | null {
  const diff: Partial<T> = {};
  let changed = false;
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (existing[key] !== next[key]) {
      diff[key] = next[key];
      changed = true;
    }
  }
  return changed ? diff : null;
}

/**
 * Fraîcheur de la synchro Whop : le passage le plus récent, qu'il ait changé
 * une ligne ou non.
 *
 * Elle se lisait sur `max(updatedAt)` des paiements. Depuis qu'une ligne
 * inchangée n'est plus réécrite, ce max ne bouge plus quand rien de neuf
 * n'arrive : l'onglet Fiabilité aurait déclaré la synchro périmée alors qu'elle
 * tourne. Le marqueur (`syncMarkers`) date le passage ; le max des lignes reste
 * pris en compte pour tout ce qui a été écrit sans marqueur (avant ce
 * changement, semeurs e2e).
 */
export function lastWhopSyncMs(
  markerAt: number | null,
  rows: readonly { updatedAt: number }[],
): number | null {
  let last = markerAt;
  for (const r of rows) last = Math.max(last ?? 0, r.updatedAt);
  return last;
}

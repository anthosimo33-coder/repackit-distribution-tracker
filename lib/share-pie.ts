/**
 * Camembert « vues par créatrice » de la page publique.
 *
 * Au plus `maxSlices` parts : au-delà, les plus petites sont regroupées dans
 * « Autres » (un camembert à 12 parts ne se lit plus). Les pourcentages sont
 * ENTIERS et leur somme fait exactement 100 — méthode du plus fort reste —,
 * sinon la légende afficherait 33 % + 33 % + 33 % sous un cercle plein.
 */
export type PieInput<T> = { key: T; value: number };
export type PieSlice<T> = {
  /** `null` = la part « Autres ». */
  key: T | null;
  value: number;
  percent: number;
};

export function pieSlices<T>(
  rows: readonly PieInput<T>[],
  maxSlices = 5,
): PieSlice<T>[] {
  const positive = rows.filter((r) => r.value > 0);
  const sorted = [...positive].sort((a, b) => b.value - a.value);
  const kept: { key: T | null; value: number }[] =
    sorted.length <= maxSlices
      ? sorted
      : [
          ...sorted.slice(0, maxSlices - 1),
          {
            key: null,
            value: sorted.slice(maxSlices - 1).reduce((s, r) => s + r.value, 0),
          },
        ];
  const total = kept.reduce((s, r) => s + r.value, 0);
  if (total <= 0) return [];

  const exact = kept.map((r) => (r.value / total) * 100);
  const floors = exact.map(Math.floor);
  let rest = 100 - floors.reduce((s, n) => s + n, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (rest <= 0) break;
    floors[i] += 1;
    rest -= 1;
  }
  return kept.map((r, i) => ({ key: r.key, value: r.value, percent: floors[i] }));
}

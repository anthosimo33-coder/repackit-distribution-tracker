/**
 * POURCENTAGES — deux unités, et le nom de la fonction dit laquelle.
 *
 * Vit dans lib/ et non à côté des composants pour une raison pratique : la
 * config vitest ne couvre que lib/, et l'alias `@/` n'y est pas résolu. Un
 * helper de formatage enfoui dans un .tsx n'est pas testable — or c'est
 * exactement ce qu'il fallait tester ici.
 */
import { formatNumber } from "./format";

/**
 * Pourcentage (1 décimale) tolérant au null. ⚠️ ATTEND DES POINTS DE %, pas un
 * ratio : `pct(54.2)` rend « 54,2 % ». Passer un ratio brut affiche la valeur
 * CENT FOIS TROP PETITE, sans erreur ni signe extérieur.
 *
 * Ce n'est pas théorique. Six champs de `lib/whop-revenue` sont des RATIOS —
 * `Math.round(x * 10000) / 10000` arrondit, il ne convertit pas — et six sites
 * de l'onglet Rétention les passaient ici. Relevé sur données de prod : un taux
 * de renouvellement de 0,5417 affiché « 0,542 % » au lieu de 54,2 %. L'écran
 * disait que le produit ne retenait personne.
 *
 * Pour un ratio, utiliser `pctFromFraction`. La règle est tenue par
 * lib/pct-units.test.ts, qui interdit de passer ces champs à `pct` en direct.
 */
export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${formatNumber(value)} %`;
}

/**
 * Pourcentage depuis un RATIO (0–1). `pctFromFraction(0.5417)` rend « 54,2 % ».
 *
 * Les deux unités coexistent dans le dépôt et ce n'est pas un accident : les
 * ratios servent aux CALCULS (la projection de rétention fait `1/(1−t)`, qui
 * n'a de sens que sur un ratio), les points servent à l'AFFICHAGE. La
 * conversion se fait donc au bord, ici, et le nom de la fonction dit son entrée.
 */
export function pctFromFraction(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "—"
    : `${formatNumber(Math.round(value * 1000) / 10)} %`;
}

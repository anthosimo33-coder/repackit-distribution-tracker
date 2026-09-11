import { parisDayStartMs } from "./hog-window";
import { shiftDay, type AnalyticsWindow } from "./analytics-window";

/**
 * FENÊTRE DU HUB → BORNES EN MILLISECONDES, pour les agrégats d'ARGENT.
 *
 * Le sélecteur raisonne en JOURS DE PARIS inclusifs (« du 01/07 au 10/09 ») ;
 * `whopPayments.paidAt` et `publications.datePubli` sont des instants. Traduire
 * naïvement `to` en minuit ampute le dernier jour de la période — 24 h de
 * revenu et de coût qui disparaissent parce que la borne a été lue au mauvais
 * bout.
 *
 * La fin est donc la veille de minuit du jour SUIVANT : le dernier jour est
 * couvert en entier, changement d'heure compris (`parisDayStartMs` porte le
 * décalage réel de CHAQUE jour, pas un UTC+1 supposé).
 */
export function windowToMs(w: AnalyticsWindow): { from: number; to: number } {
  return {
    from: parisDayStartMs(w.from),
    to: parisDayStartMs(shiftDay(w.to, 1)) - 1,
  };
}

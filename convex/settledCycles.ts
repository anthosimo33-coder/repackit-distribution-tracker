/**
 * CE QUI EST DÉJÀ PAYÉ NE BOUGE PLUS — l'assiette gelée d'une vidéo réglée.
 *
 * Un cycle de paie PAYÉ est gelé : l'écran Paiements relit sa row verbatim et ne
 * recalcule rien (`cyclePaymentsForCreator`, branche `paidByPeriod`). La
 * rentabilité, elle, re-simulait le moteur à chaque affichage — si bien qu'une
 * vidéo continuait d'ajouter du CPM et des vues facturées au mois de sa
 * publication APRÈS avoir été payée. Mesuré en prod le 22/09/2026 : le cycle
 * 02/08→01/09 d'une créatrice, réglé 1 074,57 $ le 16/09, valait ~46 $ de plus au
 * recalcul six jours plus tard — de l'argent dû à personne, puisqu'une
 * assignation n'appartient qu'au cycle de sa PUBLICATION (`cycleIndexOf`) et ne
 * peut donc pas repasser dans un cycle suivant. Le mois d'août affichait ce coût
 * fantôme, et son RPM baissait tout seul.
 *
 * CE MODULE REND L'ASSIETTE QU'ON A PAYÉE, prise dans la row : `detail.views` de
 * la ligne CPM de la vidéo. C'est le nombre de vues sur lequel le chèque a été
 * fait — pas une reconstruction par relevé, qui buterait sur le relevé du jour
 * même (un même jour n'a qu'UNE row `metricSnapshots` par source, et elle est
 * réécrite en place à chaque passage : impossible de savoir ce qu'elle valait à
 * l'instant du versement).
 *
 * ⚠️ ON NE REPREND PAS LE MONTANT, seulement l'assiette. La rentabilité découpe
 * en mois CALENDAIRE, la paie en cycle J+30 PERSO, et le budget fixe d'un barème
 * est alloué PAR FENÊTRE : les deux découpages ne peuvent pas rendre le même
 * total, et recopier un montant de cycle dans une colonne de mois y ferait entrer
 * de l'argent d'un autre mois. Avec l'assiette gelée, le CPM re-calculé retombe
 * exactement sur la ligne payée (même snapshot de barème) et seule la part fixe
 * reste re-budgétée au mois — ce qu'elle a toujours été.
 *
 * Module PUR (aucun import `_generated`) → testable depuis `lib/` en UNE seule
 * définition, même patron que `convex/payWindow.ts`.
 */

import { cycleIndexOf, cyclePeriodKey, cycleWindow } from "./payCycle";

/** Ce qu'on lit d'une row `payments` — rien d'autre n'entre dans la décision. */
export type SettledCycleRow = {
  /** Clé de période : cycle ("YYYY-MM-DD") ou legacy mensuelle ("YYYY-MM"). */
  period: string;
  status: "accruing" | "scheduled" | "paid";
  lineItems: readonly {
    assignmentId?: string;
    kind: string;
    detail?: { views?: number };
  }[];
};

/**
 * Résolveur `(vidéo, instant de publication) → vues payées` (null = rien de
 * gelé, donc calcul live comme avant).
 *
 * L'appariement du cycle passe par l'INDEX, jamais par la chaîne de période :
 * `cyclePeriodKey` tronque au jour et perd l'heure de l'ancre (cf
 * convex/payments.ts, `cyclePaymentAt`). On recalcule donc la clé du cycle
 * candidat et on la compare — une row mensuelle legacy ("2026-08") ne peut ainsi
 * JAMAIS matcher, elle n'a pas la forme d'une clé de cycle.
 *
 * `null` DANS TROIS CAS, tous « on ne sait pas », jamais « c'était zéro » :
 *   - pas d'ancre (`firstPostAt` absent : fiche supprimée, aucun post) — il n'y a
 *     aucun cycle à apparier, et les posts d'une créatrice supprimée sont déjà
 *     sortis de la paie (`unpayPostsOfDeletedCreator`) ;
 *   - cycle pas encore payé — c'est le cas nominal, la vidéo vit encore ;
 *   - cycle payé mais AUCUNE ligne CPM chiffrée pour cette vidéo (barème à taux
 *     nul, vidéo à zéro vue au versement, ou row écrite avant que `detail` existe).
 *     Geler à zéro y retirerait d'un coup ses vues du RPM et son CPM de la marge
 *     sur la foi d'une ligne absente — c'est l'interdit posé en tête de
 *     convex/payWindow, et le live reste la réponse la moins fausse.
 */
export function settledViewsResolver(
  firstPostAt: number | undefined,
  rows: readonly SettledCycleRow[],
): (assignmentId: string, publishedAt: number) => number | null {
  if (firstPostAt === undefined) return () => null;
  /** (clé de cycle payé, assignation) → vues payées. */
  const paid = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "paid") continue;
    for (const li of r.lineItems) {
      if (li.kind !== "cpm" || li.assignmentId === undefined) continue;
      const views = li.detail?.views;
      if (typeof views !== "number" || !Number.isFinite(views)) continue;
      paid.set(`${r.period}|${li.assignmentId}`, Math.max(0, views));
    }
  }
  if (paid.size === 0) return () => null;
  return (assignmentId: string, publishedAt: number) => {
    const k = cycleIndexOf(firstPostAt, publishedAt);
    const period = cyclePeriodKey(cycleWindow(firstPostAt, k).cycleStart);
    return paid.get(`${period}|${assignmentId}`) ?? null;
  };
}

/**
 * Résolveur `(vidéo, instant de publication) → BONUS PAR VIDÉO payé` (null =
 * cycle de la vidéo pas encore payé, donc calcul live).
 *
 * ⚠️ DIFFÉRENT de `settledViewsResolver` sur deux points, tous deux voulus :
 *   - on rend le MONTANT, pas l'assiette. Le bonus par vidéo n'a aucun budget de
 *     groupe à re-répartir entre mois et cycle : il appartient à sa seule vidéo,
 *     qui n'appartient qu'à UN cycle et UN mois. Reprendre le montant est exact —
 *     et c'est la seule façon qu'une grille modifiée APRÈS le paiement ne réécrive
 *     pas un coût déjà versé ;
 *   - cycle payé SANS ligne `video_bonus` pour la vidéo ⇒ 0, pas `null`. Ici
 *     l'absence est une information : le gel écrit une ligne pour toute vidéo qui
 *     touchait un bonus, donc « pas de ligne » veut dire « rien touché ». Les
 *     cycles payés avant que la grille existe rendent ainsi 0, ce qui est la règle
 *     (la grille ne vaut que pour les cycles non payés).
 */
export function settledVideoBonusResolver(
  firstPostAt: number | undefined,
  rows: readonly (SettledCycleRow & {
    lineItems: readonly { assignmentId?: string; kind: string; amount: number }[];
  })[],
): (assignmentId: string, publishedAt: number) => number | null {
  if (firstPostAt === undefined) return () => null;
  const paidPeriods = new Set<string>();
  /** (clé de cycle payé, assignation) → bonus payé. */
  const paid = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "paid") continue;
    paidPeriods.add(r.period);
    for (const li of r.lineItems) {
      if (li.kind !== "video_bonus" || li.assignmentId === undefined) continue;
      const k = `${r.period}|${li.assignmentId}`;
      paid.set(k, (paid.get(k) ?? 0) + Math.max(0, li.amount));
    }
  }
  if (paidPeriods.size === 0) return () => null;
  return (assignmentId: string, publishedAt: number) => {
    const k = cycleIndexOf(firstPostAt, publishedAt);
    const period = cyclePeriodKey(cycleWindow(firstPostAt, k).cycleStart);
    if (!paidPeriods.has(period)) return null;
    return Math.round((paid.get(`${period}|${assignmentId}`) ?? 0) * 100) / 100;
  };
}

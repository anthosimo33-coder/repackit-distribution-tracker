/**
 * QW3 — logique PURE du rappel « coordonnées de paiement manquantes » (testable
 * Vitest, sans dépendance Convex/React). LECTURE SEULE : on lit l'état déjà
 * calculé (profil + paiements) pour décider d'afficher un bandeau, jamais on
 * n'écrit ni ne recalcule un montant de paie.
 *
 * UI-ONLY : aucune réplique serveur (la décision d'affichage ne vit que côté
 * client) → pas de synchro A6 à maintenir.
 */

/** Profil de paiement minimal lu côté créateur (getMyProfile). */
export type PaymentProfileLike = {
  paymentMethod?: string | null;
  paymentDetails?: string | null;
} | null | undefined;

/** Ligne de paiement minimale lue côté créateur (getMyPayments). */
export type PaymentRowLike = { status: string; totalDue: number };

/**
 * Coordonnées de paiement INCOMPLÈTES = méthode OU coordonnées manquantes/vides.
 * Profil non chargé (null/undefined) → false : on n'affiche jamais le bandeau
 * tant qu'on ne sait pas (pas de faux positif au chargement).
 */
export function needsPaymentInfo(profile: PaymentProfileLike): boolean {
  if (!profile) return false;
  const method = (profile.paymentMethod ?? "").trim();
  const details = (profile.paymentDetails ?? "").trim();
  return method.length === 0 || details.length === 0;
}

/**
 * Total des gains DUS et non encore payés (somme des `totalDue` de toutes les
 * périodes dont le statut n'est pas "paid"). AGRÉGATION de lecture des montants
 * déjà calculés — jamais un recalcul de pricing. Liste non chargée → 0.
 */
export function amountOwed(
  payments: readonly PaymentRowLike[] | null | undefined,
): number {
  if (!payments) return 0;
  return payments
    .filter((p) => p.status !== "paid")
    .reduce((sum, p) => sum + (p.totalDue ?? 0), 0);
}

/**
 * Faut-il inviter le créateur à compléter ses coordonnées de paiement ? OUI ssi
 * il a des gains dus (> 0) ET ses coordonnées sont incomplètes. Sinon (payé,
 * rien dû, ou coordonnées présentes) → pas de bandeau.
 */
export function shouldPromptPaymentInfo(
  profile: PaymentProfileLike,
  payments: readonly PaymentRowLike[] | null | undefined,
): boolean {
  return amountOwed(payments) > 0 && needsPaymentInfo(profile);
}

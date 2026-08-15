/**
 * ALLOWLIST des champs d'un assignment renvoyés AU CLIPPEUR — même mécanique que
 * `convex/creatorAssignmentFields.ts` (logique INVERSÉE : on part de RIEN et on
 * ajoute explicitement ce qui sort), mais une LISTE DISTINCTE : le clippeur et la
 * créatrice partenaire ne voient pas la même chose.
 *
 * Pourquoi deux listes plutôt qu'une :
 *   - `rateSnapshot` / `pricingSnapshot` — la créatrice les lit pour estimer ses
 *     gains (fixe/CPM/paliers). Le clippeur est payé un MONTANT FIXE PAR CLIP
 *     (chantier pricing) : `rateSnapshot` n'est qu'un placeholder neutre
 *     `{ basePerPost: 0 }` sur les assignations de script, et un `pricingSnapshot`
 *     sur une assignation de clip serait un BUG (double paiement clip + CPM).
 *     Les retirer ici est une deuxième ligne de défense : même posé par erreur, un
 *     `pricingSnapshot` n'atteindrait pas l'écran du clippeur.
 *   - `managedByAdmin` — mode « l'équipe tient le compte », propre au flux
 *     partenaire. Un clippeur possède ses comptes : le champ n'a aucun sens chez
 *     lui, donc il ne sort pas.
 *   - `formatId` — le flux clip est 100 % script (aucun format).
 *
 * Comme pour la créatrice, la DÉCOMPOSITION du script (`scriptCombo`, `comboKey`,
 * ids de briques, tier, campagne) ne sort JAMAIS : le clippeur reçoit le TEXTE
 * monté (`assembledScript`, ajouté par l'enrichissement, pas par cette liste),
 * jamais la signature qui sert à l'anti-coordination et aux analytics.
 *
 * Invariant (vérifié par lib/clipper-assignment-fields.test.ts) : CHAQUE champ
 * top-level du schéma `assignments` figure dans CLIPPER ou NON_CLIPPER — sinon le
 * test casse, forçant une décision consciente à chaque nouveau champ.
 *
 * Module PUR (pas d'import runtime `_generated`) → importable côté client/tests.
 */

/** Les SEULS champs d'un assignment envoyés au clippeur (+ `_id`/`_creationTime`
 *  système). `targets` en est ABSENT : renvoyé ENRICHI séparément (handle du
 *  compte + URL publiée par cible), jamais le brut du document. */
export const CLIPPER_ASSIGNMENT_FIELDS = [
  "_id",
  "_creationTime",
  "status",
  "dueDate",
  "postDate",
  // Même statut que postDate : une consigne de publication. Le clippeur publie
  // lui-même son clip, la plage le concerne donc autant que la créatrice. Le
  // quota par jour reste calculé sur le JOUR, la plage ne le touche pas.
  "postWindow",
  "createdAt",
  "projectId",
  "creatorId",
  // Consignes de tournage/montage posées par l'admin pour CE clip.
  "overlayText",
  "instructions",
  "modelVideos",
  "assetFolderIds",
  "assetFolderId",
  // Sa vidéo montée en cours de revue (+ lecteur Cloudflare Stream) et le retour
  // admin en cas de refus — exactement comme pour la créatrice.
  "submittedVideoStorageId",
  "submittedVideoMimeType",
  "submittedVideoStreamUid",
  "submittedVideoStreamStatus",
  "videoReviewFeedback",
  "videoRejectedAt",
] as const;

/** Champs DÉLIBÉRÉMENT retirés de la sortie clippeur (admin-only / interne /
 *  sans objet dans le flux clip / remplacé par une forme enrichie). */
export const NON_CLIPPER_ASSIGNMENT_FIELDS = [
  // Décomposition script / rejeu / traçabilité admin — jamais côté portail.
  "scriptCombo",
  "comboKey",
  "comboImposed",
  "replayedFrom",
  "replayVerbatim",
  "publishedBy",
  // Interne / bookkeeping admin.
  "creatorNameSnapshot",
  "deadlineReminderSentAt",
  "lastNudgeAt",
  "adminFeedback",
  // Sans objet dans le flux clip (cf en-tête).
  "formatId",
  "managedByAdmin",
  "rateSnapshot",
  "pricingSnapshot",
  // ⚠️ LIRE AVANT D'EN DÉDUIRE QUOI QUE CE SOIT. `clipRateSnapshot` est la
  // rémunération DU CLIPPEUR LUI-MÊME pour CE clip. Il n'est PAS ici parce qu'il
  // serait sensible — il ne l'est pas, c'est son propre tarif, l'exact équivalent
  // de `rateSnapshot` qui est, lui, servi à la créatrice partenaire.
  //
  // Il est ici parce que RIEN NE L'AFFICHE AUJOURD'HUI. Cette liste dit ce qui
  // SORT, pas ce qui pourrait sortir un jour : l'y inscrire « pour plus tard »
  // contredirait sa règle de départ (on part de rien, on ajoute explicitement ce
  // qui est rendu). Le jour où l'espace clippeur aura un écran de paie, le
  // DÉPLACER dans CLIPPER_ASSIGNMENT_FIELDS est le geste attendu — pas une
  // entorse à une règle de confidentialité qui n'existe pas.
  "clipRateSnapshot",
  // Legacy mono-cible : l'info vit sur les cibles ENRICHIES.
  "accountId",
  "publishedUrl",
  "publishedAt",
  "submittedUrl",
  "submittedAt",
  "submittedPlatform",
  "publicationId",
  // Remplacé par les targets ENRICHIES (jamais le brut du doc).
  "targets",
] as const;

/**
 * ALLOWLIST (pas denylist) : ne garde QUE les champs de CLIPPER_ASSIGNMENT_FIELDS.
 * Générique + pur (testable). Le caller caste vers le `Pick<Doc<"assignments">>`
 * précis → tsc valide que l'espace clippeur ne lit rien d'autre.
 */
export function pickClipperAssignment<T extends object>(a: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of CLIPPER_ASSIGNMENT_FIELDS) {
    const key = k as unknown as keyof T;
    if (a[key] !== undefined) out[key] = a[key];
  }
  return out;
}

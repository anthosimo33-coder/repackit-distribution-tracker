/**
 * ALLOWLIST des champs d'un assignment renvoyés À LA CRÉATRICE — logique INVERSÉE.
 *
 * Historique : `enrichForCreator`/`assignmentDetailFor` faisaient `{...admin, ...safe}`
 * (DENYLIST) → tout NOUVEAU champ du schéma fuyait PAR DÉFAUT. Deux PR de suite ont
 * introduit une fuite par ce mécanisme (replayVerbatim #167, publishedBy #169). On
 * inverse : on part de RIEN et on ajoute EXPLICITEMENT ce qui sort. Un champ ajouté
 * au schéma est donc INVISIBLE tant que personne ne le classe sciemment.
 *
 * Invariant (vérifié par lib/creator-assignment-fields.test.ts) : CHAQUE champ
 * top-level du schéma `assignments` figure dans CREATOR ou NON_CREATOR — sinon le
 * test casse, forçant une décision consciente à chaque nouveau champ.
 *
 * Module PUR (pas d'import runtime `_generated`) → importable côté client/tests
 * (cf convex/internalAccounts, même patron). Le typage `Pick<Doc>` vit côté
 * convex/assignments.ts (où `Doc` est dispo) → tsc attrape toute lecture d'un champ
 * NON exposé dans le portail créatrice.
 */

/** Les SEULS champs d'un assignment envoyés à la créatrice (+ `_id`/`_creationTime`
 *  système). `targets` en est ABSENT : il est renvoyé ENRICHI séparément. */
export const CREATOR_ASSIGNMENT_FIELDS = [
  "_id",
  "_creationTime",
  "status",
  "managedByAdmin",
  "dueDate",
  "postDate",
  // Plage horaire : la consigne « entre 21 h et 23 h » n'a de valeur que si la
  // créatrice la voit. Sans cette ligne le champ existe en base et n'atteint
  // jamais son espace — l'allowlist est ce qui expose, pas le schéma.
  "postWindow",
  "createdAt",
  "projectId",
  "creatorId",
  "formatId",
  "rateSnapshot",
  "pricingSnapshot",
  "overlayText",
  "instructions",
  "modelVideos",
  "assetFolderIds",
  "assetFolderId",
  "submittedVideoStorageId",
  "submittedVideoMimeType",
  "submittedVideoStreamUid",
  "submittedVideoStreamStatus",
  "videoReviewFeedback",
  "videoRejectedAt",
] as const;

/** Champs DÉLIBÉRÉMENT retirés de la sortie créatrice (admin-only / interne /
 *  remplacé). Présents ICI = décision explicite ; le test garantit qu'aucun champ
 *  du schéma n'échappe aux deux listes. */
export const NON_CREATOR_ASSIGNMENT_FIELDS = [
  // Sans objet chez une partenaire : elle est payée au fixe/CPM/paliers, jamais
  // au clip. Le champ ne sera jamais posé sur une de ses assignations.
  "clipRateSnapshot",
  // Décomposition script / rejeu / traçabilité admin — JAMAIS côté créatrice.
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
  // Legacy mono-cible : l'info vit désormais sur les cibles ENRICHIES.
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
 * ALLOWLIST (pas denylist) : ne garde QUE les champs de CREATOR_ASSIGNMENT_FIELDS.
 * Générique + pur (testable). Le caller (convex/assignments.ts) caste vers le
 * `Pick<Doc<"assignments">>` précis → tsc valide que le portail ne lit rien d'autre.
 */
export function pickCreatorAssignment<T extends object>(a: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of CREATOR_ASSIGNMENT_FIELDS) {
    const key = k as unknown as keyof T;
    if (a[key] !== undefined) out[key] = a[key];
  }
  return out;
}

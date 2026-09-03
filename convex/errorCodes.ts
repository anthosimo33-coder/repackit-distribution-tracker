/**
 * CODES DE REJET MÉTIER — identifiants STABLES, jamais affichés tels quels.
 *
 * Un code existe pour que le CLIENT puisse décider quoi faire, et dans quelle
 * LANGUE le dire, sans lire le texte du serveur. Deux raisons, et la seconde a
 * déjà mordu :
 *
 *   1. Le runtime Convex n'a ni requête, ni cookie, ni `Accept-Language`. Il ne
 *      PEUT PAS savoir dans quelle langue écrire. Un message figé côté serveur
 *      angliciserait l'admin en même temps que le créateur, ou l'inverse — ces
 *      rejets sortent de cœurs PARTAGÉS (`confirmPublicationCore`,
 *      `declareCompteCore`…), atteints par les deux populations.
 *   2. `AdminPublishForm` branchait son flux de régularisation de date sur
 *      `/précède la\s+création/i`. Traduire le message cassait le flux en
 *      silence — ni erreur de compilation, ni test rouge.
 *
 * ⚠️ Un code ne se renomme pas. Il vit dans le protocole entre le serveur et le
 * client, comme un nom de champ de schéma.
 *
 * Le module vit dans `convex/` : le runtime Convex n'importe rien hors de
 * `convex/` (règle A6), et `lib/` peut l'importer dans ce sens-là.
 *
 * GÉNÉRÉ EN PARTIE — le tableau ci-dessous est la source des clés i18n
 * `error.<code>` : les deux catalogues portent une entrée par code.
 */
import { ConvexError } from "convex/values";

export const ERR = {
  TARGETS_COUNT: "ERR_TARGETS_COUNT",
  TARGET_ACCOUNT_NOT_FOUND_FOR_CREATOR: "ERR_TARGET_ACCOUNT_NOT_FOUND_FOR_CREATOR",
  TARGETS_MIXED_OWNERSHIP: "ERR_TARGETS_MIXED_OWNERSHIP",
  FORMAT_NOT_FOUND: "ERR_FORMAT_NOT_FOUND",
  FORMAT_ARCHIVED: "ERR_FORMAT_ARCHIVED",
  VIDEO_COUNT_INVALID: "ERR_VIDEO_COUNT_INVALID",
  CREATOR_NOT_IN_PROJECT: "ERR_CREATOR_NOT_IN_PROJECT",
  ASSIGNMENT_NOT_FOUND: "ERR_ASSIGNMENT_NOT_FOUND",
  ASSET_FOLDER_NOT_FOUND: "ERR_ASSET_FOLDER_NOT_FOUND",
  ASSIGNMENT_ALREADY_STARTED: "ERR_ASSIGNMENT_ALREADY_STARTED",
  VIDEO_SUBMIT_WRONG_STATE: "ERR_VIDEO_SUBMIT_WRONG_STATE",
  ASSIGNMENT_NO_TARGET: "ERR_ASSIGNMENT_NO_TARGET",
  PUBLISHED_AT_IN_FUTURE: "ERR_PUBLISHED_AT_IN_FUTURE",
  ACCOUNT_MANAGED_PUBLISH: "ERR_ACCOUNT_MANAGED_PUBLISH",
  TARGET_ACCOUNT_NOT_IN_PROJECT: "ERR_TARGET_ACCOUNT_NOT_IN_PROJECT",
  ACCOUNT_NOT_FOUND: "ERR_ACCOUNT_NOT_FOUND",
  MANAGED_ACCOUNT_NEEDS_CREATOR: "ERR_MANAGED_ACCOUNT_NEEDS_CREATOR",
  ACCOUNT_PLATFORM_LOCKED: "ERR_ACCOUNT_PLATFORM_LOCKED",
  WARMUP_START_REQUIRED: "ERR_WARMUP_START_REQUIRED",
  NO_BIO_TO_APPLY: "ERR_NO_BIO_TO_APPLY",
  HANDLE_REQUIRED: "ERR_HANDLE_REQUIRED",
  ACCOUNT_NOT_IN_WARMUP: "ERR_ACCOUNT_NOT_IN_WARMUP",
  WARMUP_ALREADY_DONE: "ERR_WARMUP_ALREADY_DONE",
  WARMUP_CHECK_ALREADY_DONE: "ERR_WARMUP_CHECK_ALREADY_DONE",
  ACCOUNT_MANAGED_WARMUP: "ERR_ACCOUNT_MANAGED_WARMUP",
  ACCOUNT_NOT_MANAGED: "ERR_ACCOUNT_NOT_MANAGED",
  NOT_AUTHENTICATED: "ERR_NOT_AUTHENTICATED",
  PROJECT_NOT_FOUND: "ERR_PROJECT_NOT_FOUND",
  PROJECT_ACCESS_DENIED: "ERR_PROJECT_ACCESS_DENIED",
  ADMIN_ONLY: "ERR_ADMIN_ONLY",
  CREATOR_RECORD_NOT_FOUND: "ERR_CREATOR_RECORD_NOT_FOUND",
  CREATOR_NOT_IN_THIS_PROJECT: "ERR_CREATOR_NOT_IN_THIS_PROJECT",
  RESET_LINK_INVALID: "ERR_RESET_LINK_INVALID",
  OPERATION_NOT_ALLOWED: "ERR_OPERATION_NOT_ALLOWED",
  ACCOUNT_HAS_NO_PASSWORD: "ERR_ACCOUNT_HAS_NO_PASSWORD",
  PASSWORD_TOO_SHORT: "ERR_PASSWORD_TOO_SHORT",
  CREATOR_NOT_FOUND: "ERR_CREATOR_NOT_FOUND",
  NO_PAY_CYCLE: "ERR_NO_PAY_CYCLE",
  CYCLE_INVALID: "ERR_CYCLE_INVALID",
  PRICING_NOT_IN_PROJECT: "ERR_PRICING_NOT_IN_PROJECT",
  PRICING_ARCHIVED: "ERR_PRICING_ARCHIVED",
  DEPOSIT_UNAVAILABLE: "ERR_DEPOSIT_UNAVAILABLE",
  FILE_REF_MISSING: "ERR_FILE_REF_MISSING",
  DRIVE_UPLOAD_START_FAILED: "ERR_DRIVE_UPLOAD_START_FAILED",
  DRIVE_UNAVAILABLE: "ERR_DRIVE_UNAVAILABLE",
  PUBLISH_BEFORE_APPROVAL: "ERR_PUBLISH_BEFORE_APPROVAL",
  SCRIPT_COMBO_MISSING: "ERR_SCRIPT_COMBO_MISSING",
  TARGET_PLATFORM_DUPLICATE: "ERR_TARGET_PLATFORM_DUPLICATE",
  ACCOUNT_WRONG_PLATFORM: "ERR_ACCOUNT_WRONG_PLATFORM",
  ACCOUNT_UNAVAILABLE: "ERR_ACCOUNT_UNAVAILABLE",
  CREATOR_NOT_ASSIGNABLE: "ERR_CREATOR_NOT_ASSIGNABLE",
  FORMAT_PLATFORM_MISMATCH: "ERR_FORMAT_PLATFORM_MISMATCH",
  ACCOUNT_NOT_APPROVED_TO_PUBLISH: "ERR_ACCOUNT_NOT_APPROVED_TO_PUBLISH",
  POST_URL_INVALID: "ERR_POST_URL_INVALID",
  POST_URL_WRONG_PLATFORM: "ERR_POST_URL_WRONG_PLATFORM",
  POST_URL_IS_ACCOUNT: "ERR_POST_URL_IS_ACCOUNT",
  POST_URL_MISSING: "ERR_POST_URL_MISSING",
  ACCOUNT_RENAME_LOCKED: "ERR_ACCOUNT_RENAME_LOCKED",
  ACCOUNT_ALREADY_EXISTS: "ERR_ACCOUNT_ALREADY_EXISTS",
  ACCOUNT_IN_USE: "ERR_ACCOUNT_IN_USE",
  CLIP_QUOTA_NOT_VALIDATED: "ERR_CLIP_QUOTA_NOT_VALIDATED",
  CLIP_QUOTA_PHASE_ZERO: "ERR_CLIP_QUOTA_PHASE_ZERO",
  CLIP_QUOTA_REACHED: "ERR_CLIP_QUOTA_REACHED",
  /**
   * Date de publication antérieure à la création de l'assignation. Ce n'est PAS
   * une saisie fautive : c'est une régularisation (post publié hors de l'app).
   * Le client propose de confirmer, il ne bloque pas.
   */
  PUBLISHED_AT_BEFORE_CREATION: "ERR_PUBLISHED_AT_BEFORE_CREATION",
  /** Rôle de portail refusé (talent / clippeur / partenaire selon le contexte). */
  PORTAL_ROLE_REJECTED: "ERR_PORTAL_ROLE_REJECTED",
} as const;

export type ErrCode = (typeof ERR)[keyof typeof ERR];

/** Paramètres d'interpolation, transportés jusqu'au client qui rend la phrase. */
export type ErrParams = Record<string, string | number>;

/**
 * Construit un rejet métier STRUCTURÉ. Le `message` français reste dans la
 * charge : il sert de repli d'affichage (et de trace lisible dans les logs)
 * quand le client ne connaît pas le code.
 */
export function err(
  code: ErrCode,
  message: string,
  params?: ErrParams,
): ConvexError<{ code: string; message: string; params?: ErrParams }> {
  return new ConvexError(
    params === undefined ? { code, message } : { code, message, params },
  );
}

/**
 * Message LISIBLE d'une erreur, pour les harnais e2e et les rapports de
 * migration.
 *
 * Une `ConvexError` transporte désormais soit une chaîne (forme historique),
 * soit une charge STRUCTURÉE `{ code, message }` (cf convex/errorCodes.ts).
 * `String(e.data)` rendait « [object Object] » sur la seconde — ce qui a fait
 * tomber cinq specs e2e d'un coup, toutes en assertant du texte français.
 */
export function convexErrorText(e: unknown): string {
  if (!(e instanceof ConvexError)) return "error";
  const d = e.data;
  if (d !== null && typeof d === "object" && "message" in d) {
    const p = d as { code?: unknown; message?: unknown };
    // Le CODE est concaténé : une assertion e2e peut alors porter sur lui
    // plutôt que sur la formulation, qui elle peut être traduite.
    return typeof p.code === "string"
      ? `${p.code} ${String(p.message)}`
      : String(p.message);
  }
  return String(d);
}

/**
 * Dépôt de fichiers Snytch (Google Drive) — helpers PURS, canoniques + testés
 * (Vitest, cf snytch-drive.test.ts). Aucune dépendance runtime : parsing,
 * dérivations, classification. Réutilisés côté FRONTEND (nom de fichier,
 * classification vidéo/photo, gate par slug).
 *
 * ⚠️ Règle A6 — convex/ ne peut PAS importer lib/. Les helpers dont le SERVEUR a
 * besoin (parseServiceAccount, creatorFolderName) sont RÉPLIQUÉS dans
 * convex/googleDriveApi.ts avec la même logique (tests ici). Toute évolution de
 * ces deux-là doit être faite des DEUX côtés. classifyDriveKind /
 * isSnytchProject / SNYTCH_SLUG sont, eux, consommés uniquement côté front (pas
 * de réplique convex ; le serveur compare au SNYTCH_SLUG de convex/projects.ts).
 */

/** Slug du projet Snytch — la seule app concernée par le dépôt de fichiers. */
export const SNYTCH_SLUG = "snytch";

/** Le projet `slug` est-il Snytch ? (gate d'affichage de « Mes fichiers »). */
export function isSnytchProject(slug: string): boolean {
  return slug === SNYTCH_SLUG;
}

/** Champs du service account Google utiles à l'auth JWT (jamais loggés). */
export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

/** Endpoint token OAuth2 par défaut si absent du JSON du service account. */
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

/**
 * Parse GOOGLE_SERVICE_ACCOUNT_JSON → { clientEmail, privateKey, tokenUri }.
 *
 * Gère la reconversion des `\n` ÉCHAPPÉS dans private_key : selon la façon dont
 * la variable a été posée, private_key peut contenir des « \n » littéraux
 * (backslash-n) au lieu de vrais sauts de ligne → on les reconvertit
 * systématiquement (no-op si la clé a déjà de vrais sauts de ligne).
 *
 * Les messages d'erreur ne contiennent JAMAIS la clé (juste le champ fautif).
 */
export function parseServiceAccount(raw: string): ServiceAccount {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON: JSON invalide.");
  }
  if (!json || typeof json !== "object") {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON: objet JSON attendu.");
  }
  const o = json as Record<string, unknown>;
  const clientEmail = o.client_email;
  const privateKeyRaw = o.private_key;
  if (typeof clientEmail !== "string" || clientEmail.length === 0) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON: client_email manquant.");
  }
  if (typeof privateKeyRaw !== "string" || privateKeyRaw.length === 0) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON: private_key manquant.");
  }
  const tokenUri =
    typeof o.token_uri === "string" && o.token_uri.length > 0
      ? o.token_uri
      : DEFAULT_TOKEN_URI;
  return {
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
    tokenUri,
  };
}

/** 6 derniers caractères de l'id Convex — suffixe court anti-collision lisible. */
export function driveShortId(creatorId: string): string {
  return creatorId.slice(-6);
}

/**
 * Nom du sous-dossier Drive d'un créateur : « <nom nettoyé> — <id court> ».
 * L'id court (creatorId) évite les collisions entre créateurs homonymes. Le nom
 * est trimmé, ses espaces internes réduits, et borné (60) ; vide → « Créateur ».
 */
export function creatorFolderName(name: string, creatorId: string): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
  const display = clean.length > 0 ? clean : "Créateur";
  return `${display} — ${driveShortId(creatorId)}`;
}

const VIDEO_EXT = new Set([
  "mov",
  "mp4",
  "m4v",
  "webm",
  "avi",
  "hevc",
  "mkv",
  "3gp",
]);
const PHOTO_EXT = new Set([
  "heic",
  "heif",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "tif",
  "avif",
]);

/**
 * Classe un fichier déposé en « video » / « photo » / « other » pour l'affichage
 * de la liste. Se fie d'abord au mimeType (video/* , image/*), puis retombe sur
 * l'extension — indispensable pour les fichiers iPhone dont le mimeType peut être
 * absent (.mov, .heic). Tout le reste → « other ».
 */
export function classifyDriveKind(
  mimeType: string,
  fileName: string,
): "video" | "photo" | "other" {
  const m = (mimeType || "").toLowerCase();
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "photo";
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (VIDEO_EXT.has(ext)) return "video";
  if (PHOTO_EXT.has(ext)) return "photo";
  return "other";
}

/** Formatte une taille en octets → « 1,2 Go » / « 340 Mo » / « 12 Ko » (fr). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  const rounded = i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("fr-FR")} ${units[i]}`;
}

/**
 * Téléchargement de la vidéo soumise — helpers PURS (extension + nom de
 * fichier), testés Vitest. Contournement HEVC : quand le navigateur ne sait
 * pas afficher une .mov HEVC iPhone, l'admin télécharge le fichier ORIGINAL
 * déjà stocké et le visionne dans un lecteur local (QuickTime lit le HEVC).
 * Le déclenchement DOM (fetch → blob → <a download>) vit dans la page
 * Validation ; ici on ne dérive que des chaînes.
 */

/** MIME (éventuellement suffixé `; codecs=…`) → extension de fichier. */
const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov", // .mov iPhone (souvent HEVC/H.265)
  "video/webm": "webm",
};

/** Extension de fichier déduite du MIME ; `mp4` par défaut si inconnu/absent. */
export function videoExtensionFromMime(
  mimeType: string | null | undefined,
): string {
  const base = (mimeType ?? "").split(";")[0]?.trim().toLowerCase();
  return (base && MIME_TO_EXT[base]) || "mp4";
}

/** Slug ASCII lisible : accents retirés, séparateurs → `-`, bornes nettoyées. */
function slugifyPart(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marques diacritiques combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Nom de fichier lisible pour la vidéo soumise : `<créateur>-<campagne>.<ext>`.
 * Les parties vides (après slug) sont ignorées ; fallback `video` si tout est
 * vide. L'extension suit le MIME stocké (.mov pour le HEVC iPhone).
 */
export function submittedVideoFilename(input: {
  creatorName: string;
  label: string;
  mimeType: string | null | undefined;
}): string {
  const stem =
    [slugifyPart(input.creatorName), slugifyPart(input.label)]
      .filter((p) => p.length > 0)
      .join("-") || "video";
  return `${stem}.${videoExtensionFromMime(input.mimeType)}`;
}

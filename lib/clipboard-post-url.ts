/**
 * LE LIEN DE PUBLICATION TROUVÉ DANS LE PRESSE-PAPIERS — « C'est ce lien ? ».
 *
 * Module PUR. Quand la créatrice revient de TikTok, son presse-papiers contient
 * souvent le lien de sa vidéo — mais rarement SEUL : le partage de l'app ajoute
 * du texte (« Regarde ma vidéo … #snytch »). On extrait le premier lien, on
 * retire la ponctuation collée à la fin, et on ne le propose que s'il n'est pas
 * PROUVÉ FAUX pour la plateforme attendue.
 *
 * ⚠️ Même verdict que le formulaire et le serveur (`publishUrlIssue`) : un lien
 * d'une autre plateforme, ou un lien de PROFIL, n'est jamais proposé. Un format
 * non reconnu sur le bon hôte l'est — c'est le serveur qui tranche, et il est
 * permissif (cf convex/postUrlShape).
 */
import { publishUrlIssue, type PostUrlPlatform } from "../convex/postUrlShape";

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;

export function suggestedPostUrl(
  clipboard: string | null | undefined,
  platform: PostUrlPlatform,
): string | null {
  const text = (clipboard ?? "").trim();
  if (text.length === 0 || text.length > 4096) return null;
  const match = text.match(URL_IN_TEXT);
  if (!match) return null;
  const url = match[0].replace(/[)\].,;:!?»]+$/, "");
  return publishUrlIssue(url, platform) === null ? url : null;
}

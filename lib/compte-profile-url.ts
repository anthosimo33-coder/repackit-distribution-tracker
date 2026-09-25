/**
 * URL PUBLIQUE du profil d'un compte — là où mène un clic sur « @handle » dans
 * l'écran Comptes. Pur, testé (Vitest), client seul.
 *
 * DEUX SOURCES, ET LE HANDLE N'EST PAS LA PREMIÈRE. Le handle est un LIBELLÉ
 * saisi à la main ; l'URL, elle, a été collée par la créatrice depuis son
 * application. En production (2026-09-24) les deux divergent là où ça compte :
 * le compte affiché `@kelly.leydie` a pour URL `tiktok.com/@kellyleydie`, et
 * c'est bien sous `@kellyleydie` que vivent ses 120 posts. Construire l'URL
 * depuis le handle aurait envoyé sur un profil qui n'est pas le sien.
 *
 * MAIS L'URL N'EST PAS FIABLE NON PLUS : `@sarahkl02` porte l'URL
 * `www.tiktok.com/julie.kl31` — sans schéma, et sans le `@` qu'exige un profil
 * TikTok. Ses 24 posts sont sous `@sarahkl02`. Une URL qui ne désigne pas un
 * compte de SA plateforme est donc écartée, et le handle reprend la main.
 *
 * L'URL rendue est toujours RECONSTRUITE (schéma https, hôte canonique, sans
 * paramètres) : les `?_r=1&_t=…` / `?igsh=…` de partage ne servent à rien, et un
 * lien ouvert depuis l'admin n'a pas à porter le traceur d'une créatrice.
 */

import type { Plateforme } from "../convex/platforms";
import { handleFromPostUrl } from "./post-url-account";

export type ProfilePlateforme = Plateforme;

const HOTES: Record<ProfilePlateforme, RegExp> = {
  TikTok: /(^|\.)tiktok\.com$/i,
  Instagram: /(^|\.)instagram\.com$/i,
  YouTube: /(^|\.)youtube\.com$/i,
  Facebook: /(^|\.)facebook\.com$/i,
  Snapchat: /(^|\.)snapchat\.com$/i,
};

/**
 * Caractères admis dans un nom de compte sur toutes les plateformes (lettres,
 * chiffres, point, tiret bas, tiret). Tout le reste — espace, slash, `?` — veut
 * dire que la chaîne n'est pas un nom de compte, et on ne fabrique pas d'URL.
 */
const NOM_DE_COMPTE = /^[A-Za-z0-9._-]+$/;

function profilCanonique(plateforme: ProfilePlateforme, nom: string): string {
  switch (plateforme) {
    case "TikTok":
      return `https://www.tiktok.com/@${nom}`;
    case "Instagram":
      return `https://www.instagram.com/${nom}/`;
    case "YouTube":
      return `https://www.youtube.com/@${nom}`;
    case "Facebook":
      return `https://www.facebook.com/${nom}`;
    case "Snapchat":
      return `https://www.snapchat.com/add/${nom}`;
  }
}

/** Le compte que désigne une URL collée, ou null si elle n'en désigne aucun. */
function profilDepuisUrl(
  brute: string,
  plateforme: ProfilePlateforme,
): string | null {
  const s = brute.trim();
  if (s === "") return null;
  let u: URL;
  try {
    // Une URL sans schéma (`www.tiktok.com/…`) existe en prod : on la lit
    // quand même, c'est son CHEMIN qui décidera si elle désigne un compte.
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!HOTES[plateforme].test(u.hostname)) return null;

  // Chaîne YouTube historique : un identifiant de chaîne, pas un @handle.
  if (plateforme === "YouTube") {
    const chaine = u.pathname.match(/^\/channel\/([A-Za-z0-9_-]+)/);
    if (chaine) return `https://www.youtube.com/channel/${chaine[1]}`;
  }

  // Profil Facebook sans nom d'utilisateur : son identifiant NUMÉRIQUE est
  // l'adresse, et le handle affiché (un nom) n'en mène à aucune.
  if (plateforme === "Facebook" && u.pathname === "/profile.php") {
    const id = u.searchParams.get("id");
    if (id && /^\d+$/.test(id)) {
      return `https://www.facebook.com/profile.php?id=${id}`;
    }
  }

  // Même lecture que la vérification des liens de post : `/@nom` sur TikTok et
  // YouTube, premier segment hors racine de post sur Instagram. Un lien de POST
  // collé à la place du profil donne donc quand même le bon compte.
  const nom = handleFromPostUrl(u.toString(), plateforme);
  return nom !== null && NOM_DE_COMPTE.test(nom)
    ? profilCanonique(plateforme, nom)
    : null;
}

/**
 * URL du profil public, ou null quand ni l'URL ni le handle ne désignent un
 * compte — l'écran affiche alors le handle sans lien plutôt qu'un lien mort.
 */
export function compteProfileUrl(compte: {
  plateforme: ProfilePlateforme;
  handle: string;
  url?: string | null;
}): string | null {
  const depuisUrl = compte.url
    ? profilDepuisUrl(compte.url, compte.plateforme)
    : null;
  if (depuisUrl !== null) return depuisUrl;
  const nom = compte.handle.trim().replace(/^@+/, "");
  return NOM_DE_COMPTE.test(nom)
    ? profilCanonique(compte.plateforme, nom)
    : null;
}

/**
 * LIEN DE PUBLICATION RECONNU — ce que le formulaire de publication sait lire,
 * PAR PLATEFORME. Sert l'avertissement ambre « Lien non reconnu » (non
 * bloquant) : `false` n'est jamais un refus, c'est « forme que je ne connais pas,
 * vérifie avant d'envoyer ». Les refus, eux, restent à `publishUrlIssue`.
 *
 * ── Le défaut que ce module ferme ────────────────────────────────────────────
 * Signalé le 2026-09-28 : une créatrice ne pouvait pas déclarer ses posts
 * Snapchat et Facebook : chaque lien, même parfait (`snapchat.com/t/<code>` de l'app,
 * `facebook.com/share/r/<code>`), s'affichait « Lien non reconnu ». Le formulaire
 * lisait les liens avec `detectInspirationType`, le détecteur de la VEILLE, qui
 * ne connaît volontairement que TikTok, Instagram et YouTube
 * (cf `INSPIRATION_PLATFORMS`) : depuis que Facebook et Snapchat sont
 * publiables (#294), l'avertissement tombait sur 100 % de leurs liens. Le
 * serveur et le relevé, eux, les acceptaient.
 *
 * ── La règle ─────────────────────────────────────────────────────────────────
 * « Reconnu » = une forme que le RELEVÉ DE VUES sait rapprocher, lue avec les
 * mêmes fonctions que lui. Snapchat : un Spotlight (`/spotlight/<id>`) ou son
 * lien court (`/t/<code>`) — une Story n'a pas de vues publiques, l'avertir est
 * juste. Facebook : les liens de post que rendent l'app et le site.
 */

import type { PostUrlPlatform } from "../convex/postUrlShape";
import { detectPostUrlPlatform } from "../convex/postUrlShape";
import {
  isSnapchatShortlink,
  snapchatSpotlightId,
} from "../convex/snapchatPublicPage";
import { facebookVideoId } from "../convex/facebookApify";
import { detectInspirationType } from "./inspiration-url";

/**
 * Lien de post Facebook : Reel ou vidéo à identifiant (`/reel/<id>`,
 * `/videos/<id>`, `?v=<id>`), lien de PARTAGE de l'app (`/share/r/<code>`,
 * `/share/v/…`, `/share/p/…`), `fb.watch/<code>`, post de Page
 * (`/<page>/posts/<id>`, `/<page>/videos/<titre>/<id>`), permalien
 * (`story.php?story_fbid=…`).
 */
function isFacebookPostUrl(u: URL, raw: string): boolean {
  const path = u.pathname;
  if (u.hostname.toLowerCase().endsWith("fb.watch")) {
    return /^\/[A-Za-z0-9_-]+\/?$/.test(path);
  }
  if (facebookVideoId(raw) !== null) return true;
  if (/^\/share\/(?:[rvp]\/)?[A-Za-z0-9_-]+\/?$/i.test(path)) return true;
  if (/^\/[^/]+\/(?:posts|videos)\/(?:[^/]+\/)?[A-Za-z0-9_-]+\/?$/i.test(path)) {
    return true;
  }
  return (
    /^\/(?:story|permalink)\.php$/i.test(path) && u.searchParams.has("story_fbid")
  );
}

export function isRecognizedPostUrl(
  url: string,
  platform: PostUrlPlatform,
): boolean {
  const raw = url.trim();
  // Le serveur exige le schéma (« lien http(s) attendu ») : sans lui, le lien
  // n'est pas reconnu, même si le reste a la bonne forme.
  if (!/^https?:\/\//i.test(raw)) return false;
  if (detectPostUrlPlatform(raw) !== platform) return false;
  if (platform === "Snapchat") {
    return snapchatSpotlightId(raw) !== null || isSnapchatShortlink(raw);
  }
  if (platform === "Facebook") {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return false;
    }
    return isFacebookPostUrl(u, raw);
  }
  // TikTok, Instagram, YouTube : les formes que connaît la veille, inchangées.
  return detectInspirationType(raw)?.plateforme === platform;
}

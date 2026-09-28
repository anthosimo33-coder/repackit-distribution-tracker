import { describe, it, expect } from "vitest";
import type { Plateforme } from "../convex/platforms";
import { publishUrlIssue } from "../convex/postUrlShape";
import { detectInspirationType } from "./inspiration-url";
import { isRecognizedPostUrl } from "./post-url-recognized";

describe("isRecognizedPostUrl — liens de post tels que les apps les donnent", () => {
  const reconnus: Array<[Plateforme, string]> = [
    // Le lien EXACT du signalement : « Copier le lien » de l'app Snapchat,
    // sans `www.`.
    ["Snapchat", "https://snapchat.com/t/RsPs9F7D"],
    ["Snapchat", "https://www.snapchat.com/t/RsPs9F7D/"],
    ["Snapchat", "https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYaGx0cXBqZnBzAZmHq1a3AZmHq1ZBAAAAAQ?share_id=MTIz&locale=fr-FR"],
    ["Snapchat", "https://www.snapchat.com/@thekellychapter/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYaGx0cXBqZnBz"],
    // Partage de l'app Facebook — Reel, vidéo, post.
    ["Facebook", "https://www.facebook.com/share/r/1AbCdEfGh2/?mibextid=wwXIfr"],
    ["Facebook", "https://www.facebook.com/share/v/15xYzAbCd9/"],
    ["Facebook", "https://www.facebook.com/share/p/1Q2w3E4r5T/"],
    ["Facebook", "https://www.facebook.com/share/1Q2w3E4r5T/"],
    ["Facebook", "https://m.facebook.com/reel/1284539976120931/?mibextid=wwXIfr"],
    ["Facebook", "https://www.facebook.com/reel/1284539976120931"],
    ["Facebook", "https://www.facebook.com/watch/?v=1284539976120931&ref=sharing"],
    ["Facebook", "https://fb.watch/uXyZ12aBcD/"],
    ["Facebook", "https://www.facebook.com/Kellydgtl/videos/1284539976120931/"],
    ["Facebook", "https://www.facebook.com/Kellydgtl/videos/mon-titre/1284539976120931/"],
    ["Facebook", "https://www.facebook.com/Kellydgtl/posts/pfbid02AbCdEfGhIjKlMn"],
    ["Facebook", "https://www.facebook.com/story.php?story_fbid=1284539976120931&id=100012345678901"],
    // Les trois plateformes historiques : verdict inchangé.
    ["TikTok", "https://www.tiktok.com/t/ZP8cDXdtT/"],
    ["TikTok", "https://www.tiktok.com/@thekellychapters_/video/7552112233445566778"],
    ["Instagram", "https://www.instagram.com/reel/DczkWNIt-s5/?igsh=MXYz"],
    ["YouTube", "https://www.youtube.com/shorts/abc_123XYZ"],
  ];
  it.each(reconnus)("%s — %s : reconnu", (platform, url) => {
    expect(isRecognizedPostUrl(url, platform)).toBe(true);
    // Et jamais refusé : un lien reconnu n'est pas un lien prouvé faux.
    expect(publishUrlIssue(url, platform)).toBeNull();
  });

  // Le défaut signalé, pris à la racine : le détecteur de la VEILLE, qui servait
  // ce verdict, ne connaît pas ces liens — ils tombaient tous en « non reconnu ».
  it("le détecteur de la veille ignore Snapchat et Facebook", () => {
    expect(detectInspirationType("https://snapchat.com/t/RsPs9F7D")).toBeNull();
    expect(
      detectInspirationType("https://www.facebook.com/share/r/1AbCdEfGh2/?mibextid=wwXIfr"),
    ).toBeNull();
  });

  // Non reconnu = avertissement ambre, JAMAIS un refus : `publishUrlIssue` doit
  // rester muet sur ces liens, sinon la créatrice ne peut plus les envoyer.
  const inconnus: Array<[Plateforme, string, string]> = [
    // Une Story Snapchat n'a pas de vues publiques : le relevé ne la mesure pas.
    ["Snapchat", "https://story.snapchat.com/p/8b2c5e1f-6a7d-4c3e-9f10-2b3c4d5e6f70/3298765432109876", "Story"],
    ["Snapchat", "https://www.snapchat.com/spotlight/court", "identifiant de Spotlight tronqué"],
    ["Facebook", "https://www.facebook.com/groups/1234567890/", "groupe"],
    ["Facebook", "https://www.facebook.com/Kellydgtl/about_contact_and_basic_info", "onglet de page"],
    ["Facebook", "https://www.facebook.com/watch/?v=abc", "?v= non numérique"],
    ["Facebook", "https://fb.watch/", "fb.watch sans code"],
    // Sans schéma : le serveur répond « lien http(s) attendu ».
    ["Snapchat", "snapchat.com/t/RsPs9F7D", "sans schéma"],
  ];
  it.each(inconnus)("%s — %s : non reconnu (%s), jamais refusé", (platform, url) => {
    expect(isRecognizedPostUrl(url, platform)).toBe(false);
    expect(publishUrlIssue(url, platform)).toBeNull();
  });

  it("un lien d'une autre plateforme n'est pas reconnu pour la cible", () => {
    expect(isRecognizedPostUrl("https://snapchat.com/t/RsPs9F7D", "Facebook")).toBe(false);
    expect(
      isRecognizedPostUrl("https://www.facebook.com/reel/1284539976120931", "Instagram"),
    ).toBe(false);
    expect(
      isRecognizedPostUrl("https://www.tiktok.com/t/ZP8cDXdtT/", "Snapchat"),
    ).toBe(false);
  });

  it("un hôte qui imite le domaine n'est pas reconnu", () => {
    expect(
      isRecognizedPostUrl("https://snapchat.com.evil.example/t/RsPs9F7D", "Snapchat"),
    ).toBe(false);
    expect(
      isRecognizedPostUrl("https://facebook.com.evil.example/reel/1284539976120931", "Facebook"),
    ).toBe(false);
  });
});

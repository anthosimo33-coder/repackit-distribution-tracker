import { describe, expect, it } from "vitest";
import {
  isTikTokShortlink,
  publicationDateFromUrl,
  timestampFromTikTokVideoId,
} from "../convex/postUrlDate";
import { isTikTokShortlink as fromEmbedsServer } from "../convex/modelVideoEmbeds";
import { isTikTokShortlink as fromEmbedsClient } from "./model-video-embed";

/**
 * IDENTIFIANTS RÉELS, relevés en prod le 2026-08-12 et recoupés contre le
 * `datePubli` enregistré de leur publication. Un id fabriqué en décalant un
 * timestamp aurait testé le décodeur contre lui-même : il faut de vrais ids,
 * dont on connaît par ailleurs la date approximative.
 *
 *   id                    décodé (UTC)          datePubli enregistré     écart
 *   7673183969470352673   2026-08-12T16:32:42   2026-08-12T16:33:59      1 min
 *   7673100168748666144   2026-08-12T11:07:31   2026-08-12T15:05:42      4 h
 *   7672850383298956577   2026-08-11T18:58:13   2026-08-12T09:55:19     15 h  ←
 *
 * Le décodage tombe TOUJOURS avant la date enregistrée : c'est TD-020 mesuré —
 * la date stockée est celle de la CONFIRMATION, pas de la mise en ligne. Le
 * dernier cas traverse minuit, c'est exactement le faux compteur qu'on corrige.
 */
const ID_NOMINAL = "7673183969470352673";
const ID_MEME_JOUR = "7673100168748666144";
const ID_VEILLE_TARD = "7672850383298956577";

/** Après tous ces posts — borne de « futur » qui ne dépend pas de l'horloge. */
const NOW = Date.UTC(2026, 7, 13, 12, 0, 0);

const jourUtc = (at: number) => new Date(at).toISOString().slice(0, 10);

describe("timestampFromTikTokVideoId — 32 bits de poids fort = secondes Unix", () => {
  it("décode un id réel à la minute près", () => {
    expect(timestampFromTikTokVideoId(ID_NOMINAL)).toBe(
      Date.UTC(2026, 7, 12, 16, 32, 42),
    );
    expect(timestampFromTikTokVideoId(ID_MEME_JOUR)).toBe(
      Date.UTC(2026, 7, 12, 11, 7, 31),
    );
    expect(timestampFromTikTokVideoId(ID_VEILLE_TARD)).toBe(
      Date.UTC(2026, 7, 11, 18, 58, 13),
    );
  });

  it("refuse ce qui n'est pas un id numérique", () => {
    expect(timestampFromTikTokVideoId("")).toBeNull();
    expect(timestampFromTikTokVideoId("abc")).toBeNull();
    expect(timestampFromTikTokVideoId("7673183969470352673x")).toBeNull();
  });
});

describe("publicationDateFromUrl — URL TikTok canonique", () => {
  it("lit la date dans une URL de la forme réelle (paramètres de partage inclus)", () => {
    const read = publicationDateFromUrl(
      `https://www.tiktok.com/@clip.demo/video/${ID_NOMINAL}?_r=1&_t=ZN-98pGRaTBJTC`,
      "TikTok",
      NOW,
    );
    expect(read).toEqual({
      at: Date.UTC(2026, 7, 12, 16, 32, 42),
      source: "tiktok-id",
    });
  });

  it("LE CAS QUI COMPTE : un post de la veille au soir ne se lit pas « aujourd'hui »", () => {
    // Publié le 11 à 18h58 UTC, déclaré le 12 au matin. Sans lecture d'URL le
    // formulaire pré-remplirait le 12 et incrémenterait le compteur du 12 : le
    // quota du 11 resterait libre et celui du 12 serait mangé pour rien.
    const read = publicationDateFromUrl(
      `https://www.tiktok.com/@clip.demo/video/${ID_VEILLE_TARD}`,
      "TikTok",
      NOW,
    );
    expect(read.at).not.toBeNull();
    expect(jourUtc(read.at!)).toBe("2026-08-11");
    // Le jour de la DÉCLARATION (date enregistrée en prod) est bien un autre jour.
    expect(jourUtc(Date.UTC(2026, 7, 12, 9, 55, 19))).toBe("2026-08-12");
  });

  it("accepte les formes /photo/ et /v/ (même espace d'identifiants)", () => {
    const attendu = Date.UTC(2026, 7, 12, 16, 32, 42);
    expect(
      publicationDateFromUrl(
        `https://www.tiktok.com/@clip.demo/photo/${ID_NOMINAL}`,
        "TikTok",
        NOW,
      ).at,
    ).toBe(attendu);
    expect(
      publicationDateFromUrl(
        `https://m.tiktok.com/v/${ID_NOMINAL}.html`,
        "TikTok",
        NOW,
      ).at,
    ).toBe(attendu);
  });
});

describe("publicationDateFromUrl — les replis, toujours avec leur raison", () => {
  it("shortlink : l'identifiant n'est pas dans l'URL", () => {
    for (const url of [
      "https://vm.tiktok.com/ZGeAbc123/",
      "https://vt.tiktok.com/ZSxyz/",
      "https://www.tiktok.com/t/ZP8GaTvfN/",
    ]) {
      expect(publicationDateFromUrl(url, "TikTok", NOW)).toEqual({
        at: null,
        reason: "shortlink",
      });
    }
  });

  it("Instagram et YouTube n'ont pas d'horodatage dans l'URL", () => {
    expect(
      publicationDateFromUrl(
        "https://www.instagram.com/reel/Db8k0nEMJR3/",
        "Instagram",
        NOW,
      ),
    ).toEqual({ at: null, reason: "platform" });
    expect(
      publicationDateFromUrl("https://youtu.be/abc123", "YouTube", NOW),
    ).toEqual({ at: null, reason: "platform" });
  });

  it("URL TikTok sans identifiant de vidéo (profil, vide)", () => {
    expect(
      publicationDateFromUrl("https://www.tiktok.com/@clip.demo", "TikTok", NOW),
    ).toEqual({ at: null, reason: "no-id" });
    expect(publicationDateFromUrl("", "TikTok", NOW)).toEqual({
      at: null,
      reason: "no-id",
    });
  });

  it("id tronqué : jamais une date de 1970 pré-remplie", () => {
    // Deux tronçons, deux raisons — la distinction est réelle et vaut d'être
    // vérifiée : sous 2^32 le décalage donne 0 seconde (rien de décodable),
    // au-dessus il donne une date plausible en machine mais absurde en fait.
    expect(
      publicationDateFromUrl(
        "https://www.tiktok.com/@clip.demo/video/7673183",
        "TikTok",
        NOW,
      ),
    ).toEqual({ at: null, reason: "no-id" });
    expect(
      publicationDateFromUrl(
        "https://www.tiktok.com/@clip.demo/video/99999999999",
        "TikTok",
        NOW,
      ),
    ).toEqual({ at: null, reason: "out-of-range" });
  });

  it("un post plus récent que `now` au-delà de la tolérance est refusé…", () => {
    // Le même id réel, mais l'horloge est ramenée à la veille de sa mise en ligne.
    const veille = Date.UTC(2026, 7, 11, 12, 0, 0);
    expect(
      publicationDateFromUrl(
        `https://www.tiktok.com/@clip.demo/video/${ID_NOMINAL}`,
        "TikTok",
        veille,
      ),
    ).toEqual({ at: null, reason: "out-of-range" });
  });

  it("…mais une dérive d'horloge de quelques minutes ne jette pas la lecture", () => {
    const justeAvant = Date.UTC(2026, 7, 12, 16, 30, 0); // 2 min avant le post
    const read = publicationDateFromUrl(
      `https://www.tiktok.com/@clip.demo/video/${ID_NOMINAL}`,
      "TikTok",
      justeAvant,
    );
    expect(read.at).toBe(Date.UTC(2026, 7, 12, 16, 32, 42));
  });
});

describe("isTikTokShortlink — une seule implémentation dans le dépôt", () => {
  it("les deux points d'accès historiques pointent sur LA fonction (identité de référence)", () => {
    // Pas une égalité de comportement testée sur quelques exemples : la MÊME
    // référence. Deux répliques surveillées par un test de parité peuvent
    // diverger le temps d'un commit ; une seule fonction non.
    expect(fromEmbedsServer).toBe(isTikTokShortlink);
    expect(fromEmbedsClient).toBe(isTikTokShortlink);
  });

  it("exige un code après le préfixe (comportement conservé)", () => {
    expect(isTikTokShortlink("https://vm.tiktok.com/ZGeAbc123/")).toBe(true);
    expect(isTikTokShortlink("https://www.tiktok.com/t/ZP8GaTvfN/")).toBe(true);
    expect(isTikTokShortlink("https://vm.tiktok.com/")).toBe(false);
    expect(
      isTikTokShortlink(`https://www.tiktok.com/@clip.demo/video/${ID_NOMINAL}`),
    ).toBe(false);
  });
});

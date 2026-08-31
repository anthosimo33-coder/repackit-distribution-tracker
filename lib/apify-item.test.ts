/**
 * Lecture des champs partagés d'un item TikTok (`convex/apifyItem.ts`).
 *
 * Les entrées ont la FORME d'une sortie réelle de `clockworks/tiktok-scraper` —
 * la même que celle qui sert de fixture à RADAR, puisque c'est le même acteur.
 * Un item inventé de toutes pièces ne prouverait rien sur la lecture d'un
 * payload dont on veut justement vérifier qu'on l'interprète bien.
 */
import { describe, it, expect } from "vitest";
import {
  toCount,
  parseSaves,
  parseAuthorProfile,
  hasAnyCount,
  parseInstagramProfile,
} from "../convex/apifyItem";

/** Item calqué sur la fixture RADAR (sortie réelle de l'acteur). */
const itemReel = {
  id: "7655457745159720205",
  webVideoUrl: "https://www.tiktok.com/@charlidamelio/video/7655457745159720205",
  createTimeISO: "2026-06-25T22:06:06.000Z",
  text: "dc @Darrion G",
  playCount: 2_300_000,
  diggCount: 371_500,
  commentCount: 2239,
  shareCount: 5786,
  collectCount: 13_646,
  videoMeta: { duration: 11 },
  authorMeta: {
    name: "charlidamelio",
    nickName: "charli",
    fans: 155_000_000,
    following: 1_312,
    heart: 12_400_000_000,
  },
};

describe("toCount", () => {
  it("accepte les nombres et les chaînes numériques", () => {
    expect(toCount(13_646)).toBe(13_646);
    expect(toCount("13646")).toBe(13_646);
    expect(toCount(0)).toBe(0);
  });

  it("rend null sur tout ce qui n'est pas un compteur", () => {
    expect(toCount(undefined)).toBeNull();
    expect(toCount(null)).toBeNull();
    expect(toCount("")).toBeNull();
    expect(toCount("beaucoup")).toBeNull();
    expect(toCount(NaN)).toBeNull();
    expect(toCount(Infinity)).toBeNull();
  });

  it("rejette les NÉGATIFS — code d'absence, jamais un compteur", () => {
    // Réplique A6 de lib/apifyPosts.ts : la règle doit tenir des deux côtés.
    expect(toCount(-1)).toBeNull();
    expect(toCount("-1")).toBeNull();
    expect(toCount(-Infinity)).toBeNull();
    expect(toCount(0)).toBe(0);
  });
});

describe("parseSaves — le champ que le relevé jetait", () => {
  it("lit collectCount sur un item réel", () => {
    expect(parseSaves(itemReel)).toBe(13_646);
  });

  it("rend null quand le champ est absent — PAS zéro", () => {
    // Toute la règle du playbook tient là-dessus : « non collecté » n'est pas
    // « nul ». Instagram et YouTube tomberont toujours dans ce cas.
    const { collectCount, ...sansSaves } = itemReel;
    expect(collectCount).toBe(13_646); // l'item de départ l'avait bien
    expect(parseSaves(sansSaves)).toBeNull();
  });

  it("distingue un zéro MESURÉ d'une absence", () => {
    expect(parseSaves({ ...itemReel, collectCount: 0 })).toBe(0);
    expect(parseSaves({ ...itemReel, collectCount: null })).toBeNull();
  });

  it("ne casse pas sur une entrée qui n'est pas un objet", () => {
    expect(parseSaves(null)).toBeNull();
    expect(parseSaves("nope")).toBeNull();
    expect(parseSaves(undefined)).toBeNull();
  });
});

describe("parseAuthorProfile — les abonnés servis avec chaque vidéo", () => {
  it("lit les trois compteurs et le handle sur un item réel", () => {
    expect(parseAuthorProfile(itemReel)).toEqual({
      handle: "charlidamelio",
      followers: 155_000_000,
      following: 1_312,
      totalLikes: 12_400_000_000,
    });
  });

  it("lit les abonnés même quand following/heart manquent", () => {
    // Cas ATTENDU : la fixture RADAR ne porte que `fans`. Si l'input postURLs
    // se comporte pareil, on veut quand même les abonnés.
    const partiel = {
      ...itemReel,
      authorMeta: { name: "charlidamelio", nickName: "charli", fans: 155_000_000 },
    };
    expect(parseAuthorProfile(partiel)).toEqual({
      handle: "charlidamelio",
      followers: 155_000_000,
      following: null,
      totalLikes: null,
    });
  });

  it("authorMeta absent → tout null, sans exception", () => {
    // L'hypothèse non prouvée du chantier : l'input postURLs porte-t-il
    // authorMeta ? Si non, le relevé doit continuer, pas planter.
    const { authorMeta, ...sansAuteur } = itemReel;
    expect(authorMeta.fans).toBe(155_000_000);
    expect(parseAuthorProfile(sansAuteur)).toEqual({
      handle: null,
      followers: null,
      following: null,
      totalLikes: null,
    });
  });

  it("retire un « @ » de tête et les espaces du handle", () => {
    expect(
      parseAuthorProfile({ authorMeta: { name: "  @kelly.dgtl " } }).handle,
    ).toBe("kelly.dgtl");
  });

  it("handle vide → null (jamais la chaîne vide)", () => {
    expect(parseAuthorProfile({ authorMeta: { name: "   " } }).handle).toBeNull();
  });
});

describe("hasAnyCount — faut-il enregistrer ce profil ?", () => {
  it("vrai dès qu'UN compteur est présent", () => {
    expect(hasAnyCount(parseAuthorProfile(itemReel))).toBe(true);
    expect(
      hasAnyCount({
        handle: "x",
        followers: null,
        following: null,
        totalLikes: 42,
      }),
    ).toBe(true);
  });

  it("faux quand tout est absent — rien à historiser", () => {
    // Sans ce garde-fou, une nuit sans authorMeta écrirait un relevé de profil
    // vide par compte, et le delta d'abonnés se calculerait sur du vide.
    expect(
      hasAnyCount({
        handle: "x",
        followers: null,
        following: null,
        totalLikes: null,
      }),
    ).toBe(false);
  });

  it("un ZÉRO mesuré compte comme une donnée", () => {
    expect(
      hasAnyCount({
        handle: "x",
        followers: 0,
        following: null,
        totalLikes: null,
      }),
    ).toBe(true);
  });
});

describe("parseInstagramProfile — le run dédié (+1 run/nuit)", () => {
  /** Item calqué sur apify/instagram-scraper, resultsType "details". */
  const profil = {
    username: "kelly.dgtl",
    fullName: "Kelly",
    followersCount: 12_408,
    followsCount: 431,
    postsCount: 96,
  };

  it("lit abonnés et abonnements", () => {
    expect(parseInstagramProfile(profil)).toEqual({
      handle: "kelly.dgtl",
      followers: 12_408,
      following: 431,
      // Instagram n'expose pas de total de likes du compte.
      totalLikes: null,
    });
  });

  it("compteurs absents → null, et le profil n'est pas historisé", () => {
    const vide = parseInstagramProfile({ username: "kelly.dgtl" });
    expect(vide.followers).toBeNull();
    expect(hasAnyCount(vide)).toBe(false);
  });

  it("ne casse pas sur une réponse inattendue", () => {
    expect(parseInstagramProfile(null).handle).toBeNull();
    expect(hasAnyCount(parseInstagramProfile("nope"))).toBe(false);
  });
});

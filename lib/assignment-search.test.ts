import { describe, expect, it } from "vitest";
import {
  matchesSearch,
  normalizeForSearch,
  searchTerms,
  type AssignmentSearchable,
} from "./assignment-search";

/**
 * Les lignes de ce fichier ont la FORME de la prod, pas une forme pratique :
 * noms de campagne réels (avec drapeau et apostrophe typographique), handles
 * suffixés, résumé de combo en trois briques séparées par « · ». Une recherche
 * qui marche sur « campagne A » et casse sur « Reaction + Demo LAB 🇺🇸 » ne
 * sert à rien.
 */
const angelica: AssignmentSearchable = {
  creatorName: "Angélica",
  scriptCampaignName: "Reaction + Demo LAB 🇺🇸",
  formatName: null,
  comboSummary: "Hook curiosité forte · Flux démonstration écran · CTA lien en bio",
  targets: [{ platform: "TikTok", accountHandle: "angelica.lab_us" }],
};

const lauret: AssignmentSearchable = {
  creatorName: "Lauret",
  scriptCampaignName:
    "Si X ressemble à ca ou ca, tu n'es pas Y tu es juste W 🇫🇷",
  formatName: null,
  comboSummary: "Hook chiffre choc · Flux tuto · CTA commentaire",
  targets: [
    { platform: "TikTok", accountHandle: "lauret.snytch1788854496476" },
    { platform: "Instagram", accountHandle: "lauret.ig" },
  ],
};

/**
 * Ligne dont le nom accentué N'EST REPRIS NULLE PART AILLEURS — le handle est
 * abrégé, comme il l'est souvent en vrai. Sans elle, l'assertion « trouve sans
 * taper l'accent » passait au vert même en retirant complètement la
 * normalisation : « angelica » était retrouvé dans le handle
 * « angelica.lab_us », qui, lui, n'a jamais eu d'accent.
 */
const accentuee: AssignmentSearchable = {
  creatorName: "Cécile-Amélie",
  scriptCampaignName: "Reaction + Demo LAB 🇺🇸",
  formatName: null,
  comboSummary: "Hook chiffre choc · Flux tuto · CTA commentaire",
  targets: [{ platform: "TikTok", accountHandle: "ca.snytch1788854496476" }],
};

/** Assignation d'origine FORMAT : aucune campagne, seul `formatName` porte le nom. */
const parFormat: AssignmentSearchable = {
  creatorName: "Juliette",
  scriptCampaignName: null,
  formatName: "Carrousel témoignage",
  comboSummary: null,
  targets: [],
};

describe("normalizeForSearch", () => {
  it("retire les accents et la casse", () => {
    // Attendus écrits en DUR : les recalculer avec le même NFD + la même classe
    // de diacritiques ferait passer le test quelle que soit la règle appliquée.
    expect(normalizeForSearch("Angélica")).toBe("angelica");
    expect(normalizeForSearch("  CURIOSITÉ  ")).toBe("curiosite");
    expect(normalizeForSearch("Où ça ? Déjà vu…")).toBe("ou ca ? deja vu…");
  });

  it("laisse passer les emojis sans les casser", () => {
    expect(normalizeForSearch("Demo LAB 🇺🇸")).toBe("demo lab 🇺🇸");
  });
});

describe("searchTerms", () => {
  it("une requête vide ne produit aucun terme", () => {
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("   ")).toEqual([]);
  });

  it("découpe sur les espaces multiples", () => {
    expect(searchTerms("  lauret   tuto ")).toEqual(["lauret", "tuto"]);
  });
});

describe("matchesSearch", () => {
  it("une requête vide ne filtre rien", () => {
    expect(matchesSearch(angelica, searchTerms(""))).toBe(true);
    expect(matchesSearch(parFormat, searchTerms(""))).toBe(true);
  });

  it("trouve par nom de créatrice, SANS accent tapé", () => {
    // « cecile » ne peut venir QUE du nom : le handle est « ca.snytch… ».
    expect(matchesSearch(accentuee, searchTerms("cecile"))).toBe(true);
    expect(matchesSearch(accentuee, searchTerms("amelie"))).toBe(true);
    expect(matchesSearch(lauret, searchTerms("cecile"))).toBe(false);
  });

  it("trouve par nom de campagne", () => {
    expect(matchesSearch(angelica, searchTerms("demo lab"))).toBe(true);
    expect(matchesSearch(lauret, searchTerms("demo lab"))).toBe(false);
  });

  it("trouve par NOM DE FORMAT quand il n'y a pas de campagne", () => {
    expect(matchesSearch(parFormat, searchTerms("carrousel"))).toBe(true);
    expect(matchesSearch(angelica, searchTerms("carrousel"))).toBe(false);
  });

  it("trouve par @handle, y compris sur le suffixe numérique", () => {
    expect(matchesSearch(lauret, searchTerms("1788854496476"))).toBe(true);
    expect(matchesSearch(lauret, searchTerms("lauret.ig"))).toBe(true);
    expect(matchesSearch(angelica, searchTerms("lauret.ig"))).toBe(false);
  });

  it("trouve par brique de combo", () => {
    expect(matchesSearch(angelica, searchTerms("curiosite"))).toBe(true);
    expect(matchesSearch(lauret, searchTerms("curiosite"))).toBe(false);
  });

  it("plusieurs termes = ET, dans n'importe quel ordre et champ", () => {
    // « angelica » vient du nom, « tiktok » de la cible, « hook » du combo.
    expect(matchesSearch(angelica, searchTerms("tiktok angelica hook"))).toBe(
      true,
    );
    // Le second terme ne matche aucun champ → la ligne sort.
    expect(matchesSearch(angelica, searchTerms("angelica carrousel"))).toBe(
      false,
    );
  });

  it("ne cherche PAS dans des champs absents sans exploser", () => {
    expect(matchesSearch({}, searchTerms("angelica"))).toBe(false);
    expect(matchesSearch({}, searchTerms(""))).toBe(true);
  });
});

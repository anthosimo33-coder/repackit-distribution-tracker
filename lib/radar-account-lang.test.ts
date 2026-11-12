import { describe, expect, it } from "vitest";
import { accountLang, declaredLang, needsDeclaredLang } from "../convex/radarNetworkMath";
import { CREATOR_LANGS } from "../convex/radarCreatorsMath";
import { LANG_BY_HAND, OFF_TOPIC_BY_HAND, SEED_REMOVED } from "../convex/radarSeedAccounts";

/**
 * Radar — la langue d'un compte suivi (12/11/2026). Cinq des 37 francophones entrés la veille n'étaient pas sous
 * « Français » dans l'onglet Créateurs. Lu en prod ce jour-là : quatre comptes sans aucune langue, un classé en
 * anglais. La langue de chaque légende n'est pas gardée en base : celles ci-dessous sont déduites de leurs dix
 * dernières légendes relevées (des hashtags seuls, ou « My favorite game » suivi de hashtags).
 */
const AUCUNE = Array.from({ length: 10 }, () => "autre");

describe("Radar — la langue d'un compte suivi", () => {
  it("sans déclaration : la langue la plus fréquente de ses légendes, « autre » ne compte pas", () => {
    expect(accountLang("x", ["en", "fr", "fr", "autre", "autre", "autre"], {})).toBe("fr");
    expect(accountLang("x", ["pt", "es-am", "pt"], {})).toBe("pt");
    // À égalité, la première rencontrée (ses vidéos arrivent les plus récentes d'abord).
    expect(accountLang("x", ["en", "fr"], {})).toBe("en");
    expect(accountLang("x", ["fr", "en"], {})).toBe("fr");
  });

  it("des légendes faites de hashtags : aucune langue — le compte n'est alors dans aucune langue de l'onglet", () => {
    // @kayllis8 : « #revision #methode #knowunity #notes #moyenne », dix fois sur dix.
    expect(accountLang("kayllis8", AUCUNE, {})).toBeUndefined();
    expect(accountLang("x", [], {})).toBeUndefined();
  });

  it("déclarée à la main, elle remplace l'absence de langue", () => {
    for (const h of ["learnwith_tesnime", "kayllis8", "study_with_louise", "sandrashh5o4"]) expect(accountLang(h, AUCUNE, LANG_BY_HAND)).toBe("fr");
    // Jamais relevé encore : elle vaut déjà.
    expect(accountLang("kayllis8", [], LANG_BY_HAND)).toBe("fr");
  });

  it("déclarée à la main, elle l'emporte sur celle de TikTok, relevé après relevé", () => {
    // @hajarxp7fem : cinq légendes sur dix commencent par « My favorite game », les autres ne sont que des hashtags ;
    // TikTok la classe en anglais, pour un texte à l'écran en français (« Donc là ma meuf joue à un jeu… »).
    const tiktok = ["en", "autre", "autre", "autre", "autre", "en", "en", "en", "en", "autre"];
    expect(accountLang("hajarxp7fem", tiktok, {})).toBe("en");
    expect(accountLang("hajarxp7fem", tiktok, LANG_BY_HAND)).toBe("fr");
    // Un autre compte aux mêmes légendes garde la langue de TikTok.
    expect(accountLang("hajarxp7", tiktok, LANG_BY_HAND)).toBe("en");
  });

  it("la langue déclarée d'un pseudo : le pseudo exact, sinon rien", () => {
    const byHand = { fr: ["a.b", "c_d"], pt: ["e"] };
    expect(declaredLang("a.b", byHand)).toBe("fr");
    expect(declaredLang("e", byHand)).toBe("pt");
    expect(declaredLang("a", byHand)).toBeUndefined();
    expect(declaredLang("a.b", {})).toBeUndefined();
  });

  it("la synchro la pose sur le compte qui ne l'a pas, et ne réécrit rien ensuite", () => {
    expect(needsDeclaredLang({}, "fr")).toBe(true);
    expect(needsDeclaredLang({ lang: "en" }, "fr")).toBe(true);
    expect(needsDeclaredLang({ lang: "fr" }, "fr")).toBe(false);
    // Le compte n'est pas (ou plus) suivi : rien à écrire.
    expect(needsDeclaredLang(null, "fr")).toBe(false);
  });
});

describe("Radar — les langues déclarées à la main", () => {
  const tous = Object.values(LANG_BY_HAND).flat();

  it("les cinq francophones du 12/11/2026, et eux seuls", () => {
    expect(LANG_BY_HAND).toEqual({ fr: ["learnwith_tesnime", "kayllis8", "study_with_louise", "sandrashh5o4", "hajarxp7fem"] });
  });

  it("chaque langue est une langue de l'onglet Créateurs : sinon le compte ne serait nulle part", () => {
    for (const lang of Object.keys(LANG_BY_HAND)) expect(CREATOR_LANGS as readonly string[]).toContain(lang);
  });

  it("des pseudos tels que TikTok les écrit, une seule langue chacun, aucun compte sorti du suivi", () => {
    for (const h of tous) expect(h).toMatch(/^[a-z0-9._]+$/);
    expect(new Set(tous).size).toBe(tous.length);
    expect(tous.filter((h) => SEED_REMOVED.includes(h) || OFF_TOPIC_BY_HAND.includes(h))).toEqual([]);
  });
});

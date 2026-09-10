import { describe, it, expect } from "vitest";
import {
  moduleLocale,
  selectModulesForLocale,
} from "../convex/guideModuleLocale";

/**
 * Sélection du JEU de modules du guide « Comment ça marche » selon la langue du
 * lecteur (`convex/guideModuleLocale.ts`), importée depuis lib/ comme
 * `convex/dateFr.ts` — le module est PUR et exécuté par le runtime Convex.
 *
 * Les jeux de test ont la FORME de la prod : titres réels des 11 modules
 * (deux projets, repackit et snytch), `locale` absente sur les modules écrits
 * avant le champ. Un jeu idéalisé (« A », « B », locale toujours posée) ne
 * dirait rien du seul cas qui existe aujourd'hui en base.
 */

/** Les 5 modules FR de repackit, tels qu'ils sont en prod : SANS `locale`. */
const PROD_FR = [
  { title: "Bienvenue & comment ça marche", order: 0 },
  { title: "Comment tu es payé", order: 1 },
  { title: "Création de tes comptes", order: 2 },
  { title: "Warmup & éviter le shadowban", order: 3 },
  { title: "Règles & exigences de post", order: 4 },
] as { title: string; order: number; locale?: string }[];

const EN_SET = [
  { title: "Welcome & how it works", order: 0, locale: "en" },
  { title: "How you get paid", order: 1, locale: "en" },
];

describe("moduleLocale — langue d'un module", () => {
  it("locale absente ⇒ français (les 11 modules écrits avant le champ)", () => {
    expect(moduleLocale({ locale: undefined })).toBe("fr");
    expect(moduleLocale({})).toBe("fr");
  });

  it("locale posée ⇒ elle-même, étiquette régionale tolérée", () => {
    expect(moduleLocale({ locale: "en" })).toBe("en");
    expect(moduleLocale({ locale: "en-US" })).toBe("en");
    expect(moduleLocale({ locale: "fr" })).toBe("fr");
  });

  it("langue inconnue ⇒ défaut, une lecture ne casse jamais", () => {
    expect(moduleLocale({ locale: "de" })).toBe("fr");
    expect(moduleLocale({ locale: "" })).toBe("fr");
  });
});

describe("selectModulesForLocale — jeu servi et langue réellement servie", () => {
  it("lecteur EN sans jeu EN : repli sur le jeu FR, servedLocale = fr", () => {
    const res = selectModulesForLocale(PROD_FR, "en");
    expect(res.servedLocale).toBe("fr");
    expect(res.modules.map((m) => m.title)).toEqual([
      "Bienvenue & comment ça marche",
      "Comment tu es payé",
      "Création de tes comptes",
      "Warmup & éviter le shadowban",
      "Règles & exigences de post",
    ]);
  });

  it("lecteur EN avec jeu EN : QUE l'anglais, servedLocale = en", () => {
    const res = selectModulesForLocale([...PROD_FR, ...EN_SET], "en");
    expect(res.servedLocale).toBe("en");
    expect(res.modules.map((m) => m.title)).toEqual([
      "Welcome & how it works",
      "How you get paid",
    ]);
  });

  it("un jeu EN PARTIEL suffit — pas de repli au module près", () => {
    // 2 modules EN face à 5 FR : le lecteur EN lit les 2, il ne récupère
    // JAMAIS les 3 français manquants en complément.
    const res = selectModulesForLocale([...PROD_FR, ...EN_SET], "en");
    expect(res.modules).toHaveLength(2);
    expect(res.modules.some((m) => m.title.startsWith("Warmup"))).toBe(false);
  });

  it("lecteur FR : le français, jamais l'anglais, même jeu EN présent", () => {
    const res = selectModulesForLocale([...PROD_FR, ...EN_SET], "fr");
    expect(res.servedLocale).toBe("fr");
    expect(res.modules.map((m) => m.title)).toEqual(
      PROD_FR.map((m) => m.title),
    );
  });

  it("CONTRE-ÉPREUVE — le repli ne va QUE vers le français", () => {
    // Un projet dont TOUT le guide est anglais : le lecteur français ne se voit
    // pas servir l'anglais faute de mieux, il voit un guide vide. C'est
    // l'asymétrie voulue — « fr » est le défaut du produit, pas un pis-aller.
    const res = selectModulesForLocale(EN_SET, "fr");
    expect(res.servedLocale).toBe("fr");
    expect(res.modules).toEqual([]);
  });

  it("guide vide : servedLocale = fr, et ce n'est PAS un repli pour un FR", () => {
    expect(selectModulesForLocale([], "fr")).toEqual({
      modules: [],
      servedLocale: "fr",
    });
    // Pour un lecteur EN en revanche, servedLocale ≠ requested → l'écran sait
    // qu'il n'a pas obtenu sa langue (c'est lui qui décide d'afficher ou non le
    // bandeau, cf GuideScreen : pas de bandeau au-dessus de rien).
    expect(selectModulesForLocale([], "en").servedLocale).toBe("fr");
  });

  it("le jeu servi ne contient QUE sa langue (pas de mélange)", () => {
    const mixed = [...PROD_FR, ...EN_SET];
    for (const loc of ["fr", "en"] as const) {
      const res = selectModulesForLocale(mixed, loc);
      expect(res.modules.every((m) => moduleLocale(m) === loc)).toBe(true);
    }
  });
});

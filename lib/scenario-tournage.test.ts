import { describe, it, expect } from "vitest";
import {
  faconDeRedemander,
  lireLienTournage,
  lireReponseCreation,
  lireReponseSuivi,
  nomBlush,
  refBlush,
  veille,
} from "../convex/scenarioTournageRegles";

describe("veille", () => {
  it("recule d'un jour, mois et années compris", () => {
    expect(veille("2026-10-15")).toBe("2026-10-14");
    expect(veille("2026-11-01")).toBe("2026-10-31");
    expect(veille("2026-01-01")).toBe("2025-12-31");
    expect(veille("2028-03-01")).toBe("2028-02-29");
  });

  it("ignore les changements d'heure (jours de Paris, pas des heures)", () => {
    expect(veille("2026-10-26")).toBe("2026-10-25");
    expect(veille("2026-03-30")).toBe("2026-03-29");
  });
});

describe("lireLienTournage", () => {
  it("garde un lien https collé, sans les blancs du bord", () => {
    expect(lireLienTournage("  https://askblush.com/tournage/k3J9x  ")).toEqual({
      ok: true,
      lien: "https://askblush.com/tournage/k3J9x",
    });
  });

  it("vide = retirer le lien", () => {
    expect(lireLienTournage("   ")).toEqual({ ok: true, lien: null });
  });

  it("refuse ce qui n'est pas un lien https d'une ligne", () => {
    for (const x of [
      "askblush.com/tournage/k3J9x",
      "http://askblush.com/tournage/k3J9x",
      "javascript:alert(1)",
      "https://askblush.com/a b",
      "https://askblush.com/a\nhttps://askblush.com/b",
      `https://askblush.com/${"x".repeat(600)}`,
    ]) {
      expect(lireLienTournage(x), x).toEqual({ ok: false });
    }
  });
});

describe("API BLUSH — réponses", () => {
  it("ref et nom du lien", () => {
    expect(refBlush("k57abc", 2)).toBe("jarvia-k57abc-v2");
    expect(nomBlush("Kelly", "A1", "Le mdr de 5h52")).toBe("Kelly · A1 · Le mdr de 5h52");
  });

  it("création : l'id, ou un refus lisible (422 = prénom absent)", () => {
    expect(lireReponseCreation(200, { id: "t_91", nouvelle: true, statut: "en_lecture" }, "Kelly")).toEqual({ ok: true, id: "t_91" });
    expect(lireReponseCreation(422, { erreur: "moi absent" }, "Kelly")).toEqual({
      ok: false,
      transitoire: false,
      erreur: "Le prénom « Kelly » n'apparaît pas dans le fichier (BLUSH : moi absent).",
    });
    expect(lireReponseCreation(401, {}, "Kelly")).toMatchObject({ ok: false, transitoire: false });
    expect(lireReponseCreation(503, {}, "Kelly")).toMatchObject({ ok: false, transitoire: true });
    expect(lireReponseCreation(200, {}, "Kelly")).toMatchObject({ ok: false, transitoire: false });
  });

  it("suivi : en lecture, prêt (lien https seulement), échec, coupure", () => {
    expect(lireReponseSuivi(200, { statut: "en_lecture" }, "K")).toEqual({ statut: "en_lecture" });
    expect(lireReponseSuivi(200, { statut: "pret", lien: "https://www.askblush.com/t/x9" }, "K")).toEqual({
      statut: "pret",
      lien: "https://www.askblush.com/t/x9",
    });
    expect(lireReponseSuivi(200, { statut: "pret", lien: "javascript:alert(1)" }, "K")).toMatchObject({ statut: "echec" });
    expect(lireReponseSuivi(200, { statut: "echec", erreur: "conv illisible" }, "K")).toEqual({
      statut: "echec",
      erreur: "La lecture BLUSH a échoué : conv illisible",
    });
    expect(lireReponseSuivi(502, {}, "K")).toMatchObject({ statut: "transitoire" });
    expect(lireReponseSuivi(404, {}, "K")).toMatchObject({ statut: "echec" });
  });
});

describe("faconDeRedemander — ne jamais repayer une lecture pour rien", () => {
  it("rien tant qu'un lien est posé ou qu'une demande tourne", () => {
    expect(faconDeRedemander({ statut: "pret" }, true)).toBe("rien");
    expect(faconDeRedemander({ statut: "en_lecture" }, false)).toBe("rien");
    expect(faconDeRedemander({ statut: "demande" }, false)).toBe("rien");
  });

  it("reprend la même demande après une lecture trop longue ou une coupure", () => {
    expect(faconDeRedemander({ statut: "echec", reprise: true, erreur: "BLUSH injoignable." }, false)).toBe("reprendre");
    // Les échecs écrits avant le correctif (15/10, 20 min) se reprennent aussi.
    expect(
      faconDeRedemander({ statut: "echec", erreur: "BLUSH n'a pas fini la lecture en 20 minutes : réessaie." }, false),
    ).toBe("reprendre");
  });

  it("relance (nouvelle lecture) après un vrai échec de BLUSH, ou la première fois", () => {
    expect(faconDeRedemander({ statut: "echec", erreur: "La lecture BLUSH a échoué : alerte" }, false)).toBe("relancer");
    expect(faconDeRedemander(undefined, false)).toBe("relancer");
    expect(faconDeRedemander({ statut: "pret" }, false)).toBe("relancer");
  });
});

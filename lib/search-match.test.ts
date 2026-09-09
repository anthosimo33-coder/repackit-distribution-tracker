import { describe, it, expect } from "vitest";
import { normaliser, scoreRecherche } from "./search-match";

describe("scoreRecherche — le filtre des sélecteurs longs", () => {
  it("EXCLUT les sous-séquences dispersées (le défaut de cmdk)", () => {
    // Le cas qui a motivé ce module : « Serb » remontait « Îles Vierges
    // britanniques » parce que s, e, r, b s'y trouvent dans l'ordre.
    expect(scoreRecherche("Îles Vierges britanniques VG", "Serb")).toBe(0);
    // Présence en regard : la vraie réponse, elle, passe.
    expect(scoreRecherche("Serbie RS", "Serb")).toBe(1);
  });

  it("ignore les accents des deux côtés", () => {
    expect(scoreRecherche("États-Unis US", "etats")).toBe(1);
    expect(scoreRecherche("Etats-Unis US", "États")).toBe(1);
  });

  it("classe un début de mot AVANT un milieu de mot", () => {
    // « Sud » commence un mot dans « Afrique du Sud »…
    expect(scoreRecherche("Afrique du Sud ZA", "sud")).toBe(1);
    // …et n'en commence pas un dans « Soudan » : trouvé, mais moins bien classé.
    expect(scoreRecherche("Soudan SD", "ouda")).toBe(0.5);
  });

  it("trouve par CODE autant que par nom", () => {
    expect(scoreRecherche("Bosnie-Herzégovine BA", "BA")).toBe(1);
    expect(scoreRecherche("Serbie RS", "rs")).toBe(1);
  });

  it("trouve un fuseau par sa ville, son continent ou son décalage", () => {
    const item = "Belgrade — Europe Europe/Belgrade UTC+2";
    for (const q of ["belgrade", "europe", "UTC+2"]) {
      expect(scoreRecherche(item, q), q).toBeGreaterThan(0);
    }
    expect(scoreRecherche(item, "tokyo")).toBe(0);
  });

  it("une recherche vide garde tout", () => {
    expect(scoreRecherche("n'importe quoi", "")).toBe(1);
    expect(scoreRecherche("n'importe quoi", "   ")).toBe(1);
  });

  it("normaliser : minuscules, sans accents, sans bords", () => {
    expect(normaliser("  ÉLÈVE  ")).toBe("eleve");
  });
});

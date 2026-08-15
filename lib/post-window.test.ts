import { describe, expect, it } from "vitest";
import {
  isValidPostWindow,
  formatPostWindow,
  postWindowSentence,
  POST_WINDOW_PRESETS,
} from "../convex/postWindow";

/**
 * La plage horaire est stockée en MINUTES depuis minuit local. Ces tests
 * verrouillent deux choses : la validation (une plage ratée ne doit pas entrer
 * en base) et surtout le RENDU QUAND LA PLAGE EST ABSENTE — c'est le cas des
 * 191 assignments antérieurs au champ, donc le cas le plus fréquent en prod
 * pendant longtemps.
 */
describe("isValidPostWindow", () => {
  it("accepte les presets du process", () => {
    for (const p of POST_WINDOW_PRESETS) {
      expect(isValidPostWindow(p.window)).toBe(true);
    }
  });

  it("refuse une plage vide, inversée ou hors journée", () => {
    expect(isValidPostWindow({ startMin: 600, endMin: 600 })).toBe(false); // durée nulle
    expect(isValidPostWindow({ startMin: 1380, endMin: 1260 })).toBe(false); // inversée
    expect(isValidPostWindow({ startMin: -1, endMin: 600 })).toBe(false);
    expect(isValidPostWindow({ startMin: 600, endMin: 1441 })).toBe(false);
    expect(isValidPostWindow({ startMin: 60.5, endMin: 600 })).toBe(false); // non entier
  });

  it("refuse ce qui n'est pas une plage", () => {
    for (const x of [null, undefined, {}, { startMin: 60 }, "21h-23h", 1260]) {
      expect(isValidPostWindow(x)).toBe(false);
    }
  });
});

describe("formatPostWindow", () => {
  it("omet les minutes sur une heure ronde", () => {
    expect(formatPostWindow({ startMin: 21 * 60, endMin: 23 * 60 })).toBe("21h-23h");
  });

  it("affiche les minutes quand il y en a", () => {
    expect(formatPostWindow({ startMin: 21 * 60 + 30, endMin: 23 * 60 + 5 })).toBe(
      "21h30-23h05",
    );
  });

  it("rend null — pas 'undefined' — quand la plage manque ou est invalide", () => {
    expect(formatPostWindow(null)).toBeNull();
    expect(formatPostWindow(undefined)).toBeNull();
    expect(formatPostWindow({ startMin: 600, endMin: 600 })).toBeNull();
  });
});

describe("postWindowSentence — ce que lit la créatrice", () => {
  it("annonce la plage quand elle existe", () => {
    expect(
      postWindowSentence("15/08", { startMin: 21 * 60, endMin: 23 * 60 }),
    ).toBe("À publier le 15/08 entre 21h et 23h");
  });

  it("SANS plage : phrase propre, aucun artefact", () => {
    // Le cas des 191 assignments existants. Aucun « entre  et », aucun tiret
    // orphelin, aucun « undefined » : la phrase doit se terminer sur le jour.
    for (const absente of [null, undefined]) {
      const s = postWindowSentence("15/08", absente);
      expect(s).toBe("À publier le 15/08");
      expect(s).not.toMatch(/undefined|NaN|entre|--/);
    }
  });

  it("une plage INVALIDE se comporte comme une plage absente", () => {
    // Défense en profondeur : si une donnée bancale passait la validation
    // d'écriture, l'écran créatrice reste lisible plutôt que d'afficher
    // « entre 23h et 21h ».
    const s = postWindowSentence("15/08", { startMin: 1380, endMin: 1260 });
    expect(s).toBe("À publier le 15/08");
  });
});

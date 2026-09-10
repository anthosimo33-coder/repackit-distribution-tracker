import { describe, it, expect } from "vitest";
import {
  PER_CREATOR,
  displayedPricingChoice,
  pricingForCreator,
} from "./assign-pricing";

/**
 * La pré-sélection du barème dans la modale d'assignation. Ce qu'on protège :
 * qu'un choix explicite ne soit pas défait par un changement de créatrice, et
 * qu'un lot ne parte pas au tarif d'une seule.
 */

// Forme de la prod : des ids opaques, pas « A » et « B ».
const FR_CPM = "kn7d3q1x8w2v9m4p6s0t5r3h";
const US_CPM = "kn79f2b4c6d8e0g2h4j6k8l0";

describe("displayedPricingChoice", () => {
  it("unitaire, intouché : la grille de la créatrice", () => {
    expect(
      displayedPricingChoice({
        touched: false,
        chosen: null,
        mode: "single",
        creatorPricingId: FR_CPM,
      }),
    ).toBe(FR_CPM);
  });

  it("unitaire, intouché, créatrice sans grille : aucun barème", () => {
    expect(
      displayedPricingChoice({
        touched: false,
        chosen: null,
        mode: "single",
        creatorPricingId: null,
      }),
    ).toBeNull();
  });

  it("masse, intouché : le barème de CHAQUE créatrice", () => {
    expect(
      displayedPricingChoice({
        touched: false,
        chosen: null,
        mode: "bulk",
        creatorPricingId: FR_CPM,
      }),
    ).toBe(PER_CREATOR);
  });

  it.each([["single"] as const, ["bulk"] as const])(
    "%s : un choix explicite l'emporte sur la grille de la créatrice",
    (mode) => {
      // Le cas qui compte : le manager impose US, puis change de créatrice (FR).
      // Reprendre FR ici défairait son geste sans rien dire.
      expect(
        displayedPricingChoice({
          touched: true,
          chosen: US_CPM,
          mode,
          creatorPricingId: FR_CPM,
        }),
      ).toBe(US_CPM);
    },
  );
});

describe("pricingForCreator", () => {
  it("« barème de chacune » rend celui de la créatrice", () => {
    expect(pricingForCreator(PER_CREATOR, US_CPM)).toBe(US_CPM);
  });

  it("« barème de chacune » sur une créatrice sans grille : rien", () => {
    expect(pricingForCreator(PER_CREATOR, null)).toBeNull();
  });

  it("un barème imposé s'applique à tout le monde, grille ou pas", () => {
    expect(pricingForCreator(FR_CPM, US_CPM)).toBe(FR_CPM);
    expect(pricingForCreator(FR_CPM, null)).toBe(FR_CPM);
  });

  it("aucun choix reste aucun barème", () => {
    expect(pricingForCreator(null, null)).toBeNull();
  });
});

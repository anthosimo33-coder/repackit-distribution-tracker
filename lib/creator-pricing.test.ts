import { describe, it, expect } from "vitest";
import { resolveCreatorPricing } from "../convex/creatorPricing";

/**
 * Quel barème est pré-sélectionné pour une créatrice. Ce qui se joue ici :
 * proposer une grille que la paie ne lira pas, ou en proposer une que le
 * sélecteur ne contient pas (barème archivé) — dans les deux cas le manager
 * assigne en croyant avoir choisi.
 */

// Forme de la prod : des noms qui se ressemblent, une grille archivée dans le
// lot, et un défaut de projet qui n'est pas le premier de la liste.
const PRICINGS = [
  { _id: "p_fr_cpm", name: "Créateur Snytch 🇫🇷 - CPM", status: "active" },
  { _id: "p_us_cpm", name: "Créateur Snytch 🇺🇸 - CPM", status: "active" },
  { _id: "p_fr_500", name: "Créateur Snytch 🇫🇷 - 500€/mois", status: "active" },
  { _id: "p_vieux", name: "Créateur Snytch 🇫🇷 - 350€/mois", status: "archived" },
];
const DEFAUT = "p_fr_cpm";

describe("resolveCreatorPricing", () => {
  it("prend la grille de la fiche quand elle en a une", () => {
    expect(
      resolveCreatorPricing({ bonusPricingId: "p_fr_500" }, DEFAUT, PRICINGS),
    ).toEqual({ pricingId: "p_fr_500", pricingName: "Créateur Snytch 🇫🇷 - 500€/mois" });
  });

  it("retombe sur le défaut du projet quand la fiche n'en a pas", () => {
    expect(resolveCreatorPricing({}, DEFAUT, PRICINGS)).toEqual({
      pricingId: "p_fr_cpm",
      pricingName: "Créateur Snytch 🇫🇷 - CPM",
    });
  });

  it("la grille de la fiche PRIME sur le défaut du projet", () => {
    // Sans cette priorité, une créatrice au forfait serait pré-sélectionnée au
    // CPM du projet — le tarif de quelqu'un d'autre.
    expect(
      resolveCreatorPricing({ bonusPricingId: "p_us_cpm" }, DEFAUT, PRICINGS)
        .pricingId,
    ).toBe("p_us_cpm");
  });

  it("ne rend RIEN quand la grille de la fiche est archivée", () => {
    // Le sélecteur ne liste que les barèmes actifs : rendre cet id afficherait
    // un champ vide au lieu d'un choix.
    expect(
      resolveCreatorPricing({ bonusPricingId: "p_vieux" }, DEFAUT, PRICINGS),
    ).toEqual({ pricingId: null, pricingName: null });
  });

  it("ne rend RIEN quand le défaut du projet est archivé", () => {
    expect(resolveCreatorPricing({}, "p_vieux", PRICINGS)).toEqual({
      pricingId: null,
      pricingName: null,
    });
  });

  it("ne rend RIEN sans grille de fiche ni défaut de projet", () => {
    expect(resolveCreatorPricing({}, null, PRICINGS)).toEqual({
      pricingId: null,
      pricingName: null,
    });
  });

  it("ne rend RIEN quand la grille pointée n'existe plus", () => {
    // Un barème supprimé laisse un id pendant sur la fiche ; l'écran doit dire
    // « aucune grille », pas planter ni inventer.
    expect(
      resolveCreatorPricing({ bonusPricingId: "p_disparu" }, DEFAUT, PRICINGS),
    ).toEqual({ pricingId: null, pricingName: null });
  });
});

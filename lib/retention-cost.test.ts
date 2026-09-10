process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { acquisitionCostPerClient } from "./retention-cost";

/** La profondeur réellement collectée en prod le 06/09/2026. */
const RANGE = { first: "2026-07-23", last: "2026-09-06" };

/** Coûts prod, non fenêtrés : 4 812,40 $ de vidéos promo + 1 250 $ de bonus. */
const TOUT = { promo: 4812.4, promoBonus: 1250, window: null };

describe("acquisitionCostPerClient", () => {
  it("divise le coût de TOUTE la profondeur par les clients de TOUTE la profondeur", () => {
    // 6 062,40 / 272 clients payants Whop = 22,29 $.
    expect(acquisitionCostPerClient(TOUT, 272, RANGE)).toBe(22.29);
  });

  it("REFUSE de diviser un coût fenêtré par des clients non fenêtrés", () => {
    // Le défaut livré en #167 : sept jours de coût sur tous les clients depuis
    // le début. Le chiffre sortait à 1,84 $ au lieu de 22,29 $ — crédible, et
    // faux d'un facteur douze.
    const septJours = {
      promo: 460.2,
      promoBonus: 40,
      window: { from: "2026-08-31", to: "2026-09-06" },
    };
    expect(acquisitionCostPerClient(septJours, 272, RANGE)).toBeNull();
  });

  it("coût ET clients sur la MÊME fenêtre : accepté", () => {
    // C'est le cas devenu possible avec la cohorte d'acquisition : les deux
    // côtés du quotient portent sur la même période.
    const w = { from: "2026-08-31", to: "2026-09-06" };
    const septJours = { promo: 460.2, promoBonus: 40, window: w };
    // 500,20 / 40 clients acquis cette semaine-là = 12,51 $.
    expect(acquisitionCostPerClient(septJours, 40, RANGE, w)).toBe(12.51);
  });

  it("deux fenêtres DIFFÉRENTES restent refusées", () => {
    const coutSemaine = {
      promo: 460.2,
      promoBonus: 40,
      window: { from: "2026-08-31", to: "2026-09-06" },
    };
    const clientsMois = { from: "2026-08-01", to: "2026-09-06" };
    expect(
      acquisitionCostPerClient(coutSemaine, 120, RANGE, clientsMois),
    ).toBeNull();
    // Contre-test : la même fenêtre des deux côtés passe.
    expect(
      acquisitionCostPerClient(coutSemaine, 40, RANGE, coutSemaine.window),
    ).toBe(12.51);
  });

  it("un coût fenêtré sur des clients NON fenêtrés reste refusé", () => {
    // Le défaut de #167, toujours interdit : c'est le cas le plus insidieux
    // parce que les deux nombres existent et se divisent sans broncher.
    const septJours = {
      promo: 460.2,
      promoBonus: 40,
      window: { from: "2026-08-31", to: "2026-09-06" },
    };
    expect(acquisitionCostPerClient(septJours, 272, RANGE, null)).toBeNull();
  });

  it("une fenêtre qui couvre TOUT est acceptée", () => {
    // Contre-test de la condition : sans lui, un refus systématique passerait le
    // test précédent sans rien mesurer. Le sélecteur sur « Tout » doit rendre le
    // chiffre, pas un tiret.
    const fenetreTotale = { ...TOUT, window: { from: "2026-07-23", to: "2026-09-06" } };
    expect(acquisitionCostPerClient(fenetreTotale, 272, RANGE)).toBe(22.29);
    // Et une fenêtre plus large que les données couvre aussi tout.
    const plusLarge = { ...TOUT, window: { from: "2026-01-01", to: "2026-12-31" } };
    expect(acquisitionCostPerClient(plusLarge, 272, RANGE)).toBe(22.29);
  });

  it("un coût inconnu ne devient pas zéro", () => {
    expect(acquisitionCostPerClient({ ...TOUT, promo: null }, 272, RANGE)).toBeNull();
    expect(acquisitionCostPerClient({ ...TOUT, promoBonus: null }, 272, RANGE)).toBeNull();
    // Contre-test : les deux connus, le chiffre revient.
    expect(acquisitionCostPerClient(TOUT, 272, RANGE)).toBe(22.29);
  });

  it("sans client payant, pas de division", () => {
    expect(acquisitionCostPerClient(TOUT, 0, RANGE)).toBeNull();
  });

  it("sans profondeur connue, une fenêtre ne peut pas être déclarée totale", () => {
    // `range` absent : impossible de prouver que la fenêtre couvre tout, donc on
    // refuse plutôt que de supposer.
    const fenetree = { ...TOUT, window: { from: "2026-01-01", to: "2026-12-31" } };
    expect(acquisitionCostPerClient(fenetree, 272, null)).toBeNull();
    // Contre-test : sans fenêtre du tout, l'absence de profondeur n'empêche rien.
    expect(acquisitionCostPerClient(TOUT, 272, null)).toBe(22.29);
  });
});

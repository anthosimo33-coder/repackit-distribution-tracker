process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import {
  promoVideosOf,
  windowCosts,
  windowedAttribution,
  type AttributionRowLike,
} from "./attribution-window";

/**
 * Lignes à la forme de la prod : une vidéo mixte, une vidéo 100 % warmup (donc
 * hors promo), une vidéo retirée de la paie, et une legacy sans barème.
 */
const ROWS: AttributionRowLike[] = [
  {
    day: "2026-08-30",
    creatorId: "c1",
    creatorName: "Kelly",
    promoViews: 12_100,
    payableViews: 12_100,
    hasPromoPost: true,
    cost: 12.1,
    promoCost: 12.1,
  },
  {
    day: "2026-09-02",
    creatorId: "c1",
    creatorName: "Kelly",
    promoViews: 0,
    payableViews: 59_000,
    hasPromoPost: false, // 100 % warmup : jamais un jour solo
    cost: 59,
    promoCost: 0,
  },
  {
    day: "2026-09-02",
    creatorId: "c2",
    creatorName: "Veljko",
    promoViews: 75_139,
    payableViews: 0,
    hasPromoPost: true,
    cost: 0, // retirée de la paie : coût CONNU, il vaut zéro
    promoCost: 0,
  },
  {
    day: "2026-09-05",
    creatorId: "c3",
    creatorName: "Cintia",
    promoViews: 1_473,
    payableViews: 1_473,
    hasPromoPost: true,
    cost: 5,
    promoCost: 5,
  },
];

const BONUS = [
  { day: "2026-08-30", amount: 200 },
  { day: "2026-09-05", amount: 50 },
];

const DAILY = [
  { day: "2026-08-30", visitors: 1604, signups: 729, clients: 18 },
  { day: "2026-09-02", visitors: 2934, signups: 1588, clients: 37 },
  { day: "2026-09-05", visitors: 1163, signups: 600, clients: 19 },
];

describe("windowCosts", () => {
  it("ne retient que les lignes de la fenêtre, bornes comprises", () => {
    const c = windowCosts(ROWS, BONUS, { from: "2026-09-02", to: "2026-09-05" });
    expect(c.rows).toHaveLength(3);
    expect(c.full).toBe(64); // 59 + 0 + 5, la ligne du 30/08 est dehors
    expect(c.promo).toBe(5); // seules les vidéos PROMO : 0 + 5
    expect(c.bonus).toBe(50); // le bonus du 30/08 est dehors
    expect(c.promoViews).toBe(76_612); // 75 139 + 1 473
  });

  it("REFUSE la somme si une seule vidéo a un coût inconnu", () => {
    // Règle déjà appliquée côté serveur : un total partiel se lirait comme un
    // total. Un tiret dit la vérité, une somme incomplète ment.
    const avecLegacy = [
      ...ROWS,
      {
        day: "2026-09-03",
        creatorId: "c4",
        creatorName: "Sarah",
        promoViews: 900,
        payableViews: 900,
        hasPromoPost: true,
        cost: null,
        promoCost: null,
      },
    ];
    const c = windowCosts(avecLegacy, BONUS, { from: "2026-09-01", to: "2026-09-06" });
    expect(c.promo).toBeNull();
    expect(c.full).toBeNull();
    // Les vues, elles, restent comptées : elles ne sont pas inconnues.
    expect(c.promoViews).toBe(76_612 + 900);
  });

  it("fenêtre absente : aucune ligne, aucun bonus (assertion de présence)", () => {
    const c = windowCosts(ROWS, BONUS, null);
    expect(c.rows).toHaveLength(0);
    expect(c.bonus).toBeNull();
    // Contre-test : sur une fenêtre qui couvre tout, on retrouve bien le total.
    const tout = windowCosts(ROWS, BONUS, { from: "2026-01-01", to: "2026-12-31" });
    expect(tout.full).toBe(76.1);
    expect(tout.bonus).toBe(250);
  });
});

describe("promoVideosOf", () => {
  it("écarte les vidéos 100 % warmup", () => {
    // Un jour solo mesure une présence PROMO : une vidéo entièrement warmup n'y
    // a pas sa place, même publiée ce jour-là.
    const v = promoVideosOf(ROWS);
    expect(v).toHaveLength(3);
    expect(v.every((x) => x.creatorName !== undefined)).toBe(true);
    expect(v.filter((x) => x.day === "2026-09-02")).toHaveLength(1);
  });
});

describe("windowedAttribution", () => {
  it("recalcule jours solo et efficacité SUR LA FENÊTRE", () => {
    const a = windowedAttribution(ROWS, BONUS, DAILY, {
      from: "2026-09-05",
      to: "2026-09-05",
    });
    expect(a.soloDays).toHaveLength(1);
    expect(a.soloDays[0].day).toBe("2026-09-05");
    // Une seule créatrice ce jour-là → attribution CERTAINE, avec les compteurs
    // du bon jour.
    expect(a.soloDays[0].isSolo).toBe(true);
    expect(a.soloDays[0].attribution?.creatorName).toBe("Cintia");
    expect(a.soloDays[0].attribution?.visitors).toBe(1163);
    // L'efficacité ne porte que sur les vidéos de la fenêtre.
    expect(a.creators.map((c) => c.creatorName)).toEqual(["Cintia"]);
  });

  it("le 02/09 EST solo : deux créatrices, mais une seule en promo", () => {
    const a = windowedAttribution(ROWS, BONUS, DAILY, {
      from: "2026-09-02",
      to: "2026-09-02",
    });
    // Kelly a publié ce jour-là, mais 100 % en warmup : elle ne compte pas comme
    // une présence promo, donc le jour reste attribuable à Veljko seul. C'est
    // toute la raison d'être de `hasPromoPost` dans le filtre.
    expect(a.soloDays[0].creators).toHaveLength(1);
    expect(a.soloDays[0].isSolo).toBe(true);
    expect(a.soloDays[0].attribution?.creatorName).toBe("Veljko");
  });

  it("un jour solo prend les compteurs de SON jour, pas d'un autre", () => {
    const a = windowedAttribution(ROWS, BONUS, DAILY, {
      from: "2026-08-30",
      to: "2026-08-30",
    });
    expect(a.soloDays).toHaveLength(1);
    // 1604 est le 30/08 ; 2934 et 1163 sont les autres jours de la série, qui
    // reste passée en entier (elle ne sert que de table de correspondance).
    expect(a.soloDays[0].attribution?.visitors).toBe(1604);
    expect(a.costs.bonus).toBe(200);
  });
});

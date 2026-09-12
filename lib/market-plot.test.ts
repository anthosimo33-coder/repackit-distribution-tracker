import { describe, it, expect } from "vitest";
import {
  quadrantScale,
  curveScale,
  bubbleRadius,
  auDessusDuSeuil,
  marchesPlacables,
  marchesTraces,
  largeurRemboursement,
  joliPas,
  echelleRonde,
  PADDING,
} from "./market-plot";
import { aggregateMarket, type MarketFacts } from "./market-aggregate";
import { VALUE_DAYS, SURVIVAL_DAYS } from "../convex/marketValue";

/**
 * Le placement des marchés dans le cadre.
 *
 * Les marchés de test sont construits par `aggregateMarket`, la vraie
 * dérivation : un jeu fabriqué à la main pourrait porter des combinaisons que
 * l'agrégation ne produit jamais, et le test placerait alors des points qui
 * n'existent pas. Les chiffres ont la forme de la prod — la France qui
 * rembourse, les Balkans qui ne remboursent pas, la Suisse qui ne coûte rien.
 */

function marche(p: {
  pays: string;
  cout?: number;
  clients?: number;
  /** [valeur, effectif mûr] par jalon, dans l'ordre de VALUE_DAYS. */
  valeurs?: [number, number][];
}) {
  const faits: MarketFacts = {
    country: p.pays,
    creatorIds: [],
    videos: 0,
    cost: p.cout ?? 0,
    costComparable: p.cout ?? 0,
    clients: p.clients ?? 0,
    payments: p.clients ?? 0,
    revenueNet: 0,
    previousClients: 0,
    previousRevenueNet: 0,
    cohortClients: p.clients ?? 0,
    curve: VALUE_DAYS.map((day, i) => ({
      day,
      // On donne des SOMMES : l'agrégation divisera, comme en production.
      sum: (p.valeurs?.[i]?.[0] ?? 0) * (p.valeurs?.[i]?.[1] ?? 0),
      mature: p.valeurs?.[i]?.[1] ?? 0,
    })),
    survival: SURVIVAL_DAYS.map((day) => ({ day, alive: 0, mature: 0 })),
    visitors: 0,
    trafficClients: 0,
    plans: [],
  };
  return aggregateMarket([faits], { key: p.pays, label: p.pays, composed: false });
}

/** Une courbe qui monte, avec assez d'effectif partout pour être lisible. */
const courbe = (v: number[], n = 40): [number, number][] =>
  v.map((x) => [x, n] as [number, number]);

const FRANCE = marche({
  pays: "FR", cout: 980.4, clients: 147,
  valeurs: courbe([4.1, 6.2, 8.9, 10.7, 12.3, 13.6], 96),
});
const BALKANS = marche({
  pays: "RS", cout: 490, clients: 14,
  valeurs: courbe([3.6, 4.5, 5.2, 5.8, 6.4, 6.9], 9),
});
const SUISSE = marche({
  pays: "CH", cout: 0, clients: 4,
  valeurs: courbe([4.99, 8.1, 11.2, 14, 16.4, 18.4], 6),
});
const MAROC = marche({ pays: "MA", cout: 142, clients: 0 });

describe("quadrantScale — une seule échelle, sinon la diagonale ment", () => {
  it("les deux axes portent la MÊME échelle", () => {
    const e = quadrantScale([FRANCE, BALKANS, SUISSE]);
    // C'est la propriété qui fait exister le graphe : `y = x` n'est le seuil
    // que si une même valeur se place au même endroit sur les deux axes.
    for (const v of [0, 5, 12, e.max]) {
      expect(e.x(v)).toBeCloseTo(e.y(v), 10);
    }
  });

  it("englobe le coût par client ET la valeur, même quand c'est le coût qui domine", () => {
    // Balkans : 35 € de coût par client contre 6,90 € de valeur. Une échelle
    // calée sur la seule valeur couperait la bulle hors cadre.
    const e = quadrantScale([BALKANS]);
    expect(BALKANS.cac).toBeCloseTo(35, 0);
    expect(e.max).toBeGreaterThanOrEqual(35);
    expect(e.x(BALKANS.cac!)).toBeLessThanOrEqual(1 - PADDING);
  });

  it("ne gaspille pas la hauteur du cadre", () => {
    // Le défaut vu au rendu : un plafond de 18,40 € donnait un maximum de 40 €,
    // parce que le pas « rond » saute de 5 à 10. Les cinq courbes se tassaient
    // alors dans le tiers bas. Le plafond doit SERRER les données.
    const e = quadrantScale([SUISSE]);
    expect(e.max).toBeGreaterThanOrEqual(18.4);
    expect(e.max).toBeLessThan(18.4 * 1.6);
  });

  it("découpe le cadre en 3 à 6 tranches, jamais moins ni plus", () => {
    // Moins, on ne sait plus lire une hauteur ; plus, la grille devient un
    // grillage. La règle vaut quel que soit l'ordre de grandeur.
    for (const plafond of [3.2, 18.4, 35, 137, 980]) {
      const { ticks } = echelleRonde(plafond);
      expect(ticks.length - 1).toBeGreaterThanOrEqual(3);
      expect(ticks.length - 1).toBeLessThanOrEqual(6);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(plafond);
    }
  });

  it("gradue en nombres ronds, bornes comprises", () => {
    const e = quadrantScale([SUISSE]);
    expect(e.ticks[0]).toBe(0);
    expect(e.ticks[e.ticks.length - 1]).toBe(e.max);
    // Un pas « rond » : pas 4,60 / 9,20 / 13,80.
    expect(e.ticks.every((t) => Number.isFinite(t))).toBe(true);
    expect(joliPas(4.6)).toBe(5);
    expect(joliPas(0.9)).toBe(1);
    expect(joliPas(23)).toBe(25);
  });

  it("sans aucun marché mesurable, rend une échelle utilisable", () => {
    // Une échelle à 0 ferait diviser par zéro et empilerait tout dans un coin.
    const e = quadrantScale([]);
    expect(e.max).toBeGreaterThan(0);
    expect(e.x(0)).toBeCloseTo(PADDING, 10);
  });

  it("borne les valeurs hors échelle au cadre", () => {
    const e = quadrantScale([SUISSE]);
    expect(e.y(e.max * 10)).toBeLessThanOrEqual(1 - PADDING + 1e-9);
    expect(e.y(-5)).toBeCloseTo(PADDING, 10);
  });
});

describe("auDessusDuSeuil — le verdict que porte la position", () => {
  it("la France rembourse, les Balkans non", () => {
    // France : 6,67 € de coût pour 13,60 € de valeur.
    expect(auDessusDuSeuil(FRANCE)).toBe(true);
    // Balkans : 35 € de coût pour 6,90 €.
    expect(auDessusDuSeuil(BALKANS)).toBe(false);
  });

  it("un marché sans coût est au-dessus : il ne coûte rien", () => {
    expect(auDessusDuSeuil(SUISSE)).toBe(true);
  });

  it("sans valeur mesurable, aucun verdict — et surtout pas « non »", () => {
    // Un marché trop jeune pour avoir une valeur à 90 jours n'est pas un marché
    // déficitaire : le peindre en rouge serait une accusation sans preuve.
    const jeune = marche({
      pays: "LU", cout: 100, clients: 3,
      valeurs: [[4.48, 3], [4.48, 3], [0, 0], [0, 0], [0, 0], [0, 0]],
    });
    expect(auDessusDuSeuil(jeune)).toBeNull();
  });
});

describe("marchesPlacables — le quadrant ne place que ce qu'il sait placer", () => {
  it("écarte un marché sans client, qui n'a aucune des deux coordonnées", () => {
    const placables = marchesPlacables([FRANCE, BALKANS, SUISSE, MAROC]);
    expect(placables.map((m) => m.key)).toEqual(["FR", "RS", "CH"]);
    // Le Maroc a bien un COÛT : il n'est pas écarté pour être vide, mais pour
    // n'avoir aucune valeur à porter en hauteur.
    expect(MAROC.cost).toBe(142);
    expect(MAROC.cac).toBeNull();
  });
});

describe("bubbleRadius — l'œil compare des aires", () => {
  it("cent clients font une bulle dix fois plus GROSSE, pas cent fois", () => {
    const r1 = bubbleRadius(1, 100);
    const r100 = bubbleRadius(100, 100);
    const petit = r1 - 0.012;
    const grand = r100 - 0.012;
    // En racine : le rapport des rayons est 10, pas 100.
    expect(grand / Math.max(petit, 1e-9)).toBeCloseTo(10, 0);
  });

  it("un marché d'un seul client reste visible et cliquable", () => {
    expect(bubbleRadius(1, 10_000)).toBeGreaterThanOrEqual(0.012);
    expect(bubbleRadius(0, 0)).toBeGreaterThanOrEqual(0.012);
  });
});

describe("largeurRemboursement — « jamais » n'est pas « court »", () => {
  it("un remboursement mesuré se place sur la fenêtre de 90 jours", () => {
    expect(largeurRemboursement({ day: 45, state: "ok" })).toBeCloseTo(0.5, 2);
    expect(largeurRemboursement({ day: 90, state: "ok" })).toBeCloseTo(1, 2);
  });

  it("« jamais » et « inconnu » REMPLISSENT la piste", () => {
    // Une barre courte se lirait comme un bon résultat. C'est le motif de la
    // barre qui dit lequel des deux, pas sa longueur.
    expect(largeurRemboursement({ day: null, state: "jamais" })).toBe(1);
    expect(largeurRemboursement({ day: null, state: "inconnu" })).toBe(1);
  });

  it("« immédiat » est un trait, pas un vide", () => {
    // Largeur nulle, la barre disparaîtrait et la ligne se lirait comme une
    // absence de donnée.
    expect(largeurRemboursement({ day: 0, state: "gratuit" })).toBeGreaterThan(0);
    expect(largeurRemboursement({ day: 0, state: "gratuit" })).toBeLessThan(0.1);
  });
});

describe("marchesTraces — cinq courbes, pas vingt", () => {
  it("garde les plus gros porteurs de clients", () => {
    const traces = marchesTraces([SUISSE, FRANCE, BALKANS], 2);
    expect(traces.map((m) => m.key)).toEqual(["FR", "RS"]);
  });

  it("écarte un marché dont AUCUN jalon n'est mesurable", () => {
    // Une courbe plate à zéro se lirait comme « ce marché ne rapporte rien »,
    // alors qu'elle dit seulement qu'on ne sait pas encore.
    const muet = marche({ pays: "PL", clients: 900 });
    const traces = marchesTraces([muet, FRANCE]);
    expect(traces.map((m) => m.key)).toEqual(["FR"]);
    // Assertion de PRÉSENCE : le même marché, avec un jalon mesurable, passe.
    const parlant = marche({
      pays: "PL", clients: 900,
      valeurs: courbe([4.1, 4.1, 4.1, 4.1, 4.1, 4.1], 30),
    });
    expect(marchesTraces([parlant, FRANCE]).map((m) => m.key)).toEqual(["PL", "FR"]);
  });
});

describe("curveScale — le temps, l'argent, et les coûts en pointillés", () => {
  it("se cale sur les VALEURS, pas sur un coût d'acquisition démesuré", () => {
    // Balkans : valeur plafonnée à 6,90 €, coût par client de 35 €. Inclure le
    // coût tirait l'échelle à 40 € et tassait toutes les courbes dans le tiers
    // bas — vérifié au rendu. La ligne de coût de ce marché n'est alors pas
    // tracée, et le remboursement d'à côté dit déjà « jamais ».
    const e = curveScale([BALKANS]);
    expect(e.max).toBeLessThan(35);
    expect(e.max).toBeGreaterThanOrEqual(6.9);
  });

  it("laisse de la place à un coût d'acquisition RAISONNABLE", () => {
    // Contre-épreuve de la règle ci-dessus : la France coûte 6,67 € par client
    // pour 13,60 € de valeur. Son pointillé doit tomber DANS le cadre, sinon le
    // franchissement — la raison d'être du graphe — ne se verrait pas.
    const e = curveScale([FRANCE]);
    expect(FRANCE.cac).toBeLessThan(e.max);
  });

  it("place les jalons de 0 à 90 jours, dans le cadre", () => {
    const e = curveScale([FRANCE]);
    expect(e.jours).toEqual([...VALUE_DAYS]);
    expect(e.x(0)).toBeCloseTo(PADDING, 10);
    expect(e.x(e.jourMax)).toBeCloseTo(1 - PADDING, 10);
  });
});

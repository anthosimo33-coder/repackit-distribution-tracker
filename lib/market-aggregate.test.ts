import { describe, it, expect } from "vitest";
import {
  aggregateMarket,
  remboursement,
  MIN_MATURE,
  type MarketFacts,
  type ValeurCohorte,
} from "./market-aggregate";
import { VALUE_DAYS, SURVIVAL_DAYS } from "../convex/marketValue";

/**
 * Un marché, seul ou composé.
 *
 * Les jeux ont la forme de la prod : des codes ISO, des montants nets décimaux
 * (4,48 € = 4,99 € moins les frais Whop), des effectifs déséquilibrés — c'est
 * le déséquilibre qui fait tout l'intérêt (la France pèse trente fois la
 * Croatie), et des ids de créatrices Convex qui se recoupent entre deux pays.
 */

/** Un pays, avec ce qu'il faut et rien de plus — le reste prend un défaut. */
function pays(p: Partial<MarketFacts> & { country: string }): MarketFacts {
  return {
    country: p.country,
    creatorIds: p.creatorIds ?? [],
    videos: p.videos ?? 0,
    cost: p.cost ?? 0,
    costComparable: p.costComparable === undefined ? (p.cost ?? 0) : p.costComparable,
    clients: p.clients ?? 0,
    payments: p.payments ?? 0,
    revenueNet: p.revenueNet ?? 0,
    previousClients: p.previousClients ?? 0,
    previousRevenueNet: p.previousRevenueNet ?? 0,
    cohortClients: p.cohortClients ?? 0,
    curve: p.curve ?? VALUE_DAYS.map((day) => ({ day, sum: 0, mature: 0 })),
    survival: p.survival ?? SURVIVAL_DAYS.map((day) => ({ day, alive: 0, mature: 0 })),
    visitors: p.visitors ?? 0,
    trafficClients: p.trafficClients ?? 0,
    plans: p.plans ?? [],
    promoCost: p.promoCost,
    promoCostComparable: p.promoCostComparable,
    promoViews: p.promoViews,
    checkouts: p.checkouts,
    creatorsDetail: p.creatorsDetail,
  };
}
const courbe = (v: [number, number][]) =>
  VALUE_DAYS.map((day, i) => ({ day, sum: v[i][0], mature: v[i][1] }));
const seul = (m: MarketFacts) =>
  aggregateMarket([m], { key: m.country ?? "", label: m.country ?? "—", composed: false });

describe("aggregateMarket — additionner puis diviser UNE fois", () => {
  it("un marché composé ne moyenne pas des moyennes", () => {
    // France : 30 clients mûrs, 300 € cumulés → 10 € par client.
    // Croatie : 5 clients mûrs, 25 € cumulés → 5 € par client.
    // La moyenne des moyennes donnerait 7,50 € ; la vraie valeur est
    // 325 / 35 = 9,2857 €. C'est tout l'enjeu du module.
    const fr = pays({ country: "FR", curve: courbe([[0,0],[0,0],[300,30],[0,0],[0,0],[0,0]]) });
    const hr = pays({ country: "HR", curve: courbe([[0,0],[0,0],[25,5],[0,0],[0,0],[0,0]]) });
    const g = aggregateMarket([fr, hr], { key: "g:1", label: "Composé", composed: true });
    const j30 = g.value.find((v) => v.day === 30)!;
    expect(j30.mature).toBe(35);
    expect(j30.value).toBeCloseTo(9.2857, 3);
    expect(j30.value).not.toBeCloseTo(7.5, 2);
  });

  it("une créatrice qui vise DEUX pays du marché ne compte qu'une fois", () => {
    const rs = pays({ country: "RS", creatorIds: ["k17aaa", "k17bbb"] });
    const hr = pays({ country: "HR", creatorIds: ["k17bbb", "k17ccc"] });
    const g = aggregateMarket([rs, hr], { key: "g:1", label: "Balkans", composed: true });
    // Union = 3, et surtout PAS la somme (4).
    expect(g.creators).toBe(3);
    expect(g.creators).not.toBe(4);
  });

  it("sous le seuil d'effectif, la valeur est VIDE — jamais un chiffre", () => {
    const m = pays({
      country: "BE",
      curve: courbe([[40, 10], [36, 9], [20, MIN_MATURE - 1], [0, 0], [0, 0], [0, 0]]),
    });
    const d = seul(m);
    // 10 mûrs : on divise.
    expect(d.value[0].value).toBeCloseTo(4, 2);
    // 4 mûrs : on ne divise pas, mais l'effectif reste LISIBLE — l'écran affiche
    // « — 4 », pas un vide muet qui se lirait comme « pas de données du tout ».
    const j30 = d.value.find((v) => v.day === 30)!;
    expect(j30.value).toBeNull();
    expect(j30.mature).toBe(MIN_MATURE - 1);
  });

  it("sans taux de change, ni coût par client ni retour — un tiret, pas un zéro", () => {
    // Le projet n'a pas réglé son taux : le coût reste en dollars, et le
    // comparer à des euros produirait un nombre qui ne veut rien dire.
    const m = pays({ country: "FR", cost: 980.4, costComparable: null, clients: 147, revenueNet: 1675.8 });
    const d = seul(m);
    expect(d.cost).toBe(980.4); // il reste AFFICHABLE dans sa devise…
    expect(d.cac).toBeNull(); // …mais aucun ratio n'en sort.
    expect(d.retour).toBeNull();
    expect(d.payback.state).toBe("inconnu");
  });

  it("un marché composé dont UN pays n'est pas convertible n'a pas de total comparable", () => {
    const a = pays({ country: "RS", cost: 310, costComparable: 310, clients: 9 });
    const b = pays({ country: "HR", cost: 180, costComparable: null, clients: 5 });
    const g = aggregateMarket([a, b], { key: "g:1", label: "Balkans", composed: true });
    // Un total à moitié converti serait un nombre sans unité.
    expect(g.costComparable).toBeNull();
    expect(g.retour).toBeNull();
    // Le coût brut, lui, reste la somme : il est affichable tel quel.
    expect(g.cost).toBe(490);
  });

  it("un marché sans investissement n'a pas de retour, et ce n'est pas zéro", () => {
    const ch = pays({ country: "CH", cost: 0, clients: 4, payments: 14, revenueNet: 88.42 });
    const d = seul(ch);
    // Le RETOUR n'existe pas : diviser par zéro rendrait Infinity, et l'afficher
    // « 0,00 » ferait passer le meilleur marché du tableau pour le pire.
    expect(d.retour).toBeNull();
    // Le COÛT PAR CLIENT, lui, vaut bien zéro — et ce n'est pas la même chose
    // qu'inconnu : on SAIT qu'on n'a rien dépensé. L'écran l'affiche « aucun »,
    // et le quadrant place le marché sur son axe gauche.
    expect(d.cac).toBe(0);
    expect(d.payback.state).toBe("gratuit");
  });

  it("panier, cycles et conversion se dérivent des volumes", () => {
    const m = pays({
      country: "FR",
      clients: 147, payments: 259, revenueNet: 1675.8,
      visitors: 8420, trafficClients: 147,
    });
    const d = seul(m);
    expect(d.basket).toBeCloseTo(6.47, 2);
    expect(d.cycles).toBeCloseTo(1.762, 3);
    expect(d.conversion).toBeCloseTo(0.01746, 5);
  });

  it("sous 30 visiteurs, aucun taux de conversion", () => {
    const d = seul(pays({ country: "PL", visitors: 7, trafficClients: 1 }));
    expect(d.conversion).toBeNull();
    // Assertion de PRÉSENCE en regard : au-dessus du seuil, le taux existe.
    expect(seul(pays({ country: "PL", visitors: 30, trafficClients: 1 })).conversion)
      .toBeCloseTo(1 / 30, 5);
  });

  it("les deltas comparent à la période d'avant, et disent « nouveau » s'il n'y en a pas", () => {
    const d = seul(pays({
      country: "FR", clients: 147, revenueNet: 1675.8,
      previousClients: 118, previousRevenueNet: 1284.5,
    }));
    expect(d.deltaClients).toBeCloseTo(0.2458, 3);
    expect(d.deltaRevenue).toBeCloseTo(0.3046, 3);
    // Rien avant ⇒ `null`, et surtout pas « +100 % » ni « 0 % ».
    expect(seul(pays({ country: "LU", clients: 1 })).deltaClients).toBeNull();
  });

  it("la survie est un taux, et elle est VIDE sous le seuil", () => {
    const d = seul(pays({
      country: "FR",
      survival: [
        { day: 30, alive: 82, mature: 100 },
        { day: 60, alive: 32, mature: 50 },
        { day: 90, alive: 2, mature: 4 },
      ],
    }));
    expect(d.survival[0].rate).toBeCloseTo(0.82, 3);
    expect(d.survival[1].rate).toBeCloseTo(0.64, 3);
    // 4 mûrs : « 50 % » sur quatre personnes serait du bruit présenté en chiffre.
    expect(d.survival[2].rate).toBeNull();
    expect(d.survival[2].mature).toBe(4);
  });

  it("le mix de plans va du moins cher au plus cher, en parts", () => {
    const a = pays({ country: "FR", plans: [
      { planId: "p1", label: "hebdo", price: 4.99, clients: 30 },
      { planId: "p3", label: "mensuel", price: 8.9, clients: 70 },
    ]});
    const b = pays({ country: "BE", plans: [
      { planId: "p1", label: "hebdo", price: 4.99, clients: 10 },
    ]});
    const g = aggregateMarket([a, b], { key: "g:1", label: "Composé", composed: true });
    expect(g.plans.map((p) => p.planId)).toEqual(["p1", "p3"]);
    expect(g.plans[0].share).toBeCloseTo(40 / 110, 4);
    expect(g.plans[1].share).toBeCloseTo(70 / 110, 4);
  });
});

describe("remboursement — le jour où un client a remboursé son coût", () => {
  const v = (paires: [number, number | null][]): ValeurCohorte[] =>
    VALUE_DAYS.map((day, i) => ({ day, value: paires[i][1], mature: paires[i][0] }));

  it("interpole entre les deux jalons qui encadrent le franchissement", () => {
    // Coût 6,67 € ; la valeur passe de 6,20 € (J+15) à 8,90 € (J+30).
    // 6,67 est à (6,67−6,20)/(8,90−6,20) = 17,4 % de l'intervalle → J+18.
    const r = remboursement(
      v([[147, 4.1], [147, 6.2], [131, 8.9], [120, 10.7], [110, 12.3], [96, 13.6]]),
      6.67,
      147,
    );
    expect(r.state).toBe("ok");
    expect(r.day).toBe(18);
  });

  it("rembourse dès le premier paiement si le coût est déjà couvert", () => {
    const r = remboursement(v([[9, 4.1], [9, 6.2], [9, 8.9], [9, 9], [9, 9], [9, 9]]), 3.5, 9);
    expect(r.day).toBe(0);
  });

  it("« jamais » veut dire « pas dans les 90 jours mesurés »", () => {
    // Serbie : 34,44 € de coût par client, 6,90 € de valeur à 90 jours.
    const r = remboursement(
      v([[9, 3.6], [9, 4.5], [8, 5.2], [8, 5.8], [7, 6.4], [6, 6.9]]),
      34.44,
      9,
    );
    expect(r.state).toBe("jamais");
    expect(r.day).toBeNull();
  });

  it("un jalon sans effectif est SAUTÉ, pas lu comme un échec", () => {
    // Les jalons 30 et 45 manquent d'effectif (`null`) ; le franchissement se lit
    // entre 15 et 60. Les traiter comme des zéros ferait conclure « jamais ».
    const r = remboursement(
      v([[20, 4.1], [20, 6.2], [3, null], [3, null], [20, 12.3], [18, 13.6]]),
      9,
      20,
    );
    expect(r.state).toBe("ok");
    // Entre J+15 (6,20) et J+60 (12,30) : 9 € est à 45,9 % → J+36.
    expect(r.day).toBe(36);
  });

  it("aucun client, aucun verdict", () => {
    expect(remboursement(v([[0, null], [0, null], [0, null], [0, null], [0, null], [0, null]]), 10, 0))
      .toEqual({ day: null, state: "inconnu" });
  });

  it("aucun investissement : il n'y a rien à rembourser", () => {
    const r = remboursement(v([[4, 4.99], [4, 8.1], [4, 11.2], [4, 14], [4, 16.4], [3, 18.4]]), 0, 4);
    expect(r.state).toBe("gratuit");
    // Assertion de PRÉSENCE : avec un coût, le même marché rembourse vraiment.
    expect(remboursement(v([[4, 4.99], [4, 8.1], [4, 11.2], [4, 14], [4, 16.4], [3, 18.4]]), 10, 4).state)
      .toBe("ok");
  });
});

describe("aggregateMarket — RPM par marché, périmètre promo", () => {
  it("le RPM d'un marché composé divise des SOMMES, pas une moyenne de RPM", () => {
    // Serbie : 1,20 € de clients pour 10 000 vues (0,12 €/1 000).
    // Bosnie : 30,00 € pour 2 000 vues (15 €/1 000). Moyenne des RPM : 7,56 €.
    // Vrai RPM : 31,20 € / 12 000 vues × 1 000 = 2,60 €.
    const rs = pays({
      country: "RS", clients: 1, payments: 1, revenueNet: 1.2,
      promoCost: 5.5, promoCostComparable: 4.73, promoViews: 10_000,
    });
    const ba = pays({
      country: "BA", clients: 2, payments: 2, revenueNet: 30,
      promoCost: 2.1, promoCostComparable: 1.81, promoViews: 2000,
    });
    const g = aggregateMarket([rs, ba], { key: "g:b", label: "Balkans", composed: true });
    expect(g.rpmCollected).toBeCloseTo(2.6, 5);
    expect(g.rpmCollected).not.toBeCloseTo(7.56, 1);
    expect(g.costPer1000).toBeCloseTo((6.54 / 12_000) * 1000, 5);
  });

  it("valeur des clients : valeur à 30 j quand elle est mûre, sinon panier ESTIMÉ", () => {
    const mur = pays({
      country: "FR", clients: 98, payments: 177, revenueNet: 1999.03,
      curve: courbe([[0,0],[0,0],[786.6,60],[0,0],[0,0],[0,0]]),
      promoCostComparable: 313.72, promoCost: 364.79, promoViews: 412_000,
    });
    const m = seul(mur);
    expect(m.acquisitionValue?.estimated).toBe(false);
    expect(m.acquisitionValue?.amount).toBeCloseTo(98 * 13.11, 6);
    expect(m.rpmAcquisition).toBeCloseTo((98 * 13.11 / 412_000) * 1000, 5);
    expect(m.acquisitionReturn).toBeCloseTo((98 * 13.11) / 313.72, 5);

    const jeune = seul(pays({ country: "US", clients: 1, payments: 1, revenueNet: 9.67 }));
    expect(jeune.acquisitionValue).toEqual({ amount: 9.67, estimated: true });
  });

  it("sans vues promo, aucun RPM (jamais une division par zéro affichée)", () => {
    const m = seul(pays({ country: "CL", promoCost: 6.7, promoCostComparable: 5.76 }));
    expect(m.rpmCollected).toBeNull();
    expect(m.costPer1000).toBeNull();
  });

  it("une créatrice sur deux pays du même marché n'apparaît qu'une fois", () => {
    const c = (promoViews: number, promoCost: number) => ({
      creatorId: "k57a1b2c3d4e5f6", name: "Milica Jovanović", videos: 1, promoViews, promoCost,
    });
    const g = aggregateMarket(
      [
        pays({ country: "RS", creatorsDetail: [c(8400, 4.2)] }),
        pays({ country: "BA", creatorsDetail: [c(1260, 0.63)] }),
      ],
      { key: "g:b", label: "Balkans", composed: true },
    );
    expect(g.creatorsDetail).toEqual([
      { creatorId: "k57a1b2c3d4e5f6", name: "Milica Jovanović", videos: 2, promoViews: 9660, promoCost: 4.83 },
    ]);
  });
});

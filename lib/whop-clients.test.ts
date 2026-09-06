process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import {
  countPersons,
  dailyNewPersons,
  firstPaidByPerson,
  personKeyOf,
} from "../convex/whopClients";

/**
 * Le cas qui a motivé ce module vient de la PROD : sur Snytch au 2026-09-06,
 * 375 abonnements pour 351 personnes. Lire les abonnements comme des personnes
 * avait déjà produit un faux écart de 9 face à PostHog, pour un écart réel NUL.
 */

/** Jour Europe/Paris — injecté, comme le fait analyticsHub. */
const parisDay = (ts: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
    new Date(ts),
  );

const D = (iso: string) => Date.parse(iso);

describe("personKeyOf", () => {
  it("replie deux abonnements d'une même personne sur une seule clé", () => {
    const userOf = new Map([
      ["mem_A", "user_1"],
      ["mem_B", "user_1"],
    ]);
    expect(personKeyOf("mem_A", userOf)).toBe(personKeyOf("mem_B", userOf));
  });

  it("ne fusionne JAMAIS deux abonnements non résolus", () => {
    // Le sens de l'erreur compte : surestimer les clients sous-estime le coût
    // unitaire, ce qui ne flatte rien. Fusionner deux inconnus perdrait un client.
    const userOf = new Map<string, string>();
    expect(personKeyOf("mem_A", userOf)).not.toBe(personKeyOf("mem_B", userOf));
    expect(countPersons(["mem_A", "mem_B"], userOf)).toBe(2);
  });
});

describe("countPersons", () => {
  it("compte des PERSONNES, pas des abonnements", () => {
    const userOf = new Map([
      ["mem_A", "user_1"],
      ["mem_B", "user_1"],
      ["mem_C", "user_1"], // la personne à 3 abonnements observée en prod
      ["mem_D", "user_2"],
      ["mem_E", "user_3"],
    ]);
    expect(countPersons(["mem_A", "mem_B", "mem_C", "mem_D", "mem_E"], userOf)).toBe(3);
  });
});

describe("firstPaidByPerson", () => {
  it("retient le PREMIER paiement de la personne, pas celui de chaque abonnement", () => {
    const userOf = new Map([
      ["mem_A", "user_1"],
      ["mem_B", "user_1"],
    ]);
    const first = new Map([
      ["mem_A", D("2026-08-20T10:00:00Z")],
      ["mem_B", D("2026-08-12T10:00:00Z")], // le plus ancien
    ]);
    expect(firstPaidByPerson(first, userOf)).toEqual(
      new Map([["user_1", D("2026-08-12T10:00:00Z")]]),
    );
  });
});

describe("dailyNewPersons", () => {
  it("acquiert la personne au jour de son PREMIER abonnement, une seule fois", () => {
    const userOf = new Map([
      ["mem_A", "user_1"],
      ["mem_B", "user_1"],
      ["mem_C", "user_2"],
    ]);
    const first = new Map([
      ["mem_A", D("2026-08-12T10:00:00Z")],
      ["mem_B", D("2026-08-20T10:00:00Z")], // 2e abonnement : n'ajoute PAS un client
      ["mem_C", D("2026-08-20T11:00:00Z")],
    ]);
    expect(dailyNewPersons(first, userOf, parisDay)).toEqual([
      { day: "2026-08-12", clients: 1 },
      { day: "2026-08-20", clients: 1 },
    ]);
  });

  it("INVARIANT : la somme des jours vaut exactement le nombre de personnes", () => {
    // C'est ce qui autorise l'écran à diviser par une somme fenêtrée sans changer
    // d'unité. Sans cet invariant, « ÷ 351 » s'afficherait sous une courbe qui
    // somme à 375.
    const userOf = new Map([
      ["mem_A", "user_1"],
      ["mem_B", "user_1"],
      ["mem_C", "user_1"],
      ["mem_D", "user_2"],
      // mem_E non résolu : compte pour lui-même
    ]);
    const first = new Map([
      ["mem_A", D("2026-07-25T09:00:00Z")],
      ["mem_B", D("2026-08-01T09:00:00Z")],
      ["mem_C", D("2026-08-14T09:00:00Z")],
      ["mem_D", D("2026-08-01T09:00:00Z")],
      ["mem_E", D("2026-09-02T09:00:00Z")],
    ]);
    const serie = dailyNewPersons(first, userOf, parisDay);
    const somme = serie.reduce((s, r) => s + r.clients, 0);
    expect(somme).toBe(countPersons(first.keys(), userOf));
    expect(somme).toBe(3); // user_1, user_2, mem_E
    // Et surtout : PAS le nombre d'abonnements.
    expect(somme).not.toBe(first.size);
  });

  it("range un paiement de fin de soirée dans le jour PARISIEN", () => {
    // 22:30 UTC le 31/08 = 00:30 le 01/09 à Paris. Le hub compte en jours Paris ;
    // un client acquis à minuit passé ne doit pas remonter à la veille.
    const first = new Map([["mem_A", D("2026-08-31T22:30:00Z")]]);
    expect(dailyNewPersons(first, new Map(), parisDay)).toEqual([
      { day: "2026-09-01", clients: 1 },
    ]);
  });

  it("rend une série TRIÉE (l'écran la découpe par bornes de jours)", () => {
    const first = new Map([
      ["m1", D("2026-09-02T09:00:00Z")],
      ["m2", D("2026-07-25T09:00:00Z")],
      ["m3", D("2026-08-14T09:00:00Z")],
    ]);
    expect(dailyNewPersons(first, new Map(), parisDay).map((r) => r.day)).toEqual([
      "2026-07-25",
      "2026-08-14",
      "2026-09-02",
    ]);
  });
});

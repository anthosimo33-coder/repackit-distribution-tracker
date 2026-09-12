import { describe, it, expect } from "vitest";
import {
  marketValueByCountry,
  marketSurvivalByCountry,
  VALUE_DAYS,
  SURVIVAL_DAYS,
} from "../convex/marketValue";

/**
 * Ce qu'un client rapporte, par marché.
 *
 * Les jeux ci-dessous ont la FORME de la production : des identifiants de
 * membership Whop, des montants nets décimaux (4,48 € = 4,99 € moins les frais),
 * des dates qui ne sont pas aujourd'hui, et des clients d'âges différents —
 * c'est précisément le mélange des âges qui fait tout l'intérêt du calcul.
 */

const J = 86_400_000;
/** Instant de référence fixe : 12 septembre 2026, 12 h UTC. */
const MAINTENANT = Date.UTC(2026, 8, 12, 12, 0, 0);
const ilYA = (jours: number) => MAINTENANT - jours * J;

const idx = (jour: number) => VALUE_DAYS.indexOf(jour as (typeof VALUE_DAYS)[number]);

describe("marketValueByCountry — la valeur cumulée d'un client", () => {
  it("cumule les paiements d'un client jusqu'au jalon, pas au-delà", () => {
    // Acquis il y a 120 jours : mûr pour TOUS les jalons. Il paie à J0, J28 et
    // J61 — le troisième tombe après le jalon 30 et après le jalon 45.
    const t0 = ilYA(120);
    const v = marketValueByCountry(
      [
        { client: "mem_A", country: "FR", paidAt: t0, net: 4.48 },
        { client: "mem_A", country: "FR", paidAt: t0 + 28 * J, net: 4.48 },
        { client: "mem_A", country: "FR", paidAt: t0 + 61 * J, net: 8.02 },
      ],
      MAINTENANT,
    );
    expect(v).toHaveLength(1);
    const fr = v[0];
    expect(fr.country).toBe("FR");
    expect(fr.cohortClients).toBe(1);
    expect(fr.curve[idx(0)].sum).toBeCloseTo(4.48, 2);
    expect(fr.curve[idx(15)].sum).toBeCloseTo(4.48, 2);
    expect(fr.curve[idx(30)].sum).toBeCloseTo(8.96, 2);
    expect(fr.curve[idx(45)].sum).toBeCloseTo(8.96, 2);
    // Le paiement de J+61 n'entre qu'au jalon 90.
    expect(fr.curve[idx(60)].sum).toBeCloseTo(8.96, 2);
    expect(fr.curve[idx(90)].sum).toBeCloseTo(16.98, 2);
  });

  it("un client trop jeune ne compte NI au numérateur NI au dénominateur", () => {
    // Deux clients du même marché : un mûr (120 j), un de 10 jours.
    const vieux = ilYA(120);
    const jeune = ilYA(10);
    const v = marketValueByCountry(
      [
        { client: "mem_vieux", country: "BE", paidAt: vieux, net: 4.48 },
        { client: "mem_vieux", country: "BE", paidAt: vieux + 40 * J, net: 4.48 },
        { client: "mem_jeune", country: "BE", paidAt: jeune, net: 7.12 },
      ],
      MAINTENANT,
    );
    const be = v[0];
    // La cohorte les compte tous les deux : ce sont bien deux clients acquis.
    expect(be.cohortClients).toBe(2);
    // À J0, les deux ont l'âge.
    expect(be.curve[idx(0)].mature).toBe(2);
    expect(be.curve[idx(0)].sum).toBeCloseTo(11.6, 2);
    // À J+30, le jeune n'a PAS l'âge : il sort des deux côtés de la division.
    expect(be.curve[idx(30)].mature).toBe(1);
    expect(be.curve[idx(30)].sum).toBeCloseTo(4.48, 2);
    // Contre-épreuve de la règle : s'il était « compté à zéro », la somme serait
    // la même mais l'effectif vaudrait 2, et la moyenne tomberait de moitié.
    expect(be.curve[idx(30)].mature).not.toBe(2);
  });

  it("le client reste au pays de son PREMIER paiement", () => {
    // Il s'abonne depuis la France, puis paie deux fois depuis la Suisse.
    const t0 = ilYA(100);
    const v = marketValueByCountry(
      [
        { client: "mem_B", country: "CH", paidAt: t0 + 30 * J, net: 4.48 },
        { client: "mem_B", country: "FR", paidAt: t0, net: 4.48 },
        { client: "mem_B", country: "CH", paidAt: t0 + 60 * J, net: 4.48 },
      ],
      MAINTENANT,
    );
    // Un seul marché rendu, et c'est la France : l'ordre d'entrée ne décide pas.
    expect(v).toHaveLength(1);
    expect(v[0].country).toBe("FR");
    expect(v[0].curve[idx(90)].sum).toBeCloseTo(13.44, 2);
  });

  it("sépare les marchés, et garde « pays inconnu » à part", () => {
    const t0 = ilYA(200);
    const v = marketValueByCountry(
      [
        { client: "mem_C", country: "FR", paidAt: t0, net: 4.48 },
        { client: "mem_D", country: "RS", paidAt: t0, net: 3.6 },
        { client: "mem_E", country: null, paidAt: t0, net: 8.02 },
      ],
      MAINTENANT,
    );
    const par = new Map(v.map((m) => [m.country ?? "", m]));
    expect(par.get("FR")!.curve[idx(90)].sum).toBeCloseTo(4.48, 2);
    expect(par.get("RS")!.curve[idx(90)].sum).toBeCloseTo(3.6, 2);
    // L'adresse de facturation manque chez Whop : ce n'est pas un marché, et ça
    // ne doit pas se fondre dans un autre.
    expect(par.get("")!.country).toBeNull();
    expect(par.get("")!.curve[idx(90)].sum).toBeCloseTo(8.02, 2);
  });

  it("ne rend rien plutôt que des zéros quand il n'y a aucun paiement", () => {
    expect(marketValueByCountry([], MAINTENANT)).toEqual([]);
  });
});

describe("marketSurvivalByCountry — combien restent abonnés", () => {
  const client = (nom: string, joursDAge: number, pays = "FR") => ({
    client: nom,
    country: pays,
    firstPaidAt: ilYA(joursDAge),
  });

  it("résilié n'est pas expiré : l'accès en cours compte comme abonné", () => {
    // Acquis il y a 100 jours, accès qui court encore (résiliation notée chez
    // Whop, mais période payée non finie) → vivant aux trois jalons.
    const s = marketSurvivalByCountry(
      [client("mem_A", 100)],
      [{ client: "mem_A", accessEndsAt: null }],
      MAINTENANT,
    );
    expect(s[0].steps.map((x) => x.alive)).toEqual([1, 1, 1]);
    expect(s[0].steps.map((x) => x.mature)).toEqual([1, 1, 1]);
  });

  it("un accès fini AVANT le jalon ne compte plus à ce jalon", () => {
    // Accès arrêté 45 jours après l'acquisition : vivant à 30, mort à 60 et 90.
    const t0 = ilYA(120);
    const s = marketSurvivalByCountry(
      [{ client: "mem_B", country: "RS", firstPaidAt: t0 }],
      [{ client: "mem_B", accessEndsAt: t0 + 45 * J }],
      MAINTENANT,
    );
    const par = new Map(s[0].steps.map((x) => [x.day, x]));
    expect(par.get(30)!.alive).toBe(1);
    expect(par.get(60)!.alive).toBe(0);
    expect(par.get(90)!.alive).toBe(0);
    // …et il reste MÛR aux trois : c'est un abandon mesuré, pas une absence.
    expect(SURVIVAL_DAYS.every((d) => par.get(d)!.mature === 1)).toBe(true);
  });

  it("un client trop jeune n'est mûr qu'aux jalons qu'il a franchis", () => {
    const s = marketSurvivalByCountry(
      [client("mem_C", 40)],
      [{ client: "mem_C", accessEndsAt: null }],
      MAINTENANT,
    );
    const par = new Map(s[0].steps.map((x) => [x.day, x]));
    expect(par.get(30)!.mature).toBe(1);
    expect(par.get(60)!.mature).toBe(0);
    expect(par.get(90)!.mature).toBe(0);
  });

  it("un abonnement INCONNU est écarté, pas compté mort", () => {
    // Deux clients mûrs, un seul a un abonnement connu (l'autre vient d'un
    // import antérieur à la synchro des memberships).
    const s = marketSurvivalByCountry(
      [client("mem_D", 120), client("mem_inconnu", 120)],
      [{ client: "mem_D", accessEndsAt: null }],
      MAINTENANT,
    );
    const j90 = s[0].steps.find((x) => x.day === 90)!;
    // Mûr = 1, pas 2 : une donnée absente n'est pas une résiliation. Comptée
    // morte, la survie afficherait 50 % là où on ne sait rien du second.
    expect(j90.mature).toBe(1);
    expect(j90.alive).toBe(1);
  });

  it("une personne à PLUSIEURS abonnements vit tant que l'un d'eux court", () => {
    const t0 = ilYA(120);
    const s = marketSurvivalByCountry(
      [{ client: "mem_E", country: "FR", firstPaidAt: t0 }],
      [
        { client: "mem_E", accessEndsAt: t0 + 20 * J },
        { client: "mem_E", accessEndsAt: null },
      ],
      MAINTENANT,
    );
    // Le premier abonnement s'arrête à J+20 ; le second court toujours.
    expect(s[0].steps.every((x) => x.alive === 1)).toBe(true);
  });
});

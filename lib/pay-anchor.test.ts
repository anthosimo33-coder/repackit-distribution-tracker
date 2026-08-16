import { describe, it, expect } from "vitest";
import { payAnchorOf, cycleWindow, cycleIndexOf } from "../convex/payCycle";

/**
 * ANCRE DE CYCLE — `firstPostAt`, et rien d'autre.
 *
 * ⚠️ Ce fichier testait une expression `payStartAt ?? firstPostAt`, du temps où
 * le forfait talent était en cycles J+30. Il est passé au MOIS CALENDAIRE
 * (arbitrage B3 — 30 jours fixes produisaient 12,17 échéances par an) et vit
 * dans un chemin de lecture séparé : l'ancre de cycle est redevenue celle
 * d'avant tout le chantier.
 *
 * Ce qui compte ici est donc la NON-RÉGRESSION du chemin partenaire : ses cycles
 * doivent partir de son premier post, exactement comme avant. Si l'ancre
 * changeait, `cycleIndexOf` recalerait TOUS ses cycles, y compris ceux déjà
 * payés — des euros qui changent de cycle sans qu'aucun humain n'ait rien fait.
 */

const JOUR = 86_400_000;
const CYCLE = 30 * JOUR;

// Volontairement pas des nombres ronds : des instants réels, pas minuit pile.
const PREMIER_POST = Date.UTC(2026, 6, 21, 9, 2, 44);
const ACTIVATION_TALENT = Date.UTC(2026, 6, 3, 14, 27, 13);

describe("payAnchorOf — le premier post, et rien d'autre", () => {
  it("PARTENAIRE → firstPostAt, au bit près", () => {
    expect(payAnchorOf({ firstPostAt: PREMIER_POST })).toBe(PREMIER_POST);
  });

  it("aucun post publié → undefined (aucun cycle)", () => {
    expect(payAnchorOf({})).toBeUndefined();
    expect(payAnchorOf({ firstPostAt: undefined })).toBeUndefined();
  });

  it("un premier post à 0 n'est pas confondu avec « absent »", () => {
    // 0 est un instant valide (epoch) : le confondre avec l'absence ferait
    // disparaître les cycles d'un créateur en silence.
    expect(payAnchorOf({ firstPostAt: 0 })).toBe(0);
  });

  it("LE TALENT N'A PLUS D'ANCRE DE CYCLE — son `payStartAt` est ignoré ici", () => {
    // Un talent ne publie jamais : `firstPostAt` reste vide chez lui, donc pas
    // d'ancre, donc aucun cycle. Son forfait vit dans convex/talentPay.ts, au
    // mois. Passer `payStartAt` ne doit RIEN produire — sinon il réapparaîtrait
    // dans le tableau des cycles avec des lignes vides à 0 €.
    expect(
      payAnchorOf({ payStartAt: ACTIVATION_TALENT } as { firstPostAt?: number }),
    ).toBeUndefined();
  });
});

describe("cycles d'un partenaire — inchangés", () => {
  it("le cycle 0 démarre au premier post", () => {
    const ancre = payAnchorOf({ firstPostAt: PREMIER_POST })!;
    expect(cycleIndexOf(ancre, PREMIER_POST)).toBe(0);
    expect(cycleWindow(ancre, 0).cycleStart).toBe(PREMIER_POST);
  });

  it("le cycle bascule à J+30 du premier post", () => {
    expect(cycleIndexOf(PREMIER_POST, PREMIER_POST + CYCLE - 1)).toBe(0);
    expect(cycleIndexOf(PREMIER_POST, PREMIER_POST + CYCLE)).toBe(1);
  });

  it("aucun trou ni recouvrement entre cycles consécutifs", () => {
    for (let k = 0; k < 5; k++) {
      expect(cycleWindow(PREMIER_POST, k).cycleEnd).toBe(
        cycleWindow(PREMIER_POST, k + 1).cycleStart,
      );
    }
  });
});

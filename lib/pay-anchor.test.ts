import { describe, it, expect } from "vitest";
import { payAnchorOf, cycleWindow, cycleIndexOf } from "../convex/payCycle";

/**
 * ANCRE DE CYCLE — `payStartAt` (talent) ?? `firstPostAt` (partenaire/clippeur).
 *
 * Le test qui compte n'est pas celui du talent, c'est celui du PARTENAIRE : il
 * vérifie que l'expression dégénère EXACTEMENT en la valeur d'avant. Si elle
 * cessait de le faire, `cycleIndexOf` recalerait tous les cycles d'un partenaire,
 * y compris ceux déjà payés — des euros qui changent de cycle sans qu'aucun
 * humain n'ait rien fait.
 */

const JOUR = 86_400_000;
const CYCLE = 30 * JOUR;

// Volontairement pas un nombre rond : un instant réel, pas minuit pile.
const ACTIVATION = Date.UTC(2026, 6, 3, 14, 27, 13);
const PREMIER_POST = Date.UTC(2026, 6, 21, 9, 2, 44); // 18 jours plus tard

describe("payAnchorOf", () => {
  it("PARTENAIRE (aucune ancre) → firstPostAt, au bit près", () => {
    expect(payAnchorOf({ firstPostAt: PREMIER_POST })).toBe(PREMIER_POST);
  });

  it("TALENT (ancre, aucun post) → l'ancre", () => {
    expect(payAnchorOf({ payStartAt: ACTIVATION })).toBe(ACTIVATION);
  });

  it("les DEUX présents → l'ancre l'emporte", () => {
    // Ne devrait pas arriver (l'ancre n'est posée que sur un talent, qui ne
    // publie jamais), mais la priorité doit être déterministe si ça arrivait.
    expect(
      payAnchorOf({ payStartAt: ACTIVATION, firstPostAt: PREMIER_POST }),
    ).toBe(ACTIVATION);
  });

  it("ni l'un ni l'autre → undefined (aucun cycle)", () => {
    expect(payAnchorOf({})).toBeUndefined();
    expect(payAnchorOf({ payStartAt: undefined, firstPostAt: undefined })).toBeUndefined();
  });

  it("une ancre à 0 n'est pas confondue avec « absente »", () => {
    // `??` et non `||` : 0 est un instant valide (epoch), et le confondre avec
    // l'absence ferait basculer sur firstPostAt en silence.
    expect(payAnchorOf({ payStartAt: 0, firstPostAt: PREMIER_POST })).toBe(0);
  });
});

describe("cycles ancrés sur l'activation (talent)", () => {
  it("le 1er rush déposé 18 jours après l'activation tombe dans le cycle 0", () => {
    const ancre = payAnchorOf({ payStartAt: ACTIVATION })!;
    expect(cycleIndexOf(ancre, PREMIER_POST)).toBe(0);
    const w = cycleWindow(ancre, 0);
    expect(w.cycleStart).toBe(ACTIVATION);
    expect(PREMIER_POST).toBeGreaterThanOrEqual(w.cycleStart);
    expect(PREMIER_POST).toBeLessThan(w.cycleEnd);
  });

  it("le cycle bascule à J+30 de l'ACTIVATION, pas du 1er rush", () => {
    const ancre = ACTIVATION;
    expect(cycleIndexOf(ancre, ACTIVATION + CYCLE - 1)).toBe(0);
    expect(cycleIndexOf(ancre, ACTIVATION + CYCLE)).toBe(1);
    // 30 jours après le PREMIER RUSH, on est déjà dans le cycle 1 depuis 18 j —
    // c'est toute la différence entre les deux ancres.
    expect(cycleIndexOf(ancre, PREMIER_POST + CYCLE)).toBe(1);
  });

  it("aucun trou ni recouvrement entre cycles consécutifs", () => {
    for (let k = 0; k < 5; k++) {
      expect(cycleWindow(ACTIVATION, k).cycleEnd).toBe(
        cycleWindow(ACTIVATION, k + 1).cycleStart,
      );
    }
  });
});

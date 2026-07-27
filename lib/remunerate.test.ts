import { describe, it, expect } from "vitest";
import { isRemunerated, type RemunerationFlags } from "./remunerate";
// Réplique serveur (A6) importée en RELATIF (module pur) : parité verrouillée.
import * as convexRemunerate from "../convex/remunerate";
import { payableAssignmentViews, type PublicationViews } from "./pricing-engine";
import { passesWarmupMode } from "./warmup-mode";

describe("isRemunerated — sémantique (LOT 2)", () => {
  it("remunere explicite prime sur isWarmup", () => {
    expect(isRemunerated({ isWarmup: true, remunere: true })).toBe(true); // Kelly
    expect(isRemunerated({ isWarmup: false, remunere: false })).toBe(false);
  });
  it("sans remunere → payé ssi pas warmup (ancienne règle)", () => {
    expect(isRemunerated({ isWarmup: false })).toBe(true);
    expect(isRemunerated({ isWarmup: true })).toBe(false);
  });
});

describe("parité lib/ ↔ convex/ isRemunerated (règle A6)", () => {
  it("identique sur toutes les combinaisons (isWarmup × remunere)", () => {
    for (const isWarmup of [true, false]) {
      for (const remunere of [true, false, undefined]) {
        const flags: RemunerationFlags = { isWarmup, remunere };
        expect(convexRemunerate.isRemunerated(flags)).toBe(isRemunerated(flags));
      }
    }
  });
});

describe("iso-paie : migration remunere = !isWarmup ne change RIEN au centime", () => {
  // Posts variés, état AVANT (remunere absent, comme la prod aujourd'hui).
  const before: PublicationViews[] = [
    { views: 10_000, isWarmup: false },
    { views: 5_000, isWarmup: true }, // warmup → non payé aujourd'hui
    { views: 3_000, isWarmup: false },
  ];
  // Après migration : remunere = !isWarmup posé explicitement sur chaque post.
  const after: PublicationViews[] = before.map((p) => ({
    ...p,
    remunere: !p.isWarmup,
  }));

  it("payableViews + hasPayablePost strictement identiques avant/après", () => {
    expect(payableAssignmentViews(after)).toEqual(payableAssignmentViews(before));
  });
  it("valeur attendue : seules les vues rémunérées comptent (13 000)", () => {
    expect(payableAssignmentViews(before).payableViews).toBe(13_000);
  });
});

describe("cas Kelly (le seul qui compte) : warmup ET payé", () => {
  const kelly: PublicationViews = {
    views: 111_300,
    isWarmup: true,
    remunere: true,
  };

  it("est PAYÉ : ses vues comptent dans payableViews et il pilote le fixe", () => {
    const r = payableAssignmentViews([kelly]);
    expect(r.payableViews).toBe(111_300);
    expect(r.hasPayablePost).toBe(true);
  });

  it("est EXCLU des vues promo / conversion (isWarmup, mode exclude)", () => {
    expect(passesWarmupMode(kelly.isWarmup, "exclude")).toBe(false);
  });

  it("séparation des deux flags : payé (financier) ≠ promo (éditorial)", () => {
    expect(isRemunerated(kelly)).toBe(true); // dans la paie
    expect(passesWarmupMode(kelly.isWarmup, "exclude")).toBe(false); // hors promo
  });
});

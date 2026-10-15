import { describe, expect, it } from "vitest";
import {
  bonusLadder,
  fixePerVideo,
  maxVideoBonus,
  termsPosition,
  termsRules,
  type CycleBreakdown,
  type Terms,
} from "./creator-terms";

// Le barème de Juliette en prod (15/10/2026) : fixe 700 € / 60 vidéos, pas de
// CPM, grille par vidéo NON cumulable.
const GRILLE = {
  cumulative: false,
  tiers: [
    { seuilVues: 10_000, montant: 10 },
    { seuilVues: 50_000, montant: 40 },
    { seuilVues: 100_000, montant: 80 },
    { seuilVues: 250_000, montant: 150 },
    { seuilVues: 500_000, montant: 250 },
    { seuilVues: 1_000_000, montant: 400 },
  ],
};
const JULIETTE: Terms = {
  pricingId: "p_juliette",
  currency: "eur",
  montantFixe: 700,
  nbVideosCible: 60,
  tauxCPM: 0,
  seuilVuesFixe: 0,
  plafondParVideo: 150,
  videoBonus: GRILLE,
  hasCumulTiers: false,
};

const groupe = (over: Partial<CycleBreakdown["perPricing"][number]> = {}) => ({
  pricingId: "p_juliette",
  montantFixe: 700,
  nbVideosCible: 60,
  seuilVuesFixe: 0,
  videoCount: 16,
  fixed: 186.67,
  groupViews: 391_216,
  fixeBloque: false,
  ...over,
});

describe("Mon contrat — position du cycle", () => {
  it("lit le fixe du cycle sur CE contrat", () => {
    const p = termsPosition(JULIETTE, {
      perPricing: [groupe()],
      perAssignment: [],
      videoBonuses: [],
    });
    expect(p.fixe).toEqual({
      videoCount: 16,
      fixed: 186.67,
      groupViews: 391_216,
      fixeBloque: false,
    });
    expect(p.otherTerms).toBe(false);
  });

  it("met à part les vidéos payées sur d'autres termes (ancien barème OU ancien snapshot)", () => {
    const p = termsPosition(JULIETTE, {
      perPricing: [
        groupe({ videoCount: 9, fixed: 105 }),
        // Ancien contrat de Juliette, avant la bascule du 08/10.
        groupe({ pricingId: "p_ancien", montantFixe: 400, nbVideosCible: 30, videoCount: 7, fixed: 93.33 }),
        // Même barème, édité en place : le snapshot a gardé l'ancien fixe.
        groupe({ montantFixe: 650, videoCount: 1, fixed: 10.83 }),
      ],
      perAssignment: [],
      videoBonuses: [],
    });
    expect(p.fixe.videoCount).toBe(9);
    expect(p.fixe.fixed).toBe(105);
    expect(p.otherTerms).toBe(true);
  });

  it("meilleure vidéo = la plus vue PARMI celles de ce contrat", () => {
    const p = termsPosition(JULIETTE, {
      perPricing: [groupe()],
      perAssignment: [
        { assignmentId: "a1", pricingId: "p_juliette" },
        { assignmentId: "a2", pricingId: "p_juliette" },
        { assignmentId: "a3", pricingId: "p_ancien" },
      ],
      videoBonuses: [
        { assignmentId: "a1", views: 14_471, montant: 10 },
        { assignmentId: "a2", views: 240_065, montant: 80 },
        // Plus vue, mais sur un autre barème : ce n'est pas CETTE grille.
        { assignmentId: "a3", views: 812_904, montant: 250 },
      ],
    });
    expect(p.bestVideo).toEqual({ assignmentId: "a2", views: 240_065 });
  });

  it("aucune vidéo bonifiée → pas de meilleure vidéo", () => {
    const p = termsPosition(JULIETTE, {
      perPricing: [groupe()],
      perAssignment: [{ assignmentId: "a1", pricingId: "p_juliette" }],
      videoBonuses: [],
    });
    expect(p.bestVideo).toBeNull();
  });
});

describe("Mon contrat — grille de bonus", () => {
  it("240 065 vues : trois paliers franchis, 250 000 est le prochain, à 9 935 vues", () => {
    const l = bonusLadder(GRILLE, 240_065);
    expect(l.rows.map((r) => r.state)).toEqual([
      "done",
      "done",
      "done",
      "next",
      "todo",
      "todo",
    ]);
    expect(l.toNext).toBe(9_935);
  });

  it("aucune vidéo : le premier palier est le prochain, sans compte à rebours", () => {
    const l = bonusLadder(GRILLE, null);
    expect(l.rows[0].state).toBe("next");
    expect(l.rows.slice(1).every((r) => r.state === "todo")).toBe(true);
    expect(l.toNext).toBeNull();
  });

  it("au-delà du dernier palier : tout est franchi", () => {
    const l = bonusLadder(GRILLE, 1_204_331);
    expect(l.rows.every((r) => r.state === "done")).toBe(true);
    expect(l.toNext).toBeNull();
  });

  it("montant maximal : le plus haut palier, ou la somme si cumulable", () => {
    expect(maxVideoBonus(GRILLE)).toBe(400);
    expect(maxVideoBonus({ ...GRILLE, cumulative: true })).toBe(930);
  });

  it("part fixe par vidéo publiée", () => {
    expect(fixePerVideo(JULIETTE)).toBeCloseTo(11.6667, 4);
    expect(fixePerVideo({ montantFixe: 0, nbVideosCible: 0 })).toBe(0);
  });
});

describe("Mon contrat — règles rappelées", () => {
  it("fixe + bonus par vidéo non cumulable", () => {
    expect(termsRules(JULIETTE)).toEqual([
      "platformsAdd",
      "window30",
      "warmupNoBonus",
      "highestTierOnly",
      "paidEvery30",
    ]);
  });

  it("CPM pur : plafond par vidéo, pas de règle de bonus", () => {
    expect(
      termsRules({ ...JULIETTE, montantFixe: 0, tauxCPM: 1.25, videoBonus: null }),
    ).toEqual(["platformsAdd", "window30", "capPerVideo", "paidEvery30"]);
  });

  it("fixe seul : aucune règle de vues", () => {
    expect(
      termsRules({ ...JULIETTE, videoBonus: null }),
    ).toEqual(["paidEvery30"]);
  });

  it("paliers cumulables / paliers sur le cumul de vues", () => {
    expect(termsRules({ ...JULIETTE, videoBonus: { ...GRILLE, cumulative: true } })).toContain(
      "tiersAdd",
    );
    expect(termsRules({ ...JULIETTE, videoBonus: null, hasCumulTiers: true })).toEqual([
      "platformsAdd",
      "window30",
      "warmupNoBonus",
      "paidEvery30",
    ]);
  });
});

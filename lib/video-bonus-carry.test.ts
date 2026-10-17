import { describe, expect, it } from "vitest";

import {
  videoBonusCarrier,
  videoBonusCostOf,
  videoBonusIsSettled,
  videoBonusLedger,
  type CarryRow,
} from "../convex/videoBonusCarry";
import { cycleIndexOf } from "../convex/payCycle";
import { payWindowEndsAt } from "../convex/payWindow";
import { videoBonusComplement, type VideoBonusGrid } from "./pricing-engine";
import * as convexPricing from "../convex/pricing";

/**
 * Le cas RÉEL du 17/10/2026, à la minute près (lu sur la prod) : Juliette,
 * premier post le 07/09/2026 à 14:38:12 UTC, donc cycle 0 = 07/09 14:38 →
 * 07/10 14:38 UTC (16:38 Paris). Son reel (IG + TikTok jumeau) est publié le
 * 07/10 à 13:18 UTC, 1 h 20 avant la fin. Le cycle est marqué payé le 08/10 à
 * 13:55 UTC sur 5 750 vues ; une semaine plus tard le reel est à 56 124.
 * Grille du barème « Juliette Nouveau Contrat » : non cumulative.
 */
const ANCRE = Date.parse("2026-09-07T14:38:12.481Z");
const REEL = "ms775tyrs256rcy1s31a9dbjfn8fqy33";
const AUTRE = "ms7c1f8qk2m4v9w3x6p0t5r8y2e4ab17";
const PUBLIE = Date.parse("2026-10-07T13:18:44.120Z");
const FENETRE = payWindowEndsAt(PUBLIE);
const PAYE_LE = Date.parse("2026-10-08T13:55:07.902Z");
const GRILLE: VideoBonusGrid = {
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

/** La row payée du cycle 0, telle que la prod la porte : une ligne fixe seule. */
const CYCLE0_PAYE: CarryRow = {
  period: "2026-09-07",
  status: "paid",
  paidAt: PAYE_LE,
  lineItems: [{ assignmentId: AUTRE, kind: "fixed", amount: 11.67 }],
};

describe("report du bonus par vidéo — le cas Juliette", () => {
  const ledger = videoBonusLedger(ANCRE, [CYCLE0_PAYE]);
  const home = cycleIndexOf(ANCRE, PUBLIE);

  it("le reel appartient au cycle 0, payé avant la fin de sa fenêtre J+30", () => {
    expect(home).toBe(0);
    expect(ledger.paidAtOfCycle(0)).toBe(PAYE_LE);
    expect(FENETRE).toBeGreaterThan(PAYE_LE);
  });

  it("40 € de complément, portés par le cycle 1 — le premier non payé", () => {
    expect(videoBonusCarrier(ledger, home)).toBe(1);
    expect(videoBonusIsSettled(ledger, home, FENETRE)).toBe(false);
    // Au paiement, 5 750 vues : rien ; aujourd'hui 56 124 : le palier 50 k.
    expect(videoBonusComplement(GRILLE, 5_750, ledger.paidOf(REEL))).toBe(0);
    expect(videoBonusComplement(GRILLE, 56_124, ledger.paidOf(REEL))).toBe(40);
  });

  it("SANS ÉCART : une vidéo déjà payée 10 qui reste sous 50 k n'a aucun complément", () => {
    const l = videoBonusLedger(ANCRE, [
      {
        ...CYCLE0_PAYE,
        lineItems: [
          ...CYCLE0_PAYE.lineItems,
          { assignmentId: AUTRE, kind: "video_bonus", amount: 10 },
        ],
      },
    ]);
    expect(l.paidOf(AUTRE)).toBe(10);
    expect(videoBonusComplement(GRILLE, 34_567, l.paidOf(AUTRE))).toBe(0);
    // … et la même vidéo à 61 234 : 40 dus, 10 versés ⇒ 30, jamais 40.
    expect(videoBonusComplement(GRILLE, 61_234, l.paidOf(AUTRE))).toBe(30);
  });

  it("CYCLE SUIVANT PAYÉ LUI AUSSI avant la fin de la fenêtre : le reste va au cycle 2", () => {
    // Le cycle 1 payé le 20/10, complément de 10 gelé (12 113 vues à ce moment-là).
    const cycle1: CarryRow = {
      period: "2026-10-07",
      status: "paid",
      paidAt: Date.parse("2026-10-20T09:12:31.004Z"),
      lineItems: [{ assignmentId: REEL, kind: "video_bonus", amount: 10 }],
    };
    const l = videoBonusLedger(ANCRE, [CYCLE0_PAYE, cycle1]);
    expect(videoBonusCarrier(l, home)).toBe(2);
    expect(videoBonusIsSettled(l, home, FENETRE)).toBe(false);
    expect(videoBonusComplement(GRILLE, 56_124, l.paidOf(REEL))).toBe(30);
  });

  it("RÉGLÉE pour de bon : le cycle porteur payé APRÈS la fin de la fenêtre clôt le report", () => {
    const cycle1: CarryRow = {
      period: "2026-10-07",
      status: "paid",
      paidAt: Date.parse("2026-11-07T15:02:00.000Z"),
      lineItems: [{ assignmentId: REEL, kind: "video_bonus", amount: 40 }],
    };
    const l = videoBonusLedger(ANCRE, [CYCLE0_PAYE, cycle1]);
    expect(videoBonusIsSettled(l, home, FENETRE)).toBe(true);
    // Contrôle opposé : payé 1 minute AVANT la fin de la fenêtre, toujours ouvert.
    const tot = videoBonusLedger(ANCRE, [
      CYCLE0_PAYE,
      { ...cycle1, paidAt: FENETRE - 60_000 },
    ]);
    expect(videoBonusIsSettled(tot, home, FENETRE)).toBe(false);
  });

  it("une vidéo dont le cycle a été payé APRÈS sa fenêtre ne rouvre jamais, même si la grille monte", () => {
    // Publiée le 08/09 (fenêtre jusqu'au 09/10), cycle 0 soldé le 12/10 : son
    // bonus était définitif au paiement. Attacher ou relever une grille ensuite
    // ne doit RIEN rouvrir — c'est la règle « cycles payés figés ».
    const vieille = Date.parse("2026-09-08T08:00:00.000Z");
    const tard = videoBonusLedger(ANCRE, [
      { ...CYCLE0_PAYE, paidAt: Date.parse("2026-10-12T09:30:00.000Z") },
    ]);
    expect(cycleIndexOf(ANCRE, vieille)).toBe(0);
    expect(videoBonusIsSettled(tard, 0, payWindowEndsAt(vieille))).toBe(true);
    // Contrôle opposé, même vidéo, cycle payé le 08/10 comme en vrai : encore
    // ouverte (sa fenêtre court jusqu'au 09/10).
    expect(videoBonusIsSettled(ledger, 0, payWindowEndsAt(vieille))).toBe(false);
  });

  it("paiement en masse dans le désordre (cycle 1 avant le cycle 0) : le reste va au cycle 2", () => {
    const l = videoBonusLedger(ANCRE, [
      CYCLE0_PAYE,
      { period: "2026-10-07", status: "paid", paidAt: PAYE_LE - 5_000, lineItems: [] },
    ]);
    expect(videoBonusIsSettled(l, home, FENETRE)).toBe(false);
    expect(videoBonusCarrier(l, home)).toBe(2);
  });

  it("cycle de la vidéo non payé : elle vit chez elle, aucun report", () => {
    const l = videoBonusLedger(ANCRE, [{ ...CYCLE0_PAYE, status: "accruing" }]);
    expect(videoBonusCarrier(l, home)).toBeNull();
    expect(videoBonusIsSettled(l, home, FENETRE)).toBe(false);
    expect(l.anyPaid).toBe(false);
  });

  it("row payée SANS date (forme d'avant `paidAt`) : rien n'est rouvert sur sa foi", () => {
    const l = videoBonusLedger(ANCRE, [{ ...CYCLE0_PAYE, paidAt: undefined }]);
    expect(videoBonusIsSettled(l, home, FENETRE)).toBe(true);
  });

  it("une row mensuelle legacy n'apparie aucun cycle, mais ce qu'elle a versé reste versé", () => {
    const l = videoBonusLedger(ANCRE, [
      CYCLE0_PAYE,
      {
        period: "2026-10",
        status: "paid",
        paidAt: PAYE_LE,
        lineItems: [{ assignmentId: REEL, kind: "video_bonus", amount: 10 }],
      },
    ]);
    expect(videoBonusCarrier(l, home)).toBe(1);
    expect(l.paidOf(REEL)).toBe(10);
  });
});

describe("coût d'analyse d'une vidéo (Rentabilité, Pays, Vue d'ensemble)", () => {
  it("compté UNE fois, au plus haut de payé et live tant que le report est ouvert", () => {
    expect(videoBonusCostOf(40, null)).toBe(40);
    expect(videoBonusCostOf(40, { paid: 0, open: true })).toBe(40);
    // Réglée : la grille peut bien avoir monté, le coût est ce qui a été versé.
    expect(videoBonusCostOf(80, { paid: 40, open: false })).toBe(40);
    // Grille baissée après paiement : on ne « reprend » rien.
    expect(videoBonusCostOf(10, { paid: 40, open: true })).toBe(40);
  });
});

describe("videoBonusComplement — parité lib/ ↔ convex/ (règle A6)", () => {
  it("identique sur toute la plage, jamais négatif", () => {
    for (const cumulative of [true, false]) {
      for (const views of [0, 9_999, 10_000, 49_999, 56_124, 123_457, 1_234_567]) {
        for (const paid of [0, 10, 40, 79.99, 500]) {
          const grid = { ...GRILLE, cumulative };
          const lib = videoBonusComplement(grid, views, paid);
          expect(convexPricing.videoBonusComplement(grid, views, paid)).toBe(lib);
          expect(lib).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(videoBonusComplement(null, 56_124, 0)).toBe(0);
  });
});

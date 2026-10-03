import { describe, expect, it } from "vitest";
import { isBulkPayable, regrouperPaiements, type LignePaiement } from "../convex/paymentsView";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 25, 14, 0, 0);

function cycle(o: Partial<LignePaiement> & Pick<LignePaiement, "key" | "creatorId" | "creatorName">): LignePaiement {
  return {
    creatorPaymentMethod: "sepa",
    creatorPaymentDetails: null,
    status: "accruing",
    cycleStart: NOW - 10 * DAY,
    paidAt: null,
    remainingDue: 0,
    totalDue: 0,
    currency: "usd",
    ...o,
  };
}

const rows: LignePaiement[] = [
  cycle({ key: "a-1", creatorId: "a", creatorName: "Inès Moreau", cycleStart: NOW - 12 * DAY, remainingDue: 110, totalDue: 150 }),
  cycle({ key: "a-0", creatorId: "a", creatorName: "Inès Moreau", status: "paid", cycleStart: NOW - 42 * DAY, paidAt: NOW - 11 * DAY, totalDue: 87.35 }),
  cycle({ key: "b-2", creatorId: "b", creatorName: "Léa Martin", cycleStart: NOW - 45 * DAY, remainingDue: 23.4, totalDue: 23.4 }),
  cycle({ key: "b-3", creatorId: "b", creatorName: "Léa Martin", cycleStart: NOW - 15 * DAY, remainingDue: 41.27, totalDue: 41.27 }),
  cycle({ key: "c-0", creatorId: "c", creatorName: "Camille Dubois", remainingDue: 0, totalDue: 0 }),
  cycle({ key: "d-0", creatorId: "d", creatorName: "Nadia Ferreira", status: "paid", paidAt: NOW - 2 * DAY, totalDue: 64.5 }),
  // Créatrice supprimée : reste dû, mais hors « tout payer ».
  cycle({ key: "orphan:x", creatorId: "x", creatorName: "—", remainingDue: 12, totalDue: 12 }),
];

describe("regrouperPaiements — l'écran Paiements", () => {
  it("regroupe les cycles OUVERTS par créatrice, du plus gros reste au plus petit", () => {
    const v = regrouperPaiements(rows, NOW);
    expect(v.avecDu.map((g) => [g.creatorName, g.remaining, g.cycles.length])).toEqual([
      ["Inès Moreau", 110, 1],
      ["Léa Martin", 64.67, 2],
      ["—", 12, 1],
    ]);
    expect(v.aZero.map((g) => g.creatorName)).toEqual(["Camille Dubois"]);
  });

  it("à verser : sans la créatrice supprimée ; historique : tout ce que valent les cycles", () => {
    const v = regrouperPaiements(rows, NOW);
    // Tout le monde en dollars : UNE entrée par total, celui d'avant.
    expect(v.aVerser).toHaveLength(1);
    expect(v.aVerser[0].currency).toBe("usd");
    expect(v.aVerser[0].amount).toBeCloseTo(174.67, 10); // 110 + 23,40 + 41,27
    expect(v.totalHistorique).toHaveLength(1);
    expect(v.totalHistorique[0].amount).toBeCloseTo(378.52, 10);
    expect(v.cyclesDus).toBe(4);
    // Le plus vieux cycle dû a commencé il y a 45 jours.
    expect(v.ageDuPlusVieux).toBe(45);
  });

  it("les réglés, du plus récent au plus ancien ; rien de dû → pas d'âge", () => {
    const v = regrouperPaiements(rows, NOW);
    expect(v.reglees.map((p) => p.key)).toEqual(["d-0", "a-0"]);
    expect(regrouperPaiements(rows.filter((r) => r.status === "paid"), NOW).ageDuPlusVieux).toBeNull();
  });

  it("payable en masse : ni payé, ni orphelin", () => {
    expect(rows.filter(isBulkPayable).map((r) => r.key)).toEqual(["a-1", "b-2", "b-3", "c-0"]);
  });
});

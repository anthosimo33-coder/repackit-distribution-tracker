import { describe, expect, it } from "vitest";
import { STATUS_FILTER_OPTIONS } from "./assignment-status-filter";
import { ASSIGNMENT_STATUS } from "./assignment-status";
import fr from "../messages/admin/fr/assignments.json";
import en from "../messages/admin/en/assignments.json";

/**
 * Le filtre de statut compare le statut tel quel : une option qui n'est pas un
 * statut VIVANT ne trouve rien. Jusqu'en octobre 2026 il ne proposait que des
 * statuts migrés (soumis / validé / rejeté) — et pas « abandonné », que la liste
 * garde désormais visible.
 */
describe("filtre de statut des Missions", () => {
  const LEGACY = ["submitted", "validated", "rejected"];
  const vivants = Object.keys(ASSIGNMENT_STATUS).filter((s) => !LEGACY.includes(s));

  it("propose chaque statut vivant, « abandonné » compris, et aucun statut migré", () => {
    expect([...STATUS_FILTER_OPTIONS].filter((o) => o !== "all").sort()).toEqual([...vivants].sort());
    expect(STATUS_FILTER_OPTIONS).toContain("cancelled");
    for (const l of LEGACY) expect(STATUS_FILTER_OPTIONS as readonly string[]).not.toContain(l);
  });

  it("chaque option a son libellé en français et en anglais", () => {
    for (const o of STATUS_FILTER_OPTIONS) {
      expect((fr.statusFilter as Record<string, string>)[o], `fr ${o}`).toBeTruthy();
      expect((en.statusFilter as Record<string, string>)[o], `en ${o}`).toBeTruthy();
    }
  });
});

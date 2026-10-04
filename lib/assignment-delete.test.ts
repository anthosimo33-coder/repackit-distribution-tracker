import { describe, it, expect } from "vitest";
import {
  canCancelAssignment,
  canDeleteAssignment,
  DELETABLE_ASSIGNMENT_STATUSES,
} from "./assignment-delete";
import type { AssignmentStatus } from "./assignment-status";

describe("canDeleteAssignment", () => {
  const deletable: AssignmentStatus[] = [
    "todo",
    "in_progress",
    "video_submitted",
    "video_rejected",
    "to_publish",
    "submitted", // legacy → video_submitted
    "rejected", // legacy → video_rejected
    // ABANDONNÉE : l'abandon est borné aux statuts ci-dessus — jamais publiée,
    // jamais payée. La supprimer efface la trace que l'abandon gardait.
    "cancelled",
  ];
  const blocked: AssignmentStatus[] = [
    "published",
    "paid",
    "validated", // legacy → published
  ];

  it.each(deletable)("AUTORISE le hard-delete en statut %s", (status) => {
    expect(canDeleteAssignment(status)).toBe(true);
  });

  it.each(blocked)(
    "BLOQUE le hard-delete en statut %s (publication/paiement rattaché)",
    (status) => {
      expect(canDeleteAssignment(status)).toBe(false);
    },
  );

  it("la liste des statuts supprimables exclut published/paid/validated", () => {
    expect(DELETABLE_ASSIGNMENT_STATUSES).not.toContain("published");
    expect(DELETABLE_ASSIGNMENT_STATUSES).not.toContain("paid");
    expect(DELETABLE_ASSIGNMENT_STATUSES).not.toContain("validated");
  });
});

describe("canCancelAssignment — l'abandon reste borné aux statuts pré-publication", () => {
  it("abandonne une mission pas encore publiée", () => {
    expect(canCancelAssignment("todo")).toBe(true);
    expect(canCancelAssignment("to_publish")).toBe(true);
  });

  it("n'abandonne ni une abandonnée (supprimable, elle) ni une publiée", () => {
    expect(canDeleteAssignment("cancelled")).toBe(true);
    expect(canCancelAssignment("cancelled")).toBe(false);
    expect(canCancelAssignment("published")).toBe(false);
  });
});

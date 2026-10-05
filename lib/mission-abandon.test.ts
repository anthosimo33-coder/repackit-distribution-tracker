import { describe, expect, it } from "vitest";
import { statutARetablir, type StatusEvent } from "./mission-abandon";
import { cancelledEmailCopy } from "../convex/emailMessages";

/**
 * « Rétablir » remet le statut EXACT d'avant le dernier abandon — lu dans la
 * trace (`assignmentStatusEvents`), jamais deviné quand elle existe. Cas réel du
 * 05/10/2026 : une mission « à publier » (vidéo validée) abandonnée par erreur
 * doit revenir « à publier », pas « à faire ».
 */
describe("statutARetablir", () => {
  const abandon = (from: string, at: number): StatusEvent => ({ action: "cancelled", from, to: "cancelled", at });
  const retabli = (to: string, at: number): StatusEvent => ({ action: "restored", from: "cancelled", to, at });

  it("remet le statut d'avant l'abandon, tel quel", () => {
    expect(statutARetablir([abandon("to_publish", 10)], true)).toEqual({ status: "to_publish", exact: true });
    expect(statutARetablir([abandon("in_progress", 10)], false)).toEqual({ status: "in_progress", exact: true });
  });

  it("lit le DERNIER abandon, quel que soit l'ordre de la trace", () => {
    const trace = [abandon("todo", 30), retabli("todo", 20), abandon("video_submitted", 10)];
    expect(statutARetablir(trace, true)).toEqual({ status: "todo", exact: true });
    expect(statutARetablir([abandon("todo", 10), retabli("todo", 20), abandon("to_publish", 30)], true)).toEqual({
      status: "to_publish",
      exact: true,
    });
  });

  it("sans trace (abandon ancien), DÉDUIT et le dit : vidéo → en revue, sinon à faire", () => {
    expect(statutARetablir([], true)).toEqual({ status: "video_submitted", exact: false });
    expect(statutARetablir([], false)).toEqual({ status: "todo", exact: false });
  });
});

/**
 * L'email « mission annulée » (case « Prévenir la créatrice par email ») : il
 * nomme la mission et le jour, et ne parle de la vidéo conservée que si elle
 * existe (phrase à part, ajoutée par l'action).
 */
describe("email « mission annulée »", () => {
  it("nomme la mission et le jour, dans chaque langue", () => {
    for (const loc of ["fr", "en", "es", "pt"]) {
      const c = cancelledEmailCopy(loc);
      const corps = c.body("<strong>LAB 2</strong>", "<strong>08/10/2026</strong>");
      expect(corps, loc).toContain("LAB 2");
      expect(corps, loc).toContain("08/10/2026");
      expect(c.videoKept.length, loc).toBeGreaterThan(0);
    }
  });

  it("une langue inconnue retombe sur le français", () => {
    expect(cancelledEmailCopy("de").subject).toBe(cancelledEmailCopy("fr").subject);
  });
});

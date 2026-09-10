import { describe, it, expect } from "vitest";
import {
  collectAvailability,
  collectAvailabilityLabel,
  showsMetric,
} from "../convex/collectAvailability";

describe("collectAvailability", () => {
  it("un relevé existe → mesuré", () => {
    expect(collectAvailability({ latestSnapshotAt: 1_787_000_000_000 })).toBe(
      "measured",
    );
  });

  it("jamais relevée, jamais en échec → en attente (publiée ce soir)", () => {
    expect(collectAvailability({})).toBe("pending");
    expect(collectAvailability({ collectFailureStreak: 0 })).toBe("pending");
  });

  it("jamais relevée ET en échec → échec", () => {
    expect(collectAvailability({ collectFailureStreak: 1 })).toBe("failed");
    expect(collectAvailability({ collectFailureStreak: 26 })).toBe("failed");
  });

  it("un relevé réussi PRIME sur un historique d'échecs", () => {
    // Cas du rattrapage par le repli : la publication a échoué des nuits, puis
    // a été relevée. C'est une mesure, pas un échec.
    expect(
      collectAvailability({
        latestSnapshotAt: 1_787_000_000_000,
        collectFailureStreak: 3,
      }),
    ).toBe("measured");
  });

  it("zéro vue MESURÉ reste mesuré — c'est le cœur de la distinction", () => {
    // Une vidéo qui a vraiment fait 0 vue porte un snapshot : elle doit
    // continuer d'afficher 0, pas un tiret.
    const vraiZero = { latestSnapshotAt: 1_787_000_000_000 };
    expect(collectAvailability(vraiZero)).toBe("measured");
    expect(showsMetric(collectAvailability(vraiZero))).toBe(true);
    // …alors qu'une non mesurée n'affiche RIEN.
    expect(showsMetric(collectAvailability({ collectFailureStreak: 1 }))).toBe(
      false,
    );
    expect(showsMetric(collectAvailability({}))).toBe(false);
  });
});

describe("collectAvailabilityLabel", () => {
  it("mesuré n'a pas de libellé — c'est le chiffre qui parle", () => {
    expect(collectAvailabilityLabel("measured")).toBeNull();
    expect(collectAvailabilityLabel("measured", "peu importe")).toBeNull();
  });

  it("en attente le dit sans dramatiser", () => {
    expect(collectAvailabilityLabel("pending")).toBe(
      "En attente du premier relevé",
    );
  });

  it("un échec REPREND le motif enregistré, tel quel", () => {
    expect(
      collectAvailabilityLabel("failed", "visible par son autrice uniquement"),
    ).toBe("Non mesuré — visible par son autrice uniquement");
    expect(collectAvailabilityLabel("failed", "HTTP 429")).toBe(
      "Non mesuré — HTTP 429",
    );
  });

  it("un échec sans motif reste lisible", () => {
    expect(collectAvailabilityLabel("failed")).toBe("Non mesuré");
    expect(collectAvailabilityLabel("failed", "   ")).toBe("Non mesuré");
  });
});

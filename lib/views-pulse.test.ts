import { describe, expect, it } from "vitest";
import { computeViewsPulse } from "../convex/viewsPulseCore";

/**
 * Relevés à la forme de la prod : un relevé par soir à 23:30 Paris (21:30 UTC
 * en été), des compteurs cumulés qui ne tombent pas ronds, deux publications
 * pour la même vidéo (TikTok + Instagram), et une horloge au matin suivant.
 */
const releve = (d: number) => Date.UTC(2026, 8, d, 21, 30); // 09/d 23:30 Paris
const NOW = Date.UTC(2026, 8, 18, 7, 12); // 18/09 09:12 Paris → hier = 17/09

const snaps = [
  // Vidéo A publiée sur TikTok et Instagram.
  { publicationId: "pubA_tt", capturedAt: releve(16), vues: 12_418 },
  { publicationId: "pubA_tt", capturedAt: releve(17), vues: 15_991 },
  { publicationId: "pubA_ig", capturedAt: releve(16), vues: 1_204 },
  { publicationId: "pubA_ig", capturedAt: releve(17), vues: 1_847 },
  // Vidéo B, sur TikTok seulement.
  { publicationId: "pubB_tt", capturedAt: releve(16), vues: 3_050 },
  { publicationId: "pubB_tt", capturedAt: releve(17), vues: 3_512 },
];
const assignmentOf = (pid: string) => (pid.startsWith("pubA") ? "assignA" : "assignB");

describe("computeViewsPulse", () => {
  it("les vues d'hier, et leur répartition par vidéo qui somme au total", () => {
    const pulse = computeViewsPulse(snaps, assignmentOf, NOW)!;
    expect(pulse.date).toBe("2026-09-17");
    // Relevés à 23:30 : l'intervalle 16/09 23:30 → 17/09 23:30 couvre 30 min du
    // 16 et 23 h 30 du 17. Hier ne reçoit donc pas 100 % du delta.
    const deltaBrut = (15_991 - 12_418) + (1_847 - 1_204) + (3_512 - 3_050);
    expect(pulse.views).toBeGreaterThan(0);
    expect(pulse.views).toBeLessThan(deltaBrut);
    expect(pulse.perAssignment.map((p) => p.assignmentId)).toEqual(["assignA", "assignB"]);
    expect(pulse.perAssignment.reduce((s, p) => s + p.views, 0)).toBe(pulse.views);
    expect(pulse.estimated).toBe(false);
  });

  it("aucune vue gagnée hier : null, rien à afficher", () => {
    const plat = snaps.map((s) => ({ ...s, vues: 1_000 }));
    expect(computeViewsPulse(plat, assignmentOf, NOW)).toBeNull();
    expect(computeViewsPulse([], assignmentOf, NOW)).toBeNull();
  });

  // « Hier » valait `now − 24 h` : faux une heure par changement d'heure.
  it("le soir du passage à l'heure d'hiver (journée de 25 h), hier est la veille, pas aujourd'hui", () => {
    // Relevés des 23 et 24/10 à 23:30 Paris (CEST, 21:30 UTC).
    const octobre = [
      { publicationId: "pubB_tt", capturedAt: Date.UTC(2026, 9, 23, 21, 30), vues: 3_050 },
      { publicationId: "pubB_tt", capturedAt: Date.UTC(2026, 9, 24, 21, 30), vues: 3_512 },
    ];
    // 25/10 22:30 UTC = 23:30 Paris (CET) ; 24 h avant = 25/10 00:30 Paris.
    const pulse = computeViewsPulse(octobre, assignmentOf, Date.UTC(2026, 9, 25, 22, 30));
    expect(pulse?.date).toBe("2026-10-24");
  });

  it("le lendemain du passage à l'heure d'été, hier n'est pas l'avant-veille", () => {
    // Relevés des 27 et 28/03 (CET, 22:30 UTC) et du 29/03 (CEST, 21:30 UTC), à 23:30 Paris.
    const mars = [
      { publicationId: "pubB_tt", capturedAt: Date.UTC(2026, 2, 27, 22, 30), vues: 1_000 },
      { publicationId: "pubB_tt", capturedAt: Date.UTC(2026, 2, 28, 22, 30), vues: 1_400 },
      { publicationId: "pubB_tt", capturedAt: Date.UTC(2026, 2, 29, 21, 30), vues: 2_300 },
    ];
    // 29/03 22:30 UTC = 30/03 00:30 Paris ; 24 h avant = 28/03 23:30 Paris.
    const pulse = computeViewsPulse(mars, assignmentOf, Date.UTC(2026, 2, 29, 22, 30));
    expect(pulse?.date).toBe("2026-03-29");
  });

  it("un trou de relevé est signalé comme estimé", () => {
    const trou = [
      { publicationId: "pubB_tt", capturedAt: releve(14), vues: 2_000 },
      { publicationId: "pubB_tt", capturedAt: releve(17), vues: 5_600 },
    ];
    const pulse = computeViewsPulse(trou, assignmentOf, NOW)!;
    expect(pulse.estimated).toBe(true);
  });
});

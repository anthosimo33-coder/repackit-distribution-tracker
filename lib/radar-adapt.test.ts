import { describe, expect, it } from "vitest";
import { adaptResult } from "../convex/radarAdaptMath";
import { PILOTE, type VideoPassee } from "../convex/pilotePlan";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 12, 12);

let seq = 0;
/** Une vidéo de Juliette publiée sur TikTok il y a `ageH` heures, `vues` au dernier relevé. */
function video(vues: number | null, ageH = 96, plateforme = "TikTok", creatorId = "juliette"): VideoPassee {
  seq += 1;
  return {
    assignmentId: `a${seq}`,
    creatorId,
    campaignId: "miseAJour",
    comboKey: `k${seq}`,
    jour: "2026-11-08",
    publications: [{ plateforme, vues, publieeA: NOW - ageH * HOUR, lien: null }],
  };
}
// Sa médiane (étage « autre », TikTok) : 1 000 vues.
const medianes = (id: string): Record<string, number | null> => (id === "juliette" ? { "autre|TikTok": 1_000 } : {});

describe("Tes adaptations : le verdict du Pilote (radarAdaptMath)", () => {
  it("gagnante à 1,5× sa médiane ET 2 000 vues ; « marche » dès une sur deux, sur 3 mesurées", () => {
    const r = adaptResult([video(5_000), video(4_000), video(500)], null, medianes, NOW);
    expect([r.published, r.measured, r.wins, r.medianRatio, r.verdict]).toEqual([3, 3, 2, 4, "marche"]);
  });

  it("une sur trois : ne prend pas ; deux mesurées : trop tôt", () => {
    expect(adaptResult([video(5_000), video(900), video(1_400)], null, medianes, NOW).verdict).toBe("neMarchePas");
    expect(adaptResult([video(5_000), video(4_000)], null, medianes, NOW).verdict).toBe("tropTot");
  });

  it("1,5× sous 2 000 vues n'est pas gagnante (plancher du Pilote)", () => {
    expect(adaptResult([video(1_900)], null, medianes, NOW).wins).toBe(0);
  });

  it("sans médiane chez elle : 10 000 vues font une gagnante", () => {
    const r = adaptResult([video(12_000, 96, "TikTok", "lorena"), video(8_000, 96, "TikTok", "lorena")], null, medianes, NOW);
    expect([r.measured, r.wins, r.medianRatio, r.medianViews]).toEqual([2, 1, null, 10_000]);
  });

  it("une publication de moins de 72 h, ou jamais relevée, attend : la prochaine mesure à publication + 72 h", () => {
    const jeune = video(50_000, 30);
    const r = adaptResult([jeune, video(null)], null, medianes, NOW);
    expect([r.published, r.measured]).toEqual([2, 0]);
    expect(r.nextResultAt).toBe(jeune.publications[0].publieeA + PILOTE.maturiteMs);
  });

  it("Snapchat et Facebook ne sont pas jugés", () => {
    const r = adaptResult([video(50_000, 96, "Snapchat")], null, medianes, NOW);
    expect([r.published, r.measured, r.nextResultAt]).toEqual([1, 0, null]);
  });
});

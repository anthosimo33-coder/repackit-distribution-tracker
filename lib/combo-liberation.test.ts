import { describe, expect, it } from "vitest";
import { canCancelAssignment } from "./assignment-delete";
import {
  usedComboKeysForCreatorPlatforms,
  type AssignmentComboUsage,
} from "./script-combo-uniqueness";
import { comboKeysInCooldown, type ScheduledComboUsage } from "./scriptCombos";

/**
 * LIBÉRATION d'un script jamais publié.
 *
 * Les deux protections — unicité à vie (créatrice) et cooldown 4 jours (projet)
 * — servent la même chose : ne pas re-servir un contenu DÉJÀ VU. Une assignation
 * abandonnée ou refusée n'a jamais été publiée : rien à protéger.
 *
 * La règle de partage à ne pas casser : c'est l'ABANDON qui libère, jamais le
 * simple retard. Un post en retard mais vivant réserve toujours son combo.
 */
const COMBO = "hook1:flux1:cta1";
const J0 = Date.UTC(2026, 7, 10, 22, 0, 0); // 11/08 minuit Paris
const JOUR = 86_400_000;

/** Reproduit le filtrage serveur : les statuts libérants ne consomment rien. */
const LIBERANTS = new Set(["video_rejected", "cancelled"]);
function usagesVivants<T extends { status: string }>(rows: T[]): T[] {
  return rows.filter((r) => !LIBERANTS.has(r.status));
}

describe("un combo abandonné redevient tirable", () => {
  it("unicité à vie : l'abandon libère pour LA MÊME créatrice", () => {
    const rows = [
      { status: "cancelled", creatorId: "kelly", comboKey: COMBO, platforms: ["TikTok"] },
    ];
    const used = usedComboKeysForCreatorPlatforms({
      creatorId: "kelly",
      platforms: ["TikTok"],
      existingAssignments: usagesVivants(rows) as AssignmentComboUsage[],
    });
    expect(used.has(COMBO)).toBe(false);
  });

  it("cooldown projet : l'abandon libère pour UNE AUTRE créatrice, à la même date", () => {
    const rows = [{ status: "cancelled", comboKey: COMBO, anchorAt: J0 }];
    const bloques = comboKeysInCooldown(
      usagesVivants(rows) as ScheduledComboUsage[],
      J0,
    );
    expect(bloques.size).toBe(0);
  });

  it("une vidéo REFUSÉE libère aussi — elle n'est jamais sortie", () => {
    const rows = [
      { status: "video_rejected", creatorId: "kelly", comboKey: COMBO, platforms: ["TikTok"] },
    ];
    expect(
      usedComboKeysForCreatorPlatforms({
        creatorId: "kelly",
        platforms: ["TikTok"],
        existingAssignments: usagesVivants(rows) as AssignmentComboUsage[],
      }).has(COMBO),
    ).toBe(false);
  });
});

describe("le simple RETARD ne libère rien", () => {
  it.each(["todo", "in_progress", "video_submitted", "to_publish"])(
    "statut vivant %s : le combo reste réservé, unicité ET cooldown",
    (status) => {
      const rows = [
        { status, creatorId: "kelly", comboKey: COMBO, platforms: ["TikTok"] },
      ];
      // Unicité à vie : toujours pris.
      expect(
        usedComboKeysForCreatorPlatforms({
          creatorId: "kelly",
          platforms: ["TikTok"],
          existingAssignments: usagesVivants(rows) as AssignmentComboUsage[],
        }).has(COMBO),
      ).toBe(true);
      // Cooldown : toujours bloqué à la date, même très en retard.
      const cool = [{ status, comboKey: COMBO, anchorAt: J0 }];
      expect(
        comboKeysInCooldown(usagesVivants(cool) as ScheduledComboUsage[], J0 + 2 * JOUR)
          .has(COMBO),
      ).toBe(true);
    },
  );
});

describe("interaction avec l'ancre de cooldown (#55)", () => {
  it("un cancelled à postDate PASSÉE ne compte dans AUCUNE fenêtre", () => {
    // L'ancre est postDate ?? publishedAt : une assignation abandonnée garde sa
    // postDate en base. Sans le filtre de statut, elle continuerait de bloquer
    // pendant 4 jours autour d'une date où rien n'est jamais sorti.
    const rows = [{ status: "cancelled", comboKey: COMBO, anchorAt: J0 }];
    const vivants = usagesVivants(rows) as ScheduledComboUsage[];
    for (const cible of [J0 - 3 * JOUR, J0, J0 + 1 * JOUR, J0 + 3 * JOUR]) {
      expect(comboKeysInCooldown(vivants, cible).size).toBe(0);
    }
    // CONTRÔLE DE PRÉSENCE apparié : la même ligne NON abandonnée bloque bien.
    const encoreVivant = [{ status: "to_publish", comboKey: COMBO, anchorAt: J0 }];
    expect(
      comboKeysInCooldown(usagesVivants(encoreVivant) as ScheduledComboUsage[], J0)
        .has(COMBO),
    ).toBe(true);
  });
});

describe("qui peut être abandonné", () => {
  it("tout ce qui n'est ni publié ni payé", () => {
    for (const s of ["todo", "in_progress", "video_submitted", "video_rejected", "to_publish"] as const) {
      expect(canCancelAssignment(s)).toBe(true);
    }
  });

  it("publié et payé sont protégés — ils portent publication et paie", () => {
    for (const s of ["published", "paid", "validated"] as const) {
      expect(canCancelAssignment(s)).toBe(false);
    }
  });
});

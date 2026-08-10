import { describe, it, expect } from "vitest";
import {
  isCycleDue,
  isCycleUnpaid,
  isOverdueMission,
  isWarmupLate,
  missionDaysLate,
  PRODUCTION_STATUSES,
  warmupMissedDays,
  type CycleLike,
  type MissionLike,
  type WarmupCompteLike,
} from "./ops-digest";
// Réplique serveur (A6) importée en RELATIF : le test verrouille la parité des
// DEUX implémentations. Le module convex est PUR (aucun import `_generated`).
import * as convexDigest from "../convex/opsDigest";

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);
const DAY = 86_400_000;

// ─── Missions en retard ──────────────────────────────────────────────────────

describe("isOverdueMission", () => {
  it("todo / in_progress dont l'échéance est passée", () => {
    expect(isOverdueMission({ status: "todo", dueDate: NOW - DAY }, NOW)).toBe(
      true,
    );
    expect(
      isOverdueMission({ status: "in_progress", dueDate: NOW - 1 }, NOW),
    ).toBe(true);
  });

  it("échéance à venir → pas en retard", () => {
    expect(isOverdueMission({ status: "todo", dueDate: NOW + DAY }, NOW)).toBe(
      false,
    );
  });

  it("une vidéo déjà soumise n'est plus une deadline de PRODUCTION", () => {
    for (const status of ["video_submitted", "to_publish", "published", "paid"]) {
      expect(isOverdueMission({ status, dueDate: NOW - DAY }, NOW)).toBe(false);
    }
  });

  it("un refus qui stagne n'est PAS compté ici (file distincte, sinon doublon)", () => {
    expect(
      isOverdueMission({ status: "video_rejected", dueDate: NOW - DAY }, NOW),
    ).toBe(false);
  });
});

describe("missionDaysLate", () => {
  it("compte les jours pleins", () => {
    expect(
      missionDaysLate({ status: "todo", dueDate: NOW - 3 * DAY - 1000 }, NOW),
    ).toBe(3);
  });
  it("jamais négatif", () => {
    expect(missionDaysLate({ status: "todo", dueDate: NOW + DAY }, NOW)).toBe(0);
  });
});

// ─── Cycles de paie ──────────────────────────────────────────────────────────

const cycle = (over: Partial<CycleLike> = {}): CycleLike => ({
  status: "accruing",
  cycleEnd: NOW - DAY,
  totalDue: 120,
  ...over,
});

describe("cycles — deux notions NOMMÉES, pas un écart tacite", () => {
  it("payé → ni l'un ni l'autre", () => {
    const c = cycle({ status: "paid" });
    expect(isCycleUnpaid(c)).toBe(false);
    expect(isCycleDue(c, NOW)).toBe(false);
  });

  it("ne doit rien → ni l'un ni l'autre", () => {
    const c = cycle({ totalDue: 0 });
    expect(isCycleUnpaid(c)).toBe(false);
    expect(isCycleDue(c, NOW)).toBe(false);
  });

  it("le cycle EN COURS est « non payé » (dashboard) mais pas « à payer » (digest)", () => {
    // C'est toute la différence : le montant s'accumule déjà, mais rien n'est
    // actionnable tant que le cycle n'est pas refermé.
    const enCours = cycle({ cycleEnd: NOW + 5 * DAY });
    expect(isCycleUnpaid(enCours)).toBe(true);
    expect(isCycleDue(enCours, NOW)).toBe(false);
  });

  it("cycle refermé et impayé → les deux", () => {
    const clos = cycle({ cycleEnd: NOW - DAY });
    expect(isCycleUnpaid(clos)).toBe(true);
    expect(isCycleDue(clos, NOW)).toBe(true);
  });
});

// ─── Warmup en retard ────────────────────────────────────────────────────────

const compte = (over: Partial<WarmupCompteLike> = {}): WarmupCompteLike => ({
  effectiveStatus: "warmup",
  warmupStartedAt: NOW - 5 * DAY,
  dailyChecks: ["2026-08-06", "2026-08-07"],
  targetDays: 7,
  ...over,
});

describe("isWarmupLate", () => {
  it("5 jours écoulés, 2 checks → 3 manqués", () => {
    expect(warmupMissedDays(compte(), NOW)).toBe(3);
    expect(isWarmupLate(compte(), NOW)).toBe(true);
  });

  it("à jour → pas en retard", () => {
    const aJour = compte({
      dailyChecks: ["a", "b", "c", "d", "e"], // 5 checks pour 5 jours écoulés
    });
    expect(warmupMissedDays(aJour, NOW)).toBe(0);
    expect(isWarmupLate(aJour, NOW)).toBe(false);
  });

  it("un compte qui n'est pas en warmup n'est jamais en retard", () => {
    for (const s of ["actif", "shadowban", "archived"]) {
      expect(isWarmupLate(compte({ effectiveStatus: s }), NOW)).toBe(false);
    }
  });

  it("warmup jamais démarré → pas en retard (rien n'a commencé)", () => {
    expect(isWarmupLate(compte({ warmupStartedAt: undefined }), NOW)).toBe(false);
  });

  it("le décompte est plafonné à la durée cible (un warmup fini ne dérive pas)", () => {
    const fini = compte({
      warmupStartedAt: NOW - 60 * DAY,
      dailyChecks: [],
      targetDays: 7,
    });
    expect(warmupMissedDays(fini, NOW)).toBe(7);
  });
});

// ─── Parité lib/ ↔ convex/ (règle A6) ────────────────────────────────────────
//
// LE test du chantier : ces trois calculs vivent en double (dashboard client /
// digest serveur). S'ils divergent, chacun a l'air juste sur son écran et le
// digest ment. On les compare ici sur des jeux de données couvrant les bords.

describe("parité lib/ ↔ convex/ (règle A6)", () => {
  const MISSIONS: MissionLike[] = [
    "todo",
    "in_progress",
    "video_submitted",
    "video_rejected",
    "to_publish",
    "published",
    "paid",
    "statut_inconnu",
  ].flatMap((status) =>
    [NOW - 10 * DAY, NOW - DAY, NOW - 1, NOW, NOW + 1, NOW + DAY].map(
      (dueDate) => ({ status, dueDate }),
    ),
  );

  const CYCLES: CycleLike[] = ["accruing", "paid", "autre"].flatMap((status) =>
    [NOW - DAY, NOW, NOW + DAY].flatMap((cycleEnd) =>
      [0, 0.5, 120].map((totalDue) => ({ status, cycleEnd, totalDue })),
    ),
  );

  const COMPTES: WarmupCompteLike[] = [
    "warmup",
    "actif",
    "shadowban",
    "archived",
  ].flatMap((effectiveStatus) =>
    [undefined, NOW - 60 * DAY, NOW - 5 * DAY, NOW - DAY, NOW].flatMap(
      (warmupStartedAt) =>
        [[], ["a"], ["a", "b", "c"], ["a", "b", "c", "d", "e", "f", "g", "h"]].flatMap(
          (dailyChecks) =>
            [3, 7, 14].map((targetDays) => ({
              effectiveStatus,
              warmupStartedAt,
              dailyChecks,
              targetDays,
            })),
        ),
    ),
  );

  it("PRODUCTION_STATUSES identique", () => {
    expect(convexDigest.PRODUCTION_STATUSES).toEqual(PRODUCTION_STATUSES);
  });

  it("isOverdueMission identique sur toutes les entrées", () => {
    for (const m of MISSIONS) {
      expect(convexDigest.isOverdueMission(m, NOW)).toBe(
        isOverdueMission(m, NOW),
      );
    }
  });

  it("missionDaysLate identique sur toutes les entrées", () => {
    for (const m of MISSIONS) {
      expect(convexDigest.missionDaysLate(m, NOW)).toBe(missionDaysLate(m, NOW));
    }
  });

  it("isCycleUnpaid et isCycleDue identiques sur toutes les entrées", () => {
    for (const c of CYCLES) {
      expect(convexDigest.isCycleUnpaid(c)).toBe(isCycleUnpaid(c));
      expect(convexDigest.isCycleDue(c, NOW)).toBe(isCycleDue(c, NOW));
    }
  });

  it("warmupMissedDays et isWarmupLate identiques — donc missedDays aussi", () => {
    // Cette comparaison traverse les DEUX répliques de missedDays
    // (lib/warmup.ts et convex/warmup.ts) : elle les apparie transitivement.
    for (const c of COMPTES) {
      expect(convexDigest.warmupMissedDays(c, NOW)).toBe(warmupMissedDays(c, NOW));
      expect(convexDigest.isWarmupLate(c, NOW)).toBe(isWarmupLate(c, NOW));
    }
  });

  it("les jeux de parité couvrent bien les deux issues (test non vide de sens)", () => {
    // Sans ça, un jeu de données dégénéré (tout faux des deux côtés) passerait
    // la parité sans rien prouver.
    expect(MISSIONS.some((m) => isOverdueMission(m, NOW))).toBe(true);
    expect(MISSIONS.some((m) => !isOverdueMission(m, NOW))).toBe(true);
    expect(CYCLES.some((c) => isCycleDue(c, NOW))).toBe(true);
    expect(CYCLES.some((c) => !isCycleDue(c, NOW))).toBe(true);
    expect(COMPTES.some((c) => isWarmupLate(c, NOW))).toBe(true);
    expect(COMPTES.some((c) => !isWarmupLate(c, NOW))).toBe(true);
  });
});

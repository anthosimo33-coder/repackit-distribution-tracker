import { describe, it, expect } from "vitest";
import {
  WARMUP_TARGET_DAYS_FALLBACK,
  warmupTargetDaysOf,
  defaultTargetDays,
  platformKey,
  todayKey,
  daysElapsed,
  warmupProgress,
  checkedToday,
  missedDays,
  lastCheck,
  effectiveTargetDays,
  checksCompleted,
  isWarmupComplete,
  isAccountAvailable,
  mustCheckToday,
} from "./warmup";

const DAY = 86_400_000;
// 2023-11-14T22:13:20Z — base déterministe (UTC).
const START = 1_700_000_000_000;
const at = (days: number) => START + days * DAY;

// Barèmes des deux projets RÉELS : les tests parlent de la prod, pas d'un jeu
// inventé. RepackIt garde 7/14/7 ; Snytch chauffe 3 jours sur ses deux
// plateformes (règle produit portée par projects.warmupTargetDays).
const REPACKIT = { tiktok: 7, instagram: 14, youtube: 7 };
const SNYTCH = { tiktok: 3, instagram: 3, youtube: 3 };

describe("Barème : dernier recours et barème de projet", () => {
  it("dernier recours — youtube=7, tiktok=7, instagram=14", () => {
    expect(WARMUP_TARGET_DAYS_FALLBACK).toEqual({
      youtube: 7,
      tiktok: 7,
      instagram: 14,
    });
  });
  it("defaultTargetDays lit LE BARÈME REÇU, pas un global", () => {
    expect(defaultTargetDays("TikTok", REPACKIT)).toBe(7);
    expect(defaultTargetDays("YouTube", REPACKIT)).toBe(7);
    expect(defaultTargetDays("Instagram", REPACKIT)).toBe(14);
  });

  it("projet sans barème → dernier recours", () => {
    expect(warmupTargetDaysOf({})).toEqual(WARMUP_TARGET_DAYS_FALLBACK);
    expect(warmupTargetDaysOf({ warmupTargetDays: null })).toEqual(
      WARMUP_TARGET_DAYS_FALLBACK,
    );
  });

  it("SNYTCH — 3 jours TikTok ET Instagram, contre 7 et 14 chez RepackIt", () => {
    const d = warmupTargetDaysOf({ warmupTargetDays: SNYTCH });
    expect(defaultTargetDays("TikTok", d)).toBe(3);
    expect(defaultTargetDays("Instagram", d)).toBe(3);
    expect(defaultTargetDays("TikTok", REPACKIT)).toBe(7);
    expect(defaultTargetDays("Instagram", REPACKIT)).toBe(14);
  });
  it("platformKey", () => {
    expect(platformKey("TikTok")).toBe("tiktok");
    expect(platformKey("Instagram")).toBe("instagram");
    expect(platformKey("YouTube")).toBe("youtube");
  });
});

describe("todayKey", () => {
  it("YYYY-MM-DD UTC", () => {
    expect(todayKey(START)).toBe("2023-11-14");
    expect(todayKey(at(1))).toBe("2023-11-15");
  });
});

describe("daysElapsed", () => {
  it("floor des jours", () => {
    expect(daysElapsed(START, START)).toBe(0);
    expect(daysElapsed(START, START + 2 * DAY + DAY / 2)).toBe(2);
  });
});

describe("warmupProgress (fondé sur les CHECKS réels)", () => {
  it("day = checksDone+1 clampé à targetDays ; complete à N checks", () => {
    expect(warmupProgress(0, 3)).toEqual({
      day: 1,
      targetDays: 3,
      complete: false,
    });
    expect(warmupProgress(1, 3)).toEqual({
      day: 2,
      targetDays: 3,
      complete: false,
    });
    // 3 checks ≥ 3 → complet, day clampé à 3.
    expect(warmupProgress(3, 3)).toEqual({
      day: 3,
      targetDays: 3,
      complete: true,
    });
    // Au-delà reste complet, day reste clampé.
    expect(warmupProgress(9, 3)).toEqual({
      day: 3,
      targetDays: 3,
      complete: true,
    });
  });
  it("respecte un targetDays surchargé (override admin)", () => {
    expect(warmupProgress(2, 5)).toEqual({
      day: 3,
      targetDays: 5,
      complete: false,
    });
  });
});

describe("effectiveTargetDays / checksCompleted", () => {
  it("durée = surcharge protocole sinon barème plateforme", () => {
    expect(effectiveTargetDays({ plateforme: "TikTok" }, REPACKIT)).toBe(7);
    expect(effectiveTargetDays({ plateforme: "Instagram" }, REPACKIT)).toBe(14);
    expect(
      effectiveTargetDays(
        { plateforme: "TikTok", warmupProtocol: { targetDays: 5 } },
        REPACKIT,
      ),
    ).toBe(5);
  });
  it("checksCompleted = nb de checks distincts", () => {
    expect(checksCompleted({ plateforme: "TikTok" })).toBe(0);
    expect(
      checksCompleted({
        plateforme: "TikTok",
        warmupProtocol: { dailyChecks: ["2023-11-14", "2023-11-16"] },
      }),
    ).toBe(2);
  });
});

describe("isWarmupComplete (par checks réels, pas calendaire)", () => {
  it("TikTok : 6/7 pas terminé, 7/7 terminé", () => {
    const c = (n: number) => ({
      plateforme: "TikTok" as const,
      warmupProtocol: { dailyChecks: Array.from({ length: n }, (_, i) => `d${i}`) },
    });
    expect(isWarmupComplete(c(6), REPACKIT)).toBe(false);
    expect(isWarmupComplete(c(7), REPACKIT)).toBe(true);
    expect(isWarmupComplete(c(8), REPACKIT)).toBe(true);
  });
  it("Instagram terminé à 14 checks", () => {
    const checks = (n: number) =>
      Array.from({ length: n }, (_, i) => `d${i}`);
    expect(
      isWarmupComplete(
        { plateforme: "Instagram", warmupProtocol: { dailyChecks: checks(13) } },
        REPACKIT,
      ),
    ).toBe(false);
    expect(
      isWarmupComplete(
        { plateforme: "Instagram", warmupProtocol: { dailyChecks: checks(14) } },
        REPACKIT,
      ),
    ).toBe(true);
  });
  it("rater un jour n'avance pas : J1 puis (saut) J3 = 2 checks, pas terminé", () => {
    // 2 checks à des dates non consécutives → checksCompleted=2 < 7.
    expect(
      isWarmupComplete(
        {
          plateforme: "TikTok",
          warmupProtocol: { dailyChecks: ["2023-11-14", "2023-11-16"] },
        },
        REPACKIT,
      ),
    ).toBe(false);
  });
});

describe("isAccountAvailable", () => {
  it("actif → disponible ; legacy actif=true → disponible", () => {
    expect(isAccountAvailable({ plateforme: "TikTok", status: "actif" }, REPACKIT)).toBe(
      true,
    );
    expect(isAccountAvailable({ plateforme: "TikTok", actif: true }, REPACKIT)).toBe(true);
  });
  it("warmup → disponible seulement si terminé (checks)", () => {
    const warm = (n: number) => ({
      plateforme: "TikTok" as const,
      status: "warmup" as const,
      warmupProtocol: { dailyChecks: Array.from({ length: n }, (_, i) => `d${i}`) },
    });
    expect(isAccountAvailable(warm(6), REPACKIT)).toBe(false);
    expect(isAccountAvailable(warm(7), REPACKIT)).toBe(true);
  });
  it("shadowban / archived → indisponible", () => {
    expect(
      isAccountAvailable({ plateforme: "TikTok", status: "shadowban" }, REPACKIT),
    ).toBe(false);
    expect(isAccountAvailable({ plateforme: "TikTok", actif: false }, REPACKIT)).toBe(
      false,
    );
  });

  // Gate STRICT (Snytch) — un warmup TERMINÉ n'est PLUS disponible tant que
  // l'admin ne l'a pas passé "actif". Seul "actif" débloque.
  describe("strict (gate actif Snytch)", () => {
    const warmDone = {
      plateforme: "TikTok" as const,
      status: "warmup" as const,
      warmupProtocol: {
        dailyChecks: Array.from({ length: 7 }, (_, i) => `d${i}`),
      },
        REPACKIT,
    };
    it("warmup terminé → indisponible en strict (dispo en lenient)", () => {
      expect(isAccountAvailable(warmDone, REPACKIT)).toBe(true); // lenient (défaut)
      expect(isAccountAvailable(warmDone, REPACKIT, { strict: true })).toBe(false);
    });
    it("actif → disponible même en strict", () => {
      expect(
        isAccountAvailable(
          { plateforme: "TikTok", status: "actif" },
          REPACKIT,
          { strict: true },
        ),
      ).toBe(true);
      expect(
        isAccountAvailable(
          { plateforme: "TikTok", actif: true },
          REPACKIT,
          { strict: true },
        ),
      ).toBe(true);
    });
    it("warmup en cours → indisponible dans les deux régimes", () => {
      const warmInProgress = {
        plateforme: "TikTok" as const,
        status: "warmup" as const,
        warmupProtocol: { dailyChecks: ["d0", "d1"] },
      };
      expect(isAccountAvailable(warmInProgress, REPACKIT)).toBe(false);
      expect(isAccountAvailable(warmInProgress, REPACKIT, { strict: true })).toBe(false);
    });
  });
});

describe("mustCheckToday", () => {
  const TODAY = todayKey(START); // "2023-11-14"
  it("dû si warmup non terminé ET pas coché aujourd'hui", () => {
    expect(
      mustCheckToday({ plateforme: "TikTok", warmupProtocol: { dailyChecks: [] } }, REPACKIT, START),
    ).toBe(true);
  });
  it("non dû si déjà coché aujourd'hui", () => {
    expect(
      mustCheckToday(
        { plateforme: "TikTok", warmupProtocol: { dailyChecks: [TODAY] } },
        REPACKIT,
        START,
      ),
    ).toBe(false);
  });
  it("dû à nouveau le lendemain si pas terminé (jour manqué reste à faire)", () => {
    // Coché hier seulement, pas terminé (1/7) → dû aujourd'hui.
    expect(
      mustCheckToday(
        { plateforme: "TikTok", warmupProtocol: { dailyChecks: ["2023-11-13"] } },
        REPACKIT,
        START,
      ),
    ).toBe(true);
  });
  it("non dû si warmup terminé (même sans check aujourd'hui)", () => {
    expect(
      mustCheckToday(
        {
          plateforme: "TikTok",
          warmupProtocol: {
            dailyChecks: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"],
          },
        },
        REPACKIT,
        START,
      ),
    ).toBe(false);
  });
});

describe("checkedToday", () => {
  it("vrai si todayKey présent", () => {
    expect(checkedToday(["2023-11-14"], START)).toBe(true);
    expect(checkedToday(["2023-11-13"], START)).toBe(false);
    expect(checkedToday([], START)).toBe(false);
  });
});

describe("missedDays", () => {
  it("jours pleins écoulés moins checks, capé targetDays, clampé 0", () => {
    // J+0, aucun check → 0 (jour en cours, rien de manqué).
    expect(missedDays(START, [], 3, at(0))).toBe(0);
    // J+2, 0 check → 2 jours pleins manqués.
    expect(missedDays(START, [], 3, at(2))).toBe(2);
    // J+2, 2 checks → 0.
    expect(missedDays(START, ["2023-11-14", "2023-11-15"], 3, at(2))).toBe(0);
    // J+2, 1 check → 1 manqué.
    expect(missedDays(START, ["2023-11-14"], 3, at(2))).toBe(1);
    // Au-delà de targetDays : capé (J+10, target 3, 1 check → 3-1=2).
    expect(missedDays(START, ["2023-11-14"], 3, at(10))).toBe(2);
    // Plus de checks que de jours pleins → clampé 0.
    expect(
      missedDays(START, ["2023-11-14", "2023-11-15", "2023-11-16"], 3, at(1)),
    ).toBe(0);
  });
});

describe("lastCheck", () => {
  it("dernier check chronologique ou null", () => {
    expect(lastCheck([])).toBeNull();
    expect(lastCheck(["2023-11-14", "2023-11-16", "2023-11-15"])).toBe(
      "2023-11-16",
    );
  });
});

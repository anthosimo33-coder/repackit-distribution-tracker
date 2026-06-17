import { describe, it, expect } from "vitest";
import {
  WARMUP_TARGET_DAYS,
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

describe("WARMUP_TARGET_DAYS — barème unique", () => {
  it("youtube=3, tiktok=3, instagram=14", () => {
    expect(WARMUP_TARGET_DAYS).toEqual({
      youtube: 3,
      tiktok: 3,
      instagram: 14,
    });
  });
  it("defaultTargetDays mappe la plateforme capitalisée", () => {
    expect(defaultTargetDays("TikTok")).toBe(3);
    expect(defaultTargetDays("YouTube")).toBe(3);
    expect(defaultTargetDays("Instagram")).toBe(14);
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
    expect(effectiveTargetDays({ plateforme: "TikTok" })).toBe(3);
    expect(effectiveTargetDays({ plateforme: "Instagram" })).toBe(14);
    expect(
      effectiveTargetDays({
        plateforme: "TikTok",
        warmupProtocol: { targetDays: 5 },
      }),
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
  it("TikTok : 2/3 pas terminé, 3/3 terminé", () => {
    const c = (n: number) => ({
      plateforme: "TikTok" as const,
      warmupProtocol: { dailyChecks: Array.from({ length: n }, (_, i) => `d${i}`) },
    });
    expect(isWarmupComplete(c(2))).toBe(false);
    expect(isWarmupComplete(c(3))).toBe(true);
    expect(isWarmupComplete(c(4))).toBe(true);
  });
  it("Instagram terminé à 14 checks", () => {
    const checks = (n: number) =>
      Array.from({ length: n }, (_, i) => `d${i}`);
    expect(
      isWarmupComplete({
        plateforme: "Instagram",
        warmupProtocol: { dailyChecks: checks(13) },
      }),
    ).toBe(false);
    expect(
      isWarmupComplete({
        plateforme: "Instagram",
        warmupProtocol: { dailyChecks: checks(14) },
      }),
    ).toBe(true);
  });
  it("rater un jour n'avance pas : J1 puis (saut) J3 = 2 checks, pas terminé", () => {
    // 2 checks à des dates non consécutives → checksCompleted=2 < 3.
    expect(
      isWarmupComplete({
        plateforme: "TikTok",
        warmupProtocol: { dailyChecks: ["2023-11-14", "2023-11-16"] },
      }),
    ).toBe(false);
  });
});

describe("isAccountAvailable", () => {
  it("actif → disponible ; legacy actif=true → disponible", () => {
    expect(isAccountAvailable({ plateforme: "TikTok", status: "actif" })).toBe(
      true,
    );
    expect(isAccountAvailable({ plateforme: "TikTok", actif: true })).toBe(true);
  });
  it("warmup → disponible seulement si terminé (checks)", () => {
    const warm = (n: number) => ({
      plateforme: "TikTok" as const,
      status: "warmup" as const,
      warmupProtocol: { dailyChecks: Array.from({ length: n }, (_, i) => `d${i}`) },
    });
    expect(isAccountAvailable(warm(2))).toBe(false);
    expect(isAccountAvailable(warm(3))).toBe(true);
  });
  it("shadowban / archived → indisponible", () => {
    expect(
      isAccountAvailable({ plateforme: "TikTok", status: "shadowban" }),
    ).toBe(false);
    expect(isAccountAvailable({ plateforme: "TikTok", actif: false })).toBe(
      false,
    );
  });
});

describe("mustCheckToday", () => {
  const TODAY = todayKey(START); // "2023-11-14"
  it("dû si warmup non terminé ET pas coché aujourd'hui", () => {
    expect(
      mustCheckToday({ plateforme: "TikTok", warmupProtocol: { dailyChecks: [] } }, START),
    ).toBe(true);
  });
  it("non dû si déjà coché aujourd'hui", () => {
    expect(
      mustCheckToday(
        { plateforme: "TikTok", warmupProtocol: { dailyChecks: [TODAY] } },
        START,
      ),
    ).toBe(false);
  });
  it("dû à nouveau le lendemain si pas terminé (jour manqué reste à faire)", () => {
    // Coché hier seulement, pas terminé (1/3) → dû aujourd'hui.
    expect(
      mustCheckToday(
        { plateforme: "TikTok", warmupProtocol: { dailyChecks: ["2023-11-13"] } },
        START,
      ),
    ).toBe(true);
  });
  it("non dû si warmup terminé (même sans check aujourd'hui)", () => {
    expect(
      mustCheckToday(
        {
          plateforme: "TikTok",
          warmupProtocol: { dailyChecks: ["d0", "d1", "d2"] },
        },
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

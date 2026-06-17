import { describe, it, expect } from "vitest";
import {
  WARMUP_DURATION_BY_PLATFORM,
  getWarmupDuration,
  isSelectableForPublication,
  getEffectiveStatus,
  getEffectiveWarmupDuration,
  isWarmupCompleteForCompte,
  getStatusBadge,
} from "./compte-status";

/** n checks distincts (dates factices, seul le compte importe pour la complétion). */
const checks = (n: number) => Array.from({ length: n }, (_, i) => `d${i}`);

describe("WARMUP_DURATION_BY_PLATFORM", () => {
  // P5 — barème unifié sur lib/warmup : TikTok aligné à 3 (était 7).
  it("TikTok=3, Instagram=14, YouTube=3", () => {
    expect(WARMUP_DURATION_BY_PLATFORM).toEqual({
      TikTok: 3,
      Instagram: 14,
      YouTube: 3,
    });
  });
  it("getWarmupDuration reflète la map", () => {
    expect(getWarmupDuration("TikTok")).toBe(3);
    expect(getWarmupDuration("Instagram")).toBe(14);
    expect(getWarmupDuration("YouTube")).toBe(3);
  });
});

describe("getEffectiveWarmupDuration", () => {
  it("défaut plateforme sans protocole", () => {
    expect(getEffectiveWarmupDuration({ plateforme: "TikTok" })).toBe(3);
    expect(getEffectiveWarmupDuration({ plateforme: "Instagram" })).toBe(14);
  });
  it("surcharge admin via warmupProtocol.targetDays", () => {
    expect(
      getEffectiveWarmupDuration({
        plateforme: "TikTok",
        warmupProtocol: { targetDays: 5 },
      }),
    ).toBe(5);
  });
});

describe("isSelectableForPublication", () => {
  it("seul actif est sélectionnable", () => {
    expect(isSelectableForPublication("actif")).toBe(true);
    expect(isSelectableForPublication("warmup")).toBe(false);
    expect(isSelectableForPublication("shadowban")).toBe(false);
    expect(isSelectableForPublication("archived")).toBe(false);
  });
});

describe("isWarmupCompleteForCompte (par CHECKS réels, ≠ calendaire)", () => {
  it("terminé seulement quand assez de checks (TikTok=3)", () => {
    expect(
      isWarmupCompleteForCompte({
        plateforme: "TikTok",
        warmupStartedAt: 1,
        warmupProtocol: { dailyChecks: checks(2) },
      }),
    ).toBe(false);
    expect(
      isWarmupCompleteForCompte({
        plateforme: "TikTok",
        warmupStartedAt: 1,
        warmupProtocol: { dailyChecks: checks(3) },
      }),
    ).toBe(true);
  });
  it("surcharge targetDays respectée", () => {
    expect(
      isWarmupCompleteForCompte({
        plateforme: "TikTok",
        warmupStartedAt: 1,
        warmupProtocol: { targetDays: 5, dailyChecks: checks(4) },
      }),
    ).toBe(false);
  });
  it("sans warmupStartedAt → false", () => {
    expect(
      isWarmupCompleteForCompte({
        plateforme: "TikTok",
        warmupProtocol: { dailyChecks: checks(3) },
      }),
    ).toBe(false);
  });
});

describe("getEffectiveStatus", () => {
  it("status explicite prioritaire", () => {
    expect(getEffectiveStatus({ status: "shadowban", actif: true })).toBe(
      "shadowban",
    );
    expect(getEffectiveStatus({ status: "warmup" })).toBe("warmup");
  });
  it("fallback legacy actif quand status absent", () => {
    expect(getEffectiveStatus({ actif: true })).toBe("actif");
    expect(getEffectiveStatus({ actif: false })).toBe("archived");
    expect(getEffectiveStatus({})).toBe("actif"); // edge: actif undefined
  });
});

describe("getStatusBadge (décompte par CHECKS réels)", () => {
  it("warmup en cours → 'Warmup J+<checks>/N' ambre", () => {
    const b = getStatusBadge({
      status: "warmup",
      plateforme: "Instagram",
      warmupStartedAt: 1,
      warmupProtocol: { targetDays: 14, dailyChecks: checks(2) },
    });
    expect(b.label).toBe("Warmup J+2/14");
    expect(b.className).toContain("amber");
  });
  it("aucun check → 'Warmup J+0/N'", () => {
    const b = getStatusBadge({
      status: "warmup",
      plateforme: "TikTok",
      warmupStartedAt: 1,
    });
    expect(b.label).toBe("Warmup J+0/3");
  });
  it("respecte targetDays surchargé (override admin)", () => {
    const b = getStatusBadge({
      status: "warmup",
      plateforme: "TikTok",
      warmupStartedAt: 1,
      warmupProtocol: { targetDays: 5, dailyChecks: checks(2) },
    });
    expect(b.label).toBe("Warmup J+2/5");
  });
  it("warmup terminé (assez de checks) → 'À valider' bleu", () => {
    const b = getStatusBadge({
      status: "warmup",
      plateforme: "YouTube",
      warmupStartedAt: 1,
      warmupProtocol: { dailyChecks: checks(3) },
    });
    expect(b.label).toBe("À valider");
    expect(b.className).toContain("blue");
  });
  it("statuts simples", () => {
    expect(getStatusBadge({ status: "actif", plateforme: "TikTok" }).label).toBe(
      "Actif",
    );
    expect(
      getStatusBadge({ status: "shadowban", plateforme: "TikTok" }).className,
    ).toContain("rose");
    expect(
      getStatusBadge({ status: "archived", plateforme: "TikTok" }).className,
    ).toContain("slate");
  });
  it("rows legacy sans status → dérivé de actif", () => {
    expect(getStatusBadge({ actif: true, plateforme: "TikTok" }).label).toBe(
      "Actif",
    );
    expect(getStatusBadge({ actif: false, plateforme: "TikTok" }).label).toBe(
      "Archivé",
    );
  });
});

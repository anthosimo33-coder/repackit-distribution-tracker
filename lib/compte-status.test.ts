import { describe, it, expect } from "vitest";
import {
  WARMUP_DURATION_BY_PLATFORM,
  getWarmupDuration,
  getWarmupDaysElapsed,
  getWarmupDaysRemaining,
  isWarmupComplete,
  isSelectableForPublication,
  formatWarmupBadge,
  getEffectiveStatus,
  getStatusBadge,
} from "./compte-status";

const DAY = 86_400_000;
const START = 1_700_000_000_000; // base déterministe
const at = (days: number) => START + days * DAY;

describe("WARMUP_DURATION_BY_PLATFORM", () => {
  it("TikTok=7, Instagram=14, YouTube=3", () => {
    expect(WARMUP_DURATION_BY_PLATFORM).toEqual({
      TikTok: 7,
      Instagram: 14,
      YouTube: 3,
    });
  });
  it("getWarmupDuration reflète la map", () => {
    expect(getWarmupDuration("TikTok")).toBe(7);
    expect(getWarmupDuration("Instagram")).toBe(14);
    expect(getWarmupDuration("YouTube")).toBe(3);
  });
});

describe("getWarmupDaysElapsed", () => {
  it("floor des jours écoulés", () => {
    expect(getWarmupDaysElapsed(START, at(0))).toBe(0);
    expect(getWarmupDaysElapsed(START, at(2))).toBe(2);
    // 4 jours et demi → floor 4
    expect(getWarmupDaysElapsed(START, START + 4 * DAY + DAY / 2)).toBe(4);
  });
});

describe("getWarmupDaysRemaining", () => {
  it("décompte restant, clampé à 0", () => {
    expect(getWarmupDaysRemaining(START, "TikTok", at(2))).toBe(5);
    expect(getWarmupDaysRemaining(START, "TikTok", at(7))).toBe(0);
    expect(getWarmupDaysRemaining(START, "TikTok", at(10))).toBe(0);
    expect(getWarmupDaysRemaining(START, "Instagram", at(4))).toBe(10);
    expect(getWarmupDaysRemaining(START, "YouTube", at(1))).toBe(2);
  });
});

describe("isWarmupComplete", () => {
  it("TikTok complet à J+7", () => {
    expect(isWarmupComplete(START, "TikTok", at(6))).toBe(false);
    expect(isWarmupComplete(START, "TikTok", at(7))).toBe(true);
  });
  it("Instagram complet à J+14", () => {
    expect(isWarmupComplete(START, "Instagram", at(13))).toBe(false);
    expect(isWarmupComplete(START, "Instagram", at(14))).toBe(true);
  });
  it("YouTube complet à J+3 (et J+4 reste complet)", () => {
    expect(isWarmupComplete(START, "YouTube", at(2))).toBe(false);
    expect(isWarmupComplete(START, "YouTube", at(3))).toBe(true);
    expect(isWarmupComplete(START, "YouTube", at(4))).toBe(true);
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

describe("formatWarmupBadge", () => {
  it("J+X/N adaptatif par plateforme", () => {
    expect(formatWarmupBadge(START, "TikTok", at(4))).toBe("J+4/7");
    expect(formatWarmupBadge(START, "Instagram", at(4))).toBe("J+4/14");
    expect(formatWarmupBadge(START, "YouTube", at(4))).toBe("J+4/3");
    expect(formatWarmupBadge(START, "TikTok", at(0))).toBe("J+0/7");
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

describe("getStatusBadge", () => {
  it("warmup en cours → 'Warmup J+X/N' ambre", () => {
    const b = getStatusBadge(
      { status: "warmup", plateforme: "TikTok", warmupStartedAt: START },
      at(2),
    );
    expect(b.label).toBe("Warmup J+2/7");
    expect(b.className).toContain("amber");
  });
  it("warmup terminé → 'À valider' bleu", () => {
    const b = getStatusBadge(
      { status: "warmup", plateforme: "YouTube", warmupStartedAt: START },
      at(4),
    );
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

import { describe, it, expect } from "vitest";
import { dateInputToMs, msToDateInput, floorToUtcMidnight } from "./promo-date";
import * as convexPromoDate from "../convex/promoDate";

describe("dateInputToMs — TZ-safe (minuit UTC du jour saisi)", () => {
  it('"2026-07-25" → 1784937600000 (25/07 00:00 UTC), pas minuit local', () => {
    expect(dateInputToMs("2026-07-25")).toBe(1784937600000);
    // = Date.UTC : TZ-INDÉPENDANT (une impl. en new Date locale donnerait une
    // autre valeur hors UTC ; l'égalité exacte prouve l'usage de Date.UTC).
    expect(dateInputToMs("2026-07-25")).toBe(Date.UTC(2026, 6, 25));
  });
  it("bornes : 24/07 et 26/07 = ±1 jour exact", () => {
    expect(dateInputToMs("2026-07-24")).toBe(1784937600000 - 86_400_000);
    expect(dateInputToMs("2026-07-26")).toBe(1784937600000 + 86_400_000);
  });
  it("vide → null", () => {
    expect(dateInputToMs("")).toBeNull();
  });
});

describe("msToDateInput — relit en UTC (round-trip)", () => {
  it("round-trip stable", () => {
    expect(msToDateInput(dateInputToMs("2026-07-25"))).toBe("2026-07-25");
    expect(msToDateInput(1784937600000)).toBe("2026-07-25");
  });
  it("null/undefined → \"\"", () => {
    expect(msToDateInput(null)).toBe("");
    expect(msToDateInput(undefined)).toBe("");
  });
});

describe("floorToUtcMidnight + parité A6", () => {
  it("no-op sur minuit UTC, ramène un ms intra-jour à minuit UTC", () => {
    expect(floorToUtcMidnight(1784937600000)).toBe(1784937600000);
    expect(floorToUtcMidnight(1784937600000 + 50_000)).toBe(1784937600000);
    expect(floorToUtcMidnight(1784937600000 + 86_400_000 - 1)).toBe(
      1784937600000,
    );
  });
  it("lib/ ↔ convex/ identiques", () => {
    for (const ms of [0, 1784937600000, 1784937600000 + 12345, 1785024000000]) {
      expect(convexPromoDate.floorToUtcMidnight(ms)).toBe(floorToUtcMidnight(ms));
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  slotBrickIdOf,
  selectSamplesForBrick,
  type ComboSlots,
} from "./scriptPosts";

type Sample = ComboSlots & { views: number };
const mk = (hook: string, flux: string, cta: string, views: number): Sample => ({
  hookBrickId: hook,
  fluxBrickId: flux,
  ctaBrickId: cta,
  views,
});

describe("slotBrickIdOf", () => {
  const s = mk("h1", "f1", "c1", 0);
  it("returns the brickId of the slot matching the kind", () => {
    expect(slotBrickIdOf(s, "hook")).toBe("h1");
    expect(slotBrickIdOf(s, "flux")).toBe("f1");
    expect(slotBrickIdOf(s, "cta")).toBe("c1");
  });
});

describe("selectSamplesForBrick", () => {
  const samples: Sample[] = [
    mk("h1", "f1", "c1", 100),
    mk("h1", "f2", "c1", 200),
    mk("h2", "f1", "c2", 300),
  ];

  it("keeps samples whose hook slot matches the brickId", () => {
    expect(
      selectSamplesForBrick(samples, "hook", "h1").map((s) => s.views),
    ).toEqual([100, 200]);
  });

  it("keeps samples whose flux slot matches the brickId", () => {
    expect(
      selectSamplesForBrick(samples, "flux", "f1").map((s) => s.views),
    ).toEqual([100, 300]);
  });

  it("keeps samples whose cta slot matches the brickId", () => {
    expect(
      selectSamplesForBrick(samples, "cta", "c2").map((s) => s.views),
    ).toEqual([300]);
  });

  it("does NOT match a brickId that lives in a different slot", () => {
    // f1 is a flux id; querying it as a hook must match nothing (slot-scoped).
    expect(selectSamplesForBrick(samples, "hook", "f1")).toEqual([]);
  });

  it("empty when no sample uses the brick", () => {
    expect(selectSamplesForBrick(samples, "cta", "c9")).toEqual([]);
  });

  it("empty input → empty output", () => {
    expect(selectSamplesForBrick([], "hook", "h1")).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  assembleScript,
  countCombinations,
  type BrickLike,
} from "./scriptAssembly";

describe("assembleScript", () => {
  const input = {
    hook: "Tu perds 2h par jour sur ça.",
    corps: "Voici pourquoi.",
    flux: "Scan, clone, publie.",
    cta: "Lien en bio.",
    demoBlock: "Démo produit fixe.",
  };

  it("monte dans l'ordre hook → corps → flux → cta → démo", () => {
    const out = assembleScript(input);
    const iHook = out.indexOf("Tu perds 2h");
    const iCorps = out.indexOf("Voici pourquoi");
    const iFlux = out.indexOf("Scan, clone");
    const iCta = out.indexOf("Lien en bio");
    const iDemo = out.indexOf("Démo produit fixe");
    expect(iHook).toBeGreaterThanOrEqual(0);
    expect(iHook).toBeLessThan(iCorps);
    expect(iCorps).toBeLessThan(iFlux);
    expect(iFlux).toBeLessThan(iCta);
    expect(iCta).toBeLessThan(iDemo);
  });

  it("inclut les 5 titres de section markdown", () => {
    const out = assembleScript(input);
    expect(out).toContain("## Hook");
    expect(out).toContain("## Corps");
    expect(out).toContain("## Flux");
    expect(out).toContain("## CTA");
    expect(out).toContain("## Démo");
  });

  it("trim le contenu de chaque brique", () => {
    const out = assembleScript({ ...input, hook: "   espacé   " });
    expect(out).toContain("## Hook\n\nespacé");
    expect(out).not.toContain("   espacé   ");
  });
});

describe("countCombinations", () => {
  const make = (
    counts: Partial<Record<BrickLike["kind"], number>>,
    activeAll = true,
  ): BrickLike[] => {
    const out: BrickLike[] = [];
    for (const kind of ["hook", "corps", "flux", "cta"] as const) {
      for (let i = 0; i < (counts[kind] ?? 0); i++) {
        out.push({ kind, active: activeAll });
      }
    }
    return out;
  };

  it("2×2×2×2 actifs = 16", () => {
    const bricks = make({ hook: 2, corps: 2, flux: 2, cta: 2 });
    const r = countCombinations(bricks);
    expect(r.total).toBe(16);
    expect(r.byKind).toEqual({ hook: 2, corps: 2, flux: 2, cta: 2 });
  });

  it("désactiver un flux fait passer 16 → 8", () => {
    const bricks = make({ hook: 2, corps: 2, flux: 2, cta: 2 });
    // Désactive une brique flux.
    const fluxIdx = bricks.findIndex((b) => b.kind === "flux");
    bricks[fluxIdx].active = false;
    const r = countCombinations(bricks);
    expect(r.byKind.flux).toBe(1);
    expect(r.total).toBe(8);
  });

  it("un kind sans brique active → 0 combo", () => {
    const bricks = make({ hook: 3, corps: 2, flux: 2 }); // pas de cta
    const r = countCombinations(bricks);
    expect(r.byKind.cta).toBe(0);
    expect(r.total).toBe(0);
  });

  it("ignore les bricks désactivés dans byKind", () => {
    const bricks = make({ hook: 2 }, false); // 2 hooks inactifs
    const r = countCombinations(bricks);
    expect(r.byKind.hook).toBe(0);
    expect(r.total).toBe(0);
  });
});

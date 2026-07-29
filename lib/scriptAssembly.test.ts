import { describe, it, expect } from "vitest";
import {
  assembleScript,
  countCombinations,
  normalizeAssembledForCompare,
  splitAssembledIntoThree,
  usefulShortLabel,
  type BrickLike,
} from "./scriptAssembly";

describe("assembleScript", () => {
  const input = {
    hook: "Tu perds 2h par jour sur ça.",
    flux: "Scan, clone, publie.",
    cta: "Lien en bio.",
  };

  it("monte dans l'ordre hook → flux → cta", () => {
    const out = assembleScript(input);
    const iHook = out.indexOf("Tu perds 2h");
    const iFlux = out.indexOf("Scan, clone");
    const iCta = out.indexOf("Lien en bio");
    expect(iHook).toBeGreaterThanOrEqual(0);
    expect(iHook).toBeLessThan(iFlux);
    expect(iFlux).toBeLessThan(iCta);
  });

  it("inclut les 3 titres de section markdown, sans Corps ni Démo", () => {
    const out = assembleScript(input);
    expect(out).toContain("## Hook");
    expect(out).toContain("## Flux");
    expect(out).toContain("## CTA");
    expect(out).not.toContain("## Corps");
    expect(out).not.toContain("## Démo");
  });

  it("labels OFF → enchaînement naturel sans titres (rendu créateur)", () => {
    const out = assembleScript(input, { labels: false });
    expect(out).not.toContain("## ");
    expect(out).toBe(
      "Tu perds 2h par jour sur ça.\n\nScan, clone, publie.\n\nLien en bio.",
    );
  });

  it("trim le contenu de chaque brique", () => {
    const out = assembleScript({ ...input, hook: "   espacé   " });
    expect(out).toContain("## Hook\n\nespacé");
    expect(out).not.toContain("   espacé   ");
  });
});

describe("countCombinations", () => {
  const make = (
    counts: Partial<Record<"hook" | "flux" | "cta", number>>,
    activeAll = true,
  ): BrickLike[] => {
    const out: BrickLike[] = [];
    for (const kind of ["hook", "flux", "cta"] as const) {
      for (let i = 0; i < (counts[kind] ?? 0); i++) {
        out.push({ kind, active: activeAll });
      }
    }
    return out;
  };

  it("2×2×2 actifs = 8", () => {
    const bricks = make({ hook: 2, flux: 2, cta: 2 });
    const r = countCombinations(bricks);
    expect(r.total).toBe(8);
    expect(r.byKind).toEqual({ hook: 2, flux: 2, cta: 2 });
  });

  it("désactiver un flux fait passer 8 → 4", () => {
    const bricks = make({ hook: 2, flux: 2, cta: 2 });
    const fluxIdx = bricks.findIndex((b) => b.kind === "flux");
    bricks[fluxIdx].active = false;
    const r = countCombinations(bricks);
    expect(r.byKind.flux).toBe(1);
    expect(r.total).toBe(4);
  });

  it("un kind sans brique active → 0 combo", () => {
    const bricks = make({ hook: 3, flux: 2 }); // pas de cta
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

  it("ignore une brique legacy 'corps' (kind hors hook/flux/cta)", () => {
    // Garde de la fenêtre de migration : un corps pas encore reclassé ne casse
    // pas le décompte (il est simplement ignoré), il ne fait pas tomber à 0.
    const bricks: BrickLike[] = [
      { kind: "hook", active: true },
      { kind: "flux", active: true },
      { kind: "cta", active: true },
      { kind: "corps", active: true },
    ];
    const r = countCombinations(bricks);
    expect(r.total).toBe(1);
    expect(r.byKind).toEqual({ hook: 1, flux: 1, cta: 1 });
  });
});

describe("normalizeAssembledForCompare", () => {
  it("neutralise espace insécable, zéro-largeur et runs d'espaces", () => {
    // NBSP + LRM + ZWSP + doubles espaces / sauts de ligne.
    const withInvisibles = "Snytch\u00A0\u200E  me\u200B\n\nrappelle";
    expect(normalizeAssembledForCompare(withInvisibles)).toBe(
      "Snytch me rappelle",
    );
  });

  it("préserve une VRAIE différence de texte", () => {
    expect(normalizeAssembledForCompare("froid et méchant")).not.toBe(
      normalizeAssembledForCompare("Snytch me rappelle"),
    );
  });
});

describe("usefulShortLabel", () => {
  it("null si vide, doublon du content, ou ponctuation pure", () => {
    expect(usefulShortLabel("", "abc")).toBeNull();
    expect(usefulShortLabel(".", "vrai contenu du flux")).toBeNull();
    expect(usefulShortLabel("Ouvre Youtube", "Ouvre Youtube")).toBeNull();
    // doublon à un espace insécable près
    expect(usefulShortLabel("Flux\u00A01", "Flux 1")).toBeNull();
  });

  it("null si le label est une phrase longue (>=40 car. = ancienne version)", () => {
    const vieux =
      "il me manque… jusqu'à ce que je me rappelle à quel point il était froid";
    expect(usefulShortLabel(vieux, "Il me manque... Snytch me rappelle")).toBeNull();
  });

  it("renvoie un vrai nom court distinct du content", () => {
    expect(usefulShortLabel("Flux 1 — Upload", "Tu vas sur RepackIt.io…")).toBe(
      "Flux 1 — Upload",
    );
  });
});

describe("splitAssembledIntoThree", () => {
  it("re-sépare un script monté labels:false en [hook, flux, cta]", () => {
    const assembled = assembleScript(
      { hook: "Le hook", flux: ".", cta: "Le CTA final" },
      { labels: false },
    );
    expect(splitAssembledIntoThree(assembled)).toEqual([
      "Le hook",
      ".",
      "Le CTA final",
    ]);
  });

  it("null si un contenu a une ligne vide interne (arité ambiguë)", () => {
    // hook à 2 paragraphes → 4 segments → non mappable → null (pas de devinette).
    const assembled = "Hook ligne 1\n\nHook ligne 2\n\nFlux\n\nCTA";
    expect(splitAssembledIntoThree(assembled)).toBeNull();
  });
});

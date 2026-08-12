import { describe, it, expect } from "vitest";
import {
  describeIneligibleBrick,
  describeNoEligibleCombo,
  eligibleBricksForRush,
  isBrickRushEligible,
  isGuardedKind,
  resolveBrickMode,
  type EligibilityBrick,
} from "../convex/rushScriptEligibility";
import { resolveBrickMode as resolveFromLib } from "./script-mode";

/**
 * Garde D7 — un rush est MUET, donc seul un script entièrement « à afficher »
 * peut être monté dessus.
 *
 * Deux tests de ce fichier ne protègent pas une règle mais une CATASTROPHE
 * ÉVITÉE : celui qui vérifie que le `cta` échappe à la garde (l'inclure
 * refuserait 100 % des scripts en production, aucun cta n'ayant de mode), et
 * celui qui vérifie qu'un mode absent est REFUSÉ (le tolérer laisserait passer
 * les 7 hooks non étiquetés de la prod comme s'ils étaient à afficher).
 */

const brique = (
  kind: string,
  mode: string | undefined,
  content = "texte",
  active = true,
): EligibilityBrick => ({ kind, mode, content, active });

describe("isGuardedKind — hook et flux seulement", () => {
  it("hook et flux sont gardés, cta ne l'est pas", () => {
    expect(isGuardedKind("hook")).toBe(true);
    expect(isGuardedKind("flux")).toBe(true);
    expect(isGuardedKind("cta")).toBe(false);
    // Legacy 4 briques : `corps` n'est pas gardé non plus (il n'existe plus à
    // l'écriture, seulement sur des combos figés).
    expect(isGuardedKind("corps")).toBe(false);
  });
});

describe("isBrickRushEligible", () => {
  it("hook/flux en « afficher » → éligibles", () => {
    expect(isBrickRushEligible(brique("hook", "afficher"))).toBe(true);
    expect(isBrickRushEligible(brique("flux", "afficher"))).toBe(true);
  });

  it("hook/flux en « dire » ou « les_deux » → refusés (le rush est muet)", () => {
    for (const mode of ["dire", "les_deux"]) {
      expect(isBrickRushEligible(brique("hook", mode))).toBe(false);
      expect(isBrickRushEligible(brique("flux", mode))).toBe(false);
    }
  });

  it("MODE ABSENT → REFUSÉ, jamais toléré", () => {
    // Aligné sur le défaut `les_deux` de resolveBrickMode. Une brique dont
    // personne n'a dit si elle se dit ou s'affiche n'est pas une brique à
    // afficher — les 7 hooks non étiquetés de la prod se corrigent à la main.
    expect(isBrickRushEligible(brique("hook", undefined))).toBe(false);
    expect(isBrickRushEligible(brique("hook", ""))).toBe(false);
    expect(isBrickRushEligible(brique("hook", "Afficher"))).toBe(false); // casse
    expect(isBrickRushEligible(brique("flux", undefined))).toBe(false);
  });

  it("le CTA passe TOUJOURS, quel que soit son mode", () => {
    // ⚠️ Si ce test tombe, la garde refuse 100 % des scripts en production :
    // aucun cta n'a de mode (14/14 absents au relevé du 2026-08-11), et son
    // champ `mode` est ignoré par conception (zone description).
    for (const mode of [undefined, "dire", "les_deux", "afficher"]) {
      expect(isBrickRushEligible(brique("cta", mode))).toBe(true);
    }
  });
});

describe("eligibleBricksForRush — filtrage AVANT le tirage", () => {
  it("ne garde que hook/flux à afficher, et tous les cta", () => {
    const bricks = [
      brique("hook", "afficher", "hook OK"),
      brique("hook", "dire", "hook parlé"),
      brique("hook", undefined, "hook non étiqueté"),
      brique("flux", "afficher", "flux OK"),
      brique("flux", "les_deux", "flux mixte"),
      brique("cta", undefined, "cta sans mode"),
    ];
    expect(eligibleBricksForRush(bricks).map((b) => b.content)).toEqual([
      "hook OK",
      "flux OK",
      "cta sans mode",
    ]);
  });

  it("filtrer en amont, c'est ce qui rend l'erreur explicable", () => {
    // Le tirage ne travaille que sur des briques valides : « aucun combo » cesse
    // d'être un cul-de-sac et devient une information exacte.
    const bricks = [brique("hook", "dire"), brique("flux", "afficher")];
    const eligible = eligibleBricksForRush(bricks);
    expect(eligible.some((b) => b.kind === "hook")).toBe(false);
  });
});

describe("messages — la brique fautive est NOMMÉE", () => {
  it("le motif distingue « mode absent » de « mauvais mode »", () => {
    expect(describeIneligibleBrick(brique("hook", undefined, "Tu savais que"))).
      toMatch(/mode n'est pas renseigné/i);
    expect(
      describeIneligibleBrick(brique("hook", "dire", "Tu savais que")),
    ).toMatch(/Dire à l'oral/);
  });

  it("le message cite le texte de la brique et le geste attendu", () => {
    const msg = describeIneligibleBrick(brique("flux", "dire", "Le corps ici"));
    expect(msg).toContain("Le corps ici");
    expect(msg).toMatch(/Afficher à l'écran/);
    expect(msg).toMatch(/muets/i);
  });

  it("un texte long est tronqué proprement", () => {
    const msg = describeIneligibleBrick(brique("hook", "dire", "x".repeat(200)));
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(250);
  });

  it("describeNoEligibleCombo borne la liste et compte le reste", () => {
    const bricks = Array.from({ length: 5 }, (_, i) =>
      brique("hook", "dire", `hook ${i}`),
    );
    const msg = describeNoEligibleCombo(bricks);
    expect(msg).toContain("hook 0");
    expect(msg).toContain("+ 2 autre(s)");
    expect(msg).not.toContain("hook 4");
  });

  it("aucune brique active à corriger → message de campagne vide", () => {
    const inactives = [brique("hook", "dire", "vieux hook", false)];
    expect(describeNoEligibleCombo(inactives)).toMatch(/pas d'accroche/i);
    expect(describeNoEligibleCombo([])).toMatch(/pas d'accroche/i);
  });
});

describe("parité lib ↔ convex (une seule définition)", () => {
  it("lib/script-mode ré-exporte EXACTEMENT resolveBrickMode", () => {
    // Ce n'est pas un test de parité entre deux copies : c'est la preuve qu'il
    // n'y a QU'UNE définition, le ré-export pointant la même fonction.
    expect(resolveFromLib).toBe(resolveBrickMode);
    for (const v of [undefined, "", "dire", "afficher", "les_deux", "DIRE"]) {
      expect(resolveFromLib(v)).toBe(resolveBrickMode(v));
    }
  });
});

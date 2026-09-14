import { describe, it, expect } from "vitest";
import {
  computeBioPatch,
  bioStateLabel,
  isBioPending,
  type BioState,
} from "./account-bio";
import fr from "../messages/admin/fr/accounts.json";
import en from "../messages/admin/en/accounts.json";

const NOW = 1_700_000_000_000;
const LATER = NOW + 86_400_000;

describe("computeBioPatch — transitions d'état", () => {
  it("pose une 1re bio → to_apply + bioUpdatedAt, pas de bioAppliedAt", () => {
    const patch = computeBioPatch({}, "Lien en bio 👉 repack.it", NOW);
    expect(patch).toEqual({
      bioToApply: "Lien en bio 👉 repack.it",
      bioStatus: "to_apply",
      bioUpdatedAt: NOW,
      bioAppliedAt: undefined,
    });
  });

  it("trim la bio avant de l'enregistrer", () => {
    const patch = computeBioPatch({}, "   Ma bio   ", NOW);
    expect(patch?.bioToApply).toBe("Ma bio");
  });

  it("bio MODIFIÉE après application → repasse en to_apply + purge bioAppliedAt", () => {
    const applied: BioState = {
      bioToApply: "Ancienne bio",
      bioStatus: "applied",
      bioUpdatedAt: NOW,
      bioAppliedAt: NOW + 1000,
    };
    const patch = computeBioPatch(applied, "Nouvelle bio", LATER);
    expect(patch).toEqual({
      bioToApply: "Nouvelle bio",
      bioStatus: "to_apply",
      bioUpdatedAt: LATER,
      bioAppliedAt: undefined,
    });
  });

  it("re-sauver EXACTEMENT la même bio (état applied) → no-op (reste applied)", () => {
    const applied: BioState = {
      bioToApply: "Ma bio",
      bioStatus: "applied",
      bioUpdatedAt: NOW,
      bioAppliedAt: NOW + 1000,
    };
    expect(computeBioPatch(applied, "Ma bio", LATER)).toBeNull();
    // Espaces autour : toujours considéré identique (trim).
    expect(computeBioPatch(applied, "  Ma bio  ", LATER)).toBeNull();
  });

  it("re-sauver la même bio en to_apply → no-op (n'écrase pas bioUpdatedAt)", () => {
    const pending: BioState = {
      bioToApply: "Ma bio",
      bioStatus: "to_apply",
      bioUpdatedAt: NOW,
    };
    expect(computeBioPatch(pending, "Ma bio", LATER)).toBeNull();
  });

  it("vider la bio quand elle existe → efface tous les champs", () => {
    const applied: BioState = {
      bioToApply: "Ma bio",
      bioStatus: "applied",
      bioUpdatedAt: NOW,
      bioAppliedAt: NOW + 1000,
    };
    expect(computeBioPatch(applied, "   ", LATER)).toEqual({
      bioToApply: undefined,
      bioStatus: undefined,
      bioUpdatedAt: undefined,
      bioAppliedAt: undefined,
    });
  });

  it("vider une bio inexistante → no-op", () => {
    expect(computeBioPatch({}, "", NOW)).toBeNull();
  });
});

describe("bioStateLabel & isBioPending", () => {
  it("aucune bio → none / pas pending", () => {
    expect(bioStateLabel({})).toEqual({ key: "none", tone: "none" });
    // La phrase, elle, vit dans le catalogue — dans les deux langues.
    expect(fr.bioState.none).toBe("Aucune bio définie");
    expect(en.bioState.none).toBe("No bio set");
    expect(isBioPending({})).toBe(false);
  });

  it("to_apply → pending", () => {
    const s: BioState = { bioToApply: "x", bioStatus: "to_apply" };
    expect(bioStateLabel(s)).toEqual({ key: "pending", tone: "pending" });
    expect(fr.bioState.pending).toBe("En attente d'application");
    expect(isBioPending(s)).toBe(true);
  });

  it("applied → applied / pas pending", () => {
    const s: BioState = { bioToApply: "x", bioStatus: "applied" };
    expect(bioStateLabel(s)).toEqual({ key: "applied", tone: "applied" });
    expect(fr.bioState.applied).toBe("Appliquée");
    expect(isBioPending(s)).toBe(false);
  });
});

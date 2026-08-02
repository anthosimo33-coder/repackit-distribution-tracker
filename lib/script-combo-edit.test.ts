import { describe, it, expect } from "vitest";
import { canEditScriptCombo, SCRIPT_COMBO_SLOTS } from "./script-combo-edit";

describe("canEditScriptCombo — éditable TANT QU'AUCUN lien de publication", () => {
  it("OK tant que pas publié (postedAt null / undefined)", () => {
    // Le statut n'entre PLUS en compte : todo, in_progress, video_submitted,
    // to_publish… → tous éditables tant qu'aucune cible n'est publiée.
    expect(canEditScriptCombo({ postedAt: null })).toBe(true);
    expect(canEditScriptCombo({ postedAt: undefined })).toBe(true);
  });

  it("KO dès qu'un lien de publication existe (postedAt renseigné)", () => {
    expect(canEditScriptCombo({ postedAt: 1_700_000_000_000 })).toBe(false);
    expect(canEditScriptCombo({ postedAt: 1 })).toBe(false);
    // 0 = timestamp epoch = publié (valeur non-null) → verrouillé (défensif).
    expect(canEditScriptCombo({ postedAt: 0 })).toBe(false);
  });
});

describe("SCRIPT_COMBO_SLOTS", () => {
  it("hook / flux / cta", () => {
    expect([...SCRIPT_COMBO_SLOTS]).toEqual(["hook", "flux", "cta"]);
  });
});

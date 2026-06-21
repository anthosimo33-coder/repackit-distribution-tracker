import { describe, it, expect } from "vitest";
import {
  isComboStatusEditable,
  canEditScriptCombo,
  SCRIPT_COMBO_SLOTS,
} from "./script-combo-edit";

describe("isComboStatusEditable", () => {
  it("éditable avant soumission : todo / in_progress", () => {
    expect(isComboStatusEditable("todo")).toBe(true);
    expect(isComboStatusEditable("in_progress")).toBe(true);
  });

  it("verrouillé dès soumission/publication", () => {
    for (const s of [
      "video_submitted",
      "video_rejected",
      "to_publish",
      "published",
      "paid",
      "submitted", // legacy
      "validated",
      "rejected",
    ]) {
      expect(isComboStatusEditable(s)).toBe(false);
    }
  });
});

describe("canEditScriptCombo", () => {
  it("OK si statut pré-soumission ET jamais édité", () => {
    expect(canEditScriptCombo({ status: "todo", editedOnce: false })).toBe(true);
    expect(canEditScriptCombo({ status: "in_progress", editedOnce: false })).toBe(
      true,
    );
  });

  it("KO si déjà édité (verrou une seule fois), même statut éditable", () => {
    expect(canEditScriptCombo({ status: "todo", editedOnce: true })).toBe(false);
    expect(
      canEditScriptCombo({ status: "in_progress", editedOnce: true }),
    ).toBe(false);
  });

  it("KO si publié/soumis, même jamais édité", () => {
    expect(canEditScriptCombo({ status: "published", editedOnce: false })).toBe(
      false,
    );
    expect(
      canEditScriptCombo({ status: "video_submitted", editedOnce: false }),
    ).toBe(false);
  });
});

describe("SCRIPT_COMBO_SLOTS", () => {
  it("hook / flux / cta", () => {
    expect([...SCRIPT_COMBO_SLOTS]).toEqual(["hook", "flux", "cta"]);
  });
});

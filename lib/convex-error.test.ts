import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { convexErrorCode, convexErrorMessage } from "./convex-error";
import { ERR } from "../convex/errorCodes";

describe("convexErrorMessage", () => {
  it("surface le message métier d'une ConvexError (data string)", () => {
    const e = new ConvexError("Mot-clé « x » déjà utilisé par @y.");
    expect(convexErrorMessage(e)).toBe("Mot-clé « x » déjà utilisé par @y.");
  });

  it("retombe sur le fallback pour une ConvexError dont data n'est pas une string", () => {
    const e = new ConvexError({ code: "NOPE" });
    expect(convexErrorMessage(e, "Erreur")).toBe("Erreur");
  });

  it("surface le message d'une charge STRUCTURÉE (code + message)", () => {
    const e = new ConvexError({
      code: ERR.PUBLISHED_AT_BEFORE_CREATION,
      message: "La date de publication (…) précède la création (…).",
    });
    expect(convexErrorMessage(e, "Erreur")).toBe(
      "La date de publication (…) précède la création (…).",
    );
  });
});

describe("convexErrorCode — brancher sur le CODE, jamais sur le texte", () => {
  it("rend le code d'une charge structurée", () => {
    const e = new ConvexError({
      code: ERR.PUBLISHED_AT_BEFORE_CREATION,
      message: "peu importe",
    });
    expect(convexErrorCode(e)).toBe(ERR.PUBLISHED_AT_BEFORE_CREATION);
  });

  it("le code SURVIT à une reformulation ou une traduction du message", () => {
    // C'est tout l'objet du désamorçage : AdminPublishForm branchait sur
    // /précède la\s+création/i. Traduire le message cassait la régularisation
    // de date en silence. Ici, le même code sort de trois formulations.
    for (const message of [
      "La date de publication (…) précède la création (…).",
      "Publication date (…) precedes the assignment's creation (…).",
      "",
    ]) {
      const e = new ConvexError({
        code: ERR.PUBLISHED_AT_BEFORE_CREATION,
        message,
      });
      expect(convexErrorCode(e)).toBe(ERR.PUBLISHED_AT_BEFORE_CREATION);
    }
  });

  it("rend null quand l'erreur ne porte pas de code", () => {
    expect(convexErrorCode(new ConvexError("message simple"))).toBe(null);
    expect(convexErrorCode(new Error("boom"))).toBe(null);
    expect(convexErrorCode(undefined)).toBe(null);
  });

  it("retombe sur le fallback pour une Error standard (message brut masqué)", () => {
    const e = new Error("[Request ID: abc] Server Error");
    expect(convexErrorMessage(e, "Erreur")).toBe("Erreur");
  });

  it("retombe sur le fallback pour une valeur non-Error", () => {
    expect(convexErrorMessage("boom", "Erreur")).toBe("Erreur");
    expect(convexErrorMessage(undefined)).toBe("Une erreur est survenue.");
  });
});

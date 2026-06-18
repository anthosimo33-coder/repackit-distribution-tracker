import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { convexErrorMessage } from "./convex-error";

describe("convexErrorMessage", () => {
  it("surface le message métier d'une ConvexError (data string)", () => {
    const e = new ConvexError("Mot-clé « x » déjà utilisé par @y.");
    expect(convexErrorMessage(e)).toBe("Mot-clé « x » déjà utilisé par @y.");
  });

  it("retombe sur le fallback pour une ConvexError dont data n'est pas une string", () => {
    const e = new ConvexError({ code: "NOPE" });
    expect(convexErrorMessage(e, "Erreur")).toBe("Erreur");
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

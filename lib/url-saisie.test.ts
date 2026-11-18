import { describe, expect, it } from "vitest";
import { urlSaisie } from "./url-saisie";

describe("urlSaisie", () => {
  it("ajoute https:// à une adresse tapée sans schéma", () => {
    expect(urlSaisie("www.tiktok.com/@kellyszcretacc")).toBe(
      "https://www.tiktok.com/@kellyszcretacc",
    );
    expect(urlSaisie("  instagram.com/mon_compte  ")).toBe(
      "https://instagram.com/mon_compte",
    );
  });

  it("garde une adresse qui a déjà son schéma", () => {
    expect(urlSaisie("https://www.tiktok.com/@a")).toBe("https://www.tiktok.com/@a");
    expect(urlSaisie("HTTP://tiktok.com/@a")).toBe("HTTP://tiktok.com/@a");
  });

  it("rend undefined pour un champ vide", () => {
    expect(urlSaisie("")).toBeUndefined();
    expect(urlSaisie("   ")).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { getCreatorTools } from "./creator-tools";

const SUBTITLES_URL = "https://sous-titre-editeur.vercel.app/";
const CARROUSEL_URL = "https://carrouselstudio.vercel.app/";

describe("getCreatorTools — outils figés par projet", () => {
  it("snytch → Sous-titres + Carrousel Studio (dans cet ordre)", () => {
    const tools = getCreatorTools("snytch");
    expect(tools.map((t) => t.labelKey)).toEqual([
      "tools.subtitles",
      "tools.carousel",
    ]);
    expect(tools.map((t) => t.url)).toEqual([SUBTITLES_URL, CARROUSEL_URL]);
  });

  it("repackit → Sous-titres seul", () => {
    const tools = getCreatorTools("repackit");
    expect(tools.map((t) => t.labelKey)).toEqual(["tools.subtitles"]);
    expect(tools[0]?.url).toBe(SUBTITLES_URL);
  });

  it("projet sans outils (slug inconnu) → liste vide", () => {
    expect(getCreatorTools("e2e-test")).toEqual([]);
    expect(getCreatorTools("")).toEqual([]);
    expect(getCreatorTools("autre")).toEqual([]);
  });

  it("toutes les URL d'outils sont absolues (liens externes)", () => {
    for (const slug of ["snytch", "repackit"]) {
      for (const tool of getCreatorTools(slug)) {
        expect(tool.url).toMatch(/^https:\/\//);
      }
    }
  });
});

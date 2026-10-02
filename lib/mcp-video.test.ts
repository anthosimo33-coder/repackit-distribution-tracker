import { describe, it, expect } from "vitest";
import { base64, instantTexte, instantsDeLaVideo, lireVignettes, urlVignette } from "../convex/mcpVideo";

/**
 * `regarder_video` : Claude voit des IMAGES CLÉS d'une vidéo soumise. Ce qui
 * compte : le hook est regardé (les 3 premières secondes), la fin aussi (le CTA),
 * l'encodage est exact sans `Buffer`, et une image absente est DITE, jamais
 * remplacée.
 */
describe("les instants regardés", () => {
  it("une vidéo de 23,4 s : le hook trois fois, puis milieu, trois quarts, fin", () => {
    expect(instantsDeLaVideo(23.4)).toEqual([0.3, 1.5, 3, 11.7, 17.5, 22.6]);
  });

  it("une vidéo courte : jamais au-delà de la fin, jamais deux images à moins d'une demi-seconde", () => {
    // 4,2 s : milieu 2,1 ; trois quarts 3,1 et fin 3,4 trop près de 3 s → écartés.
    expect(instantsDeLaVideo(4.2)).toEqual([0.3, 1.5, 2.1, 3]);
  });

  it("durée inconnue : des instants fixes", () => {
    expect(instantsDeLaVideo(null)).toEqual([0.5, 1.5, 3, 6, 10, 15]);
    expect(instantsDeLaVideo(-1)).toEqual([0.5, 1.5, 3, 6, 10, 15]);
  });

  it("l'URL publique de la vignette, et l'instant lisible", () => {
    expect(urlVignette("6b9e68b07dfee8cc2d116e4c51d6a957", 1.5)).toBe(
      "https://videodelivery.net/6b9e68b07dfee8cc2d116e4c51d6a957/thumbnails/thumbnail.jpg?time=1.5s&height=480",
    );
    expect(instantTexte(0.3)).toBe("0,3 s");
    expect(instantTexte(17.6)).toBe("18 s");
    expect(instantTexte(65.2)).toBe("1 min 05 s");
  });
});

describe("base64 sans Buffer", () => {
  it("identique à l'encodage de référence, pour 0, 1 et 2 octets de reste", () => {
    for (const texte of ["", "a", "ab", "abc", "Jarvia ✓ — vidéo", "\u0000ÿ\u0080"]) {
      const octets = new TextEncoder().encode(texte);
      expect(base64(octets)).toBe(Buffer.from(octets).toString("base64"));
    }
    const binaire = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);
    expect(base64(binaire)).toBe(Buffer.from(binaire).toString("base64"));
  });
});

describe("lire les vignettes", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const reponse = (corps: Uint8Array, type: string, status = 200) =>
    new Response(corps.slice().buffer as ArrayBuffer, { status, headers: { "content-type": type } });

  it("les images lues, dans l'ordre des instants ; les autres comptées en échec", async () => {
    const vues: string[] = [];
    const fetchFaux = (async (url: string) => {
      vues.push(url);
      if (url.includes("time=10s")) return reponse(new Uint8Array(), "application/json", 404);
      if (url.includes("time=15s")) return reponse(new TextEncoder().encode("<html>"), "text/html");
      if (url.includes("time=6s")) throw new Error("réseau");
      return reponse(jpeg, "image/jpeg; charset=binary");
    }) as unknown as typeof fetch;
    const r = await lireVignettes("uid-abc", [0.5, 1.5, 6, 10, 15], fetchFaux);
    expect(vues).toHaveLength(5);
    expect(r.vignettes.map((v) => v.secondes)).toEqual([0.5, 1.5]);
    expect(r.vignettes[0]).toEqual({ secondes: 0.5, data: Buffer.from(jpeg).toString("base64"), mimeType: "image/jpeg" });
    expect(r.echecs).toEqual([6, 10, 15]);
  });
});

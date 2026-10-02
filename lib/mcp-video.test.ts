import { describe, it, expect } from "vitest";
import {
  base64,
  ditEntre,
  instantTexte,
  instantsDeLaVideo,
  langueTranscription,
  lireVignettes,
  lireVtt,
  transcription,
  urlVignette,
} from "../convex/mcpVideo";

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

/**
 * Ce qui est DIT : la transcription automatique de Cloudflare Stream, en WebVTT.
 * Le format réel : en-tête, numéros de bloc, horodatages au millième, balises.
 */
describe("transcription", () => {
  const VTT = [
    "WEBVTT",
    "",
    "1",
    "00:00:00.000 --> 00:00:02.480",
    "Personne ne regarde le dos",
    "de ses cartes Pokémon.",
    "",
    "2",
    "00:00:02.480 --> 00:00:06.120 align:start position:0%",
    "<c>Moi je la scanne</c> avec l'appli",
    "",
    "3",
    "00:00:19.040 --> 00:00:22.900",
    "Le lien est dans ma bio.",
    "",
  ].join("\r\n");

  it("lit les répliques, multi-lignes, balises et réglages retirés", () => {
    expect(lireVtt(VTT)).toEqual([
      { debut: 0, fin: 2.48, texte: "Personne ne regarde le dos de ses cartes Pokémon." },
      { debut: 2.48, fin: 6.12, texte: "Moi je la scanne avec l'appli" },
      { debut: 19.04, fin: 22.9, texte: "Le lien est dans ma bio." },
    ]);
    expect(lireVtt("WEBVTT\n\n01:02:03.5 --> 01:02:04.000\nAu-delà d'une heure")).toEqual([
      { debut: 3723.5, fin: 3724, texte: "Au-delà d'une heure" },
    ]);
    expect(lireVtt("WEBVTT\n\nNOTE rien\n")).toEqual([]);
  });

  it("ce qui est dit sur une fenêtre : le hook au début, le CTA à la fin", () => {
    const r = lireVtt(VTT);
    expect(ditEntre(r, 0, 4)).toBe("Personne ne regarde le dos de ses cartes Pokémon. Moi je la scanne avec l'appli");
    expect(ditEntre(r, 23.4 - 6, 23.4 + 1)).toBe("Le lien est dans ma bio.");
    expect(ditEntre(r, 7, 18)).toBe("");
  });

  it("la langue de la créatrice, sinon le français", () => {
    expect(langueTranscription("pt-BR")).toBe("pt");
    expect(langueTranscription("en")).toBe("en");
    expect(langueTranscription("es_ES")).toBe("es");
    expect(langueTranscription("sr")).toBe("fr");
    expect(langueTranscription(null)).toBe("fr");
  });

  it("chaque état : lancée si absente, en cours, erreur, prête, indisponible", async () => {
    const lances: string[] = [];
    const api = (pistes: { language: string; status: "ready" | "inprogress" | "error" | null }[]) => ({
      lister: async () => pistes,
      lancer: async () => {
        lances.push("fr");
      },
      vtt: async () => VTT,
    });
    expect(await transcription(api([{ language: "en", status: "ready" }]), "fr")).toEqual({ etat: "lancee" });
    expect(lances).toEqual(["fr"]);
    expect(await transcription(api([{ language: "fr", status: "inprogress" }]), "fr")).toEqual({ etat: "en_cours" });
    expect((await transcription(api([{ language: "fr", status: "error" }]), "fr")).etat).toBe("erreur");
    const prete = await transcription(api([{ language: "fr", status: "ready" }]), "fr");
    expect(prete.etat === "prete" ? prete.repliques.length : -1).toBe(3);
    expect(lances).toHaveLength(1);
    expect(await transcription(null, "fr")).toEqual({ etat: "indisponible" });
    const panne = await transcription({ lister: async () => { throw new Error("HTTP 403"); }, lancer: async () => null, vtt: async () => "" }, "fr");
    expect(panne).toEqual({ etat: "erreur", message: "HTTP 403" });
  });
});

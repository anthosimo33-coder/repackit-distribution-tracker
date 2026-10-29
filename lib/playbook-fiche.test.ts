/**
 * Règles de la FICHE de playbook (`convex/playbookFiche.ts`) : ce qu'une saisie
 * change vraiment, la clé d'un post tirée de son lien, et le dédoublonnage.
 *
 * Les liens ont la forme de la prod (paramètres de partage, deux comptes pour une
 * même vidéo) : c'est là que se cachent les pièges, pas dans une URL nue.
 */
import { describe, it, expect } from "vitest";
import {
  clePost,
  dateDeCle,
  dedoublonnerPosts,
  diffFiche,
  fenetreDePublication,
  motifValide,
  texteValide,
  titreValide,
  MAX_TEXTE,
  MAX_TITRE,
  type ContenuFiche,
} from "../convex/playbookFiche";

const fiche: ContenuFiche = {
  titre: "« La nouvelle personne »",
  statut: "en_test",
  recette: "Hook « trois jours que je trouve mon mec bizarre », flux LA NOUVELLE PERSONNE.",
  preuves: "Combo 5,2 × la campagne sur 12 posts.",
  contrePreuve: "",
  regles: "Garder les trois légendes telles quelles.",
  aTester: "",
};

describe("diffFiche", () => {
  it("ne retient que les champs qui changent, avec leur valeur d'avant", () => {
    const d = diffFiche(fiche, { statut: "prouve", recette: fiche.recette, aTester: "Le même flux sur BLUSH." });
    expect(d.champs).toEqual(["statut", "aTester"]);
    expect(d.avant).toEqual({ statut: "en_test", aTester: "" });
    expect(d.apres).toEqual({ statut: "prouve", aTester: "Le même flux sur BLUSH." });
  });

  it("une saisie identique ne change rien : pas d'écriture, pas de ligne au journal", () => {
    expect(diffFiche(fiche, { ...fiche }).champs).toEqual([]);
    expect(diffFiche(fiche, {}).champs).toEqual([]);
  });

  it("vider un champ est un changement", () => {
    const d = diffFiche(fiche, { regles: "" });
    expect(d.champs).toEqual(["regles"]);
    expect(d.avant.regles).toBe(fiche.regles);
  });

  it("range les champs dans l'ordre de l'écran, quel que soit l'ordre de la saisie", () => {
    expect(diffFiche(fiche, { aTester: "x", titre: "Autre", preuves: "y" }).champs).toEqual(["titre", "preuves", "aTester"]);
  });
});

describe("validation des saisies", () => {
  it("titre : nettoyé, refusé vide ou trop long", () => {
    expect(titreValide("  L'ex va revenir  ")).toBe("L'ex va revenir");
    expect(titreValide("   ")).toBeNull();
    expect(titreValide("x".repeat(MAX_TITRE + 1))).toBeNull();
    expect(titreValide("x".repeat(MAX_TITRE))).toHaveLength(MAX_TITRE);
  });

  it("texte : vide accepté (champ effacé), refusé au-delà de la limite", () => {
    expect(texteValide("  \n")).toBe("");
    expect(texteValide("x".repeat(MAX_TEXTE + 1))).toBeNull();
  });

  it("motif : absent ou blanc = pas de motif", () => {
    expect(motifValide(undefined)).toBeNull();
    expect(motifValide("  ")).toBeNull();
    expect(motifValide(" A/B tour 2 lu à J+7 ")).toBe("A/B tour 2 lu à J+7");
  });
});

describe("clePost", () => {
  it("TikTok : l'id de la vidéo, quels que soient le compte et les paramètres de partage", () => {
    const surKelly = "https://www.tiktok.com/@thekellychapters_/video/7680276052102401313?_r=1&_t=ZN-99Ll1tvhOVS";
    const surLeydie = "https://www.tiktok.com/@thekellychapters_/video/7680276052102401313?_r=1&_t=ZN-99LkRc4osQl";
    expect(clePost(surKelly)).toBe("tiktok:7680276052102401313");
    expect(clePost(surLeydie)).toBe(clePost(surKelly));
  });

  it("Instagram : le shortcode, reel ou post", () => {
    expect(clePost("https://www.instagram.com/reel/DeXSTe2IFq9/?exln=czlkOW0wNnM4OXJw")).toBe("instagram:DeXSTe2IFq9");
    expect(clePost("https://www.instagram.com/p/DerS2vEo968/")).toBe("instagram:DerS2vEo968");
    expect(clePost("https://www.instagram.com/kelly.dgtl/reel/Dcl2Zy1MM27/")).toBe("instagram:Dcl2Zy1MM27");
  });

  it("refuse ce qui ne désigne pas une vidéo : lien court, profil, autre site", () => {
    expect(clePost("https://vm.tiktok.com/ZN-99Ll1tvhOVS/")).toBeNull();
    expect(clePost("https://www.tiktok.com/@kelly.snytch")).toBeNull();
    expect(clePost("https://www.instagram.com/kelly.dgtl/")).toBeNull();
    expect(clePost("https://snytch.co")).toBeNull();
    expect(clePost("")).toBeNull();
  });
});

describe("dateDeCle et fenêtre de recherche", () => {
  it("lit la date de mise en ligne dans l'id TikTok", () => {
    // Le post de Kelly à 833 400 vues, publié le 31/08/2026 au soir.
    expect(new Date(dateDeCle("tiktok:7680276052102401313")!).toISOString()).toBe("2026-08-31T19:13:36.000Z");
  });

  it("lit une date plausible dans un shortcode Instagram", () => {
    const d = dateDeCle("instagram:DeXSTe2IFq9")!;
    expect(d).toBeGreaterThan(Date.UTC(2026, 0, 1));
    expect(d).toBeLessThan(Date.UTC(2027, 0, 1));
  });

  it("rend null sur une clé inconnue", () => {
    expect(dateDeCle("youtube:abc")).toBeNull();
    expect(dateDeCle("tiktok")).toBeNull();
  });

  it("la fenêtre couvre une confirmation tardive, pas une publication de la veille", () => {
    const mise = Date.UTC(2026, 7, 31, 19, 13);
    const f = fenetreDePublication(mise);
    expect(f.du).toBeLessThan(mise);
    expect(f.au - mise).toBe(10 * 86_400_000);
    expect(mise - f.du).toBe(86_400_000);
  });
});

describe("dedoublonnerPosts", () => {
  it("une vidéo comptée sur deux comptes ne sort qu'une fois, avec ses vues les plus hautes", () => {
    // La seconde publication a un relevé plus ancien : elle compte moins de vues.
    const posts = [
      { id: "b", cle: "tiktok:7680276052102401313", vues: 790_100 },
      { id: "a", cle: "tiktok:7680276052102401313", vues: 833_400 },
      { id: "c", cle: "tiktok:7693941212864154912", vues: 376_300 },
      { id: "d", cle: null, vues: 12_000 },
    ];
    const out = dedoublonnerPosts(posts);
    expect(out.map((p) => p.id)).toEqual(["a", "c", "d"]);
  });

  it("garde les posts sans vues relevées, en dernier", () => {
    const out = dedoublonnerPosts([
      { id: "x", cle: "instagram:DeXSTe2IFq9", vues: null },
      { id: "y", cle: "tiktok:1", vues: 1_454 },
    ]);
    expect(out.map((p) => p.id)).toEqual(["y", "x"]);
  });
});

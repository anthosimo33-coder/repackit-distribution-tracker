import { describe, it, expect } from "vitest";
import {
  categorieDepuis,
  cleDeLienPost,
  colonneDepuis,
  designer,
  jourDepuis,
  montantDepuis,
  jourTexte,
  montantTexte,
  plageDepuis,
  plageTexte,
  plateformeDepuis,
  plierTexte,
  roleBriqueDepuis,
  typeContenuDepuis,
  usageDepuis,
} from "../convex/mcpWriteArgs";

/**
 * Outils MCP d'écriture — ce que Claude écrit (les libellés de l'écran, tels
 * qu'il les a lus dans l'outil `compta`) devient le code que les cœurs attendent.
 * Entrées à la forme de la prod : accents, majuscules, montants à la française.
 */
describe("arguments des outils d'écriture", () => {
  it("un usage s'écrit comme à l'écran, ou par son code", () => {
    expect(usageDepuis("Paiement créatrices")).toBe("creators");
    expect(usageDepuis("paiement createurs")).toBe("creators");
    expect(usageDepuis("Mise de côté (impôts, URSSAF)")).toBe("provision");
    expect(usageDepuis("Charges de l'activité")).toBe("business");
    expect(usageDepuis("À récupérer (bloqué, en transit)")).toBe("recover");
    expect(usageDepuis("rémunération")).toBe("pay");
    expect(usageDepuis("business")).toBe("business");
    expect(usageDepuis("Autre")).toBe("other");
  });

  it("un libellé inconnu n'est jamais deviné", () => {
    expect(usageDepuis("paiement")).toBeNull();
    expect(usageDepuis("créatrices et charges")).toBeNull();
    expect(usageDepuis(42)).toBeNull();
    expect(categorieDepuis("marketing")).toBeNull();
    expect(colonneDepuis("revenus")).toBeNull();
  });

  it("catégories et colonnes, avec ou sans accents", () => {
    expect(categorieDepuis("Publicité")).toBe("ads");
    expect(categorieDepuis("hébergement")).toBe("hosting");
    expect(categorieDepuis("SCANS")).toBe("scans");
    expect(categorieDepuis("tools")).toBe("tools");
    expect(colonneDepuis("Frais Whop")).toBe("fees");
    expect(colonneDepuis("CA brut")).toBe("gross");
    expect(colonneDepuis("mouvements internes")).toBe("internal");
  });

  it("un montant à la française ou en nombre", () => {
    expect(montantDepuis(1337.49)).toBe(1337.49);
    expect(montantDepuis("1 337,49")).toBe(1337.49);
    expect(montantDepuis("1 337,49 €")).toBe(1337.49);
    expect(montantDepuis("2325.49")).toBe(2325.49);
    expect(montantDepuis("douze")).toBeNull();
    expect(montantDepuis("")).toBeNull();
    expect(montantDepuis(Number.NaN)).toBeNull();
  });

  it("un jour AAAA-MM-JJ, aujourd'hui par défaut", () => {
    expect(jourDepuis(undefined, "2026-10-02")).toBe("2026-10-02");
    expect(jourDepuis("2026-09-09", "2026-10-02")).toBe("2026-09-09");
    expect(jourDepuis("09/09/2026", "2026-10-02")).toBeNull();
  });

  it("le journal écrit les montants sans dépendre de la locale", () => {
    expect(montantTexte(1337.49, "eur")).toBe("1337,49 EUR");
    expect(montantTexte(31.24, "usd")).toBe("31,24 USD");
    expect(plierTexte("  Antho   Banque ")).toBe("antho banque");
    expect(jourTexte("2025-09-05")).toBe("05/09/2025");
  });
});

/**
 * Missions, scripts, publications — Claude désigne par le NOM qu'il a lu (nom
 * complet de créatrice, handle suffixé, libellé de brique), jamais par un id.
 */
describe("désigner par le nom", () => {
  const creatrices = [{ name: "Kelly Martin" }, { name: "Kelly-Ann Dubois" }, { name: "Léa Fontaine" }, { name: "Lea" }];
  const nom = (c: { name: string }) => c.name;

  it("le nom exact l'emporte, accents et casse ignorés — même quand il est aussi un morceau d'un autre", () => {
    expect(designer(creatrices, nom, "léa fontaine")).toEqual({ ok: true, item: creatrices[2] });
    // « Lea » est à la fois un nom exact et un morceau de « Léa Fontaine ».
    expect(designer(creatrices, nom, "LEA")).toEqual({ ok: true, item: creatrices[3] });
  });

  it("un morceau qui ne désigne qu'UN élément suffit", () => {
    expect(designer(creatrices, nom, "dubois")).toEqual({ ok: true, item: creatrices[1] });
  });

  it("deux candidats ne sont jamais départagés au hasard", () => {
    const r = designer(creatrices, nom, "kelly");
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.candidats.map(nom)).toEqual(["Kelly Martin", "Kelly-Ann Dubois"]);
  });

  it("rien, ou une demande vide, ne désigne rien", () => {
    expect(designer(creatrices, nom, "Zoé")).toEqual({ ok: false, candidats: [] });
    expect(designer(creatrices, nom, "   ")).toEqual({ ok: false, candidats: [] });
  });

  it("un handle se désigne avec ou sans @, suffixe compris", () => {
    const comptes = [{ handle: "@kelly.martin.fr" }, { handle: "@kelly.martin.us" }];
    expect(designer(comptes, (c) => c.handle, "kelly.martin.us")).toEqual({ ok: true, item: comptes[1] });
    expect(designer(comptes, (c) => c.handle, "@KELLY.MARTIN.FR")).toEqual({ ok: true, item: comptes[0] });
    expect(designer(comptes, (c) => c.handle, "@kelly.martin").ok).toBe(false);
  });
});

describe("plage horaire", () => {
  it("les écritures courantes d'une plage", () => {
    expect(plageDepuis("21h-23h")).toEqual({ startMin: 1260, endMin: 1380 });
    expect(plageDepuis("21:30-23:00")).toEqual({ startMin: 1290, endMin: 1380 });
    expect(plageDepuis("de 18h à 20h30")).toEqual({ startMin: 1080, endMin: 1230 });
    expect(plageDepuis("9h – 11h")).toEqual({ startMin: 540, endMin: 660 });
  });

  it("les créneaux de l'écran par leur nom", () => {
    expect(plageDepuis("soir")).toEqual({ startMin: 1260, endMin: 1380 });
    expect(plageDepuis("Après-midi")).toEqual({ startMin: 900, endMin: 1020 });
    expect(plageDepuis("midi")).toEqual({ startMin: 660, endMin: 780 });
  });

  it("« aucune » efface ; une plage inversée ou absurde n'est jamais devinée", () => {
    expect(plageDepuis("aucune")).toBe("aucune");
    expect(plageDepuis("23h-21h")).toBeNull();
    expect(plageDepuis("21h75-23h")).toBeNull();
    expect(plageDepuis("25h-26h")).toBeNull();
    expect(plageDepuis("ce soir tard")).toBeNull();
    expect(plageDepuis(21)).toBeNull();
  });

  it("la plage relue au journal", () => {
    expect(plageTexte({ startMin: 1290, endMin: 1380 })).toBe("21h30-23h");
  });
});

describe("plateformes, contenu, rôles", () => {
  it("une plateforme écrite comme à l'écran ou en abrégé", () => {
    expect(plateformeDepuis("TikTok")).toBe("TikTok");
    expect(plateformeDepuis("insta")).toBe("Instagram");
    expect(plateformeDepuis("YT")).toBe("YouTube");
    expect(plateformeDepuis("snapchat")).toBe("Snapchat");
    expect(plateformeDepuis("Twitter")).toBeNull();
  });

  it("promo ou warmup, sans rien deviner d'autre", () => {
    expect(typeContenuDepuis("Promo")).toBe("promo");
    expect(typeContenuDepuis("chauffe")).toBe("warmup");
    expect(typeContenuDepuis("pub")).toBeNull();
    expect(roleBriqueDepuis("Hook")).toBe("hook");
    expect(roleBriqueDepuis("CTA")).toBe("cta");
    expect(roleBriqueDepuis("notif")).toBeNull();
  });
});

describe("retrouver un post par son lien", () => {
  it("TikTok : l'id de la vidéo, quels que soient les paramètres", () => {
    const a = cleDeLienPost("https://www.tiktok.com/@kelly.martin.fr/video/7556123456789012345?is_from_webapp=1&sender_device=pc");
    expect(a).toBe("tiktok:7556123456789012345");
    expect(cleDeLienPost("https://tiktok.com/@kelly.martin.fr/video/7556123456789012345")).toBe(a);
    expect(cleDeLienPost("https://www.tiktok.com/@kelly.martin.fr/video/7556123456789012399")).not.toBe(a);
  });

  it("Instagram : /reel/ et /p/ désignent le même post", () => {
    const k = cleDeLienPost("https://www.instagram.com/reel/DPa1B2c3D4e/?igsh=MWx0");
    expect(k).toBe("instagram:DPa1B2c3D4e");
    expect(cleDeLienPost("https://instagram.com/p/DPa1B2c3D4e/")).toBe(k);
    expect(cleDeLienPost("https://www.instagram.com/kelly.martin.fr/reel/DPa1B2c3D4e/")).toBe(k);
  });

  it("YouTube : shorts, watch et youtu.be", () => {
    const k = cleDeLienPost("https://www.youtube.com/shorts/aB3dE5fG7hI");
    expect(k).toBe("youtube:aB3dE5fG7hI");
    expect(cleDeLienPost("https://youtu.be/aB3dE5fG7hI?si=x")).toBe(k);
    expect(cleDeLienPost("https://m.youtube.com/watch?v=aB3dE5fG7hI&t=3")).toBe(k);
  });

  it("autre lien : l'adresse sans paramètres ni / final ; pas un lien : null", () => {
    expect(cleDeLienPost("https://www.facebook.com/reel/1234567890/?mibextid=x")).toBe("facebook.com/reel/1234567890");
    expect(cleDeLienPost("pas un lien")).toBeNull();
  });
});

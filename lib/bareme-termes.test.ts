import { describe, expect, it } from "vitest";
import {
  appliquerChangements,
  differences,
  empreinteTermes,
  termesDe,
  termesDepuisEmpreinte,
  termesLisibles,
  toucheLesTermesFiges,
  versChampsPricing,
} from "../convex/baremeTermes";

/** Un barème de la forme de la prod (Snytch, 24/11) : fixe seul, en euros. */
const LORENA = {
  name: "Créateur Lorena 🇫🇷",
  montantFixe: 300,
  nbVideosCible: 60,
  tauxCPM: 0,
};
const KELLY = { name: "Kelly Novembre", montantFixe: 400, nbVideosCible: 60, tauxCPM: 1, minVuesParVideo: 200 };

describe("termes d'un barème — outils MCP creer_bareme / modifier_bareme", () => {
  it("lit un barème sans condition : seuil et minimum à 0, jamais absents", () => {
    expect(termesDe(LORENA)).toEqual({
      nom: "Créateur Lorena 🇫🇷",
      fixe: 300,
      nbVideos: 60,
      cpm: 0,
      seuilVuesMois: 0,
      minVuesParVideo: 0,
    });
  });

  it("ne change QUE ce qui est demandé", () => {
    const apres = appliquerChangements(termesDe(KELLY), { cpm: 1.25 });
    expect(apres).toEqual({ ...termesDe(KELLY), cpm: 1.25 });
    // Le minimum déjà posé reste là.
    expect(apres.minVuesParVideo).toBe(200);
  });

  it("vers l'écriture : seuil et minimum TOUJOURS envoyés, 0 compris", () => {
    // Absents, validatePricingFields les effacerait : changer le CPM de Kelly
    // ferait tomber son minimum.
    const champs = versChampsPricing(appliquerChangements(termesDe(KELLY), { cpm: 1.25 }));
    expect(champs).toEqual({
      name: "Kelly Novembre",
      montantFixe: 400,
      nbVideosCible: 60,
      tauxCPM: 1.25,
      seuilVuesFixe: 0,
      minVuesParVideo: 200,
    });
    expect("seuilVuesFixe" in champs && "minVuesParVideo" in champs).toBe(true);
  });

  it("l'empreinte se relit à l'identique, décimales et emoji compris", () => {
    const t = termesDe({ ...KELLY, tauxCPM: 1.1, seuilVuesFixe: 100_000 });
    expect(termesDepuisEmpreinte(empreinteTermes(t))).toEqual(t);
  });

  it("deux termes différents ⇒ deux empreintes différentes (defaire compare par elle)", () => {
    const a = termesDe(KELLY);
    expect(empreinteTermes(a)).not.toBe(empreinteTermes({ ...a, minVuesParVideo: 0 }));
    expect(empreinteTermes(a)).toBe(empreinteTermes(termesDe({ ...KELLY })));
  });

  it("dit ce qui change, terme par terme, et seulement ça", () => {
    const avant = termesDe(LORENA);
    const apres = appliquerChangements(avant, { minVuesParVideo: 200 });
    expect(differences(avant, apres, "eur")).toEqual(["minimum par vidéo : aucun → 200 vues"]);
    expect(differences(avant, avant, "eur")).toEqual([]);
  });

  it("renommer ne touche pas les termes figés ; le minimum, si", () => {
    const avant = termesDe(LORENA);
    expect(toucheLesTermesFiges(avant, appliquerChangements(avant, { nom: "Lorena FR" }))).toBe(false);
    expect(toucheLesTermesFiges(avant, appliquerChangements(avant, { minVuesParVideo: 200 }))).toBe(true);
  });

  it("en clair : fixe par vidéo, devise, et « aucun » pour ce qui n'existe pas", () => {
    const l = termesLisibles(termesDe(KELLY), "eur");
    expect(l.fixe).toBe("400 EUR pour 60 vidéos (6,67 EUR par vidéo)");
    expect(l.minimumParVideo).toBe("une vidéo touche son fixe à partir de 200 vues");
    expect(termesLisibles(termesDe(LORENA), "eur").minimumParVideo).toBe("aucun");
  });
});

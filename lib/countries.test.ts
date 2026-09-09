import { describe, it, expect } from "vitest";
import {
  COUNTRY_CODES,
  TREND_COUNTRY_CODES,
  countryFlag,
  countryLabel,
  countryName,
} from "./countries";
import {
  SUPPORTED_COUNTRIES,
  TREND_COUNTRIES,
  assertCountry,
} from "../convex/countries";

/**
 * DEUX LISTES DUPLIQUÉES, ET C'EST LA RÈGLE A6 QUI L'IMPOSE : un module
 * `convex/` ne peut pas importer `lib/`. Le seul filet possible est donc un
 * test — celui-ci. Sans lui, ajouter un pays côté serveur sans l'ajouter côté
 * écran donnerait un pays validé mais introuvable, et l'inverse un pays
 * proposé que le serveur refuse au clic sur « Enregistrer ».
 */
describe("listes de pays — serveur et écran en phase", () => {
  it("les 250 codes du PAYS CIBLÉ sont les mêmes des deux côtés", () => {
    expect([...COUNTRY_CODES]).toEqual([...SUPPORTED_COUNTRIES]);
    expect(COUNTRY_CODES).toHaveLength(250);
  });

  it("les pays du RADAR sont les mêmes des deux côtés, et restent DIX", () => {
    // Cette liste-ci ne décrit pas ce qu'on aimerait cibler : elle décrit ce que
    // la source de tendances sait servir. L'élargir proposerait des pays qui
    // répondent vide.
    expect([...TREND_COUNTRY_CODES]).toEqual([...TREND_COUNTRIES]);
    expect(TREND_COUNTRY_CODES).toHaveLength(10);
  });

  it("le Radar refuse un pays hors de SA liste, même s'il est ciblable", () => {
    // La Serbie est ciblable pour un compte depuis cet élargissement…
    expect(COUNTRY_CODES).toContain("RS");
    // …et reste refusée par le Radar, qui n'a pas de données pour elle.
    expect(() => assertCountry("RS")).toThrow(/non supporté/i);
    // Présence en regard : un pays de la liste Radar passe bien.
    expect(assertCountry("fr")).toBe("FR");
  });
});

describe("libellés de pays", () => {
  it("rend le drapeau et le nom français", () => {
    expect(countryLabel("RS")).toBe("🇷🇸 Serbie");
    expect(countryLabel("BA")).toBe("🇧🇦 Bosnie-Herzégovine");
    expect(countryLabel("FR")).toBe("🇫🇷 France");
  });

  it("normalise la casse et les espaces", () => {
    expect(countryLabel(" ch ")).toBe(countryLabel("CH"));
  });

  it("rend un code INCONNU tel quel, sans drapeau", () => {
    // Un code qu'on n'a pas écrit nous-mêmes se montre brut : l'habiller
    // laisserait croire qu'on l'a reconnu.
    expect(countryLabel("ZZ")).toBe("ZZ");
    expect(countryFlag("ZZ")).toBeNull();
    // Présence en regard : un code connu, lui, a bien son drapeau.
    expect(countryFlag("RS")).toBe("🇷🇸");
  });

  it("ne propose AUCUN pays disparu ni regroupement", () => {
    // « Yougoslavie » ou « Union européenne » proposés d'un clic dans un
    // sélecteur de 2026, ce serait une donnée fausse offerte par l'écran.
    for (const mort of ["YU", "SU", "DD", "AN", "CS", "ZR"]) {
      expect(COUNTRY_CODES, mort).not.toContain(mort);
    }
    for (const groupe of ["EU", "UN", "QO", "ZZ", "UK"]) {
      expect(COUNTRY_CODES, groupe).not.toContain(groupe);
    }
    // Présence en regard : le Kosovo, hors norme mais universellement employé,
    // est GARDÉ — la région est dans le parc.
    expect(COUNTRY_CODES).toContain("XK");
    expect(countryName("XK")).toBe("Kosovo");
  });

  it("aucun code absent, aucun doublon", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const c of COUNTRY_CODES) {
      expect(c, c).toMatch(/^[A-Z]{2}$/);
      // Chaque code doit avoir un NOM : un code qu'ICU ne connaît pas
      // s'afficherait comme lui-même dans le sélecteur.
      expect(countryName(c), c).not.toBe(c);
    }
  });
});

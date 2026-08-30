import { describe, it, expect } from "vitest";
import { countryLabel } from "./country-name";

/**
 * CODES PAYS → NOMS EN CLAIR.
 *
 * Whop rend `billing_address.country` en ISO 3166-1 alpha-2 — mesuré sur les 319
 * paiements couverts du 30/08 : onze valeurs, toutes de longueur 2. La doc de
 * l'API ne le spécifiait pas ; c'est l'observation qui tranche.
 *
 * La correspondance vient d'`Intl.DisplayNames`, adossé à ICU : aucune liste
 * écrite à la main à maintenir, et les territoires gardent leur identité — « RE »
 * est La Réunion et non la France, « MQ » la Martinique. Ils n'ont pas le même
 * marché que la métropole et doivent rester séparés.
 *
 * Un code inconnu s'affiche BRUT : mieux vaut « XK » qu'un vide, qui se lirait
 * comme une donnée manquante alors que le pays est bien là.
 */
describe("countryLabel", () => {
  it("traduit les onze codes réellement observés en prod", () => {
    expect(countryLabel("FR")).toBe("France");
    expect(countryLabel("CH")).toBe("Suisse");
    expect(countryLabel("BE")).toBe("Belgique");
    expect(countryLabel("CA")).toBe("Canada");
    expect(countryLabel("MA")).toBe("Maroc");
    expect(countryLabel("LU")).toBe("Luxembourg");
    expect(countryLabel("US")).toBe("États-Unis");
    expect(countryLabel("MC")).toBe("Monaco");
    expect(countryLabel("ID")).toBe("Indonésie");
  });

  it("les territoires restent DISTINCTS de la métropole", () => {
    // Exigence produit : La Réunion et la Martinique n'ont pas le même marché.
    expect(countryLabel("RE")).toBe("La Réunion");
    expect(countryLabel("MQ")).toBe("Martinique");
    expect(countryLabel("RE")).not.toBe(countryLabel("FR"));
    expect(countryLabel("MQ")).not.toBe(countryLabel("FR"));
  });

  it("un code inconnu s'affiche BRUT, jamais vide", () => {
    // Codes NON ATTRIBUÉS de la norme. Attention en choisissant l'exemple :
    // « XK » a l'air libre mais ICU le résout en « Kosovo » — vérifié.
    expect(countryLabel("QQ")).toBe("QQ");
    expect(countryLabel("ZY")).toBe("ZY");
  });

  it("une entrée mal formée ne fait pas planter l'écran", () => {
    // `Intl.DisplayNames.of` lève un RangeError sur « F », « FRA », « 12 ».
    expect(countryLabel("F")).toBe("F");
    expect(countryLabel("FRA")).toBe("FRA");
    expect(countryLabel("12")).toBe("12");
  });

  it("la casse de la donnée n'empêche pas la résolution", () => {
    // On stocke la valeur BRUTE de Whop ; si elle arrivait en minuscules un
    // jour, l'écran ne doit pas afficher « fr ».
    expect(countryLabel("fr")).toBe("France");
    expect(countryLabel(" fr ")).toBe("France");
  });

  it("absence de valeur → libellé explicite, pas une chaîne vide", () => {
    expect(countryLabel(null)).toBe("Pays non renseigné");
    expect(countryLabel(undefined)).toBe("Pays non renseigné");
    expect(countryLabel("")).toBe("Pays non renseigné");
  });
});

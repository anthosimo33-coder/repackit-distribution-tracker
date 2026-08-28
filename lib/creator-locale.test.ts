import { describe, it, expect } from "vitest";
import {
  normalizeCreatorLocale,
  localeOrDefault,
  normalizeLocale,
} from "../convex/locales";

/**
 * LA LANGUE D'UN CRÉATEUR — la règle qui casse silencieusement.
 *
 * Le français N'EST PAS STOCKÉ sur la fiche : `normalizeCreatorLocale("fr")`
 * rend `undefined`, donc `creators.locale` vaut « en » ou RIEN. Un filtre qui
 * comparerait la valeur brute devrait traiter l'ABSENCE comme du français.
 *
 * Et il se tromperait, parce qu'il existe un SECOND porteur : `setMyLocale`
 * écrit `users.locale` BRUT, sans passer par `normalizeCreatorLocale`. Une
 * créatrice qui bascule en français depuis son profil a donc « fr » écrit
 * EXPLICITEMENT — l'absence n'est plus le seul visage du français.
 *
 * D'où la règle que ces tests figent : on résout, puis on compare une valeur
 * concrète. Jamais une absence.
 */

/** Réplique EXACTE de convex/i18n.resolveCreatorLocale, sur des données nues. */
const resolve = (creator: { locale?: string }, user?: { locale?: string }) => {
  if (user && user.locale && user.locale.trim() !== "") return user.locale;
  const fiche = creator.locale;
  return fiche && fiche.trim() !== "" ? fiche : null;
};
/** Ce que sert `listCreators` : une langue CONCRÈTE, jamais null. */
const servie = (creator: { locale?: string }, user?: { locale?: string }) =>
  localeOrDefault(resolve(creator, user));

describe("Le français n'est pas stocké sur la fiche", () => {
  it("normalizeCreatorLocale ramène « fr » à undefined", () => {
    expect(normalizeCreatorLocale("fr")).toBeUndefined();
    expect(normalizeCreatorLocale("fr-FR")).toBeUndefined();
    // L'anglais, lui, est bien stocké — c'est la divergence qu'on garde.
    expect(normalizeCreatorLocale("en")).toBe("en");
    expect(normalizeCreatorLocale("en-US")).toBe("en");
  });

  it("une fiche muette et un compte muet donnent « fr »", () => {
    // Les 10 créateurs français de la prod sont exactement dans cet état.
    expect(servie({})).toBe("fr");
    expect(servie({ locale: undefined }, { locale: undefined })).toBe("fr");
    expect(servie({ locale: "" }, { locale: "  " })).toBe("fr");
  });
});

describe("Les DEUX divergences que le filtre doit voir juste", () => {
  it("DIVERGENCE 1 — fiche muette, compte anglophone → EN", () => {
    // Un admin invite sans préciser la langue ; la créatrice bascule en anglais
    // depuis son profil. La fiche ne dit rien, le compte dit « en ».
    expect(servie({}, { locale: "en" })).toBe("en");
    // Un filtre qui lirait la FICHE la classerait en français : faux.
    expect(normalizeCreatorLocale(undefined)).toBeUndefined();
  });

  it("DIVERGENCE 2 — fiche « en », compte repassé en français → FR", () => {
    // Celle qui arrivera en vrai : invitée en anglais, elle bascule en français
    // depuis son Profil. `setMyLocale` écrit « fr » EXPLICITEMENT sur users.
    expect(servie({ locale: "en" }, { locale: "fr" })).toBe("fr");
    // Un filtre qui lirait la fiche la classerait en anglais : faux.
    expect(servie({ locale: "en" })).toBe("en");
  });

  it("le compte prime TOUJOURS sur la fiche, dans les deux sens", () => {
    expect(servie({ locale: "en" }, { locale: "fr" })).toBe("fr");
    expect(servie({ locale: undefined }, { locale: "en" })).toBe("en");
    // …mais un compte MUET laisse la fiche décider.
    expect(servie({ locale: "en" }, { locale: "" })).toBe("en");
  });

  it("étiquette régionale et langue inconnue retombent sur le défaut", () => {
    expect(servie({}, { locale: "en-US" })).toBe("en");
    expect(servie({ locale: "de" })).toBe("fr");
    expect(normalizeLocale("de")).toBeNull();
  });
});

describe("CONTRE-ÉPREUVE — le piège du filtre naïf", () => {
  it("« absence = français » se trompe sur la divergence 2", () => {
    const naif = (c: { locale?: string }) => (c.locale ? c.locale : "fr");
    const fiche = { locale: "en" };
    const compte = { locale: "fr" };
    // Le filtre naïf ne regarde que la fiche…
    expect(naif(fiche)).toBe("en");
    // …alors que la créatrice lit le français.
    expect(servie(fiche, compte)).toBe("fr");
    expect(naif(fiche)).not.toBe(servie(fiche, compte));
  });
});

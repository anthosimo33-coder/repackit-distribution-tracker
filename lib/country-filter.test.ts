import { describe, it, expect } from "vitest";
import {
  buildCountryOptions,
  matchesCountryFilter,
  NO_COUNTRY,
} from "./country-filter";

// Forme de la prod Snytch (2026-09-24) : FR/US majoritaires, un marché serbe,
// un compte archivé ciblant GB, et des comptes sans pays.

describe("buildCountryOptions", () => {
  it("effectif décroissant, départage par code, « sans pays » en dernier", () => {
    const comptes = [
      ["FR"], ["FR"], ["FR"], ["US"], ["US"], ["US"], ["RS"], ["GB"],
      [null], [undefined],
    ];
    expect(buildCountryOptions(comptes)).toEqual([
      { value: "FR", count: 3 },
      { value: "US", count: 3 },
      { value: "GB", count: 1 },
      { value: "RS", count: 1 },
      { value: NO_COUNTRY, count: 2 },
    ]);
  });

  it("une assignation à deux comptes du même pays compte UNE fois", () => {
    const assignations = [
      ["FR", "FR"], // TikTok + Instagram de la même créatrice
      ["US", "US"],
      ["FR", "US"], // cas rare : deux marchés, compte dans les deux
    ];
    expect(buildCountryOptions(assignations)).toEqual([
      { value: "FR", count: 2 },
      { value: "US", count: 2 },
    ]);
  });

  it("pas d'entrée « sans pays » quand tout le monde en a un", () => {
    expect(buildCountryOptions([["FR"], ["us"]]).map((o) => o.value)).toEqual([
      "FR",
      "US",
    ]);
  });
});

describe("matchesCountryFilter", () => {
  it("sélection vide : tout passe, y compris sans pays", () => {
    expect(matchesCountryFilter([null], new Set())).toBe(true);
    expect(matchesCountryFilter(["RS"], new Set())).toBe(true);
  });

  it("passe dès qu'UN des pays est coché", () => {
    const us = new Set(["US"]);
    expect(matchesCountryFilter(["FR", "US"], us)).toBe(true);
    expect(matchesCountryFilter(["FR", "FR"], us)).toBe(false);
    expect(matchesCountryFilter(["us"], us)).toBe(true);
    // Un élément SANS pays ne se glisse pas sous un pays coché.
    expect(matchesCountryFilter([null], us)).toBe(false);
  });

  it("« sans pays » ne retient QUE les éléments sans pays", () => {
    const sans = new Set([NO_COUNTRY]);
    expect(matchesCountryFilter([null, undefined], sans)).toBe(true);
    expect(matchesCountryFilter([], sans)).toBe(true);
    expect(matchesCountryFilter(["FR"], sans)).toBe(false);
  });
});

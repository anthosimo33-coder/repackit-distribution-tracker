process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { hogDateTime, hogWindowClause, parisDayStartMs } from "./hog-window";

describe("parisDayStartMs", () => {
  it("un jour d'ÉTÉ commence la veille à 22:00 UTC", () => {
    // Paris est à UTC+2 en septembre : le 6 septembre parisien démarre le 5 à 22h.
    expect(hogDateTime(parisDayStartMs("2026-09-06"))).toBe("2026-09-05 22:00:00");
  });

  it("un jour d'HIVER commence la veille à 23:00 UTC", () => {
    // UTC+1 : sans relecture du décalage à SA date, on aurait gardé 22:00 et
    // décalé toutes les bornes d'hiver d'une heure.
    expect(hogDateTime(parisDayStartMs("2026-12-15"))).toBe("2026-12-14 23:00:00");
  });

  it("le jour du CHANGEMENT D'HEURE est correct des deux côtés", () => {
    // Bascule le 25 octobre 2026 à 03:00 Paris → 02:00. Le 25 commence encore à
    // UTC+2 (la veille 22h), le 26 déjà à UTC+1 (la veille 23h). C'est le cas où
    // une seule passe de correction se trompe.
    expect(hogDateTime(parisDayStartMs("2026-10-25"))).toBe("2026-10-24 22:00:00");
    expect(hogDateTime(parisDayStartMs("2026-10-26"))).toBe("2026-10-25 23:00:00");
    // Et l'autre bascule, au printemps (29 mars 2026).
    expect(hogDateTime(parisDayStartMs("2026-03-29"))).toBe("2026-03-28 23:00:00");
    expect(hogDateTime(parisDayStartMs("2026-03-30"))).toBe("2026-03-29 22:00:00");
  });

  it("une date illisible ne rend pas un instant plausible", () => {
    expect(Number.isNaN(parisDayStartMs("pas-une-date"))).toBe(true);
    // Contre-test de présence : une date lisible rend bien un nombre.
    expect(Number.isNaN(parisDayStartMs("2026-09-06"))).toBe(false);
  });
});

describe("hogWindowClause", () => {
  it("la borne haute est EXCLUSIVE et comprend le dernier jour EN ENTIER", () => {
    const c = hogWindowClause("2026-09-01", "2026-09-06")!;
    expect(c).toContain("timestamp >= toDateTime('2026-08-31 22:00:00')");
    // Le 7 à 00:00 Paris = le 6 à 22:00 UTC : tout le 6 est dedans.
    expect(c).toContain("timestamp < toDateTime('2026-09-06 22:00:00')");
  });

  it("un seul jour couvre bien vingt-quatre heures", () => {
    const c = hogWindowClause("2026-09-06", "2026-09-06")!;
    const bornes = [...c.matchAll(/toDateTime\('([^']+)'\)/g)].map((m) => m[1]);
    const duree =
      (Date.parse(bornes[1].replace(" ", "T") + "Z") -
        Date.parse(bornes[0].replace(" ", "T") + "Z")) /
      3600000;
    expect(duree).toBe(24);
  });

  it("le jour du changement d'heure dure vingt-trois heures, et on le dit", () => {
    // Ce n'est pas un défaut : le 25 octobre 2026 a réellement 25 heures à Paris
    // (on recule d'une heure). La fenêtre doit les contenir toutes.
    const c = hogWindowClause("2026-10-25", "2026-10-25")!;
    const bornes = [...c.matchAll(/toDateTime\('([^']+)'\)/g)].map((m) => m[1]);
    const duree =
      (Date.parse(bornes[1].replace(" ", "T") + "Z") -
        Date.parse(bornes[0].replace(" ", "T") + "Z")) /
      3600000;
    expect(duree).toBe(25);
  });

  it("des bornes à l'envers ou illisibles rendent null, pas une fenêtre absurde", () => {
    expect(hogWindowClause("2026-09-06", "2026-09-01")).toBeNull();
    expect(hogWindowClause("n'importe quoi", "2026-09-01")).toBeNull();
    // Contre-test : des bornes valides rendent bien un prédicat.
    expect(hogWindowClause("2026-09-01", "2026-09-06")).not.toBeNull();
  });
});

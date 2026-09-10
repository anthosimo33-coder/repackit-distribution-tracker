// Le runtime Convex tourne en UTC et le navigateur à Paris : on fige le process
// sur UTC pour que `parisDayKey` soit éprouvée sur le fuseau qui la piège, et non
// sur celui d'un poste français où le bug serait invisible.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import {
  clampWindow,
  coversEverything,
  dataRangeOf,
  formatWindow,
  inWindow,
  parisDayKey,
  presetWindow,
  previousWindow,
  rowsInWindow,
  shiftDay,
  sumInWindow,
  windowLengthDays,
} from "./analytics-window";

/**
 * Les bornes utilisées ici sont celles de la PROD au 2026-09-06 : PostHog ne
 * contient rien avant le 2026-07-23, soit 46 jours. C'est ce qui rend le bouton
 * « 90 jours » trompeur — il n'a jamais rien pu montrer de plus que « 30 ».
 */
const RANGE = { first: "2026-07-23", last: "2026-09-06" };

describe("parisDayKey", () => {
  it("range un instant de fin de soirée dans le jour PARISIEN", () => {
    // 22:30 UTC le 31/08 = 00:30 le 01/09 à Paris (été, UTC+2).
    expect(parisDayKey(Date.UTC(2026, 7, 31, 22, 30))).toBe("2026-09-01");
    // 21:30 UTC le même jour est encore le 31/08 à Paris.
    expect(parisDayKey(Date.UTC(2026, 7, 31, 21, 30))).toBe("2026-08-31");
  });

  it("tient l'heure d'HIVER, où la bascule est à 23:00 UTC", () => {
    expect(parisDayKey(Date.UTC(2026, 0, 31, 22, 59))).toBe("2026-01-31");
    expect(parisDayKey(Date.UTC(2026, 0, 31, 23, 0))).toBe("2026-02-01");
  });
});

describe("shiftDay", () => {
  it("recule et avance sans dépendre du fuseau du process", () => {
    expect(shiftDay("2026-09-06", -6)).toBe("2026-08-31");
    expect(shiftDay("2026-09-06", 1)).toBe("2026-09-07");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("traverse un changement d'heure sans perdre ni gagner un jour", () => {
    // Dernier dimanche de mars 2026 : le 29. La journée fait 23 h à Paris.
    expect(shiftDay("2026-03-28", 1)).toBe("2026-03-29");
    expect(shiftDay("2026-03-29", 1)).toBe("2026-03-30");
  });
});

describe("windowLengthDays", () => {
  it("compte les bornes (un seul jour = 1, pas 0)", () => {
    expect(windowLengthDays({ from: "2026-09-06", to: "2026-09-06" })).toBe(1);
    expect(windowLengthDays({ from: "2026-08-31", to: "2026-09-06" })).toBe(7);
  });

  it("rend 0 sur une fenêtre inversée plutôt qu'un négatif", () => {
    expect(windowLengthDays({ from: "2026-09-06", to: "2026-08-31" })).toBe(0);
  });
});

describe("dataRangeOf", () => {
  it("trouve les bornes même si la série n'est pas triée", () => {
    expect(dataRangeOf(["2026-08-02", "2026-07-23", "2026-09-06"])).toEqual(RANGE);
  });

  it("rend null sur une série vide (≠ d'une fenêtre à zéro)", () => {
    expect(dataRangeOf([])).toBeNull();
  });
});

describe("presetWindow", () => {
  it("« 7 derniers jours » couvre 7 jours, pas 8", () => {
    const w = presetWindow("7d", RANGE);
    expect(w).toEqual({ from: "2026-08-31", to: "2026-09-06" });
    expect(windowLengthDays(w)).toBe(7);
  });

  it("s'ancre sur le DERNIER JOUR DE DONNÉES, pas sur aujourd'hui", () => {
    // La synchro tourne à l'heure : le jour courant est souvent absent. Ancrer
    // ailleurs ferait entrer un jour vide et diviserait par 7 ce qui n'a que 6
    // jours de mesure.
    const enRetard = { first: "2026-07-23", last: "2026-09-04" };
    expect(presetWindow("7d", enRetard)).toEqual({
      from: "2026-08-29",
      to: "2026-09-04",
    });
  });

  it("ne remonte JAMAIS avant le premier jour de données", () => {
    // 30 jours demandés sur une profondeur de 10 → la fenêtre s'arrête au début.
    const court = { first: "2026-08-28", last: "2026-09-06" };
    const w = presetWindow("30d", court);
    expect(w).toEqual({ from: "2026-08-28", to: "2026-09-06" });
    expect(windowLengthDays(w)).toBe(10);
  });

  it("« Tout » rend exactement l'étendue disponible", () => {
    expect(presetWindow("all", RANGE)).toEqual({
      from: RANGE.first,
      to: RANGE.last,
    });
  });
});

describe("clampWindow", () => {
  it("coupe ce qui dépasse sans inventer de jours", () => {
    expect(
      clampWindow({ from: "2026-01-01", to: "2027-01-01" }, RANGE),
    ).toEqual({ from: "2026-07-23", to: "2026-09-06" });
  });

  it("rend null quand la fenêtre est ENTIÈREMENT hors données", () => {
    // Contre-test : sans ça, une sélection dans le futur rendrait une fenêtre
    // vide et les cartes afficheraient 0 — un « mesuré à zéro » qui est faux.
    expect(clampWindow({ from: "2027-01-01", to: "2027-02-01" }, RANGE)).toBeNull();
    expect(clampWindow({ from: "2026-01-01", to: "2026-02-01" }, RANGE)).toBeNull();
  });

  it("rend null s'il n'y a aucune donnée", () => {
    expect(clampWindow({ from: "2026-08-01", to: "2026-08-31" }, null)).toBeNull();
  });
});

describe("sumInWindow / rowsInWindow", () => {
  const serie = [
    { day: "2026-07-22", n: 1000 }, // avant les données
    { day: "2026-08-31", n: 10 },
    { day: "2026-09-01", n: 20 },
    { day: "2026-09-06", n: 30 },
    { day: "2026-09-07", n: 2000 }, // après
  ];
  const w = { from: "2026-08-31", to: "2026-09-06" };

  it("somme les bornes COMPRISES et rien d'autre", () => {
    expect(sumInWindow(serie, w, (r) => r.day, (r) => r.n)).toBe(60);
  });

  it("rend null (pas 0) quand la fenêtre est absente", () => {
    expect(sumInWindow(serie, null, (r) => r.day, (r) => r.n)).toBeNull();
  });

  it("retient les mêmes lignes que la somme", () => {
    expect(rowsInWindow(serie, w, (r) => r.day).map((r) => r.n)).toEqual([10, 20, 30]);
  });

  it("inWindow inclut les deux bornes", () => {
    expect(inWindow("2026-08-31", w)).toBe(true);
    expect(inWindow("2026-09-06", w)).toBe(true);
    expect(inWindow("2026-08-30", w)).toBe(false);
    expect(inWindow("2026-09-07", w)).toBe(false);
  });
});

describe("coversEverything", () => {
  it("reconnaît une fenêtre qui vaut le cumul (n'affiche pas deux fois le même)", () => {
    expect(coversEverything(presetWindow("all", RANGE), RANGE)).toBe(true);
  });

  it("distingue une fenêtre partielle", () => {
    expect(coversEverything(presetWindow("7d", RANGE), RANGE)).toBe(false);
  });
});

describe("formatWindow", () => {
  it("écrit une plage, un jour unique, ou l'absence de données", () => {
    expect(formatWindow({ from: "2026-08-31", to: "2026-09-06" })).toBe("31/08 → 06/09");
    expect(formatWindow({ from: "2026-09-06", to: "2026-09-06" })).toBe("06/09");
    expect(formatWindow(null)).toBe("aucune donnée");
  });

  it("ajoute l'année quand la plage en change", () => {
    expect(formatWindow({ from: "2025-12-30", to: "2026-01-02" })).toBe(
      "30/12/25 → 02/01",
    );
  });
});

describe("previousWindow", () => {
  it("rend la période immédiatement précédente, de MÊME longueur", () => {
    const w = { from: "2026-08-31", to: "2026-09-06" }; // 7 jours
    expect(previousWindow(w, RANGE)).toEqual({ from: "2026-08-24", to: "2026-08-30" });
    expect(windowLengthDays(previousWindow(w, RANGE)!)).toBe(7);
  });

  it("rend null si la comparaison n'est PAS entièrement couverte", () => {
    // « Tout » (46 j) n'a que 0 jour avant lui : comparer donnerait un delta qui
    // ne mesure que la profondeur d'historique.
    expect(previousWindow(presetWindow("all", RANGE), RANGE)).toBeNull();
    // 30 jours sur une profondeur de 46 : il n'en reste que 16 avant → refusé.
    expect(previousWindow(presetWindow("30d", RANGE), RANGE)).toBeNull();
  });

  it("accepte dès que la profondeur suffit (assertion de présence)", () => {
    // Contre-test : sans lui, un `return null` systématique passerait le test
    // précédent.
    const profond = { first: "2026-01-01", last: "2026-09-06" };
    expect(previousWindow(presetWindow("30d", profond), profond)).toEqual({
      from: "2026-07-09",
      to: "2026-08-07",
    });
  });

  it("rend null sans fenêtre ni données", () => {
    expect(previousWindow(null, RANGE)).toBeNull();
    expect(previousWindow({ from: "2026-09-01", to: "2026-09-06" }, null)).toBeNull();
  });
});

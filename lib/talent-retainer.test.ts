import { describe, it, expect } from "vitest";
import {
  MAX_MONTHS_DUE,
  daysCovered,
  monthLabelFr,
  monthsDue,
  nextMonthKey,
  parisMonthKey,
  retainerAmountFor,
} from "../convex/talentRetainer";

/**
 * Forfait mensuel d'un talent. Les assertions sont écrites en TIMESTAMPS
 * ABSOLUS : elles doivent tenir quel que soit le `TZ` du runner, parce que le
 * calcul tourne côté serveur (runtime Convex en UTC) sur une règle qui parle de
 * mois PARISIENS.
 */

/** Minuit PARIS d'un jour d'ÉTÉ (CEST, UTC+2) → 22:00 UTC la veille. */
const minuitParisEte = (m: number, d: number, y = 2026) =>
  Date.UTC(y, m - 1, d - 1, 22, 0);
/** Minuit PARIS d'un jour d'HIVER (CET, UTC+1) → 23:00 UTC la veille. */
const minuitParisHiver = (m: number, d: number, y = 2026) =>
  Date.UTC(y, m - 1, d - 1, 23, 0);
/** Midi Paris en été (10:00 UTC). */
const midiEte = (m: number, d: number, y = 2026) => Date.UTC(y, m - 1, d, 10, 0);

describe("parisMonthKey — le mois est celui de Paris, pas celui du processus", () => {
  it("LE PIÈGE : activée le 1er à 00h30 Paris, c'est bien le mois qui COMMENCE", () => {
    // 1er septembre 00h30 Paris = 31 août 22h30 UTC. Un mois calculé en UTC
    // dirait « août » — et par la règle « mois d'entrée payé en entier », ce
    // serait UN MOIS ENTIER OFFERT pour trente minutes.
    const activation = Date.UTC(2026, 7, 31, 22, 30);
    expect(parisMonthKey(activation)).toBe("2026-09");
  });

  it("le même piège en hiver (UTC+1)", () => {
    // 1er janvier 00h30 Paris = 31 décembre 23h30 UTC — et l'ANNÉE change aussi.
    expect(parisMonthKey(Date.UTC(2025, 11, 31, 23, 30))).toBe("2026-01");
  });

  it("un instant en pleine journée tombe dans son mois, évidemment", () => {
    expect(parisMonthKey(midiEte(8, 15))).toBe("2026-08");
  });
});

describe("nextMonthKey — passage d'année", () => {
  it("enchaîne les mois et bascule au 1er janvier", () => {
    expect(nextMonthKey("2026-08")).toBe("2026-09");
    expect(nextMonthKey("2026-11")).toBe("2026-12");
    expect(nextMonthKey("2026-12")).toBe("2027-01");
  });
});

describe("monthsDue — mois d'entrée ET de sortie dus en entier", () => {
  it("LE CAS 28→3 : deux mois pleins pour six jours", () => {
    // Activée le 28 août, arrêtée le 3 septembre. C'est la conséquence assumée
    // des deux arbitrages, pas un défaut : l'écran doit l'afficher, pas la
    // corriger.
    const mois = monthsDue({
      startAt: midiEte(8, 28),
      endAt: midiEte(9, 3),
      now: midiEte(9, 20),
    });
    expect(mois).toEqual(["2026-08", "2026-09"]);
  });

  it("activée et arrêtée dans le MÊME mois → un seul mois", () => {
    expect(
      monthsDue({
        startAt: midiEte(8, 3),
        endAt: midiEte(8, 28),
        now: midiEte(9, 20),
      }),
    ).toEqual(["2026-08"]);
  });

  it("toujours active → jusqu'au mois COURANT inclus", () => {
    expect(
      monthsDue({
        startAt: midiEte(6, 14),
        endAt: null,
        now: midiEte(8, 2),
      }),
    ).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("activée aujourd'hui, toujours active → un mois, pas zéro", () => {
    expect(
      monthsDue({ startAt: midiEte(8, 15), endAt: null, now: midiEte(8, 15) }),
    ).toEqual(["2026-08"]);
  });

  it("traverse une fin d'année", () => {
    expect(
      monthsDue({
        startAt: minuitParisHiver(12, 30, 2025),
        endAt: midiEte(2, 1),
        now: midiEte(3, 1),
      }),
    ).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("jamais activée → aucun mois dû", () => {
    // Le cas de Manon avant activation : elle ne doit apparaître nulle part.
    expect(monthsDue({ startAt: null, endAt: null, now: midiEte(8, 15) })).toEqual(
      [],
    );
    expect(
      monthsDue({ startAt: undefined, endAt: null, now: midiEte(8, 15) }),
    ).toEqual([]);
  });

  it("arrêt ANTÉRIEUR à l'activation (bascule incohérente) → le mois d'entrée", () => {
    // Fermé par défaut : ni liste vide (qui ferait croire qu'on ne doit rien),
    // ni boucle qui ne se termine pas.
    expect(
      monthsDue({
        startAt: midiEte(8, 20),
        endAt: midiEte(7, 1),
        now: midiEte(9, 1),
      }),
    ).toEqual(["2026-08"]);
  });

  it("une ancre aberrante ne produit pas des milliers de lignes", () => {
    const mois = monthsDue({
      startAt: Date.UTC(1970, 0, 1),
      endAt: null,
      now: midiEte(8, 15),
    });
    expect(mois.length).toBe(MAX_MONTHS_DUE);
  });

  it("activation à minuit Paris pile — la borne haute compte aussi", () => {
    // Entrée le 1er septembre 00h00 Paris, arrêt le 1er octobre 00h00 Paris :
    // deux mois, parce que le mois de sortie est dû en entier.
    expect(
      monthsDue({
        startAt: minuitParisEte(9, 1),
        endAt: minuitParisEte(10, 1),
        now: midiEte(11, 5),
      }),
    ).toEqual(["2026-09", "2026-10"]);
  });
});

describe("daysCovered — le chiffre qui rend le 28→3 lisible", () => {
  it("compte les jours calendaires, bornes incluses", () => {
    // Du 28/08 au 03/09 = SEPT jours couverts, pour 2 mois facturés — et non
    // six : elle était active LE 28 et LE 3, les deux bornes comptent. C'est le
    // sens de « couverts ». Le chiffre affiché à l'écran sera donc 7.
    expect(
      daysCovered({
        startAt: midiEte(8, 28),
        endAt: midiEte(9, 3),
        now: midiEte(9, 20),
      }),
    ).toBe(7);
  });

  it("activée et arrêtée le même jour → 1 jour, pas 0", () => {
    expect(
      daysCovered({
        startAt: midiEte(8, 28),
        endAt: Date.UTC(2026, 7, 28, 20, 0),
        now: midiEte(9, 1),
      }),
    ).toBe(1);
  });

  it("toujours active → compte jusqu'à aujourd'hui", () => {
    expect(
      daysCovered({ startAt: midiEte(8, 1), endAt: null, now: midiEte(8, 10) }),
    ).toBe(10);
  });

  it("jamais activée → null, jamais 0 (0 se lirait « zéro jour couvert »)", () => {
    expect(
      daysCovered({ startAt: null, endAt: null, now: midiEte(8, 10) }),
    ).toBeNull();
  });
});

describe("retainerAmountFor — qui a un forfait, et combien", () => {
  it("un talent avec un forfait", () => {
    expect(retainerAmountFor({ kind: "talent", monthlyRetainer: 300 })).toBe(300);
    // Montant à décimales — la forme réelle d'un tarif négocié.
    expect(retainerAmountFor({ kind: "talent", monthlyRetainer: 137.5 })).toBe(
      137.5,
    );
  });

  it("aucune autre population n'a de forfait", () => {
    // `kind` absent = partenaire : le chemin historique doit rendre null.
    expect(retainerAmountFor({ monthlyRetainer: 300 })).toBeNull();
    expect(
      retainerAmountFor({ kind: "partner", monthlyRetainer: 300 }),
    ).toBeNull();
    expect(
      retainerAmountFor({ kind: "clipper", monthlyRetainer: 300 }),
    ).toBeNull();
  });

  it("forfait absent, nul ou négatif → null", () => {
    expect(retainerAmountFor({ kind: "talent" })).toBeNull();
    expect(retainerAmountFor({ kind: "talent", monthlyRetainer: 0 })).toBeNull();
    expect(retainerAmountFor({ kind: "talent", monthlyRetainer: -50 })).toBeNull();
  });
});

describe("monthLabelFr — sans dépendre de l'ICU du runtime", () => {
  it("rend le mois en français", () => {
    expect(monthLabelFr("2026-08")).toBe("août 2026");
    expect(monthLabelFr("2026-01")).toBe("janvier 2026");
    expect(monthLabelFr("2025-12")).toBe("décembre 2025");
  });
});

import { describe, it, expect } from "vitest";
import {
  TIMEZONE_BY_COUNTRY,
  dayKey,
  dayIndex,
  isSameDay,
  startOfDayUtc,
  endOfDayUtc,
  inferTimezoneFromCountries,
  resolveCreatorTimezone,
  isSupportedTimezone,
} from "../convex/creatorDay";

/**
 * « Quel jour est-il pour cette créatrice ? » — LA question du chantier fuseaux.
 *
 * ⚠️ Ce fichier ne définit AUCUN `process.env.TZ`, et c'est délibéré : il doit
 * être vert sous n'importe quel fuseau de runner. Même propriété que
 * `lib/calendar-status.test.ts:52`. Si une assertion d'ici dépend du fuseau de
 * la machine, c'est que le module sous test a laissé fuir une horloge locale —
 * exactement le défaut qu'on élimine.
 *
 * Les instants de référence sont écrits en UTC explicite (`...Z`), jamais en
 * ISO nue : `new Date("2026-09-02T21:00:00")` se lirait dans le fuseau du
 * runner, et le test mentirait.
 */

const NY = "America/New_York";
const LA = "America/Los_Angeles";
const PARIS = "Europe/Paris";

/** 2 sept 2026, 21:00 à New York (EDT, UTC−4) = 3 sept 01:00 UTC. */
const CHECK_21H_NY = Date.parse("2026-09-03T01:00:00Z");

describe("dayKey — le jour vécu par la créatrice", () => {
  it("21 h à New York, c'est ENCORE le 2 septembre chez elle", () => {
    expect(dayKey(CHECK_21H_NY, NY)).toBe("2026-09-02");
  });

  it("...alors que la clé UTC d'aujourd'hui dit le 3 — c'EST le bug", () => {
    // Comportement de convex/warmup.todayKey avant correction. Écrit ici pour
    // que la régression soit visible si quelqu'un revient en arrière.
    expect(new Date(CHECK_21H_NY).toISOString().slice(0, 10)).toBe("2026-09-03");
    expect(dayKey(CHECK_21H_NY, NY)).not.toBe(
      new Date(CHECK_21H_NY).toISOString().slice(0, 10),
    );
  });

  it("le même instant est déjà le 3 septembre à Paris", () => {
    expect(dayKey(CHECK_21H_NY, PARIS)).toBe("2026-09-03");
  });

  it("Los Angeles n'est pas New York — 21 h là-bas franchit encore l'UTC", () => {
    // 2 sept 21:00 PDT (UTC−7) = 3 sept 04:00 UTC.
    const at = Date.parse("2026-09-03T04:00:00Z");
    expect(dayKey(at, LA)).toBe("2026-09-02");
    expect(dayKey(at, NY)).toBe("2026-09-03"); // minuit déjà passé à l'est
  });

  it("minuit pile, des deux côtés de la bascule", () => {
    // 3 sept 00:00 NY = 04:00 UTC ; une milliseconde avant, on est le 2.
    const minuitNy = Date.parse("2026-09-03T04:00:00Z");
    expect(dayKey(minuitNy, NY)).toBe("2026-09-03");
    expect(dayKey(minuitNy - 1, NY)).toBe("2026-09-02");
  });
});

describe("Changements d'heure — US et Europe ne basculent pas ensemble", () => {
  /**
   * 2026 : les US passent à l'heure d'été le 8 mars, l'Europe le 29 mars ;
   * l'Europe repasse à l'heure d'hiver le 25 octobre, les US le 1er novembre.
   * Entre les deux, l'écart Paris↔New York vaut 5 h et non 6 : un décalage
   * codé en dur casserait ici, et seulement ici.
   */
  it("fenêtre de mars — écart de 5 h, pas 6", () => {
    // 15 mars 2026, 20:30 à New York (EDT, UTC−4) = 16 mars 00:30 UTC.
    const at = Date.parse("2026-03-16T00:30:00Z");
    expect(dayKey(at, NY)).toBe("2026-03-15");
    expect(dayKey(at, PARIS)).toBe("2026-03-16"); // Paris encore en heure d'hiver (UTC+1)
  });

  it("fenêtre d'octobre — écart de 5 h, pas 6", () => {
    // 28 oct 2026, 19:30 à New York (EDT, UTC−4) = 28 oct 23:30 UTC.
    const at = Date.parse("2026-10-28T23:30:00Z");
    expect(dayKey(at, NY)).toBe("2026-10-28");
    expect(dayKey(at, PARIS)).toBe("2026-10-29"); // Paris déjà repassé en UTC+1
  });

  it("le jour où l'on avance les pendules aux US ne dure que 23 h", () => {
    // 8 mars 2026 : 02:00 EST devient 03:00 EDT. La journée locale est courte.
    const debut = startOfDayUtc("2026-03-08", NY);
    const fin = startOfDayUtc("2026-03-09", NY);
    expect(fin - debut).toBe(23 * 3_600_000);
  });

  it("le jour où l'on recule les pendules aux US dure 25 h", () => {
    const debut = startOfDayUtc("2026-11-01", NY);
    const fin = startOfDayUtc("2026-11-02", NY);
    expect(fin - debut).toBe(25 * 3_600_000);
  });

  it("idem côté européen, sur SES week-ends à lui", () => {
    expect(
      startOfDayUtc("2026-03-30", PARIS) - startOfDayUtc("2026-03-29", PARIS),
    ).toBe(23 * 3_600_000);
    expect(
      startOfDayUtc("2026-10-26", PARIS) - startOfDayUtc("2026-10-25", PARIS),
    ).toBe(25 * 3_600_000);
  });
});

describe("Bornes de journée — début et fin d'un jour local, en instant UTC", () => {
  it("minuit local d'un jour de New York", () => {
    expect(new Date(startOfDayUtc("2026-09-03", NY)).toISOString()).toBe(
      "2026-09-03T04:00:00.000Z",
    );
  });

  it("minuit local d'un jour de Paris (été)", () => {
    expect(new Date(startOfDayUtc("2026-09-03", PARIS)).toISOString()).toBe(
      "2026-09-02T22:00:00.000Z",
    );
  });

  it("une échéance saisie « le 2 septembre » expire à 23:59:59 CHEZ ELLE", () => {
    const fin = endOfDayUtc("2026-09-02", NY);
    expect(new Date(fin).toISOString()).toBe("2026-09-03T03:59:59.999Z");
    // Et c'est bien encore le 2 septembre pour elle, à la dernière milliseconde.
    expect(dayKey(fin, NY)).toBe("2026-09-02");
    expect(dayKey(fin + 1, NY)).toBe("2026-09-03");
  });

  it("échéance saisie depuis Paris à 23 h 30 — le jour saisi ne glisse pas", () => {
    // L'admin saisit « échéance le 2 septembre » alors qu'il est le 2 à 23 h 30
    // chez lui. Le jour retenu doit rester le 2 dans le fuseau de la créatrice,
    // pas le 3 parce que le navigateur de l'admin a basculé.
    expect(dayKey(endOfDayUtc("2026-09-02", NY), NY)).toBe("2026-09-02");
    expect(dayKey(endOfDayUtc("2026-09-02", LA), LA)).toBe("2026-09-02");
    expect(dayKey(endOfDayUtc("2026-09-02", PARIS), PARIS)).toBe("2026-09-02");
  });

  it("aller-retour : startOfDayUtc ∘ dayKey est stable pour tout instant", () => {
    const tzs = [NY, LA, PARIS, "Europe/London", "America/Sao_Paulo"];
    for (const tz of tzs) {
      for (let h = 0; h < 48; h++) {
        const at = Date.parse("2026-03-08T00:00:00Z") + h * 3_600_000;
        expect(dayKey(startOfDayUtc(dayKey(at, tz), tz), tz)).toBe(
          dayKey(at, tz),
        );
      }
    }
  });
});

describe("isSameDay / dayIndex", () => {
  it("21 h et 9 h le lendemain matin ne sont PAS le même jour", () => {
    const soir = CHECK_21H_NY; // 2 sept 21 h NY
    const lendemain = Date.parse("2026-09-03T13:00:00Z"); // 3 sept 9 h NY
    expect(isSameDay(soir, lendemain, NY)).toBe(false);
    // ...alors qu'ils tombent dans la MÊME journée UTC — le bug, en une ligne.
    expect(new Date(soir).toISOString().slice(0, 10)).toBe(
      new Date(lendemain).toISOString().slice(0, 10),
    );
  });

  it("dayIndex est monotone et comparable", () => {
    expect(dayIndex(Date.parse("2026-09-02T12:00:00Z"), NY)).toBeLessThan(
      dayIndex(Date.parse("2026-09-03T12:00:00Z"), NY),
    );
    expect(dayIndex(Date.parse("2026-12-31T18:00:00Z"), NY)).toBeLessThan(
      dayIndex(Date.parse("2027-01-01T18:00:00Z"), NY),
    );
  });
});

describe("Déduction depuis le pays — explicite, jamais un repli silencieux", () => {
  it("la table couvre les 10 pays supportés du dépôt", () => {
    expect(Object.keys(TIMEZONE_BY_COUNTRY).sort()).toEqual(
      ["AR", "AU", "BR", "CA", "DE", "ES", "FR", "GB", "IT", "US"].sort(),
    );
    expect(TIMEZONE_BY_COUNTRY.US).toBe("America/New_York");
    expect(TIMEZONE_BY_COUNTRY.FR).toBe("Europe/Paris");
    expect(TIMEZONE_BY_COUNTRY.ES).toBe("Europe/Madrid");
  });

  it("un seul pays → déduction", () => {
    expect(inferTimezoneFromCountries(["US"])).toBe("America/New_York");
    expect(inferTimezoneFromCountries(["US", "US"])).toBe("America/New_York");
  });

  it("aucun pays → null, PAS Paris", () => {
    expect(inferTimezoneFromCountries([])).toBeNull();
  });

  it("pays CONTRADICTOIRES → null, on ne devine pas (cas Sarah, US+FR en prod)", () => {
    expect(inferTimezoneFromCountries(["US", "FR"])).toBeNull();
  });

  it("pays hors table → null", () => {
    expect(inferTimezoneFromCountries(["XX"])).toBeNull();
  });
});

describe("Résolution du fuseau d'une créatrice + PROVENANCE", () => {
  it("valeur confirmée par la créatrice — la plus fiable", () => {
    expect(
      resolveCreatorTimezone(
        { timezone: NY, timezoneSource: "confirmed" },
        ["FR"],
      ),
    ).toEqual({ timezone: NY, source: "confirmed", stored: true });
  });

  it("une valeur confirmée n'est JAMAIS écrasée par le pays des comptes", () => {
    // Créatrice à Madrid qui anime un compte US : le pays décrit le marché,
    // pas l'endroit où elle vit.
    expect(
      resolveCreatorTimezone(
        { timezone: "Europe/Madrid", timezoneSource: "confirmed" },
        ["US"],
      ).timezone,
    ).toBe("Europe/Madrid");
  });

  it("valeur posée par l'admin — retenue, et marquée comme telle", () => {
    expect(
      resolveCreatorTimezone({ timezone: LA, timezoneSource: "admin" }, ["US"]),
    ).toEqual({ timezone: LA, source: "admin", stored: true });
  });

  it("champ vide → déduction depuis les comptes, marquée « inferred »", () => {
    expect(resolveCreatorTimezone({}, ["US"])).toEqual({
      timezone: "America/New_York",
      source: "inferred",
      stored: false,
    });
  });

  it("champ vide ET pays indéterminable → AUCUN fuseau, source null", () => {
    expect(resolveCreatorTimezone({}, [])).toEqual({
      timezone: null,
      source: null,
      stored: false,
    });
    expect(resolveCreatorTimezone({}, ["US", "FR"])).toEqual({
      timezone: null,
      source: null,
      stored: false,
    });
  });

  it("⚠️ INVARIANT — aucune entrée ne peut produire Europe/Paris par défaut", () => {
    // La règle du chantier : une créatrice sans fuseau est VISIBLE comme telle,
    // jamais traitée comme parisienne. Ce test est le garde-fou.
    const entrees: { timezone?: string; timezoneSource?: string }[] = [
      {},
      { timezone: undefined },
      { timezoneSource: "confirmed" },
      { timezone: "" },
    ];
    for (const e of entrees) {
      for (const pays of [[], ["US", "FR"], ["XX"], ["US", "GB", "FR"]]) {
        expect(resolveCreatorTimezone(e, pays).timezone).not.toBe(PARIS);
      }
    }
  });

  it("le fuseau ne vient de Paris que si le PAYS le dit", () => {
    expect(resolveCreatorTimezone({}, ["FR"])).toEqual({
      timezone: PARIS,
      source: "inferred",
      stored: false,
    });
  });
});

describe("STOCKÉ vs VIVANT — distinguer une fiche figée d'une fiche qui bougera", () => {
  /**
   * Depuis le gel au premier check, `source: "inferred"` recouvre DEUX états
   * très différents :
   *   - la valeur est ÉCRITE sur la fiche (figée) — elle ne bougera plus, même
   *     si on change le pays de ses comptes ;
   *   - la valeur est CALCULÉE à la lecture — elle se corrigera toute seule.
   * L'admin doit pouvoir les distinguer, sinon il ne sait pas s'il doit agir.
   */
  it("valeur écrite sur la fiche → stored: true", () => {
    expect(
      resolveCreatorTimezone(
        { timezone: NY, timezoneSource: "inferred" },
        ["US"],
      ),
    ).toEqual({ timezone: NY, source: "inferred", stored: true });
  });

  it("valeur seulement DÉDUITE à la lecture → stored: false", () => {
    expect(resolveCreatorTimezone({}, ["US"])).toEqual({
      timezone: "America/New_York",
      source: "inferred",
      stored: false,
    });
  });

  it("une saisie admin et une confirmation sont TOUJOURS stockées", () => {
    expect(
      resolveCreatorTimezone({ timezone: LA, timezoneSource: "admin" }, []).stored,
    ).toBe(true);
    expect(
      resolveCreatorTimezone({ timezone: NY, timezoneSource: "confirmed" }, []).stored,
    ).toBe(true);
  });

  it("aucun fuseau → stored: false (il n'y a rien à figer)", () => {
    expect(resolveCreatorTimezone({}, [])).toEqual({
      timezone: null,
      source: null,
      stored: false,
    });
  });

  it("figée sur une valeur DIFFÉRENTE du pays actuel — le cas qui compte", () => {
    // Figée à New York, puis ses comptes passent en FR. La déduction dirait
    // Paris ; la fiche doit rester à New York ET se dire figée, sinon l'admin
    // croit que ça se corrigera tout seul et n'agit jamais.
    const r = resolveCreatorTimezone(
      { timezone: NY, timezoneSource: "inferred" },
      ["FR"],
    );
    expect(r.timezone).toBe(NY);
    expect(r.stored).toBe(true);
  });
});

describe("isSupportedTimezone — refuse une valeur qui casserait le rendu", () => {
  it("accepte les fuseaux IANA réels", () => {
    for (const tz of [NY, LA, PARIS, "Europe/London", "Asia/Kolkata"]) {
      expect(isSupportedTimezone(tz)).toBe(true);
    }
  });

  it("refuse le vide et le n'importe quoi", () => {
    for (const tz of ["", "Paris", "UTC+2", "America/Atlantide"]) {
      expect(isSupportedTimezone(tz)).toBe(false);
    }
  });

  it("un fuseau à décalage NON ENTIER reste correct (Inde, UTC+5:30)", () => {
    // 2 sept 2026, 00:30 à Kolkata = 1er sept 19:00 UTC.
    const at = Date.parse("2026-09-01T19:00:00Z");
    expect(dayKey(at, "Asia/Kolkata")).toBe("2026-09-02");
    expect(new Date(startOfDayUtc("2026-09-02", "Asia/Kolkata")).toISOString())
      .toBe("2026-09-01T18:30:00.000Z");
  });
});

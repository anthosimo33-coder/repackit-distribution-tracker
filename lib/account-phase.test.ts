import { describe, it, expect } from "vitest";
import {
  ACCOUNT_PHASES,
  PHASE_LABELS,
  accountPhaseAt,
  dayOfPhase,
  postsPerDayAt,
  quotaRefusalMessage,
  utcDayKey,
  utcDayRange,
} from "../convex/accountPhase";

/**
 * Phase et quota d'un compte de clippeur. Les tests qui comptent sont ceux des
 * BORNES : une phase décalée d'un jour, et un compte publie 2 fois là où il
 * devrait publier 1 fois — ou l'inverse, un clippeur se retrouve bloqué sans
 * comprendre. Chaque seuil est donc vérifié des DEUX côtés.
 */

const JOUR = 86_400_000;
const VALIDATION = Date.UTC(2026, 7, 12, 9, 30); // 12/08/2026 09:30 UTC

/** Instant situé `n` jours pleins après la validation (J(n+1)). */
const jour = (n: number) => VALIDATION + n * JOUR;

describe("dayOfPhase — le jour de validation est J1", () => {
  it("l'instant exact de la validation est J1, pas J0", () => {
    expect(dayOfPhase(VALIDATION, VALIDATION)).toBe(1);
  });

  it("une date de validation FUTURE retombe sur J1", () => {
    // Dérive d'horloge ou antidatage : jamais un jour négatif, qui donnerait le
    // quota d'une phase ultérieure.
    expect(dayOfPhase(VALIDATION, VALIDATION - 5 * JOUR)).toBe(1);
  });

  it("le compteur avance d'un jour toutes les 24 h", () => {
    expect(dayOfPhase(VALIDATION, jour(1))).toBe(2);
    expect(dayOfPhase(VALIDATION, jour(13))).toBe(14);
  });
});

describe("accountPhaseAt — les trois bornes, des deux côtés", () => {
  it("J1-3 chauffe, J4 échauffement (borne J3/J4)", () => {
    expect(accountPhaseAt(VALIDATION, jour(0))).toBe("chauffe");
    expect(accountPhaseAt(VALIDATION, jour(2))).toBe("chauffe"); // J3
    expect(accountPhaseAt(VALIDATION, jour(3))).toBe("warmup"); // J4
  });

  it("J4-6 échauffement, J7 démo (borne J6/J7)", () => {
    expect(accountPhaseAt(VALIDATION, jour(5))).toBe("warmup"); // J6
    expect(accountPhaseAt(VALIDATION, jour(6))).toBe("demo"); // J7
  });

  it("J7-13 démo, J14 croisière (borne J13/J14)", () => {
    expect(accountPhaseAt(VALIDATION, jour(12))).toBe("demo"); // J13
    expect(accountPhaseAt(VALIDATION, jour(13))).toBe("croisiere"); // J14
  });

  it("la croisière ne se termine jamais", () => {
    expect(accountPhaseAt(VALIDATION, jour(400))).toBe("croisiere");
  });

  it("compte NON VALIDÉ → null, et non « chauffe »", () => {
    // L'absence de validation n'est pas un début de parcours : c'est un parcours
    // pas commencé. Les confondre donnerait une phase à un compte que l'admin
    // n'a jamais regardé.
    expect(accountPhaseAt(undefined, jour(30))).toBeNull();
    expect(accountPhaseAt(null, jour(30))).toBeNull();
  });
});

describe("postsPerDayAt — le quota dérive de la phase, jamais d'une saisie", () => {
  it("0 / 1 / 1 / 2 selon la phase", () => {
    expect(postsPerDayAt(VALIDATION, jour(0))).toBe(0); // chauffe
    expect(postsPerDayAt(VALIDATION, jour(3))).toBe(1); // échauffement
    expect(postsPerDayAt(VALIDATION, jour(6))).toBe(1); // démo
    expect(postsPerDayAt(VALIDATION, jour(13))).toBe(2); // croisière
  });

  it("la chauffe est à 0 — scroll seul, aucune publication", () => {
    for (const n of [0, 1, 2]) {
      expect(postsPerDayAt(VALIDATION, jour(n))).toBe(0);
    }
  });

  it("compte non validé → 0 (fermé par défaut)", () => {
    expect(postsPerDayAt(undefined, jour(30))).toBe(0);
  });

  it("le quota ne DÉCROÎT jamais au fil des jours", () => {
    // Une table mal ordonnée produirait un compte qui régresse ; le parcours est
    // monotone par construction et doit le rester.
    let precedent = -1;
    for (let n = 0; n <= 40; n++) {
      const q = postsPerDayAt(VALIDATION, jour(n));
      expect(q).toBeGreaterThanOrEqual(precedent === -1 ? 0 : precedent);
      precedent = q;
    }
  });
});

describe("journée UTC — l'unité du quota", () => {
  it("utcDayKey bucketise sur la journée UTC", () => {
    expect(utcDayKey(Date.UTC(2026, 7, 12, 23, 59))).toBe("2026-08-12");
    expect(utcDayKey(Date.UTC(2026, 7, 13, 0, 1))).toBe("2026-08-13");
  });

  it("utcDayRange encadre exactement 24 h et contient son instant", () => {
    const at = Date.UTC(2026, 7, 12, 22, 30);
    const { start, end } = utcDayRange(at);
    expect(end - start).toBe(JOUR);
    expect(start).toBeLessThanOrEqual(at);
    expect(at).toBeLessThan(end);
    expect(utcDayKey(start)).toBe("2026-08-12");
  });

  it("effet de bord DOCUMENTÉ : après minuit à Paris = journée UTC précédente", () => {
    // 13/08 00h30 à Paris en été (UTC+2) = 12/08 22h30 UTC. Écart assumé (cf
    // en-tête du module) : introduire un fuseau coûterait plus que ces deux
    // heures. Ce test EXISTE pour que le comportement soit choisi, pas subi.
    const minuitTrenteParisEnEte = Date.UTC(2026, 7, 12, 22, 30);
    expect(utcDayKey(minuitTrenteParisEnEte)).toBe("2026-08-12");
  });
});

describe("messages et libellés", () => {
  it("chaque phase a un libellé FR", () => {
    for (const p of ACCOUNT_PHASES) expect(PHASE_LABELS[p]).toBeTruthy();
  });

  it("le refus distingue non validé / chauffe / quota atteint", () => {
    expect(quotaRefusalMessage("@x", null, 0)).toMatch(/pas encore validé/i);
    expect(quotaRefusalMessage("@x", "chauffe", 0)).toMatch(/chauffe/i);
    const plein = quotaRefusalMessage("@x", "croisiere", 2);
    expect(plein).toMatch(/quota du jour/i);
    expect(plein).toContain("2 posts");
  });

  it("le message nomme TOUJOURS le compte fautif", () => {
    // Sans le handle, un clippeur à deux comptes ne sait pas lequel bloque.
    for (const phase of [null, "chauffe", "croisiere"] as const) {
      expect(quotaRefusalMessage("@monhandle", phase, 2)).toContain(
        "@monhandle",
      );
    }
  });
});

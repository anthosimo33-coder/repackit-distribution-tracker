import { describe, it, expect } from "vitest";
import { ERR } from "../convex/errorCodes";
import {
  ACCOUNT_PHASES,
  PHASE_LABEL_KEYS,
  accountPhaseAt,
  dayKeyToUtcInstant,
  dayOfPhase,
  formatUtcDay,
  postsPerDayAt,
  quotaRefusal,
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

/** Le lundi de l'exemple du refus — 10/08/2026, en pleine journée UTC. */
const LUNDI = Date.UTC(2026, 7, 10, 14, 0);

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

/** Charge utile d'un rejet structuré (le typage de ConvexError est générique). */
function data(e: unknown) {
  return (e as { data: { code: string; message: string; params?: Record<string, string | number> } })
    .data;
}

describe("messages et libellés", () => {
  it("chaque phase a un libellé FR", () => {
    for (const p of ACCOUNT_PHASES) expect(PHASE_LABEL_KEYS[p]).toBeTruthy();
  });

  it("le refus distingue non validé / chauffe / quota atteint", () => {
    // Le refus est désormais une charge STRUCTURÉE : on asserte le CODE, pas la
    // phrase. Le message français reste dans la charge comme repli d'affichage.
    expect(data(quotaRefusal("@x", null, 0, LUNDI)).code).toBe(
      ERR.CLIP_QUOTA_NOT_VALIDATED,
    );
    expect(data(quotaRefusal("@x", "chauffe", 0, LUNDI)).code).toBe(
      ERR.CLIP_QUOTA_PHASE_ZERO,
    );
    const plein = data(quotaRefusal("@x", "croisiere", 2, LUNDI));
    expect(plein.code).toBe(ERR.CLIP_QUOTA_REACHED);
    expect(plein.message).toContain("2 publications sur 2");
  });

  it("le refus nomme TOUJOURS le compte fautif, en paramètre", () => {
    // Sans le handle, un clippeur à deux comptes ne sait pas lequel bloque.
    // En paramètre et pas seulement dans la phrase : c'est ce qui permet au
    // client de le rendre dans SA langue sans perdre l'information.
    for (const phase of [null, "chauffe", "croisiere"] as const) {
      const d = data(quotaRefusal("@monhandle", phase, 2, LUNDI));
      expect(d.params?.handle).toBe("@monhandle");
      expect(d.message).toContain("@monhandle");
    }
  });

  it("le refus nomme TOUJOURS la date concernée, en paramètre", () => {
    // Le scénario : deux posts déclarés lundi soir, un troisième publié lundi
    // tard et déclaré mardi matin daté de lundi. Le refus tombe un MARDI où le
    // clippeur croit avoir deux créneaux libres — sans la date, il conclut que
    // l'outil est cassé.
    for (const phase of [null, "chauffe", "croisiere"] as const) {
      const d = data(quotaRefusal("@x", phase, 2, LUNDI));
      expect(d.params?.date).toBe("lundi 10 août");
      expect(d.message).toContain("lundi 10 août");
    }
  });
});

describe("formatUtcDay — le libellé et le seau du quota parlent du même jour", () => {
  it("rend le jour en français, sans dépendre de l'ICU du runtime", () => {
    expect(formatUtcDay(LUNDI, "fr")).toBe("lundi 10 août");
    expect(formatUtcDay(Date.UTC(2026, 0, 1, 9, 0), "fr")).toBe("jeudi 1er janvier");
    expect(formatUtcDay(Date.UTC(2026, 11, 25, 23, 59), "fr")).toBe(
      "vendredi 25 décembre",
    );
  });

  it("aller-retour clé ↔ instant : le champ date et le seau ne peuvent pas diverger", () => {
    // Propriété, pas exemples : pour chaque jour d'une année entière, la clé
    // convertie en instant puis re-convertie doit redonner la MÊME clé. C'est ce
    // qui garantit que le jour choisi dans le champ est le jour compté.
    for (let i = 0; i < 365; i++) {
      const at = Date.UTC(2026, 0, 1, 12) + i * JOUR;
      const cle = utcDayKey(at);
      const retour = dayKeyToUtcInstant(cle);
      expect(retour).not.toBeNull();
      expect(utcDayKey(retour!)).toBe(cle);
    }
  });

  it("une clé mal formée ou impossible ne se convertit PAS silencieusement", () => {
    expect(dayKeyToUtcInstant("")).toBeNull();
    expect(dayKeyToUtcInstant("12/08/2026")).toBeNull();
    // Date.UTC reporterait le 31 février en mars — on refuse plutôt que décaler.
    expect(dayKeyToUtcInstant("2026-02-31")).toBeNull();
  });

  it("LE PIÈGE : minuit trente à Paris est nommé comme il est COMPTÉ", () => {
    // 22h30 UTC le 12 = 00h30 à Paris le 13. `utcDayKey` bucketise le 12 : le
    // libellé doit dire le 12 lui aussi, sinon l'écran refuse « pour le 13 »
    // avec un compteur qui compte le 12.
    const minuitTrenteParisEnEte = Date.UTC(2026, 7, 12, 22, 30);
    expect(utcDayKey(minuitTrenteParisEnEte)).toBe("2026-08-12");
    expect(formatUtcDay(minuitTrenteParisEnEte, "fr")).toBe("mercredi 12 août");
  });

  it("l'ordre des champs suit la LANGUE, pas seulement les mots", () => {
    // « lundi 10 août » contre « Monday, August 10 » : le quantième passe
    // APRÈS le mois en anglais US. Un simple dictionnaire de mois ne suffit
    // pas — c'est la construction de la phrase qui change.
    expect(formatUtcDay(LUNDI, "en")).toBe("Monday, August 10");
    // L'ordinal « 1er » n'a pas d'équivalent courant en anglais US.
    expect(formatUtcDay(Date.UTC(2026, 0, 1, 9, 0), "en")).toBe(
      "Thursday, January 1",
    );
    // Langue absente ou inconnue ⇒ français, le défaut du produit.
    expect(formatUtcDay(LUNDI, undefined)).toBe("lundi 10 août");
    expect(formatUtcDay(LUNDI, "es")).toBe("lundi 10 août");
  });
});

import { describe, it, expect } from "vitest";
import {
  isChauffeSansTalent,
  joursAvantSortieDeChauffe,
  sortieDeChauffeAt,
} from "../convex/clipperReadiness";

/**
 * Signal « compte en chauffe sans talent apparié ». Ce qui compte ici, ce sont
 * les BORNES de la fenêtre : un jour trop tôt et le signal parle d'un compte qui
 * vient d'être validé (l'admin n'a pas encore eu le temps d'apparier) ; un jour
 * trop tard et il annonce un dégât déjà fait, les trois jours étant perdus.
 */

const JOUR = 86_400_000;
const VALIDE = Date.UTC(2026, 7, 10, 9, 0, 0); // J1 = 10 août

/** Instant situé `n` jours après la validation. */
const jour = (n: number) => VALIDE + n * JOUR;

describe("isChauffeSansTalent — la fenêtre, des deux côtés", () => {
  it("J1 à J3 sans talent → signale", () => {
    for (const n of [0, 1, 2]) {
      expect(
        isChauffeSansTalent({ validatedAt: VALIDE, talentCount: 0 }, jour(n)),
      ).toBe(true);
    }
  });

  it("J4 → ne signale PLUS : la chauffe est finie, le dégât est fait", () => {
    // Le signal doit arriver PENDANT, pas après. Un constat post-mortem
    // n'appelle aucune action.
    expect(
      isChauffeSansTalent({ validatedAt: VALIDE, talentCount: 0 }, jour(3)),
    ).toBe(false);
  });

  it("dès qu'un talent est apparié, plus rien à signaler", () => {
    expect(
      isChauffeSansTalent({ validatedAt: VALIDE, talentCount: 1 }, jour(1)),
    ).toBe(false);
  });

  it("compte NON VALIDÉ → aucun signal (c'est la file de validation qui porte l'action)", () => {
    expect(
      isChauffeSansTalent({ validatedAt: undefined, talentCount: 0 }, jour(1)),
    ).toBe(false);
    expect(
      isChauffeSansTalent({ validatedAt: null, talentCount: 0 }, jour(1)),
    ).toBe(false);
  });
});

describe("joursAvantSortieDeChauffe", () => {
  it("compte à rebours en jours ENTIERS jusqu'à la sortie : J1→3, J2→2, J3→1", () => {
    expect(joursAvantSortieDeChauffe(VALIDE, jour(0))).toBe(3);
    expect(joursAvantSortieDeChauffe(VALIDE, jour(1))).toBe(2);
    expect(joursAvantSortieDeChauffe(VALIDE, jour(2))).toBe(1);
  });

  it("le dernier jour de chauffe annonce 1, jusqu'à son dernier instant", () => {
    expect(joursAvantSortieDeChauffe(VALIDE, jour(2) + 23 * 3_600_000)).toBe(1);
  });

  it("hors chauffe → null, jamais « 0 jour »", () => {
    // « 0 jour restant » sur un compte déjà sorti se lirait comme une urgence
    // alors que c'est un constat.
    expect(joursAvantSortieDeChauffe(VALIDE, jour(3))).toBeNull();
    expect(joursAvantSortieDeChauffe(VALIDE, jour(20))).toBeNull();
  });

  it("compte non validé → null", () => {
    expect(joursAvantSortieDeChauffe(undefined, jour(1))).toBeNull();
  });
});

describe("sortieDeChauffeAt — la date à écrire en clair", () => {
  it("tombe au début du 4e jour", () => {
    expect(sortieDeChauffeAt(VALIDE, jour(1))).toBe(VALIDE + 3 * JOUR);
  });

  it("null hors chauffe", () => {
    expect(sortieDeChauffeAt(VALIDE, jour(5))).toBeNull();
  });

  it("la date annoncée est cohérente avec le compte à rebours", () => {
    // Les deux dérivent de la même borne : s'ils divergeaient, l'écran dirait
    // « 1 jour restant » à côté d'une date déjà passée.
    const at = jour(1);
    const restants = joursAvantSortieDeChauffe(VALIDE, at)!;
    const sortie = sortieDeChauffeAt(VALIDE, at)!;
    expect(Math.ceil((sortie - at) / JOUR)).toBe(restants);
  });
});

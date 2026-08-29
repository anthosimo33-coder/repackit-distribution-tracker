/**
 * FENÊTRE D'AFFICHAGE d'un défi terminé.
 *
 * Un défi qui disparaît à la seconde où il se termine escamote le moment qui
 * compte : celui où l'on découvre qui a gagné. Sept jours, puis l'écran se
 * libère.
 *
 * La subtilité est l'ANCRE : la fin réelle est le PREMIER des deux entre la
 * deadline et une clôture manuelle. Prendre le plus tardif ferait traîner des
 * mois un défi clos d'avance ; ne regarder que la deadline ignorerait la
 * clôture.
 */
import { describe, expect, it } from "vitest";
import {
  CHALLENGE_VISIBLE_AFTER_END_DAYS,
  challengeEndedAt,
  challengeStillVisible,
} from "../convex/challengeScore";

const JOUR = 86_400_000;
/** Deadline : 20/09/2026 à 23h59 heure de Paris. */
const DEADLINE = Date.UTC(2026, 8, 20, 21, 59);

describe("l'instant où le défi s'est réellement terminé", () => {
  it("sans clôture manuelle : c'est la deadline", () => {
    expect(challengeEndedAt({ deadline: DEADLINE })).toBe(DEADLINE);
  });

  it("clos AVANT la deadline : c'est la clôture", () => {
    const closedAt = DEADLINE - 3 * JOUR;
    expect(challengeEndedAt({ deadline: DEADLINE, closedAt })).toBe(closedAt);
  });

  it("clos APRÈS la deadline (rattrapage admin) : c'est la deadline", () => {
    // L'admin clôt une semaine après ; le défi était fini depuis la deadline, et
    // la fenêtre de 7 jours ne redémarre pas au geste administratif.
    const closedAt = DEADLINE + 7 * JOUR;
    expect(challengeEndedAt({ deadline: DEADLINE, closedAt })).toBe(DEADLINE);
  });
});

describe("les 7 jours d'affichage après la fin", () => {
  it("avant la fin : visible", () => {
    expect(challengeStillVisible({ deadline: DEADLINE }, DEADLINE - JOUR)).toBe(
      true,
    );
  });

  it("le lendemain de la fin : visible — c'est là qu'elle lit le résultat", () => {
    expect(challengeStillVisible({ deadline: DEADLINE }, DEADLINE + JOUR)).toBe(
      true,
    );
  });

  it("au 7e jour PILE : encore visible (borne inclusive)", () => {
    expect(
      challengeStillVisible(
        { deadline: DEADLINE },
        DEADLINE + CHALLENGE_VISIBLE_AFTER_END_DAYS * JOUR,
      ),
    ).toBe(true);
  });

  it("une seconde APRÈS le 7e jour : l'écran se libère", () => {
    expect(
      challengeStillVisible(
        { deadline: DEADLINE },
        DEADLINE + CHALLENGE_VISIBLE_AFTER_END_DAYS * JOUR + 1,
      ),
    ).toBe(false);
  });

  it("clos d'avance : la fenêtre part de la CLÔTURE, pas de la deadline", () => {
    // Défi clos 30 jours avant son échéance. S'il fallait attendre la deadline,
    // il traînerait 37 jours dans l'espace de la créatrice.
    const closedAt = DEADLINE - 30 * JOUR;
    const opts = { deadline: DEADLINE, closedAt };
    expect(challengeStillVisible(opts, closedAt + 3 * JOUR)).toBe(true);
    expect(challengeStillVisible(opts, closedAt + 8 * JOUR)).toBe(false);
    // CONTRÔLE APPARIÉ : sans la clôture, ce même instant serait visible — la
    // ligne ci-dessus dit donc bien quelque chose sur la clôture.
    expect(
      challengeStillVisible({ deadline: DEADLINE }, closedAt + 8 * JOUR),
    ).toBe(true);
  });
});

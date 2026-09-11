import { describe, it, expect } from "vitest";
import {
  creatorActivationPatch,
  shouldAutoActivateCreator,
} from "../convex/creatorActivation";

/**
 * Activation d'une fiche créateur — la décision (« qui l'automatisme a le droit
 * de passer active ») et le patch (« ce que l'activation écrit »).
 *
 * Ce qui compte ici tient en deux lignes de conséquences : une fiche « partie »
 * qu'un désarchivage de compte ferait revenir en service, et un talent activé
 * sans ancre de paie — qui sort alors de tous ses cycles.
 */

const MAINTENANT = Date.UTC(2026, 8, 10, 12, 45); // 10/09/2026 12:45 UTC
const ANCRE_EXISTANTE = Date.UTC(2026, 6, 3, 8, 0); // 03/07/2026, déjà posée

describe("shouldAutoActivateCreator", () => {
  it("active une fiche en onboarding", () => {
    expect(shouldAutoActivateCreator({ status: "onboarding" })).toBe(true);
  });

  // Les trois refus ci-dessous sont la raison d'être de la fonction : sans eux,
  // valider (ou désarchiver) un compte réveillerait des fiches que quelqu'un a
  // délibérément mises de côté, et effacerait le fait qu'une invitée ne s'est
  // jamais connectée.
  it.each(["invited", "paused", "churned", "active"] as const)(
    "ne touche pas une fiche %s",
    (status) => {
      expect(shouldAutoActivateCreator({ status })).toBe(false);
    },
  );
});

describe("creatorActivationPatch", () => {
  it("pose l'ancre de paie d'un talent qui n'en a pas", () => {
    expect(creatorActivationPatch({ kind: "talent" }, MAINTENANT)).toEqual({
      status: "active",
      payStartAt: MAINTENANT,
    });
  });

  it("ne réécrit JAMAIS l'ancre d'un talent déjà ancré", () => {
    // Une réécriture décalerait des cycles déjà payés (cf payCycle.payAnchorOf).
    expect(
      creatorActivationPatch(
        { kind: "talent", payStartAt: ANCRE_EXISTANTE },
        MAINTENANT,
      ),
    ).toEqual({ status: "active" });
  });

  it.each([
    ["partenaire explicite", "partner" as const],
    ["clippeur", "clipper" as const],
    ["fiche historique sans population (= partenaire)", undefined],
  ])("n'ancre pas un %s", (_libelle, kind) => {
    expect(creatorActivationPatch({ kind }, MAINTENANT)).toEqual({
      status: "active",
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  auditCompteHandle,
  handleWarningMessage,
  hasHandleWarning,
} from "../convex/handleHygiene";

/**
 * Audit du pseudo d'un compte déclaré. Les tests qui comptent sont ceux des deux
 * bords : ce que l'audit DOIT attraper malgré une dispersion du mot, et ce qu'il
 * ne doit PAS signaler — un audit qui crie trop cesse d'être lu, et c'est alors
 * un compte publicitaire déclaré qui passe.
 */

const CTX = {
  productNames: ["Snytch", "snytch"],
  talentNames: ["Marine", "Kelly", "Sofia"],
};

describe("auditCompteHandle — ce qu'il doit attraper", () => {
  it("le nom du produit en clair", () => {
    expect(auditCompteHandle("@snytchapp", CTX).mentionsProduct).toBe("Snytch");
  });

  it("malgré la casse", () => {
    expect(auditCompteHandle("@SnYtChFr", CTX).mentionsProduct).toBe("Snytch");
  });

  it("malgré les séparateurs — c'est le cas qui motive la normalisation", () => {
    // Points, tirets et underscores sont exactement ce qu'un pseudo utilise pour
    // disperser un mot. Sans leur retrait, la moitié des cas passeraient.
    for (const h of ["@s.n.y.t.c.h", "@snytch_off", "@snytch-fr", "@sny.tch.app"]) {
      expect(auditCompteHandle(h, CTX).mentionsProduct).toBe("Snytch");
    }
  });

  it("malgré les accents", () => {
    expect(
      auditCompteHandle("@sofïa.clips", { ...CTX, talentNames: ["Sofia"] })
        .mentionsTalent,
    ).toBe("Sofia");
  });

  it("le nom d'un talent", () => {
    expect(auditCompteHandle("@marine.bn07", CTX).mentionsTalent).toBe("Marine");
  });
});

describe("auditCompteHandle — ce qu'il ne doit PAS signaler", () => {
  it("un pseudo neutre", () => {
    const a = auditCompteHandle("@lea.quotidien", CTX);
    expect(a.mentionsProduct).toBeNull();
    expect(a.mentionsTalent).toBeNull();
    expect(hasHandleWarning(a)).toBe(false);
  });

  it("un terme de moins de 3 caractères n'est jamais cherché", () => {
    // À 1-2 caractères une sous-chaîne se retrouve dans presque tout pseudo :
    // le signal serait constant, donc nul.
    const a = auditCompteHandle("@bobo.clips", {
      productNames: [],
      talentNames: ["Bo"],
    });
    expect(a.mentionsTalent).toBeNull();
  });

  it("à 3 caractères, un faux positif est ACCEPTÉ — le rappel prime ici", () => {
    // « Ana » dans « banana.clips » est un faux positif, et c'est le bon
    // arbitrage : l'audit est une aide à la décision qu'un humain relit. Le
    // coût d'un faux positif est une ligne à écarter ; celui d'un raté est un
    // compte rattachable à la personne d'un talent qui part en production.
    const a = auditCompteHandle("@banana.clips", {
      productNames: [],
      talentNames: ["Ana"],
    });
    expect(a.mentionsTalent).toBe("Ana");
  });

  it("une liste de termes vide ne signale rien", () => {
    const a = auditCompteHandle("@snytch", { productNames: [], talentNames: [] });
    expect(hasHandleWarning(a)).toBe(false);
  });

  it("un pseudo vide ne casse rien", () => {
    expect(hasHandleWarning(auditCompteHandle("", CTX))).toBe(false);
  });
});

describe("le message est une observation, jamais un refus", () => {
  it("produit : nomme le terme trouvé et la conséquence", () => {
    const m = handleWarningMessage(auditCompteHandle("@snytchfan", CTX));
    expect(m).toContain("Snytch");
    expect(m).toContain("hook");
    // C'est une aide à la décision : le mot « refus » n'a rien à y faire.
    expect(m).not.toMatch(/refus/i);
    expect(m).not.toMatch(/interdit/i);
  });

  it("talent : dit ce que ça expose", () => {
    const m = handleWarningMessage(auditCompteHandle("@kelly.leydie", CTX));
    expect(m).toContain("Kelly");
    expect(m).toContain("talent");
  });

  it("le produit prime sur le talent quand les deux sont présents", () => {
    // Un seul message : le plus grave d'abord, sinon l'écran empile deux phrases
    // pour une seule décision.
    const m = handleWarningMessage(auditCompteHandle("@kelly.snytch", CTX));
    expect(m).toContain("Snytch");
  });

  it("rien à signaler → null (l'écran n'affiche pas de bloc vide)", () => {
    expect(handleWarningMessage(auditCompteHandle("@neutre", CTX))).toBeNull();
  });
});

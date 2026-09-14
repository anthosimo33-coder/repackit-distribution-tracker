import { describe, it, expect } from "vitest";
import {
  auditCompteHandle,
  handleWarning,
  hasHandleWarning,
} from "../convex/handleHygiene";
import fr from "../messages/admin/fr/accounts.json";
import en from "../messages/admin/en/accounts.json";

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

  it("un PRÉNOM extrait d'un nom complet — la forme réelle des données", () => {
    // Les talents sont enregistrés sous leur nom complet, les pseudos n'en
    // reprennent qu'un morceau. Ne chercher que la chaîne entière rendait
    // l'audit muet sur le cas le plus courant — et le défaut restait invisible
    // tant que le test n'utilisait que des prénoms nus.
    const a = auditCompteHandle("@marine.bn07", {
      productNames: [],
      talentNames: ["Marine Dupont-Lefèvre"],
    });
    expect(a.mentionsTalent).toBe("Marine");
  });

  it("le nom entier compte aussi, quand le pseudo le reprend en bloc", () => {
    const a = auditCompteHandle("@marinedupont.off", {
      productNames: [],
      talentNames: ["Marine Dupont"],
    });
    expect(a.mentionsTalent).toBe("Marine Dupont");
  });

  it("un jeton purement NUMÉRIQUE n'est jamais cherché", () => {
    // Une suite de chiffres dans un nom ne désigne rien, et collerait au hasard
    // sur tout pseudo qui en contient (les jeux e2e suffixent par un timestamp).
    const a = auditCompteHandle("@neutre1755012345", {
      productNames: [],
      talentNames: ["Talent 1755012345"],
    });
    expect(a.mentionsTalent).toBeNull();
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

describe("l'avertissement est une observation, jamais un refus", () => {
  /** La phrase rendue par l'écran, dans la langue demandée. */
  const phrase = (handle: string, locale: "fr" | "en") => {
    const w = handleWarning(auditCompteHandle(handle, CTX));
    if (w === null) return null;
    const cat = locale === "fr" ? fr : en;
    return (cat.handleWarning as Record<string, string>)[w.key].replace("{mot}", w.mot);
  };

  it("produit : nomme le terme trouvé et la conséquence", () => {
    const m = phrase("@snytchfan", "fr");
    expect(m).toContain("Snytch");
    expect(m).toContain("hook");
    // C'est une aide à la décision : le mot « refus » n'a rien à y faire.
    expect(m).not.toMatch(/refus/i);
    expect(m).not.toMatch(/interdit/i);
    // Et la version anglaise dit la même chose, sans français.
    expect(phrase("@snytchfan", "en")).toContain("hook");
    expect(phrase("@snytchfan", "en")).not.toMatch(/pseudo/i);
  });

  it("talent : dit ce que ça expose", () => {
    const m = phrase("@kelly.leydie", "fr");
    expect(m).toContain("Kelly");
    expect(m).toContain("talent");
  });

  it("le produit prime sur le talent quand les deux sont présents", () => {
    // Un seul message : le plus grave d'abord, sinon l'écran empile deux phrases
    // pour une seule décision.
    const m = phrase("@kelly.snytch", "fr");
    expect(m).toContain("Snytch");
  });

  it("rien à signaler → null (l'écran n'affiche pas de bloc vide)", () => {
    expect(handleWarning(auditCompteHandle("@neutre", CTX))).toBeNull();
  });
});

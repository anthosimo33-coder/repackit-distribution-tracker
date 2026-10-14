import { describe, it, expect } from "vitest";
import {
  dureeRelation,
  enDur,
  relationPourElle,
  remplirVariables,
  tirableAvec,
  valeursFiche,
  variablesDe,
  variablesInconnues,
} from "../convex/scenarioFiche";

/**
 * Fiche d'une conv et variables des briques — les textes viennent des
 * campagnes BLUSH (prod, 14/10/2026) : c'est elles qui contredisaient la conv
 * tirée (« 3 ANS QU'IL ME DIT QUE J'EXAGÈRE » sur une conv de 14 mois).
 */
const C2 = {
  lui: "Yanis",
  dates: { debut: "2025-08-03", fin: "2026-10-12", lune_de_miel_fin: "2025-11-01", tournant: "2026-06-21", record: "2026-02-14" },
  fiche: {
    relation: "mon copain",
    cest_normal: "c'est juste un like",
    question_chat: "est-ce que j'ai eu tort de m'excuser ?",
    resume: "Yanis a liké la photo de son ex, et c'est toi qui t'excuses.",
  },
};

describe("dureeRelation", () => {
  it("se dit comme une créatrice le dirait", () => {
    expect(dureeRelation("2025-08-03", "2026-10-12")).toBe("14 mois");
    expect(dureeRelation("2026-05-16", "2026-10-12")).toBe("4 mois");
    expect(dureeRelation("2026-09-21", "2026-10-12")).toBe("3 semaines");
    expect(dureeRelation("2026-10-05", "2026-10-12")).toBe("1 semaine");
    expect(dureeRelation("2023-09-01", "2026-10-12")).toBe("3 ans");
  });

  it("passe de semaines à mois à 8 semaines, de mois à ans à 2 ans", () => {
    expect(dureeRelation("2026-08-18", "2026-10-12")).toBe("8 semaines");
    expect(dureeRelation("2026-08-17", "2026-10-12")).toBe("2 mois");
    expect(dureeRelation("2024-10-13", "2026-10-12")).toBe("23 mois");
    expect(dureeRelation("2024-10-12", "2026-10-12")).toBe("2 ans");
  });
});

describe("valeurs et remplissage", () => {
  const v = valeursFiche(C2)!;

  it("donne les six variables, la durée en majuscules comprise", () => {
    expect(v).toEqual({
      duree: "14 mois",
      DUREE: "14 MOIS",
      relation: "mon copain",
      lui: "Yanis",
      cest_normal: "c'est juste un like",
      question_chat: "est-ce que j'ai eu tort de m'excuser ?",
    });
  });

  it("remplit un hook en majuscules et un cta", () => {
    expect(remplirVariables("{DUREE} QU'IL ME DIT QUE J'EXAGÈRE ET JE DÉCOUVRE ÇA ??!!", v)).toBe(
      "14 MOIS QU'IL ME DIT QUE J'EXAGÈRE ET JE DÉCOUVRE ÇA ??!!",
    );
    expect(remplirVariables("{duree} avec {lui} et je vois ça que maintenant 😭 #couple", v)).toBe(
      "14 mois avec Yanis et je vois ça que maintenant 😭 #couple",
    );
  });

  it("une bible sans fiche ne donne rien, et le texte reste tel quel", () => {
    expect(valeursFiche({ ...C2, fiche: undefined })).toBeNull();
    expect(remplirVariables("{duree}", null)).toBe("{duree}");
  });
});

describe("tirableAvec", () => {
  const v = valeursFiche(C2);

  it("une brique sans variable est toujours tirable", () => {
    expect(tirableAvec(["Il m'a laissée en vu deux jours"], null)).toBe(true);
  });

  it("une brique qui cite la conv exige une fiche", () => {
    expect(tirableAvec(["{DUREE} D'AMITIÉ ET JE DÉCOUVRE ÇA ??!!"], null)).toBe(false);
    expect(tirableAvec(["{DUREE} D'AMITIÉ ET JE DÉCOUVRE ÇA ??!!"], v)).toBe(true);
  });

  it("la direction et les exemples d'un hook libre comptent aussi", () => {
    expect(tirableAvec(["texte", "", "après {duree} avec lui"], null)).toBe(false);
  });

  it("liste les variables employées, une fois chacune", () => {
    expect(variablesDe("{lui} {lui} {question_chat}")).toEqual(["lui", "question_chat"]);
  });
});

describe("relationPourElle", () => {
  it("passe de « mon » à « ton »", () => {
    expect(relationPourElle("mon copain")).toBe("ton copain");
    expect(relationPourElle("mon meilleur ami")).toBe("ton meilleur ami");
    expect(relationPourElle("ma meilleure amie")).toBe("ta meilleure amie");
  });
});

describe("enDur — les briques BLUSH qui contredisaient la conv", () => {
  it("repère les durées et les relations écrites en dur", () => {
    expect(enDur("LES 2006 QUI PARLENT À UN MEC DEPUIS 3 SEMAINES SONT FOUTUES MDR !!!!")).toEqual(["3 SEMAINES"]);
    expect(enDur("8 ANS D'AMITIÉ ET JE DÉCOUVRE ÇA ??!!")).toEqual(["8 ANS"]);
    expect(enDur("3 ans ensemble et je vois ça que maintenant 😭 #couple #dispute")).toEqual(["3 ans"]);
    expect(enDur("On se parle depuis trois semaines, et depuis quelques jours il répond plus pareil.")).toEqual([
      "trois semaines",
    ]);
    expect(enDur("j'ai mis la conv avec mon copain dans une IA")).toEqual(["mon copain"]);
  });

  it("laisse passer ce qui n'affirme rien sur la conv", () => {
    expect(enDur("Ça fait trois jours qu'il me répond plus pareil")).toEqual([]);
    expect(enDur("mon intuition avait donc raison #crush #pourlesfilles #relation")).toEqual([]);
    expect(enDur("{DUREE} QU'IL ME DIT QUE J'EXAGÈRE")).toEqual([]);
  });

  it("signale une variable mal écrite", () => {
    expect(variablesInconnues("{durée} avec {lui} et {prenom}")).toEqual(["durée", "prenom"]);
  });
});

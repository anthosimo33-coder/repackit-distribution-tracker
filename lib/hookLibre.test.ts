/**
 * HOOK LIBRE (`convex/hookLibre.ts`) — ce qui est DÉCIDABLE sans base : quand une
 * brique s'affiche en direction, et comment le texte figé se découpe autour.
 *
 * Le texte figé est construit ici par `assembleNoLabels`, le vrai montage du
 * tirage, et pas par une jointure recopiée : c'est sur LUI que la découpe doit
 * tenir.
 */
import { describe, it, expect } from "vitest";
import {
  hookLibreDuTexte,
  hookLibreOf,
  normaliserAutresExemples,
  resteApresHook,
} from "../convex/hookLibre";
import { assembleNoLabels } from "../convex/scripts";

const HOOK = "8 mois de situationship et je découvre ÇA ??!!";
const FLUX = "Il me disait qu'il était « pas prêt »…\nSpoiler : il l'était, mais pas avec moi.";
const CTA = "mon intuition avait donc raison #crush #pourlesfilles #relation";

describe("hookLibreOf", () => {
  const base = { kind: "hook", content: HOOK };

  it("un hook ordinaire reste ordinaire", () => {
    expect(hookLibreOf(base)).toBeNull();
    expect(hookLibreOf({ ...base, libre: false, direction: "Une durée + une découverte" })).toBeNull();
  });

  it("seul un hook peut être libre", () => {
    expect(hookLibreOf({ kind: "flux", content: FLUX, libre: true })).toBeNull();
  });

  it("libre : la direction, puis l'exemple principal suivi des autres", () => {
    expect(
      hookLibreOf({
        ...base,
        libre: true,
        direction: "  Une relation qui dure, puis tu tombes sur un truc.  ",
        autresExemples: ["On se parle depuis 3 semaines et je viens de voir ÇA…"],
      }),
    ).toEqual({
      direction: "Une relation qui dure, puis tu tombes sur un truc.",
      exemples: [HOOK, "On se parle depuis 3 semaines et je viens de voir ÇA…"],
    });
  });

  it("libre sans direction : les exemples seuls suffisent", () => {
    expect(hookLibreOf({ ...base, libre: true, direction: "   " })).toEqual({
      direction: null,
      exemples: [HOOK],
    });
  });

  it("libre mais vide : rien à montrer, affichage ordinaire", () => {
    expect(hookLibreOf({ kind: "hook", content: "  ", libre: true })).toBeNull();
  });
});

describe("normaliserAutresExemples", () => {
  it("saisie de l'écran : une ligne par exemple, vides et doublons écartés", () => {
    expect(
      normaliserAutresExemples(
        "  2 ans avec lui et je trouve ÇA \n\n2 ans avec lui et je trouve ÇA\nIl me jure qu'il est célibataire. Spoiler :\n",
        HOOK,
      ),
    ).toEqual(["2 ans avec lui et je trouve ÇA", "Il me jure qu'il est célibataire. Spoiler :"]);
  });

  it("l'exemple principal n'est pas répété parmi les autres", () => {
    expect(normaliserAutresExemples([` ${HOOK} `, "Mon talking stage m'a menti pendant 4 mois"], HOOK)).toEqual([
      "Mon talking stage m'a menti pendant 4 mois",
    ]);
  });
});

describe("resteApresHook — sur le vrai montage du tirage", () => {
  const texte = assembleNoLabels({ hook: `  ${HOOK}\n`, flux: FLUX, cta: CTA });

  it("retire l'accroche et garde flux puis cta tels quels", () => {
    expect(resteApresHook(texte, HOOK)).toBe(`${FLUX}\n\n${CTA}`);
  });

  it("exemple corrigé depuis l'assignation : pas de découpe", () => {
    expect(resteApresHook(texte, "12 jours de situationship et je découvre ÇA ??!!")).toBeNull();
  });

  it("un exemple qui n'est qu'un début de l'accroche figée ne découpe pas", () => {
    expect(resteApresHook(texte, "8 mois de situationship")).toBeNull();
  });

  it("pas de texte figé : rien", () => {
    expect(resteApresHook(undefined, HOOK)).toBeNull();
  });
});

describe("hookLibreDuTexte — ce que reçoit la carte unique", () => {
  const texte = assembleNoLabels({ hook: HOOK, flux: FLUX, cta: CTA });
  const libre = { kind: "hook", content: HOOK, libre: true, direction: "Une durée, puis une découverte." };

  it("hook libre : la direction, les exemples et la suite du script", () => {
    expect(hookLibreDuTexte(libre, texte)).toEqual({
      direction: "Une durée, puis une découverte.",
      exemples: [HOOK],
      reste: `${FLUX}\n\n${CTA}`,
    });
  });

  it("hook ordinaire, ou exemple corrigé depuis : texte tel quel", () => {
    expect(hookLibreDuTexte({ ...libre, libre: undefined }, texte)).toBeNull();
    expect(hookLibreDuTexte({ ...libre, content: "3 semaines de talking stage et je découvre ÇA" }, texte)).toBeNull();
  });
});

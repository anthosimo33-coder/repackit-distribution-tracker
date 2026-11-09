import { describe, expect, it } from "vitest";
import {
  addExample,
  FAMILY_EXAMPLES,
  familyPrompt,
  formatLang,
  haikuCostUsd,
  placeAnswer,
  type FamilyCandidate,
  type KnownFamily,
} from "../convex/radarFamiliesMath";

// Les variantes réelles relevées le 09/11/2026 chez les comptes de Snitchy et Stalkie.
const known: KnownFamily[] = [
  { id: "famObsession", label: "Jeu : fouiller le téléphone d'une fille disparue", examples: ["new obsession: a game where you have to go through a missing girl's phone"] },
  { id: "famSnap", label: "La mise à jour Snapchat qui montre s'il te trompe", examples: ["La mise à jour SNAPCHAT qui te permet de voir si ton mec te trompe"] },
];
const candidates: FamilyCandidate[] = [
  { id: "fDe", variants: ["Neue Obsession: Ein Spiel, in dem du das Handy eines verschwundenen Mädchens durchsuchst"] },
  { id: "fFr", variants: ["POV: Cette fille a disparu et tu dois fouiller son tel"] },
  { id: "fEs", variants: ["Cuando tu novio te dice que solo es una amiga"] },
  { id: "fPt", variants: ["Quando seu namorado diz que é só uma amiga"] },
];

describe("familles de hooks (radarFamiliesMath)", () => {
  it("la demande numérote familles et hooks sans livrer les ids de la base", () => {
    const p = familyPrompt(candidates, known);
    expect(p).toContain("E1: Jeu : fouiller le téléphone d'une fille disparue — examples: «new obsession");
    expect(p).toContain("H2: «POV: Cette fille a disparu et tu dois fouiller son tel»");
    expect(p).not.toContain("famObsession");
    expect(p).not.toContain("fDe");
    expect(familyPrompt(candidates, [])).toContain("(none yet)");
  });

  it("range chaque hook : famille connue, nouvelle famille partagée par deux langues", () => {
    const r = placeAnswer(
      {
        placements: [
          { hook: "H1", family: "E1" },
          { hook: "h2", family: "e1" },
          { hook: "H3", family: "N1" },
          { hook: "H4", family: "N1" },
        ],
        newFamilies: [{ id: "N1", label: "  « C'est juste une amie »  " }],
      },
      candidates,
      known,
    );
    expect(r.placements).toEqual([
      { formatId: "fDe", family: { known: "famObsession" } },
      { formatId: "fFr", family: { known: "famObsession" } },
      { formatId: "fEs", family: { ref: "N1" } },
      { formatId: "fPt", family: { ref: "N1" } },
    ]);
    expect(r.newFamilies).toEqual([{ ref: "N1", label: "« C'est juste une amie »" }]);
  });

  it("une réponse incomplète ou fausse ne perd aucun format et n'invente rien : le hook ouvre sa famille", () => {
    const r = placeAnswer(
      {
        placements: [
          { hook: "H1", family: "E9" }, // famille inconnue
          { hook: "H2", family: "N3" }, // nouvelle famille sans étiquette
          { hook: "H7", family: "E1" }, // hook inconnu
        ],
        newFamilies: [{ id: "X1", label: "pas un id" }],
      },
      candidates.slice(0, 3),
      known,
    );
    expect(r.placements.map((p) => p.family)).toEqual([{ ref: "self:fDe" }, { ref: "self:fFr" }, { ref: "self:fEs" }]);
    // Étiquetée de sa variante, coupée à 80 caractères.
    expect(r.newFamilies.map((f) => f.label)).toEqual([
      "Neue Obsession: Ein Spiel, in dem du das Handy eines verschwundenen Mädchens du…",
      candidates[1].variants[0],
      candidates[2].variants[0],
    ]);
    // Pas de réponse du tout : pareil.
    expect(placeAnswer(null, candidates.slice(0, 1), known).placements).toEqual([{ formatId: "fDe", family: { ref: "self:fDe" } }]);
  });

  it("une nouvelle famille annoncée mais rangée nulle part n'est pas créée", () => {
    const r = placeAnswer({ placements: [{ hook: "H1", family: "E1" }], newFamilies: [{ id: "N1", label: "orpheline" }] }, candidates.slice(0, 1), known);
    expect(r.newFamilies).toEqual([]);
  });

  it("la langue d'un format est celle de la majorité de ses comptes", () => {
    expect(formatLang(["de", "de", "en", undefined])).toBe("de");
    expect(formatLang(["fr", "en"])).toBe("en"); // égalité : ordre alphabétique, stable
    expect(formatLang([undefined])).toBe("autre");
  });

  it("garde au plus 4 exemples par famille, une langue nouvelle avant une langue déjà vue", () => {
    let ex: { text: string; lang: string }[] = [];
    for (const [text, lang] of [["a", "en"], ["b", "en"], ["c", "de"], ["d", "fr"]] as const) ex = addExample(ex, { text, lang });
    expect(ex).toHaveLength(FAMILY_EXAMPLES);
    // Un doublon ne change rien.
    expect(addExample(ex, { text: "c", lang: "de" })).toEqual(ex);
    // Une 5e en espagnol chasse l'anglais le plus ancien, pas une langue seule.
    expect(addExample(ex, { text: "e", lang: "es-am" }).map((e) => e.text)).toEqual(["b", "c", "d", "e"]);
  });

  it("coût d'un appel Claude Haiku 5.5 : 0,10 $ le million de jetons lus, 0,50 $ écrits", () => {
    expect(haikuCostUsd({ input_tokens: 4_000, output_tokens: 1_200 })).toBeCloseTo(0.001, 6);
    expect(haikuCostUsd({ input_tokens: 1_000, output_tokens: 0, cache_read_input_tokens: 3_000 })).toBeCloseTo(0.0004, 6);
  });
});

import { describe, it, expect } from "vitest";
import {
  lastUseForCreatorPlatforms,
  usedComboKeysForCreatorPlatforms,
  type AssignmentComboUsage,
} from "./script-combo-uniqueness";
import { moinsRecent, tirerPourDates } from "../convex/comboRecency";
import {
  comboKeyOf,
  comboKeysInCooldown,
  generateCombos,
  pickCombosForCreator,
  type Combo,
  type ComboBrick,
  type ScheduledComboUsage,
} from "./scriptCombos";

const JOUR = 86_400_000;
// Minuit Paris, comme les postDates de la prod.
const J0 = Date.UTC(2026, 10, 2, 23, 0, 0); // 03/11/2026 00:00 Paris
const X = "k17h1q8x2v:k57f3n9c1d:k97c2m4p8e"; // comboKey de référence
const Y = "k17h7w2r5t:k57f8b1s3a:k97c6d9q2z";

describe("ce qu'elle a déjà fait — par créatrice et par plateforme", () => {
  const existing: AssignmentComboUsage[] = [
    { creatorId: "bader", comboKey: X, platforms: ["TikTok"], usedAt: J0 },
    { creatorId: "bader", comboKey: Y, platforms: ["YouTube"], usedAt: J0 + JOUR },
    { creatorId: "marielle", comboKey: X, platforms: ["TikTok"], usedAt: J0 + 2 * JOUR },
  ];

  it("union des combos faits sur les plateformes ciblées (TikTok)", () => {
    const used = usedComboKeysForCreatorPlatforms({
      creatorId: "bader",
      platforms: ["TikTok"],
      existingAssignments: existing,
    });
    expect([...used]).toEqual([X]); // Y est sur YouTube → neuf pour TikTok
  });

  it("cible multi-plateformes : un combo fait sur l'une OU l'autre est déjà fait", () => {
    const used = usedComboKeysForCreatorPlatforms({
      creatorId: "bader",
      platforms: ["TikTok", "YouTube"],
      existingAssignments: existing,
    });
    expect([...used].sort()).toEqual([X, Y]);
  });

  it("isole par créatrice : ce que marielle a fait reste neuf pour bader", () => {
    const used = usedComboKeysForCreatorPlatforms({
      creatorId: "bader",
      platforms: ["Instagram"],
      existingAssignments: existing,
    });
    expect(used.size).toBe(0);
    // Contre-épreuve de présence : marielle, elle, l'a fait.
    expect(
      usedComboKeysForCreatorPlatforms({
        creatorId: "marielle",
        platforms: ["TikTok"],
        existingAssignments: existing,
      }).has(X),
    ).toBe(true);
  });

  it("une ligne à combo IMPOSÉ ne compte pas comme déjà faite", () => {
    const withImposed: AssignmentComboUsage[] = [
      { creatorId: "bader", comboKey: X, platforms: ["TikTok"], usedAt: J0 },
      { creatorId: "bader", comboKey: Y, platforms: ["TikTok"], usedAt: J0, comboImposed: true },
    ];
    const used = usedComboKeysForCreatorPlatforms({
      creatorId: "bader",
      platforms: ["TikTok"],
      existingAssignments: withImposed,
    });
    expect([...used]).toEqual([X]);
  });

  it("garde le passage le plus RÉCENT d'un script fait plusieurs fois", () => {
    const deuxFois: AssignmentComboUsage[] = [
      { creatorId: "bader", comboKey: X, platforms: ["TikTok"], usedAt: J0 + 9 * JOUR },
      { creatorId: "bader", comboKey: X, platforms: ["TikTok", "Instagram"], usedAt: J0 + 2 * JOUR },
    ];
    expect(
      lastUseForCreatorPlatforms({
        creatorId: "bader",
        platforms: ["TikTok"],
        existingAssignments: deuxFois,
      }).get(X),
    ).toBe(J0 + 9 * JOUR);
  });
});

// ─── Le tirage d'une créatrice : jamais fait d'abord, puis le moins récent ───
//
// La boucle est celle du serveur (`tirerPourDates`, convex/comboRecency), avec
// le tirage équilibré de lib (réplique A6 de `pickCombosServer`) et le
// cooldown de lib (réplique de `comboKeysInCooldownServer`).

let seq = 0;
/** Des briques aux ids de la forme Convex, dans l'ordre de création. */
function briques(kind: ComboBrick["kind"], textes: string[]): ComboBrick[] {
  return textes.map((content) => ({ _id: `k${kind[0]}${(seq += 1)}x9w2q`, kind, content, active: true }));
}

/** BLUSH TOFU en petit : 3 hooks × 1 corps × 1 légende = 3 scripts. */
function catalogueBlush(): Combo[] {
  return generateCombos([
    ...briques("hook", [
      "Il te garde au chaud pendant qu'il en voit une autre",
      "Il répond à ses stories mais pas à tes messages",
      "Il t'a dit « je suis pas prêt » le mois dernier",
    ]),
    ...briques("flux", ["Regarde ce que l'app m'a montré sur son compte…"]),
    ...briques("cta", ["Le lien est dans ma bio 💗"]),
  ]);
}

function tirer(
  combos: Combo[],
  o: {
    derniers?: Map<string, number>;
    projet?: ScheduledComboUsage[];
    dates?: (number | undefined)[];
    count: number;
    delaiJours?: number;
    retires?: string[];
  },
): string[] {
  const delai = o.delaiJours ?? 1;
  return tirerPourDates({
    combos,
    cleDe: comboKeyOf,
    equilibre: (cs, exclus) => pickCombosForCreator([...cs], new Set(exclus), 1)[0] ?? null,
    derniers: o.derniers ?? new Map(),
    bloquesLe: (date) => comboKeysInCooldown(o.projet ?? [], date, delai),
    delaiMs: delai * JOUR,
    dates: o.dates,
    count: o.count,
    retiresALaMain: o.retires,
  }).map(comboKeyOf);
}

describe("tirage — un script déjà fait peut revenir (11/11/2026)", () => {
  it("catalogue épuisé : elle reçoit de nouveau un script déjà fait, le moins récent d'abord", () => {
    const combos = catalogueBlush();
    const [a, b, c] = combos.map(comboKeyOf);
    // Elle a tout fait. Le PREMIER du catalogue (a) est le plus récent : un
    // tirage qui suivrait l'ordre de création le redonnerait.
    const derniers = new Map([
      [b, J0 - 9 * JOUR],
      [c, J0 - 6 * JOUR],
      [a, J0 - 2 * JOUR],
    ]);
    expect(tirer(combos, { derniers, dates: [J0], count: 1 })).toEqual([b]);
  });

  it("une semaine sur un catalogue épuisé tourne sur tous les scripts, pas toujours le premier", () => {
    const combos = catalogueBlush();
    const [a, b, c] = combos.map(comboKeyOf);
    const derniers = new Map([
      [a, J0 - 9 * JOUR],
      [b, J0 - 6 * JOUR],
      [c, J0 - 2 * JOUR],
    ]);
    const semaine = Array.from({ length: 6 }, (_, i) => J0 + i * JOUR);
    expect(tirer(combos, { derniers, dates: semaine, count: 6 })).toEqual([a, b, c, a, b, c]);
  });

  it("ce qu'elle n'a jamais fait passe AVANT tout script déjà fait, même ancien", () => {
    const combos = catalogueBlush();
    const [a, b, c] = combos.map(comboKeyOf);
    const derniers = new Map([
      [a, J0 - 60 * JOUR],
      [b, J0 - 1 * JOUR],
    ]);
    // c n'a jamais été fait : il passe devant a, fait il y a deux mois.
    expect(tirer(combos, { derniers, dates: [J0, J0 + JOUR], count: 2 })).toEqual([c, a]);
  });

  it("sans historique : trois vidéos, trois scripts différents, puis il reboucle", () => {
    const combos = catalogueBlush();
    const [a, b, c] = combos.map(comboKeyOf);
    // Sans date : rien n'interdit, l'ordre des choix de CE tirage fait foi.
    expect(tirer(combos, { count: 5 })).toEqual([a, b, c, a, b]);
  });

  it("le délai du projet reste un interdit — chez une autre créatrice comme chez elle", () => {
    const combos = catalogueBlush();
    const [a, b, c] = combos.map(comboKeyOf);
    const derniers = new Map([
      [a, J0 - 9 * JOUR],
      [b, J0 - 6 * JOUR],
      [c, J0 - 2 * JOUR],
    ]);
    // a, le moins récent chez elle, sort le même jour chez une autre créatrice :
    // interdit ce jour-là → b.
    expect(
      tirer(combos, { derniers, projet: [{ comboKey: a, anchorAt: J0 }], dates: [J0], count: 1 }),
    ).toEqual([b]);
    // Quatre vidéos le MÊME jour sur trois scripts : la 4e reprendrait un script
    // de ce jour-là → interdite par le délai, pénurie plutôt que doublon.
    expect(tirer(combos, { derniers, dates: [J0, J0, J0, J0], count: 4 })).toEqual([a, b, c]);
    // Contre-épreuve de présence : le lendemain, le même script revient.
    expect(tirer(combos, { derniers, dates: [J0, J0, J0, J0 + JOUR], count: 4 })).toEqual([a, b, c, a]);
  });

  it("retraits à la main et délai peuvent tout interdire : pénurie, pas de doublon", () => {
    const combos = catalogueBlush();
    const [a, b, c] = combos.map(comboKeyOf);
    expect(
      tirer(combos, {
        projet: [{ comboKey: a, anchorAt: J0 }],
        retires: [b, c],
        dates: [J0],
        count: 1,
      }),
    ).toEqual([]);
  });
});

describe("moinsRecent", () => {
  const cle = (s: string) => s;
  it("à égalité de date, l'ordre du catalogue — déterministe", () => {
    const d = new Map([
      ["s1", J0],
      ["s2", J0],
    ]);
    expect(moinsRecent(["s2", "s1"], cle, d, new Set())).toBe("s2");
  });
  it("tout exclu → null", () => {
    expect(moinsRecent(["s1"], cle, new Map(), new Set(["s1"]))).toBeNull();
  });
});

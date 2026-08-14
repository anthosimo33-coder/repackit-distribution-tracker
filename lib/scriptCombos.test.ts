import { describe, it, expect } from "vitest";
import {
  generateCombos,
  pickCombosForCreator,
  comboKeyOf,
  parseComboKey,
  comboKeysInCooldown,
  firstFreeSlotAfter,
  shiftPostDatesByDays,
  type ComboBrick,
  type ScheduledComboUsage,
} from "./scriptCombos";

/** Construit n bricks d'un kind donné (actives par défaut). */
function bricks(
  kind: ComboBrick["kind"],
  n: number,
  active = true,
  prefix: string = kind,
): ComboBrick[] {
  return Array.from({ length: n }, (_, i) => ({
    _id: `${prefix}${i}`,
    kind,
    content: `${kind} ${i}`,
    active,
  }));
}

describe("generateCombos", () => {
  it("produit le cartésien des actifs (2×2×2 = 8)", () => {
    const all = [...bricks("hook", 2), ...bricks("flux", 2), ...bricks("cta", 2)];
    const combos = generateCombos(all);
    expect(combos.length).toBe(8);
    // assembledScript figé, SANS étiquette de section ni socle démo.
    expect(combos[0].assembledScript).not.toContain("## Hook");
    expect(combos[0].assembledScript).toContain("hook 0");
    expect(combos[0].assembledScript).toContain("flux 0");
    expect(combos[0].assembledScript).toContain("cta 0");
  });

  it("reproduit 104 (campagne seedée : 26 hooks × 2 flux × 2 cta)", () => {
    const all = [
      ...bricks("hook", 26),
      ...bricks("flux", 2),
      ...bricks("cta", 2),
    ];
    expect(generateCombos(all).length).toBe(104);
  });

  it("0 combo si un kind n'a aucune brick active", () => {
    const all = [
      ...bricks("hook", 3),
      ...bricks("flux", 2),
      // pas de cta
    ];
    expect(generateCombos(all).length).toBe(0);
  });

  it("ignore les bricks inactives", () => {
    const all = [
      ...bricks("hook", 2),
      ...bricks("flux", 2),
      ...bricks("cta", 1),
      ...bricks("cta", 1, false, "ctaOff"), // inactif → ignoré
    ];
    expect(generateCombos(all).length).toBe(4); // 2×2×1
  });

  it("comboKey = hook:flux:cta (3 segments)", () => {
    const all = [...bricks("hook", 1), ...bricks("flux", 1), ...bricks("cta", 1)];
    const key = comboKeyOf(generateCombos(all)[0]);
    expect(key.split(":")).toHaveLength(3);
    expect(key).toBe("hook0:flux0:cta0");
  });
});

describe("pickCombosForCreator", () => {
  const all = [...bricks("hook", 26), ...bricks("flux", 2), ...bricks("cta", 2)];
  const combos = generateCombos(all); // 104

  it("renvoie n combos DISTINCTS", () => {
    const picked = pickCombosForCreator(combos, new Set(), 5);
    expect(picked.length).toBe(5);
    const keys = picked.map(comboKeyOf);
    expect(new Set(keys).size).toBe(5);
  });

  it("maximise la diversité de hook (5 picks → 5 hooks distincts)", () => {
    const picked = pickCombosForCreator(combos, new Set(), 5);
    const hooks = new Set(picked.map((c) => c.hookBrickId));
    expect(hooks.size).toBe(5);
  });

  it("évite les combos déjà reçus (usedKeys)", () => {
    const first = pickCombosForCreator(combos, new Set(), 5);
    const usedKeys = new Set(first.map(comboKeyOf));
    const second = pickCombosForCreator(combos, usedKeys, 5);
    // Aucun chevauchement avec la 1re série.
    for (const c of second) expect(usedKeys.has(comboKeyOf(c))).toBe(false);
    expect(second.length).toBe(5);
  });

  it("épuisement : renvoie au plus le stock disponible", () => {
    const usedKeys = new Set(combos.slice(0, 102).map(comboKeyOf));
    const picked = pickCombosForCreator(combos, usedKeys, 5);
    expect(picked.length).toBe(2); // seulement 2 restants
  });

  it("n=0 → vide", () => {
    expect(pickCombosForCreator(combos, new Set(), 0)).toEqual([]);
  });
});

// ─── Diversité des 3 dimensions (hook/flux/cta) — fermeture du bug ────────────
// Angle mort historique : les tests ne couvraient que la diversité de hook à N=5
// (< 1 round). flux & cta restaient figés tant que N < hooks·cta → ces tests
// ÉCHOUENT sur l'ancien round-robin (flux/cta distincts = 1) et passent sur la
// sélection gloutonne least-used.
describe("pickCombosForCreator — diversité des 3 dimensions", () => {
  /** Campagne H hooks × F flux × C cta (ids hookN / fluxN / ctaN). */
  const campaign = (H: number, F: number, C: number) =>
    generateCombos([
      ...bricks("hook", H),
      ...bricks("flux", F),
      ...bricks("cta", C),
    ]);

  type Dim = "hookBrickId" | "fluxBrickId" | "ctaBrickId";
  const distinct = (picked: ReturnType<typeof campaign>, dim: Dim) =>
    new Set(picked.map((c) => c[dim])).size;
  const usage = (picked: ReturnType<typeof campaign>, dim: Dim) => {
    const m = new Map<string, number>();
    for (const c of picked) m.set(c[dim], (m.get(c[dim]) ?? 0) + 1);
    return [...m.values()];
  };
  const spread = (counts: number[]) =>
    Math.max(...counts) - Math.min(...counts);

  it("petit N (12/4/2, N=6) : flux ET cta varient (> 1 distinct)", () => {
    // Sur l'ancien round-robin : flux distinct = 1 ET cta distinct = 1 → ÉCHEC.
    const picked = pickCombosForCreator(campaign(12, 4, 2), new Set(), 6);
    expect(picked.length).toBe(6);
    expect(distinct(picked, "fluxBrickId")).toBeGreaterThan(1);
    expect(distinct(picked, "ctaBrickId")).toBeGreaterThan(1);
    // Hook reste maximalement divers (autant de hooks distincts que de picks).
    expect(distinct(picked, "hookBrickId")).toBe(6);
  });

  it("N=12 (12/4/2) : flux & cta pleinement variés et équilibrés", () => {
    const picked = pickCombosForCreator(campaign(12, 4, 2), new Set(), 12);
    expect(picked.length).toBe(12);
    expect(distinct(picked, "fluxBrickId")).toBe(4); // tous les flux
    expect(distinct(picked, "ctaBrickId")).toBe(2); // tous les cta
    expect(distinct(picked, "hookBrickId")).toBe(12);
    // Équilibre : écart d'usage minimal entre bricks d'une même dimension.
    expect(spread(usage(picked, "fluxBrickId"))).toBeLessThanOrEqual(1);
    expect(spread(usage(picked, "ctaBrickId"))).toBeLessThanOrEqual(1);
  });

  it("N=20 (12/4/2) : hooks réutilisés mais équilibrés, flux/cta variés", () => {
    const picked = pickCombosForCreator(campaign(12, 4, 2), new Set(), 20);
    expect(picked.length).toBe(20);
    expect(distinct(picked, "fluxBrickId")).toBe(4);
    expect(distinct(picked, "ctaBrickId")).toBe(2);
    expect(distinct(picked, "hookBrickId")).toBe(12); // 12 hooks, tous servis
    // 20 picks / 12 hooks → 8 hooks 2×, 4 hooks 1× → écart 1.
    expect(spread(usage(picked, "hookBrickId"))).toBeLessThanOrEqual(1);
    expect(spread(usage(picked, "fluxBrickId"))).toBeLessThanOrEqual(1);
    expect(spread(usage(picked, "ctaBrickId"))).toBeLessThanOrEqual(1);
  });

  it("cas piège F=4,C=2 (facteur commun 2) : pas de cas limite", () => {
    // N=8 = multiple de F et de C → équilibre PARFAIT (spread 0) attendu.
    const picked = pickCombosForCreator(campaign(12, 4, 2), new Set(), 8);
    expect(usage(picked, "fluxBrickId")).toEqual([2, 2, 2, 2]);
    expect(spread(usage(picked, "ctaBrickId"))).toBe(0); // 4 + 4
  });

  it("cas piège F=3,C=2 : équilibre tenu (aucun flux/cta figé)", () => {
    const picked = pickCombosForCreator(campaign(12, 3, 2), new Set(), 6);
    expect(distinct(picked, "fluxBrickId")).toBe(3);
    expect(distinct(picked, "ctaBrickId")).toBe(2);
    expect(spread(usage(picked, "fluxBrickId"))).toBeLessThanOrEqual(1);
    expect(spread(usage(picked, "ctaBrickId"))).toBeLessThanOrEqual(1);
  });

  it("déterministe : même entrée → même sortie (tie-break stable)", () => {
    const all = campaign(12, 4, 2);
    const a = pickCombosForCreator(all, new Set(), 10).map(comboKeyOf);
    const b = pickCombosForCreator(all, new Set(), 10).map(comboKeyOf);
    expect(a).toEqual(b);
  });

  it("usedKeys amorcent l'équilibre : le flux sur-servi est ensuite évité", () => {
    const all = campaign(12, 4, 2);
    // Simule une assignation passée bugguée : 6 combos tous sur flux0.
    const usedKeys = new Set(
      Array.from({ length: 6 }, (_, i) => `hook${i}:flux0:cta${i % 2}`),
    );
    const picked = pickCombosForCreator(all, usedKeys, 6);
    expect(picked.length).toBe(6);
    // flux0 est déjà saturé (6×) → la nouvelle sélection ne le re-pioche pas.
    expect(picked.every((c) => c.fluxBrickId !== "flux0")).toBe(true);
    // Et continue d'exclure les combos déjà pris (pas de doublon).
    for (const c of picked) expect(usedKeys.has(comboKeyOf(c))).toBe(false);
  });
});

describe("parseComboKey (rejeu depuis analytics)", () => {
  it("3 segments (refonte) → hook/flux/cta", () => {
    expect(parseComboKey("h1:f1:c1")).toEqual({
      hookBrickId: "h1",
      fluxBrickId: "f1",
      ctaBrickId: "c1",
    });
  });

  it("4 segments legacy → corps ignoré (hook, flux, cta)", () => {
    expect(parseComboKey("h1:corps1:f1:c1")).toEqual({
      hookBrickId: "h1",
      fluxBrickId: "f1",
      ctaBrickId: "c1",
    });
  });

  it("aller-retour avec comboKeyOf", () => {
    const combo = { hookBrickId: "h9", fluxBrickId: "f9", ctaBrickId: "c9" };
    expect(parseComboKey(comboKeyOf(combo))).toEqual(combo);
  });

  it("forme inattendue → null (non rejouable)", () => {
    expect(parseComboKey("h1:f1")).toBeNull();
    expect(parseComboKey("")).toBeNull();
  });
});

// ─── Cooldown PROJET ────────────────────────────────────────────────────────
//
// Simule le chemin serveur : l'exclusion passée au picker est l'UNION de
// l'unicité à vie (créateur × plateforme) et du cooldown projet à la date visée.
// C'est exactement ce que fait convex/scripts.assignScriptCampaign, vidéo par
// vidéo. Les dates sont des instants RÉELS (minuit Paris, comme en prod), pas
// des entiers arbitraires.

const J0 = Date.UTC(2026, 7, 10, 22, 0, 0); // 11/08 00:00 Paris
const JOUR = 86_400_000;

/** Le catalogue d'une petite campagne : 3 hooks × 2 flux × 2 cta = 12 combos. */
function catalogue() {
  return generateCombos([
    ...bricks("hook", 3),
    ...bricks("flux", 2),
    ...bricks("cta", 2),
  ]);
}

/** Reproduit la sélection serveur pour UNE vidéo à une date donnée. */
function pickOne(
  combos: ReturnType<typeof generateCombos>,
  opts: {
    lifetime?: Set<string>;
    projectUsages?: ScheduledComboUsage[];
    targetAt: number | null;
  },
) {
  const excluded = new Set<string>([
    ...(opts.lifetime ?? []),
    ...comboKeysInCooldown(opts.projectUsages ?? [], opts.targetAt),
  ]);
  return pickCombosForCreator(combos, excluded, 1)[0] ?? null;
}

describe("cooldown projet — le même script ne repart pas ailleurs dans la fenêtre", () => {
  it("deux créatrices sans historique, même campagne, même jour → combos DIFFÉRENTS", () => {
    const combos = catalogue();
    // Kelly passe en premier : rien ne bloque.
    const kelly = pickOne(combos, { targetAt: J0 });
    expect(kelly).not.toBeNull();
    // Orlane vise le MÊME jour ; le combo de Kelly occupe désormais la fenêtre.
    const orlane = pickOne(combos, {
      targetAt: J0,
      projectUsages: [{ comboKey: comboKeyOf(kelly!), anchorAt: J0 }],
    });
    expect(orlane).not.toBeNull();
    expect(comboKeyOf(orlane!)).not.toBe(comboKeyOf(kelly!));
  });

  it("borne EXACTE : refusé à J+3, accepté à J+4", () => {
    const combos = catalogue();
    const kelly = pickOne(combos, { targetAt: J0 });
    const usages: ScheduledComboUsage[] = [
      { comboKey: comboKeyOf(kelly!), anchorAt: J0 },
    ];
    // J+3 : encore dans la fenêtre → le combo de Kelly est exclu.
    expect(comboKeysInCooldown(usages, J0 + 3 * JOUR)).toContain(
      comboKeyOf(kelly!),
    );
    // J+4 : la fenêtre est passée → il redevient piochable.
    expect(comboKeysInCooldown(usages, J0 + 4 * JOUR).size).toBe(0);
    // Et symétrique : programmer 3 jours AVANT est bloqué aussi, sinon on
    // contournerait la règle en planifiant à rebours.
    expect(comboKeysInCooldown(usages, J0 - 3 * JOUR)).toContain(
      comboKeyOf(kelly!),
    );
    expect(comboKeysInCooldown(usages, J0 - 4 * JOUR).size).toBe(0);
  });

  it("l'exclusion à vie par créatrice survit à l'expiration du cooldown", () => {
    const combos = catalogue();
    const dejaVu = comboKeyOf(combos[0]);
    // Le cooldown projet a expiré (J+10) : plus rien ne bloque de ce côté.
    expect(comboKeysInCooldown([{ comboKey: dejaVu, anchorAt: J0 }], J0 + 10 * JOUR).size).toBe(0);
    // Mais Kelly l'a DÉJÀ reçu : l'unicité à vie le lui interdit pour toujours.
    const repioche = pickOne(combos, {
      targetAt: J0 + 10 * JOUR,
      lifetime: new Set([dejaVu]),
      projectUsages: [{ comboKey: dejaVu, anchorAt: J0 }],
    });
    expect(repioche).not.toBeNull();
    expect(comboKeyOf(repioche!)).not.toBe(dejaVu);
  });

  it("une ligne sans date d'ancrage n'occupe aucune fenêtre", () => {
    const combos = catalogue();
    const k = comboKeyOf(combos[0]);
    expect(comboKeysInCooldown([{ comboKey: k, anchorAt: null }], J0).size).toBe(0);
    // Et sans date VISÉE non plus : pas de fenêtre calculable.
    expect(comboKeysInCooldown([{ comboKey: k, anchorAt: J0 }], null).size).toBe(0);
  });

  it("pool épuisé : rien n'est rendu, et la 1re libération est datée", () => {
    // Catalogue minimal : 1 seul combo possible.
    const combos = generateCombos([
      ...bricks("hook", 1),
      ...bricks("flux", 1),
      ...bricks("cta", 1),
    ]);
    expect(combos.length).toBe(1);
    const usages: ScheduledComboUsage[] = [
      { comboKey: comboKeyOf(combos[0]), anchorAt: J0 },
    ];
    // Aucun combo disponible à J+1 → le picker ne rend RIEN (jamais un doublon).
    expect(pickOne(combos, { targetAt: J0 + JOUR, projectUsages: usages })).toBeNull();
    // Et on sait quoi répondre : le combo se libère à J0 + 4 jours.
    expect(firstFreeSlotAfter(usages, J0 + JOUR)).toBe(J0 + 4 * JOUR);
    // Rien ne bloque hors fenêtre → aucun créneau à attendre.
    expect(firstFreeSlotAfter(usages, J0 + 10 * JOUR)).toBeNull();
  });
});

describe("lot de 2 créatrices — ce qui garantit vraiment des combos distincts", () => {
  it("le décalage +1 j ne MASQUE pas un doublon : à dates IDENTIQUES, l'exclusion projet suffit", () => {
    const combos = catalogue();
    // Dates volontairement IDENTIQUES (décalage neutralisé) : si les combos sont
    // quand même distincts, c'est bien l'exclusion projet qui travaille — pas
    // l'étalement des dates. C'est le point que le décalage pourrait camoufler.
    const kelly = pickOne(combos, { targetAt: J0 });
    const orlane = pickOne(combos, {
      targetAt: J0,
      projectUsages: [{ comboKey: comboKeyOf(kelly!), anchorAt: J0 }],
    });
    expect(comboKeyOf(orlane!)).not.toBe(comboKeyOf(kelly!));

    // CONTRE-ÉPREUVE : sans l'exclusion projet, les deux tirages rendent le MÊME
    // combo (le picker est déterministe). C'est l'état d'AVANT le correctif —
    // il prouve que le test ci-dessus ne passe pas par hasard.
    const sansRegle = pickCombosForCreator(combos, new Set(), 1)[0];
    expect(comboKeyOf(sansRegle)).toBe(comboKeyOf(kelly!));
  });

  it("le planning est bien décalé d'un jour par rang de créatrice", () => {
    const plan = [J0, J0 + JOUR];
    expect(shiftPostDatesByDays(plan, 0)).toEqual(plan);
    const decale = shiftPostDatesByDays(plan, 1);
    expect(decale[0]).toBe(J0 + JOUR);
    expect(decale[1]).toBe(J0 + 2 * JOUR);
    // Le décalage ne modifie pas le tableau source.
    expect(plan[0]).toBe(J0);
  });
});

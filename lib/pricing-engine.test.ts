import { describe, it, expect } from "vitest";
import {
  computeMonthlyPayout,
  assignmentCpm,
  estimateMissionEarnings,
  tiersOf,
  evaluateBonusTiers,
  payableAssignmentViews,
  promoVideoCost,
  type PricingSnapshot,
  type PayoutItem,
  type PublicationViews,
  type BonusTier,
  MAX_PAY_PER_VIDEO_EUR,
} from "./pricing-engine";
// Réplique serveur (A6) — le moteur de paie est dupliqué côté convex ; la parité
// n'était couverte par aucun test alors qu'elle porte sur de l'argent.
import * as convexPricing from "../convex/pricing";

/** Pricing de référence : fixe 100$/60 vidéos, CPM 2$/1000. */
const P: PricingSnapshot = {
  pricingId: "p1",
  montantFixe: 100,
  nbVideosCible: 60,
  tauxCPM: 2,
  // legacy v1 (ignoré par le moteur v2) :
  seuilBonusVues: 100_000,
  montantBonus: 50,
};

function items(n: number, views: number, snapshot = P, prefix = "a"): PayoutItem[] {
  return Array.from({ length: n }, (_, i) => ({
    assignmentId: `${prefix}${i}`,
    snapshot,
    totalViews: views,
  }));
}

describe("computeMonthlyPayout — FIXE + CPM (v2, sans bonus par vidéo)", () => {
  it("fixe : 30/60 → 50$, 60 → 100$, 75 → 100$ (plafond)", () => {
    expect(computeMonthlyPayout(items(30, 0)).fixedTotal).toBe(50);
    expect(computeMonthlyPayout(items(60, 0)).fixedTotal).toBe(100);
    expect(computeMonthlyPayout(items(75, 0)).fixedTotal).toBe(100);
  });

  it("CPM 3000+2000 = 5000 vues @2$/1000 → 10$", () => {
    expect(assignmentCpm(P, 5000)).toBe(10);
    expect(computeMonthlyPayout(items(1, 5000)).cpmTotal).toBe(10);
  });

  it("RÉGRESSION : une vidéo à 1M vues ne déclenche PLUS de bonus par vidéo", () => {
    const r = computeMonthlyPayout(items(1, 1_000_000)); // ex-seuil v1 = 100k
    // fixe (1/60≈1,67) + CPM (1000×2=2000) — AUCUN bonus ; CPM rogné par le
    // plafond 150 $/vidéo (2001,67 → 150 ; cf describe « plafond »).
    expect(r.fixedTotal).toBe(1.67);
    expect(r.cpmTotal).toBe(148.33);
    expect(r.total).toBe(150);
    expect("bonusTotal" in r).toBe(false);
  });

  it("total = fixe + CPM (round2), pas vide", () => {
    const r = computeMonthlyPayout(items(1, 120_000));
    expect(r.total).toBe(round(r.fixedTotal + r.cpmTotal));
  });
});

describe("plafond 150 $/vidéo — computeMonthlyPayout (global tous projets)", () => {
  // Part fixe RONDE (120/60 = 2 $/vidéo) → totaux nets pour les assertions.
  const P2: PricingSnapshot = {
    ...P,
    montantFixe: 120,
    nbVideosCible: 60,
    tauxCPM: 2,
  };

  it("une vidéo dont le calcul dépasse 150 $ → capée à 150 $", () => {
    // fixe 2 + CPM (1000×2=2000) = 2002 → 150.
    expect(computeMonthlyPayout(items(1, 1_000_000, P2)).total).toBe(150);
  });

  it("122M vues → 150 $ (exemple fondateur)", () => {
    expect(computeMonthlyPayout(items(1, 122_000_000, P2)).total).toBe(150);
  });

  it("une vidéo SOUS 150 $ → calcul inchangé (CPM normal)", () => {
    // fixe 2 + CPM (5×2=10) = 12.
    expect(computeMonthlyPayout(items(1, 5000, P2)).total).toBe(12);
  });

  it("total = SOMME des vidéos DÉJÀ capées (cap PAR vidéo, pas sur le total)", () => {
    // 3 vidéos > 150 chacune → 450, JAMAIS capé à 150 globalement.
    expect(computeMonthlyPayout(items(3, 1_000_000, P2)).total).toBe(450);
  });

  it("mix : une vidéo capée (150) + une sous le plafond (fixe 2) → 152", () => {
    const mix = [
      ...items(1, 1_000_000, P2, "hi"),
      ...items(1, 0, P2, "lo"),
    ];
    expect(computeMonthlyPayout(mix).total).toBe(152);
  });
});

describe("tiersOf — grille + fallback legacy", () => {
  it("bonusTiers présent → renvoyé tel quel", () => {
    const tiers: BonusTier[] = [
      { seuilVues: 2_000_000, rewardType: "nature", libelle: "iPhone" },
      { seuilVues: 5_000_000, rewardType: "cash", montant: 500 },
    ];
    expect(tiersOf({ bonusTiers: tiers })).toEqual(tiers);
  });

  it("legacy (seuilBonusVues+montantBonus, pas de bonusTiers) → 1 palier cash", () => {
    expect(tiersOf({ seuilBonusVues: 100_000, montantBonus: 50 })).toEqual([
      { seuilVues: 100_000, rewardType: "cash", montant: 50 },
    ]);
  });

  it("ni tiers ni legacy → []", () => {
    expect(tiersOf({})).toEqual([]);
    expect(tiersOf({ seuilBonusVues: 0, montantBonus: 0 })).toEqual([]);
  });
});

describe("evaluateBonusTiers — cumul créateur", () => {
  const TIERS: BonusTier[] = [
    { seuilVues: 2_000_000, rewardType: "nature", libelle: "iPhone" },
    { seuilVues: 5_000_000, rewardType: "cash", montant: 500 },
    { seuilVues: 10_000_000, rewardType: "nature", libelle: "MacBook" },
  ];

  it("cumul sous tous les paliers → rien franchi, jauge vers le 1er", () => {
    const r = evaluateBonusTiers(1_500_000, TIERS);
    expect(r.crossed).toEqual([]);
    expect(r.cashCrossedTotal).toBe(0);
    expect(r.nextTier?.libelle).toBe("iPhone");
    expect(r.viewsToNext).toBe(500_000);
  });

  it("cas chiffré 2,3M : iPhone franchi (nature, HORS total $), 5M non atteint", () => {
    const r = evaluateBonusTiers(2_300_000, TIERS);
    expect(r.crossed).toHaveLength(1);
    expect(r.natureCrossed.map((t) => t.libelle)).toEqual(["iPhone"]);
    expect(r.cashCrossedTotal).toBe(0); // l'iPhone ne compte pas en $
    expect(r.nextTier?.montant).toBe(500);
    expect(r.viewsToNext).toBe(2_700_000);
  });

  it("cas chiffré 5,1M : iPhone + 500$ franchis → cash 500$, MacBook prochain", () => {
    const r = evaluateBonusTiers(5_100_000, TIERS);
    expect(r.crossed).toHaveLength(2);
    expect(r.cashCrossedTotal).toBe(500);
    expect(r.natureCrossed.map((t) => t.libelle)).toEqual(["iPhone"]);
    expect(r.nextTier?.libelle).toBe("MacBook");
  });

  it("cumul == seuil exact → franchi (>=)", () => {
    expect(evaluateBonusTiers(2_000_000, TIERS).crossed).toHaveLength(1);
  });

  it("paliers non triés en entrée → évaluation triée déterministe", () => {
    const unsorted: BonusTier[] = [
      { seuilVues: 5_000_000, rewardType: "cash", montant: 500 },
      { seuilVues: 2_000_000, rewardType: "nature", libelle: "iPhone" },
    ];
    const r = evaluateBonusTiers(2_300_000, unsorted);
    expect(r.crossed).toHaveLength(1);
    expect(r.crossed[0].libelle).toBe("iPhone");
    expect(r.nextTier?.montant).toBe(500);
  });

  it("aucun palier → tout vide", () => {
    const r = evaluateBonusTiers(9_999_999, []);
    expect(r).toMatchObject({
      crossed: [],
      cashCrossedTotal: 0,
      natureCrossed: [],
      nextTier: null,
      viewsToNext: null,
    });
  });

  it("palier cash sans montant (malformé) → 0, pas de NaN", () => {
    const r = evaluateBonusTiers(3_000_000, [
      { seuilVues: 2_000_000, rewardType: "cash" },
    ]);
    expect(r.cashCrossedTotal).toBe(0);
    expect(Number.isNaN(r.cashCrossedTotal)).toBe(false);
  });
});

const round = (n: number) => Math.round(n * 100) / 100;

describe("estimateMissionEarnings — fiche mission (fixe/vidéo + CPM, sans bonus)", () => {
  // Pricing réel « Deal Créateur Face cam » (prod) : fixe 100$/60 vidéos, CPM 1,1.
  const DEAL: PricingSnapshot = {
    pricingId: "deal",
    montantFixe: 100,
    nbVideosCible: 60,
    tauxCPM: 1.1,
    seuilBonusVues: 0,
    montantBonus: 0,
  };

  it("fixe/vidéo + CPM ; ex. Marielle à 10k vues ≈ 12,67$ (et non 0$)", () => {
    const e = estimateMissionEarnings(DEAL, 10_000);
    expect(e.fixed).toBe(1.67); // 100 / 60
    expect(e.cpm).toBe(11); // 10 × 1,1
    expect(e.total).toBe(12.67);
  });

  it("le slider (vues) pilote la part CPM → l'estimation varie", () => {
    const at0 = estimateMissionEarnings(DEAL, 0);
    const at50k = estimateMissionEarnings(DEAL, 50_000);
    // À 0 vue : pas de CPM, total = fixe seul.
    expect(at0.cpm).toBe(0);
    expect(at0.total).toBe(at0.fixed);
    // Plus de vues → plus de CPM → total strictement supérieur.
    expect(at50k.cpm).toBe(55); // 50 × 1,1
    expect(at50k.total).toBeGreaterThan(at0.total);
    expect(at50k.cpm).toBe(assignmentCpm(DEAL, 50_000));
  });

  it("garde anti /0 : nbVideosCible invalide → fixe 0 (CPM seul)", () => {
    const bad: PricingSnapshot = { ...DEAL, nbVideosCible: 0 };
    const e = estimateMissionEarnings(bad, 10_000);
    expect(e.fixed).toBe(0);
    expect(e.total).toBe(11);
  });

  it("plafond 150 $/vidéo : estimation > 150 → capée (fixe gardé, CPM rogné)", () => {
    // CPM 1,1 × 1M/1000 = 1100 + fixe 1,67 → 1101,67 → 150.
    const e = estimateMissionEarnings(DEAL, 1_000_000);
    expect(e.total).toBe(150);
    expect(e.fixed).toBe(1.67);
    expect(e.cpm).toBe(148.33);
  });
});

describe("payableAssignmentViews — exclusion warmup (par POST)", () => {
  it("vidéo tout-warmup : payableViews 0, hasPayablePost false (exclue du fixe)", () => {
    const r = payableAssignmentViews([{ views: 100_000, isWarmup: true }]);
    expect(r).toEqual({ payableViews: 0, hasPayablePost: false });
  });

  it("aucun warmup : payableViews == Σ vues, hasPayablePost true → INCHANGÉ", () => {
    const r = payableAssignmentViews([
      { views: 5_000, isWarmup: false },
      { views: 3_000, isWarmup: false },
    ]);
    expect(r).toEqual({ payableViews: 8_000, hasPayablePost: true });
  });

  it("partiel : seules les vues NON-warmup comptent, la vidéo reste payable", () => {
    const r = payableAssignmentViews([
      { views: 5_000, isWarmup: false },
      { views: 100_000, isWarmup: true },
    ]);
    expect(r).toEqual({ payableViews: 5_000, hasPayablePost: true });
  });

  it("vidéo sans post (edge legacy) : compte pour le fixe (historique préservé)", () => {
    expect(payableAssignmentViews([])).toEqual({
      payableViews: 0,
      hasPayablePost: true,
    });
  });
});

/**
 * Le CPM est payé sur les vues PAYABLES, qui incluent un post warmup RÉMUNÉRÉ
 * (exception historique). Rapporté aux seules vues PROMO, ce CPM-là gonflerait le
 * chiffre : numérateur et dénominateur doivent porter sur le même périmètre.
 */
describe("promoVideoCost — la paie warmup ne remonte jamais dans un coût promo", () => {
  it("aucun warmup rémunéré : fixe + CPM entier (cas courant, INCHANGÉ)", () => {
    expect(promoVideoCost(10, 40, 100_000, 100_000)).toBe(50);
  });

  it("vidéo MIXTE : seule la part du CPM gagnée en promo est retenue", () => {
    // 100k vues payées dont 25k promo → 25 % du CPM ; le fixe reste entier.
    expect(promoVideoCost(10, 40, 100_000, 25_000)).toBe(20);
  });

  it("le fixe est par VIDÉO : une vidéo promo le porte en entier", () => {
    expect(promoVideoCost(12, 0, 100_000, 1)).toBe(12);
  });

  it("vidéo publiée pas encore mesurée : rien à répartir, il reste le fixe", () => {
    expect(promoVideoCost(10, 40, 0, 0)).toBe(10);
  });

  it("vues promo bornées aux vues payées : jamais plus de 100 % du CPM", () => {
    expect(promoVideoCost(10, 40, 50_000, 999_999)).toBe(50);
  });

  it("aucune vue promo payée : le CPM tombe, le fixe subsiste", () => {
    expect(promoVideoCost(10, 40, 100_000, 0)).toBe(10);
  });
});

describe("warmup — un post warmup n'ajoute NI fixe, NI CPM, NI cumul palier", () => {
  const TIERS: BonusTier[] = [
    { seuilVues: 2_000_000, rewardType: "nature", libelle: "iPhone" },
    { seuilVues: 5_000_000, rewardType: "cash", montant: 500 },
  ];

  /**
   * Réplique la composition SERVEUR (convex/pricing) : chaque vidéo → vues
   * payables ; une vidéo tout-warmup est EXCLUE des items (donc du fixe) ; le
   * cumul de paliers = Σ des vues payables. C'est ce pipeline que le warmup doit
   * neutraliser.
   */
  function buildPay(
    videos: { snapshot: PricingSnapshot; pubs: PublicationViews[] }[],
  ): { payout: ReturnType<typeof computeMonthlyPayout>; cumul: number } {
    const payoutItems: PayoutItem[] = [];
    let cumul = 0;
    videos.forEach((vd, i) => {
      const { payableViews, hasPayablePost } = payableAssignmentViews(vd.pubs);
      cumul += payableViews;
      if (hasPayablePost) {
        payoutItems.push({
          assignmentId: `a${i}`,
          snapshot: vd.snapshot,
          totalViews: payableViews,
        });
      }
    });
    return { payout: computeMonthlyPayout(payoutItems), cumul };
  }

  it("vidéo entièrement warmup : 0 fixe, 0 CPM, 0 cumul, aucun palier franchi", () => {
    const { payout, cumul } = buildPay([
      { snapshot: P, pubs: [{ views: 3_000_000, isWarmup: true }] },
    ]);
    expect(payout.fixedTotal).toBe(0);
    expect(payout.cpmTotal).toBe(0);
    expect(payout.total).toBe(0);
    expect(cumul).toBe(0);
    // Même 3M de vues warmup ne débloquent AUCUN palier.
    expect(evaluateBonusTiers(cumul, TIERS).crossed).toHaveLength(0);
  });

  it("preuve a contrario : la MÊME vidéo NON-warmup paie et cumule bien", () => {
    const { payout, cumul } = buildPay([
      { snapshot: P, pubs: [{ views: 3_000_000, isWarmup: false }] },
    ]);
    expect(payout.fixedTotal).toBeGreaterThan(0);
    expect(payout.cpmTotal).toBeGreaterThan(0);
    expect(cumul).toBe(3_000_000);
    // 3M franchit le palier iPhone (2M) — que le warmup ci-dessus supprimait.
    expect(evaluateBonusTiers(cumul, TIERS).crossed).toHaveLength(1);
  });

  it("partiel : fixe compté UNE fois, CPM sur les seules vues payables (5000)", () => {
    const { payout, cumul } = buildPay([
      {
        snapshot: P,
        pubs: [
          { views: 5_000, isWarmup: false },
          { views: 100_000, isWarmup: true },
        ],
      },
    ]);
    // fixe = 1 vidéo × 100/60 = 1,67 (la vidéo reste payante).
    expect(payout.fixedTotal).toBe(1.67);
    // CPM sur 5000 vues (@2€/1000) = 10 — les 100k warmup sont EXCLUES.
    expect(payout.cpmTotal).toBe(10);
    // Cumul de paliers = 5000 (warmup exclu), pas 105 000.
    expect(cumul).toBe(5_000);
  });

  it("cumul multi-vidéos : les vues warmup ne franchissent pas le palier", () => {
    // 1,5M payable + 1,5M warmup. Sans warmup on serait à 3M (> 2M = iPhone) ;
    // avec, le cumul reste 1,5M → aucun palier.
    const { cumul } = buildPay([
      { snapshot: P, pubs: [{ views: 1_500_000, isWarmup: false }] },
      { snapshot: P, pubs: [{ views: 1_500_000, isWarmup: true }] },
    ]);
    expect(cumul).toBe(1_500_000);
    expect(evaluateBonusTiers(cumul, TIERS).crossed).toHaveLength(0);
  });
});

// ─── Cycle MIXTE : deux générations de snapshot sous le MÊME pricingId ───────
//
// Un pricing peut être ÉDITÉ EN PLACE (Snytch : 100 $/60 + 1,1 → 0 $/60 + 1,0).
// Les assignations déjà attribuées gardent leur snapshot FIGÉ, donc un même
// cycle mélange deux barèmes portant le même `pricingId`.
//
// L'implémentation précédente groupait sur ce seul id et lisait les termes de
// groupe sur `groupItems[0].snapshot` : la part fixe dépendait alors de l'ORDRE
// DES DOCUMENTS. Constaté en prod sur le cycle 1 de Kelly (7 anciennes +
// 12 nouvelles) : 69,50 $ ou 37,83 $ pour exactement les mêmes données.
//
// C'est le test qui aurait attrapé le bug, et celui qui l'empêche de revenir.

/** Ancien barème : 100 $ pour 60 vidéos (1,6667/vidéo), CPM 1,1. */
const ANCIEN: PricingSnapshot = {
  pricingId: "meme-id",
  montantFixe: 100,
  nbVideosCible: 60,
  tauxCPM: 1.1,
  seuilBonusVues: 0,
  montantBonus: 0,
};
/** Nouveau barème, MÊME pricingId : 0 $ de fixe, CPM 1,0. */
const NOUVEAU: PricingSnapshot = {
  ...ANCIEN,
  montantFixe: 0,
  tauxCPM: 1,
};

describe("computeMonthlyPayout — indépendance à l'ordre des documents", () => {
  const mixte: PayoutItem[] = [
    ...items(7, 10_000, ANCIEN, "vieux"),
    ...items(12, 2_000, NOUVEAU, "neuf"),
  ];

  it("l'ordre inverse donne EXACTEMENT le même total", () => {
    const direct = computeMonthlyPayout(mixte);
    const inverse = computeMonthlyPayout([...mixte].reverse());
    expect(inverse.total).toBe(direct.total);
    expect(inverse.fixedTotal).toBe(direct.fixedTotal);
    expect(inverse.cpmTotal).toBe(direct.cpmTotal);
  });

  it("toutes les permutations testées donnent le même total", () => {
    // Entrelacements variés : le bug ne se révélait que si un item d'une autre
    // génération passait en tête du groupe.
    const permutations: PayoutItem[][] = [
      mixte,
      [...mixte].reverse(),
      // alternance stricte
      mixte.filter((_, i) => i % 2 === 0).concat(mixte.filter((_, i) => i % 2 === 1)),
      // un « neuf » en tête, le reste inchangé
      [mixte[mixte.length - 1], ...mixte.slice(0, -1)],
      // un « vieux » en queue
      [...mixte.slice(1), mixte[0]],
    ];
    const totaux = permutations.map((p) => computeMonthlyPayout(p).total);
    expect(new Set(totaux).size).toBe(1);
  });

  it("chaque génération paie SON fixe, jamais celui du voisin", () => {
    const r = computeMonthlyPayout(mixte);
    // 7 vidéos à 1,6667 $ = 11,67 $ ; les 12 du barème à 0 $ n'ajoutent rien —
    // et surtout ne puisent pas dans le budget de 100 $ de l'ancien.
    expect(r.fixedTotal).toBe(11.67);
    // CPM par item, chacun à SON taux : 7×10 000×1,1/1000 + 12×2 000×1,0/1000.
    expect(r.cpmTotal).toBe(101);
  });

  it("deux groupes distincts sont exposés, un par génération", () => {
    const r = computeMonthlyPayout(mixte);
    expect(r.perPricing).toHaveLength(2);
    const budgets = r.perPricing.map((g) => g.montantFixe).sort((a, b) => a - b);
    expect(budgets).toEqual([0, 100]);
    // La somme des groupes fait le total (invariant d'affichage : le détail
    // par groupe ne doit jamais contredire le sous-total).
    const sommeFixe = r.perPricing.reduce((s, g) => s + g.fixed, 0);
    expect(Math.round(sommeFixe * 100) / 100).toBe(r.fixedTotal);
  });

  it("le CPM était DÉJÀ par vidéo — il reste inchangé, quel que soit l'ordre", () => {
    const direct = computeMonthlyPayout(mixte);
    const inverse = computeMonthlyPayout([...mixte].reverse());
    const cpmOf = (r: ReturnType<typeof computeMonthlyPayout>) =>
      Object.fromEntries(r.perAssignment.map((a) => [a.assignmentId, a.cpm]));
    expect(cpmOf(inverse)).toEqual(cpmOf(direct));
  });

  it("un cycle HOMOGÈNE est strictement inchangé (non-régression)", () => {
    // Le correctif ne doit rien bouger sur le cas normal : un seul barème.
    const r = computeMonthlyPayout(items(30, 5_000, ANCIEN));
    expect(r.fixedTotal).toBe(50); // 30 × 1,6667, sous le budget de 100
    expect(r.cpmTotal).toBe(165); // 30 × 5 000 × 1,1 / 1000
    expect(r.perPricing).toHaveLength(1);
  });

  it("le budget fixe reste plafonné PAR GÉNÉRATION", () => {
    // 80 vidéos à 1,6667 dépasseraient 133 $ : le budget de 100 $ borne, et la
    // seconde génération garde le sien (0 $) sans y toucher.
    const r = computeMonthlyPayout([
      ...items(80, 0, ANCIEN, "v"),
      ...items(5, 0, NOUVEAU, "n"),
    ]);
    expect(r.fixedTotal).toBe(100);
  });
});

// ─── Parité lib/ ↔ convex/ du MOTEUR DE PAIE (règle A6) ─────────────────────
//
// `convex/pricing.ts` réplique computeMonthlyPayout / assignmentCpm parce qu'un
// module convex ne peut pas importer lib/. Cette parité n'était vérifiée par
// AUCUN test : les deux copies pouvaient diverger sur de l'ARGENT sans que rien
// ne casse. Le correctif d'ordre ci-dessus touchant les deux, on la verrouille.

describe("parité lib/ ↔ convex/ du moteur de paie (règle A6)", () => {
  const JEUX: { nom: string; items: PayoutItem[] }[] = [
    { nom: "vide", items: [] },
    { nom: "une vidéo", items: items(1, 5_000) },
    { nom: "sous le budget fixe", items: items(30, 12_000) },
    { nom: "au-dessus du budget fixe", items: items(75, 12_000) },
    { nom: "plafond 150 franchi", items: items(3, 1_000_000) },
    { nom: "vues nulles", items: items(4, 0) },
    { nom: "cycle mixte (deux générations)", items: [
      ...items(7, 10_000, ANCIEN, "vieux"),
      ...items(12, 2_000, NOUVEAU, "neuf"),
    ] },
    { nom: "cycle mixte inversé", items: [
      ...items(12, 2_000, NOUVEAU, "neuf"),
      ...items(7, 10_000, ANCIEN, "vieux"),
    ] },
  ];

  for (const { nom, items: jeu } of JEUX) {
    it(`résultats identiques — ${nom}`, () => {
      const a = computeMonthlyPayout(jeu);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = convexPricing.computeMonthlyPayout(jeu as any);
      expect(b.fixedTotal).toBe(a.fixedTotal);
      expect(b.cpmTotal).toBe(a.cpmTotal);
      expect(b.total).toBe(a.total);
      expect(b.perAssignment).toEqual(a.perAssignment);
      expect(b.perPricing).toEqual(a.perPricing);
    });
  }

  it("assignmentCpm identique, plafond MAX_PAY_PER_VIDEO_EUR identique", () => {
    for (const views of [0, 1, 999, 1_000, 123_456, 10_000_000]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(convexPricing.assignmentCpm(P as any, views)).toBe(
        assignmentCpm(P, views),
      );
    }
    expect(convexPricing.MAX_PAY_PER_VIDEO_EUR).toBe(MAX_PAY_PER_VIDEO_EUR);
  });
});

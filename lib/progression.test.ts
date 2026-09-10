import { describe, it, expect } from "vitest";
import {
  buildProgression,
  rewardOf,
  rewardEmoji,
  clamp01,
  computeVictories,
  type ProgressionUnlock,
} from "./progression";
import type { BonusTier } from "./pricing-engine";

// Deux configs de PROJET différentes (paliers jamais en dur : la vue lit la
// grille du projet) → l'échelle produite doit différer.
const PROJECT_A: BonusTier[] = [
  { seuilVues: 100_000, rewardType: "cash", montant: 200 },
  { seuilVues: 500_000, rewardType: "nature", libelle: "iPhone 15" },
  { seuilVues: 1_000_000, rewardType: "cash", montant: 1000 },
];
const PROJECT_B: BonusTier[] = [
  { seuilVues: 50_000, rewardType: "cash", montant: 50 },
  { seuilVues: 250_000, rewardType: "nature", libelle: "MacBook Air" },
];

describe("rewardEmoji", () => {
  it("dérive un emoji par mot-clé du libellé", () => {
    expect(rewardEmoji("iPhone 15 Pro")).toBe("📱");
    expect(rewardEmoji("MacBook Air")).toBe("💻");
    expect(rewardEmoji("une voiture Tesla")).toBe("🚗");
    expect(rewardEmoji("AirPods Pro")).toBe("🎧");
  });
  it("retombe sur 🎁 pour l'inconnu ou le vide", () => {
    expect(rewardEmoji("un truc mystère")).toBe("🎁");
    expect(rewardEmoji("")).toBe("🎁");
    expect(rewardEmoji(undefined)).toBe("🎁");
  });
});

describe("rewardOf", () => {
  it("cash → { kind: 'cash', amount }", () => {
    expect(rewardOf({ rewardType: "cash", montant: 200 })).toEqual({
      kind: "cash",
      amount: 200,
      emoji: "💶",
    });
  });
  it("nature → { kind: 'item', label, emoji } SANS montant $ (jamais des euros)", () => {
    const r = rewardOf({ rewardType: "nature", libelle: "iPhone" });
    expect(r.kind).toBe("item");
    expect(r).not.toHaveProperty("amount");
    if (r.kind === "item") {
      expect(r.label).toBe("iPhone");
      expect(r.emoji).toBe("📱");
    }
  });
  it("nature sans libellé → null (le repli i18n est posé à l'affichage)", () => {
    const r = rewardOf({ rewardType: "nature" });
    // `label` porte la DONNÉE saisie par l'admin. Vide ⇒ null : le repli
    // « Récompense » / « Reward » est résolu à l'affichage, dans la langue du
    // lecteur, et ne peut plus être figé en français dans un module pur.
    if (r.kind === "item") expect(r.label).toBe(null);
  });
});

describe("clamp01", () => {
  it("borne dans [0,1] et neutralise NaN/Inf", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
    // Inf est neutralisé (non fini → 0), pas clampé à 1.
    expect(clamp01(Infinity)).toBe(0);
  });
});

describe("buildProgression — échelle par projet", () => {
  it("construit une échelle différente selon la config du projet", () => {
    const a = buildProgression({
      cumulViews: 0,
      tiers: PROJECT_A,
      unlocks: [],
      publishedPostsCount: 0,
    });
    const b = buildProgression({
      cumulViews: 0,
      tiers: PROJECT_B,
      unlocks: [],
      publishedPostsCount: 0,
    });
    expect(a.ladder.map((l) => l.threshold)).toEqual([
      100_000, 500_000, 1_000_000,
    ]);
    expect(b.ladder.map((l) => l.threshold)).toEqual([50_000, 250_000]);
    // Récompense du 2e palier : item (iPhone) vs item (MacBook) — emoji distinct.
    expect(a.ladder[1].reward).toMatchObject({ kind: "item", emoji: "📱" });
    expect(b.ladder[1].reward).toMatchObject({ kind: "item", emoji: "💻" });
  });

  it("marque unlocked + unlockedAt selon le cumul et les unlocks persistés", () => {
    const unlocks: ProgressionUnlock[] = [
      {
        seuilVues: 100_000,
        rewardType: "cash",
        montant: 200,
        unlockedAt: 1_000,
      },
    ];
    const p = buildProgression({
      cumulViews: 300_000,
      tiers: PROJECT_A,
      unlocks,
      publishedPostsCount: 12,
    });
    expect(p.ladder[0]).toMatchObject({ unlocked: true, unlockedAt: 1_000 });
    // 300k ≥ 100k (unlocked) mais < 500k et < 1M.
    expect(p.ladder[1].unlocked).toBe(false);
    expect(p.ladder[2].unlocked).toBe(false);
    // unlocked par cumul même sans row persistée (500k pas atteint ici) :
    expect(p.ladder[1].unlockedAt).toBeUndefined();
  });

  it("prochain palier, vues restantes et progression 0..1", () => {
    const p = buildProgression({
      cumulViews: 300_000,
      tiers: PROJECT_A,
      unlocks: [],
      publishedPostsCount: 0,
    });
    expect(p.nextThreshold).toBe(500_000);
    expect(p.nextReward).toMatchObject({ kind: "item", label: "iPhone 15" });
    expect(p.remainingViews).toBe(200_000);
    // De 100k (dernier franchi) à 500k : (300k-100k)/(500k-100k) = 0.5.
    expect(p.progressToNext).toBeCloseTo(0.5, 5);
  });

  it("tout débloqué → nextReward null, progression 1, restant 0", () => {
    const p = buildProgression({
      cumulViews: 2_000_000,
      tiers: PROJECT_A,
      unlocks: [],
      publishedPostsCount: 40,
    });
    expect(p.nextReward).toBeNull();
    expect(p.nextThreshold).toBeNull();
    expect(p.progressToNext).toBe(1);
    expect(p.remainingViews).toBe(0);
  });

  it("cash total = somme des unlocks cash ; nature JAMAIS additionnée en euros", () => {
    const unlocks: ProgressionUnlock[] = [
      { seuilVues: 100_000, rewardType: "cash", montant: 200, unlockedAt: 1 },
      {
        seuilVues: 500_000,
        rewardType: "nature",
        libelle: "iPhone 15",
        montant: 9999, // piège : même si un montant traîne sur une nature…
        unlockedAt: 2,
      },
      { seuilVues: 1_000_000, rewardType: "cash", montant: 1000, unlockedAt: 3 },
    ];
    const p = buildProgression({
      cumulViews: 1_200_000,
      tiers: PROJECT_A,
      unlocks,
      publishedPostsCount: 30,
    });
    // …le total $ n'inclut QUE les cash (200 + 1000), jamais la nature.
    expect(p.cashUnlockedTotal).toBe(1200);
    expect(p.itemsUnlocked).toEqual([
      { label: "iPhone 15", emoji: "📱", unlockedAt: 2 },
    ]);
  });

  it("progression bornée même si cumul dépasse le prochain seuil (données incohérentes)", () => {
    // Cumul entre deux paliers, pas de crossed inférieur : borne à [0,1].
    const p = buildProgression({
      cumulViews: 40_000,
      tiers: PROJECT_B,
      unlocks: [],
      publishedPostsCount: 0,
    });
    expect(p.nextThreshold).toBe(50_000);
    expect(p.progressToNext).toBeCloseTo(40_000 / 50_000, 5);
    expect(p.progressToNext).toBeGreaterThanOrEqual(0);
    expect(p.progressToNext).toBeLessThanOrEqual(1);
  });

  it("aucune grille (projet sans paliers) → échelle vide, pas de prochain", () => {
    const p = buildProgression({
      cumulViews: 500_000,
      tiers: [],
      unlocks: [],
      publishedPostsCount: 3,
    });
    expect(p.ladder).toEqual([]);
    expect(p.nextReward).toBeNull();
    expect(p.progressToNext).toBe(1);
  });
});

describe("computeVictories", () => {
  it("marque les paliers de posts/vues atteints", () => {
    const v = computeVictories({
      cumulViews: 150_000,
      publishedPostsCount: 7,
      tiersUnlocked: 1,
    });
    const by = Object.fromEntries(v.map((x) => [x.id, x.achieved]));
    expect(by["posts-1"]).toBe(true);
    expect(by["posts-5"]).toBe(true);
    expect(by["posts-10"]).toBe(false);
    expect(by["views-100000"]).toBe(true);
    expect(by["views-1000000"]).toBe(false);
    expect(by["tier-1"]).toBe(true);
  });
  it("rien atteint au départ", () => {
    const v = computeVictories({
      cumulViews: 0,
      publishedPostsCount: 0,
      tiersUnlocked: 0,
    });
    expect(v.every((x) => !x.achieved)).toBe(true);
  });
});

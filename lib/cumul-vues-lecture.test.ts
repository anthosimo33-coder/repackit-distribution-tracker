import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { QueryCtx } from "../convex/_generated/server";
import { creatorCumulViews } from "../convex/pricing";
import { memoryDb, type MemoryDoc } from "./convex-memory-db";

/**
 * `creatorCumulViews` — le cumul de paliers que lisent la progression, la jauge
 * de bonus et la paie des paliers.
 *
 * Le 18/11/2026, la créatrice aux 569 publications ne pouvait plus ouvrir son
 * espace : `getMyProgression` lisait ses vidéos UNE PAR UNE (une publication,
 * puis son relevé de fin de fenêtre, puis la suivante…), 1 733 documents en
 * 13 à 15,8 s, et tombait vers 15,5 s. Le calcul, lui, prenait 0,18 s : c'est la
 * chaîne d'attente qui tuait la query, pas le volume. D'où la mesure en
 * allers-retours (`allers()`), pas en documents lus.
 */

const DAY = 86_400_000;
const NOW = Date.now();
const SNYTCH = "projects_snytch";
const BLUSH = "projects_blush";
const KELLY = "creators_kelly";

let seq = 0;
const doc = (table: string, champs: Record<string, unknown>): MemoryDoc => {
  seq += 1;
  return {
    _id: `${table}_${String(seq).padStart(6, "0")}`,
    _creationTime: NOW - 200 * DAY + seq * 37,
    ...champs,
  };
};

type Base = Record<string, MemoryDoc[]>;
const vide = (): Base => ({ assignments: [], publications: [], metricSnapshots: [] });

/**
 * Un post, avec la vue que la paie DOIT en retenir — connue à la construction,
 * jamais recalculée par le test.
 */
type Post = {
  ageJours: number;
  vuesMesurees: number;
  /** Relevés : [jour depuis la publication, vues]. */
  releves?: [number, number][];
  isWarmup?: boolean;
  remunere?: boolean;
  /** Jour (depuis la publication) du lancement de la spark ad. */
  sparkAdJour?: number;
  /** Assiette attendue de ce post. */
  retenues: number;
};

function poser(base: Base, posts: Post[], projectId = SNYTCH): Id<"publications">[] {
  return posts.map((p) => {
    const datePubli = NOW - p.ageJours * DAY - 3 * 3_600_000; // 21 h la veille, pas minuit pile
    const pub = doc("publications", {
      projectId,
      datePubli,
      vuesLatest: p.vuesMesurees,
      ...(p.releves?.length ? { latestSnapshotAt: datePubli + p.releves[p.releves.length - 1][0] * DAY } : {}),
      ...(p.isWarmup !== undefined ? { isWarmup: p.isWarmup } : {}),
      ...(p.remunere !== undefined ? { remunere: p.remunere } : {}),
      ...(p.sparkAdJour !== undefined ? { sparkAdLaunchedAt: datePubli + p.sparkAdJour * DAY } : {}),
    });
    base.publications.push(pub);
    for (const [jour, vues] of p.releves ?? []) {
      base.metricSnapshots.push(
        doc("metricSnapshots", {
          projectId,
          publicationId: pub._id,
          capturedAt: datePubli + jour * DAY + 7_200_000,
          daysSincePublication: jour,
          vues,
          likes: Math.round(vues / 23),
          createdAt: datePubli + jour * DAY,
          source: "apify",
        }),
      );
    }
    return pub._id as Id<"publications">;
  });
}

function mission(
  base: Base,
  posts: Post[],
  opts: { status?: string; projectId?: string; snapshot?: boolean } = {},
): void {
  const projectId = opts.projectId ?? SNYTCH;
  const ids = poser(base, posts, projectId);
  base.assignments.push(
    doc("assignments", {
      projectId,
      creatorId: KELLY,
      status: opts.status ?? "published",
      // Missions multi-plateformes : `targets` porte les posts, `publicationId` le premier.
      publicationId: ids[0],
      targets: ids.map((publicationId, i) => ({
        accountId: `comptes_${["tiktok", "instagram", "snapchat"][i]}_kelly`,
        publicationId,
      })),
      ...(opts.snapshot === false ? {} : { pricingSnapshot: { fixe: 400 / 60, cpm: 1, devise: "EUR" } }),
    }),
  );
}

const cumulDe = async (base: Base) => {
  const mem = memoryDb(base);
  const ctx = { db: mem.db } as unknown as QueryCtx;
  const cumul = await creatorCumulViews(ctx, SNYTCH as Id<"projects">, KELLY as Id<"creators">);
  return { cumul, allers: mem.allers(), lus: mem.reads() };
};

describe("creatorCumulViews — ce qui compte pour les paliers", () => {
  it("ne retient que les posts rémunérés EN PROMO, à leur assiette, des vidéos publiées ou payées du projet", async () => {
    const base = vide();
    // Fenêtre ouverte (J+12) : les vues mesurées.
    mission(base, [
      { ageJours: 12, vuesMesurees: 1_734, releves: [[3, 912], [10, 1_650]], retenues: 1_734 },
      { ageJours: 12, vuesMesurees: 486, releves: [[3, 301]], retenues: 486 },
    ]);
    // Fenêtre close (J+64) : le DERNIER relevé avant J+31, pas celui de J+45.
    mission(
      base,
      [
        { ageJours: 64, vuesMesurees: 41_877, releves: [[5, 18_420], [20, 25_310], [29, 25_342], [45, 40_015]], retenues: 25_342 },
        { ageJours: 64, vuesMesurees: 2_291, releves: [[2, 880], [44, 2_290]], retenues: 880 },
      ],
      { status: "paid" },
    );
    // Close sans aucun relevé : les vues mesurées (rien de mieux).
    mission(base, [{ ageJours: 70, vuesMesurees: 6_512, retenues: 6_512 }]);
    // Spark ad lancée à J+9 : figée au dernier relevé d'avant la pub.
    mission(base, [
      { ageJours: 50, vuesMesurees: 377_204, releves: [[4, 61_870], [8, 98_455], [15, 301_002]], sparkAdJour: 9, retenues: 98_455 },
    ]);
    // Exclus des paliers : warmup (même rémunéré, cas Kelly), promo non rémunérée.
    mission(base, [
      { ageJours: 40, vuesMesurees: 12_004, releves: [[6, 9_870]], isWarmup: true, remunere: true, retenues: 0 },
      { ageJours: 40, vuesMesurees: 3_118, releves: [[6, 2_002]], remunere: false, retenues: 0 },
    ]);
    // Exclues : pas encore publiée, sans barème figé, d'un autre projet.
    mission(base, [{ ageJours: 2, vuesMesurees: 9_999, retenues: 0 }], { status: "submitted" });
    mission(base, [{ ageJours: 20, vuesMesurees: 8_888, retenues: 0 }], { snapshot: false });
    mission(base, [{ ageJours: 20, vuesMesurees: 7_777, retenues: 0 }], { projectId: BLUSH });

    const { cumul } = await cumulDe(base);
    expect(cumul).toBe(1_734 + 486 + 25_342 + 880 + 6_512 + 98_455);
  });
});

describe("creatorCumulViews — la chaîne d'attente", () => {
  /** 320 vidéos TikTok + Instagram sur 120 jours, au profil de la créatrice du 18/11. */
  function grosCompte(): { base: Base; attendu: number } {
    const base = vide();
    let attendu = 0;
    for (let i = 0; i < 320; i += 1) {
      // De J+2 à J+119, sans les deux jours où la fenêtre se ferme (publiée la
      // veille à 21 h, elle est close dès J+31) : l'oracle reste lisible.
      const brut = 2 + Math.floor((i * 118) / 320);
      const age = brut >= 30 && brut <= 32 ? 33 : brut;
      const ferme = age >= 31;
      const posts: Post[] = [0, 1].map((p) => {
        const finFenetre = 1_000 + ((i * 7_919 + p * 104_729) % 48_000);
        const mesurees = finFenetre + (ferme ? 1_337 + p : 0);
        return {
          ageJours: age,
          vuesMesurees: mesurees,
          releves: ferme ? [[3, Math.round(finFenetre / 3)], [27, finFenetre], [age - 1, mesurees]] : [[1, 200 + p]],
          // Un post sur quatre en chauffe, comme les premières semaines d'un compte.
          ...(i % 4 === 0 && p === 1 ? { isWarmup: true } : {}),
          retenues: ferme ? finFenetre : mesurees,
        };
      });
      for (const p of posts) if (!p.isWarmup) attendu += p.retenues;
      mission(base, posts, { status: i % 3 === 0 ? "paid" : "published" });
    }
    return { base, attendu };
  }

  it("lit les vidéos par lots : l'attente ne suit plus le nombre de vidéos", async () => {
    const { base, attendu } = grosCompte();
    const { cumul, allers, lus } = await cumulDe(base);
    expect(cumul).toBe(attendu);
    // Une par une : 1 (missions) + 320 × 2 posts × (publication + relevé) ≈ 1 000.
    // Par lots de 100 : 4 lots × 4 allers (publication, relevé, ×2 posts) + 1 = 17.
    expect(allers).toBeLessThanOrEqual(20);
    // Même lecture qu'avant : le parallélisme ne doit rien relire ni rien sauter.
    expect(lus).toBe(320 + 640 + base.metricSnapshots.filter((s) => (s.daysSincePublication as number) === 27).length);
  });
});

import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { QueryCtx } from "../convex/_generated/server";
import {
  aggregateByBrick,
  campaignMedianOf,
  gatherCampaignViews,
} from "../convex/scriptAnalytics";
import { memoryDb, type MemoryDoc } from "./convex-memory-db";

/**
 * L'outil MCP `scripts` et l'écran Analytics d'une campagne passent par
 * `gatherCampaignViews`. Le 2026-11-08, il tombait sur TOUTES les campagnes de
 * Snytch : « Too many documents read in a single function execution (limit:
 * 32000) ». Il lisait toutes les publications du projet (1 925) et tous leurs
 * relevés de vues (31 490), pour n'en garder que ceux d'une campagne.
 *
 * Le projet simulé a la forme de Snytch : plusieurs campagnes, des posts hors
 * script, un autre projet à côté, ~40 000 relevés au total. La campagne lue en
 * a quelques milliers : c'est tout ce que la query doit lire.
 */

const DAY = 86_400_000;
const SNYTCH = "kh7snytch0000000000000000000000" as Id<"projects">;
const BLUSH = "kh7blush00000000000000000000000" as Id<"projects">;

let seq = 0;
let horloge = Date.parse("2026-09-01T08:00:00Z");
const doc = (table: string, champs: Record<string, unknown>): MemoryDoc => {
  seq += 1;
  horloge += 37;
  return { _id: `${table}_${String(seq).padStart(6, "0")}`, _creationTime: horloge, ...champs };
};

const vuesA = (i: number, jour: number) => Math.round(813 * ((i % 7) + 1) * Math.log2(jour + 2)) + i;

function projetSnytch() {
  const t: Record<string, MemoryDoc[]> = {
    projects: [],
    scriptCampaigns: [],
    scriptBricks: [],
    publications: [],
    metricSnapshots: [],
  };
  t.projects.push({ _id: SNYTCH, _creationTime: 1, slug: "snytch", name: "Snytch" });
  t.projects.push({ _id: BLUSH, _creationTime: 2, slug: "blush", name: "BLUSH" });

  const campagne = (projectId: string, name: string) => {
    const c = doc("scriptCampaigns", { projectId, name, status: "active", createdAt: horloge });
    t.scriptCampaigns.push(c);
    const brique = (kind: string, label: string, order: number) => {
      const b = doc("scriptBricks", { projectId, campaignId: c._id, kind, label, text: label, active: true, order, createdAt: horloge });
      t.scriptBricks.push(b);
      return b._id;
    };
    return {
      id: c._id,
      hooks: [
        brique("hook", "Quand ton mec te dit « j'étais à la salle »", 0),
        brique("hook", "Il est bizarre depuis 3 semaines", 1),
        brique("hook", "POV : tu retrouves son 2e compte", 2),
        brique("hook", "Elle like tout ce qu'il poste", 3),
      ],
      flux: [brique("flux", "Démo Snytch — recherche du @", 0), brique("flux", "Réaction écran partagé", 1)],
      ctas: [brique("cta", "Lien en bio 👀", 0), brique("cta", "Tape « snytch » sur l'App Store", 1)],
      notif: brique("notif", "Nouvelle connexion détectée", 0),
    };
  };

  // Une publication + ses relevés quotidiens (23 h 30 Paris), jusqu'à `jours`.
  const publier = (
    projectId: string,
    i: number,
    combo: Record<string, unknown> | undefined,
    opts: { warmup?: boolean; jours: number },
  ) => {
    const datePubli = Date.parse("2026-09-03T17:42:00Z") + i * 5 * 3_600_000;
    const plateforme = i % 2 === 0 ? "TikTok" : "Instagram";
    const p = doc("publications", {
      projectId,
      carouselId: `${plateforme === "TikTok" ? "TT" : "IG"}-${7_412_000_000 + i}`,
      plateforme,
      mediaType: "short",
      compte: i % 3 === 0 ? "juliette.snytch_" : "lea.verif.fr",
      datePubli,
      postUrl: `https://www.tiktok.com/@juliette.snytch_/video/${7_412_000_000 + i}`,
      isWarmup: opts.warmup ? true : undefined,
      scriptCombo: combo,
    });
    t.publications.push(p);
    for (let d = 0; d <= opts.jours; d++) {
      const vues = vuesA(i, d);
      t.metricSnapshots.push(
        doc("metricSnapshots", {
          projectId,
          publicationId: p._id,
          capturedAt: datePubli + d * DAY + 5 * 3_600_000,
          daysSincePublication: d,
          vues,
          likes: Math.floor(vues / 23),
          comments: Math.floor(vues / 410),
          createdAt: horloge,
          source: plateforme === "TikTok" ? "tiktok" : "instagram",
        }),
      );
    }
    return p;
  };
  const comboDe = (c: ReturnType<typeof campagne>, i: number) => {
    const hook = c.hooks[i % 4];
    const flux = c.flux[i % 2];
    const cta = c.ctas[Math.floor(i / 2) % 2];
    return {
      campaignId: c.id,
      hookBrickId: hook,
      fluxBrickId: flux,
      ctaBrickId: cta,
      comboKey: `${hook}|${flux}|${cta}`,
      ...(i % 3 === 0 ? { notifBrickId: c.notif } : {}),
    };
  };

  const cible = campagne(SNYTCH, "Reaction + Demo LAB 🇫🇷");
  // 150 posts de la campagne lue : 1 sur 15 en chauffe, les 10 derniers trop
  // jeunes pour J+7 (relevés de J+0 à J+4 seulement).
  for (let i = 0; i < 150; i++) {
    publier(SNYTCH, i, comboDe(cible, i), { warmup: i % 15 === 0, jours: i >= 140 ? 4 : 21 });
  }
  // Le reste de Snytch : 8 autres campagnes et des posts hors script.
  let n = 1_000;
  for (let k = 0; k < 8; k++) {
    const autre = campagne(SNYTCH, `Format parlé ${k} 🇫🇷`);
    for (let i = 0; i < 180; i++) publier(SNYTCH, n++, comboDe(autre, i), { jours: 21 });
  }
  for (let i = 0; i < 200; i++) publier(SNYTCH, n++, undefined, { jours: 21 });
  // Un autre projet, qui ne doit rien coûter à Snytch.
  const blush = campagne(BLUSH, "BLUSH conversations");
  for (let i = 0; i < 50; i++) publier(BLUSH, n++, comboDe(blush, i), { jours: 21 });

  return { tables: t, cible };
}

describe("gatherCampaignViews — lecture bornée à la campagne", () => {
  const { tables, cible } = projetSnytch();
  const pubsCible = tables.publications.filter(
    (p) => (p.scriptCombo as { campaignId?: string } | undefined)?.campaignId === cible.id,
  );
  const idsCible = new Set(pubsCible.map((p) => p._id));
  const relevesCible = tables.metricSnapshots.filter((s) => idsCible.has(s.publicationId as string));
  const briquesCible = tables.scriptBricks.filter((b) => b.campaignId === cible.id);

  it("le projet simulé dépasse bien la limite de Convex", () => {
    expect(tables.metricSnapshots.filter((s) => s.projectId === SNYTCH).length).toBeGreaterThan(32_000);
  });

  it("ne lit que la campagne, ses publications et leurs relevés", async () => {
    const m = memoryDb(tables);
    const ctx = { db: m.db } as unknown as QueryCtx;
    const vues = await gatherCampaignViews(ctx, SNYTCH, cible.id as Id<"scriptCampaigns">, "j7");
    expect(vues.found).toBe(true);
    expect(m.reads()).toBeLessThanOrEqual(1 + briquesCible.length + pubsCible.length + relevesCible.length);
  });

  it("garde les chiffres : chauffe exclue, posts trop jeunes hors J+7, médiane par hook", async () => {
    const ctx = { db: memoryDb(tables).db } as unknown as QueryCtx;
    const vues = await gatherCampaignViews(ctx, SNYTCH, cible.id as Id<"scriptCampaigns">, "j7");

    // 140 posts mesurés à J+7, moins les 10 en chauffe (i = 0, 15, …, 135).
    const mesures = Array.from({ length: 140 }, (_, i) => i).filter((i) => i % 15 !== 0);
    expect(vues.samples).toHaveLength(mesures.length);
    expect(vues.samples.map((s) => s.views)).toEqual(mesures.map((i) => vuesA(i, 7)));

    const mediane = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
    };
    const parBrique = new Map(aggregateByBrick(vues).map((b) => [b.brickId as string, b]));
    cible.hooks.forEach((hook, h) => {
      const attendus = mesures.filter((i) => i % 4 === h).map((i) => vuesA(i, 7));
      expect(parBrique.get(hook)?.postCount).toBe(attendus.length);
      expect(parBrique.get(hook)?.viewsMedian).toBe(mediane(attendus));
    });
    const notifs = mesures.filter((i) => i % 3 === 0).map((i) => vuesA(i, 7));
    expect(parBrique.get(cible.notif)?.postCount).toBe(notifs.length);
    expect(campaignMedianOf(vues)).toBe(mediane(mesures.map((i) => vuesA(i, 7))));
  });

  it("segment chauffe : seulement les posts de chauffe, et tous avec « all »", async () => {
    const ctx = { db: memoryDb(tables).db } as unknown as QueryCtx;
    const seule = await gatherCampaignViews(ctx, SNYTCH, cible.id as Id<"scriptCampaigns">, "j7", "only");
    expect(seule.samples.map((s) => s.views)).toEqual(
      [0, 15, 30, 45, 60, 75, 90, 105, 120, 135].map((i) => vuesA(i, 7)),
    );
    const toutes = await gatherCampaignViews(ctx, SNYTCH, cible.id as Id<"scriptCampaigns">, "j7", "all");
    expect(toutes.samples).toHaveLength(140);
  });

  it("une campagne d'un autre projet ne se lit pas", async () => {
    const blush = tables.scriptCampaigns.find((c) => c.projectId === BLUSH)!;
    const ctx = { db: memoryDb(tables).db } as unknown as QueryCtx;
    const vues = await gatherCampaignViews(ctx, SNYTCH, blush._id as Id<"scriptCampaigns">, "j7");
    expect(vues.found).toBe(false);
    expect(vues.samples).toHaveLength(0);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { QueryCtx } from "../convex/_generated/server";
import { collectDigestCore } from "../convex/notifications";
import { memoryDb, type MemoryDoc } from "./convex-memory-db";

/**
 * Le digest Telegram du matin (`runDailyDigest` → `collectDigestCore`) est tombé
 * sur Snytch les 06, 07 et 08/11/2026 (`convex insights --prod`) : « Documents
 * Read Limit Exceeded ». Le rejeu de l'export prod place la première chute au
 * 04/11. Pour savoir quelles publications n'avaient JAMAIS été relevées, il
 * lisait tous les relevés du projet (31 490) et toutes ses publications (1 939),
 * au-delà de la limite de 32 000 documents. BLUSH passe après Snytch dans la
 * boucle du cron, et son digest ne partait donc plus non plus.
 *
 * Le projet simulé a la forme de Snytch : ~1 900 publications relevées chaque
 * nuit (> 32 000 relevés), leurs champs « latest » posés comme le fait
 * `recomputeLatestMetrics`, quelques publications jamais relevées, et un autre
 * projet à côté.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-08T06:00:00Z");
const SNYTCH = "kh7snytch0000000000000000000000" as Id<"projects">;
const BLUSH = "kh7blush00000000000000000000000" as Id<"projects">;

/** Les événements réellement activés sur Snytch au 08/11 (export prod). */
const EVENEMENTS_SNYTCH = [
  "video_submitted",
  "video_resubmitted",
  "video_approved",
  "video_rejected",
  "publication_confirmed",
  "publication_late",
  "whop_dispute",
  "whop_renewal_failed",
  "digest_overdue_missions",
  "digest_warmup_ready",
  "digest_recrues_a_trancher",
  "evening_unpublished",
  "sync_failures",
];
const EVENEMENTS_BLUSH = EVENEMENTS_SNYTCH.filter(
  (e) => e !== "digest_warmup_ready" && e !== "digest_recrues_a_trancher",
);

let seq = 0;
let horloge = Date.parse("2026-08-01T08:00:00Z");
const doc = (table: string, champs: Record<string, unknown>): MemoryDoc => {
  seq += 1;
  horloge += 37;
  return { _id: `${table}_${String(seq).padStart(6, "0")}`, _creationTime: horloge, ...champs };
};

function projetSnytch() {
  const t: Record<string, MemoryDoc[]> = {
    projects: [],
    dashboardCache: [],
    publications: [],
    metricSnapshots: [],
  };
  const notify = (enabledEvents: string[]) => ({ channel: "telegram", chatId: "-100", tokenEnvVar: "X", enabledEvents });
  t.projects.push({ _id: SNYTCH, _creationTime: 1, slug: "snytch", name: "Snytch", status: "active", notify: notify(EVENEMENTS_SNYTCH) });
  t.projects.push({ _id: BLUSH, _creationTime: 2, slug: "blush", name: "BLUSH", status: "active", notify: notify(EVENEMENTS_BLUSH) });
  // La carte « recrues » du Dashboard, rangée par son cron : le digest la lit.
  t.dashboardCache.push(
    doc("dashboardCache", { projectId: SNYTCH, key: "decisions", json: JSON.stringify({ recruits: [] }), changedAt: NOW }),
  );

  const publier = (
    projectId: string,
    compte: string,
    datePubli: number,
    opts: { releves: number[]; postUrl?: string | null },
  ) => {
    const plateforme = seq % 2 === 0 ? "TikTok" : "Instagram";
    const p = doc("publications", {
      projectId,
      carouselId: `${plateforme === "TikTok" ? "TT" : "IG"}-${7_412_000_000 + seq}`,
      plateforme,
      mediaType: "short",
      compte,
      datePubli,
      postUrl:
        opts.postUrl === null
          ? undefined
          : (opts.postUrl ?? `https://www.tiktok.com/@${compte}/video/${7_412_000_000 + seq}`),
    });
    t.publications.push(p);
    // Un relevé par nuit (23 h 30 Paris), puis la copie « latest » sur la
    // publication, comme recomputeLatestMetrics.
    let dernier: MemoryDoc | null = null;
    opts.releves.forEach((vues, d) => {
      dernier = doc("metricSnapshots", {
        projectId,
        publicationId: p._id,
        capturedAt: datePubli + d * DAY + 5 * 3_600_000,
        daysSincePublication: d,
        vues,
        likes: Math.floor(vues / 23),
        createdAt: horloge,
        source: plateforme === "TikTok" ? "tiktok" : "instagram",
      });
      t.metricSnapshots.push(dernier);
    });
    if (dernier !== null) {
      const l = dernier as MemoryDoc;
      Object.assign(p, {
        vuesLatest: l.vues,
        likesLatest: l.likes,
        latestSnapshotId: l._id,
        latestSnapshotAt: l.capturedAt,
        latestSnapshotDaysSince: l.daysSincePublication,
      });
    }
    return p;
  };

  const comptes = ["juliette.snytch_", "lea.verif.fr", "marby.snytch", "camila.mx"];
  // Les jamais relevées, au milieu du reste (l'ordre de création compte pour
  // les égalités d'âge).
  publier(SNYTCH, "lea.verif.fr", NOW - 40 * DAY - 3_600_000, { releves: [] }); // perdue
  for (let i = 0; i < 1_900; i++) {
    const age = 2 + (i % 60);
    const jours = Math.min(age, 21);
    publier(SNYTCH, comptes[i % 4], NOW - age * DAY - (i % 7) * 3_600_000, {
      releves: Array.from({ length: jours }, (_, d) => 120 * (d + 1) + i),
    });
    if (i === 700) publier(SNYTCH, "camila.mx", NOW - 40 * DAY - 7_200_000, { releves: [] }); // même âge
    if (i === 1_200) publier(SNYTCH, "juliette.snytch_", NOW - 5 * DAY - 3_600_000, { releves: [] }); // rattrapable
  }
  // Absentes du digest : relevée à 0 vue (une mesure), publiée hier (le relevé
  // de 23 h 30 n'est pas encore passé deux fois), sans lien.
  publier(SNYTCH, "marby.snytch", NOW - 12 * DAY, { releves: [0, 0, 0] });
  publier(SNYTCH, "marby.snytch", NOW - 1 * DAY, { releves: [] });
  publier(SNYTCH, "juliette.snytch_", NOW - 20 * DAY, { releves: [], postUrl: null });
  // Un autre projet : sa publication jamais relevée n'a rien à faire chez Snytch.
  publier(BLUSH, "blush.conv", NOW - 9 * DAY, { releves: [] });
  for (let i = 0; i < 40; i++) publier(BLUSH, "blush.conv", NOW - (3 + i) * DAY, { releves: [300, 900, 1_500] });

  return t;
}

describe("digest quotidien — publications jamais mesurées", () => {
  const tables = projetSnytch();

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("le projet simulé dépasse bien la limite de Convex", () => {
    expect(tables.metricSnapshots.filter((s) => s.projectId === SNYTCH).length).toBeGreaterThan(32_000);
  });

  it("le digest de Snytch passe sous la limite, sans lire un seul relevé", async () => {
    const m = memoryDb(tables);
    const digest = await collectDigestCore({ db: m.db } as unknown as QueryCtx, SNYTCH);
    expect(digest).not.toBeNull();
    // Les publications jamais relevées (5 à Snytch), le projet, la carte du
    // Dashboard — pas les 1 900 publications relevées ni leurs 32 000 relevés.
    expect(m.reads()).toBeLessThan(50);
  });

  it("signale exactement les publications jamais relevées, la plus ancienne d'abord", async () => {
    const digest = await collectDigestCore({ db: memoryDb(tables).db } as unknown as QueryCtx, SNYTCH);
    expect(digest?.sections.jamaisMesurees).toEqual([
      { compte: "lea.verif.fr", joursDepuisPubli: 40 },
      { compte: "camila.mx", joursDepuisPubli: 40 },
      { compte: "juliette.snytch_", joursDepuisPubli: 5 },
    ]);
  });

  it("BLUSH garde la sienne, sans celles de Snytch", async () => {
    const digest = await collectDigestCore({ db: memoryDb(tables).db } as unknown as QueryCtx, BLUSH);
    expect(digest?.sections.jamaisMesurees).toEqual([{ compte: "blush.conv", joursDepuisPubli: 9 }]);
  });
});

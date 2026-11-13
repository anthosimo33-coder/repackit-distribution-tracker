/**
 * NOUVEAU RADAR — APPS DES CLASSEMENTS : la collecte et ses écritures. Les
 * règles, leur raison d'être et la mesure du 12/11/2026 : convex/radarStoreMath.
 *
 *  - CLASSEMENTS (toutes les 3 heures) : 12 listes de l'App Store par passage
 *    (France et États-Unis, 22 genres, gratuites et plus rentables), en boucle.
 *    Chaque app vue entre dans `radarStoreApps`, les récentes en tête de file.
 *  - CONTRÔLE (toutes les heures) : jusqu'à 90 pages publiques de TikTok, une à
 *    la fois, avec la pause du relevé de vues (1,5 à 3 s) — le hashtag de l'app,
 *    puis le profil de ses auteurs. Aucun crédit. Cinq pages refusées d'affilée
 *    arrêtent le passage : le suivant reprendra.
 *  - Une app à deux comptes créateurs ou plus entre dans les apps repérées
 *    (`radarAppCandidates`, genre « store ») : l'écran la propose, quelqu'un la
 *    suit ou l'ignore. La suivre crée l'app et rattache ces comptes
 *    (radarNetworks.followCandidate), puis sa recherche de réseau fait le reste.
 *
 * Sans SCRAPECREATORS_API_KEY (tests, poste local), rien ne part sur le réseau :
 * même garde que les autres tâches du Radar.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { e2eMutation, permissionQuery, type ProjectQueryCtx } from "./functions";
import { ensureSettings, readSettings } from "./radarSignals";
import { cleanText } from "./radarSignalsMath";
import {
  alreadyFollowed,
  checkStoreApp,
  feedsForRun,
  fetchEmbedPage,
  firstCheckAt,
  nextCheckAfter,
  parseStoreFeed,
  runStoreQueue,
  storeBrand,
  storeCandidateKey,
  storeFeedUrl,
  storePauseMs,
  storeUrl,
  tagCore,
  type StoreEntry,
  type TagVerdict,
} from "./radarStoreMath";
import { scKeyPresent } from "./scrapeCreatorsApi";

const DAY = 86_400_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Les classements ─────────────────────────────────────────────────────────

const entryValidator = v.object({ storeId: v.string(), name: v.string(), artist: v.string(), genre: v.string(), released: v.string() });

/** Range les apps d'une liste : une app neuve entre dans la file, une app connue garde sa place. Rend le nombre d'apps neuves. */
export async function upsertStoreAppsCore(ctx: MutationCtx, country: string, entries: readonly StoreEntry[], now: number): Promise<number> {
  let created = 0;
  for (const e of entries) {
    const got = await ctx.db.query("radarStoreApps").withIndex("by_store", (q) => q.eq("storeId", e.storeId)).first();
    if (!got) {
      await ctx.db.insert("radarStoreApps", { ...e, countries: [country], firstSeenAt: now, lastSeenAt: now, nextCheckAt: firstCheckAt(e.released, now) });
      created++;
    } else if (!got.countries.includes(country) || now - got.lastSeenAt > DAY) {
      // Une écriture par jour au plus pour une app déjà là : les listes sont relues plusieurs fois par jour.
      await ctx.db.patch(got._id, { lastSeenAt: now, ...(got.countries.includes(country) ? {} : { countries: [...got.countries, country] }) });
    }
  }
  return created;
}

export const upsertStoreApps = internalMutation({
  args: { country: v.string(), entries: v.array(entryValidator), now: v.number() },
  handler: (ctx, { country, entries, now }): Promise<number> => upsertStoreAppsCore(ctx, country, entries, now),
});

export const chartsCursor = internalQuery({
  args: {},
  handler: async (ctx): Promise<number> => (await readSettings(ctx))?.storeCursor ?? 0,
});

export const noteChartsRun = internalMutation({
  args: { cursor: v.number(), created: v.number(), now: v.number() },
  handler: async (ctx, { cursor, created, now }) => {
    const s = await ensureSettings(ctx);
    await ctx.db.patch(s._id, { storeCursor: cursor, lastStoreChartsAt: now, storeSeen: (s.storeSeen ?? 0) + created });
    return null;
  },
});

type ChartsRun = { skipped: "no-key" } | { read: number; created: number; errors: number };

/** Le passage des classements : les listes du tour, l'une après l'autre. */
export const runStoreCharts = internalAction({
  args: {},
  handler: async (ctx): Promise<ChartsRun> => {
    if (!scKeyPresent()) return { skipped: "no-key" };
    const cursor: number = await ctx.runQuery(internal.radarStore.chartsCursor, {});
    const { feeds, next } = feedsForRun(cursor);
    let read = 0;
    let created = 0;
    let errors = 0;
    for (const f of feeds) {
      try {
        const res = await fetch(storeFeedUrl(f), { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) {
          errors++;
          continue;
        }
        const entries = parseStoreFeed(await res.json());
        created += await ctx.runMutation(internal.radarStore.upsertStoreApps, { country: f.country, entries, now: Date.now() });
        read++;
      } catch {
        errors++;
      }
    }
    await ctx.runMutation(internal.radarStore.noteChartsRun, { cursor: next, created, now: Date.now() });
    return { read, created, errors };
  },
});

// ─── Le contrôle TikTok ──────────────────────────────────────────────────────

/** Apps tirées de la file par passage (le passage s'arrête avant, à ses 90 pages). */
const APPS_PER_RUN = 60;

type DueStoreApp = { id: Id<"radarStoreApps">; name: string; artist: string };
type DueStore = { due: DueStoreApp[]; followed: { strong: string[] }[] };

export const dueStoreApps = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }): Promise<DueStore> => {
    const rows = await ctx.db
      .query("radarStoreApps")
      .withIndex("by_due", (q) => q.lte("nextCheckAt", now))
      .take(Math.max(0, limit));
    const apps = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
    return { due: rows.map((r) => ({ id: r._id, name: r.name, artist: r.artist })), followed: apps.map((a) => ({ strong: a.strong })) };
  },
});

const bestValidator = v.object({
  tag: v.string(),
  videos: v.number(),
  views: v.number(),
  creators: v.array(v.object({ handle: v.string(), why: v.union(v.literal("handle"), v.literal("bio"), v.literal("half")) })),
});
const outcomeValidator = v.union(v.literal("network"), v.literal("none"), v.literal("known"), v.literal("unreadable"));

/**
 * Écrit ce qu'un contrôle a conclu : l'app des classements garde son verdict et
 * sa prochaine date ; avec un réseau, elle entre (ou se met à jour) dans les apps
 * repérées. Une app déjà ignorée ou suivie garde son statut.
 */
export async function applyStoreCheckCore(
  ctx: MutationCtx,
  id: Id<"radarStoreApps">,
  outcome: "network" | "none" | "known" | "unreadable",
  best: TagVerdict | null,
  now: number,
): Promise<"created" | "updated" | null> {
  const app = await ctx.db.get(id);
  if (!app) return null;
  await ctx.db.patch(id, {
    checkedAt: now,
    outcome,
    nextCheckAt: nextCheckAfter(outcome, now),
    ...(best ? { tag: best.tag, tagVideos: best.videos, creators: best.creators.length } : {}),
  });
  if (outcome !== "network" || !best) return null;
  const key = storeCandidateKey(app.storeId);
  const fields = {
    label: cleanText(storeBrand(app.name), 60) || app.name.slice(0, 60),
    authors: best.creators.map((c) => c.handle),
    authorCount: best.creators.length,
    examples: best.creators.slice(0, 5).map((c) => ({ handle: c.handle, url: `https://www.tiktok.com/@${c.handle}` })),
    lastSeenAt: now,
    store: { storeId: app.storeId, artist: app.artist, genre: app.genre, released: app.released, tag: best.tag, tagVideos: best.videos, tagViews: best.views, creators: best.creators },
  };
  const got = await ctx.db.query("radarAppCandidates").withIndex("by_key", (q) => q.eq("key", key)).first();
  if (got) {
    await ctx.db.patch(got._id, fields);
    return "updated";
  }
  await ctx.db.insert("radarAppCandidates", { key, kind: "store", fromApps: [], status: "new", firstSeenAt: now, ...fields });
  return "created";
}

export const applyStoreCheck = internalMutation({
  args: { id: v.id("radarStoreApps"), outcome: outcomeValidator, best: v.union(bestValidator, v.null()), now: v.number() },
  handler: (ctx, { id, outcome, best, now }): Promise<"created" | "updated" | null> => applyStoreCheckCore(ctx, id, outcome, best, now),
});

export const noteChecksRun = internalMutation({
  args: { checked: v.number(), stopped: v.union(v.string(), v.null()), now: v.number() },
  handler: async (ctx, { checked, stopped, now }) => {
    const s = await ensureSettings(ctx);
    await ctx.db.patch(s._id, { lastStoreChecksAt: now, storeChecked: (s.storeChecked ?? 0) + checked, lastStoreStop: stopped ?? undefined });
    return null;
  },
});

type ChecksRun = { skipped: "no-key" } | { checked: number; found: number; pages: number; stopped: string | null };

/** Le passage du contrôle : la file, une page à la fois avec la pause du relevé de vues (radarStoreMath.runStoreQueue). */
export const runStoreChecks = internalAction({
  args: {},
  handler: async (ctx): Promise<ChecksRun> => {
    if (!scKeyPresent()) return { skipped: "no-key" };
    const { due, followed }: DueStore = await ctx.runQuery(internal.radarStore.dueStoreApps, { now: Date.now(), limit: APPS_PER_RUN });
    let found = 0;
    const run = await runStoreQueue(due, followed, {
      page: (url) => fetchEmbedPage(url),
      pause: () => sleep(storePauseMs(Math.random())),
      apply: async (app, outcome, best) => {
        const wrote = await ctx.runMutation(internal.radarStore.applyStoreCheck, { id: app.id, outcome, best, now: Date.now() });
        if (wrote === "created") found++;
      },
    });
    await ctx.runMutation(internal.radarStore.noteChecksRun, { checked: run.checked, stopped: run.stopped, now: Date.now() });
    return { ...run, found };
  },
});

// ─── L'écran ─────────────────────────────────────────────────────────────────

/** Apps des classements montrées au plus, celles qui ont le plus de comptes créateurs d'abord. */
const STORE_LIST_CAP = 60;

export async function listStoreCandidatesCore(ctx: ProjectQueryCtx) {
  const rows = await ctx.db
    .query("radarAppCandidates")
    .withIndex("by_kind_status_count", (q) => q.eq("kind", "store").eq("status", "new"))
    .order("desc")
    .take(STORE_LIST_CAP);
  const s = await readSettings(ctx);
  // Une app suivie depuis (à l'écran sous un autre nom, ou par la liste de départ) n'est plus à proposer.
  const followed = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
  return {
    apps: rows.flatMap((c) =>
      c.store && !alreadyFollowed([c.store.tag], followed)
        ? [
            {
              id: c._id,
              // Le nom et le motif proposés pour la suivre.
              name: c.label,
              patterns: [tagCore(c.store.tag)],
              storeUrl: storeUrl(c.store.storeId),
              artist: c.store.artist,
              genre: c.store.genre,
              year: c.store.released.slice(0, 4),
              tag: c.store.tag,
              tagVideos: c.store.tagVideos,
              tagViews: c.store.tagViews,
              creators: c.store.creators.map((x) => ({ handle: x.handle, why: x.why, url: `https://www.tiktok.com/@${x.handle}` })),
              firstSeenAt: c.firstSeenAt,
            },
          ]
        : [],
    ),
    // Où en est la collecte : apps vues dans les classements, apps contrôlées, dernier passage.
    seen: s?.storeSeen ?? 0,
    checked: s?.storeChecked ?? 0,
    lastChecksAt: s?.lastStoreChecksAt ?? null,
    stopped: s?.lastStoreStop ?? null,
  };
}

export const listStoreCandidates = permissionQuery("radar.use")({
  args: {},
  handler: (ctx) => listStoreCandidatesCore(ctx),
});

// ─── E2E ─────────────────────────────────────────────────────────────────────

/** e2e : des apps « vues dans les classements » (la vraie collecte ne tourne pas en e2e). */
export const e2eSeedStoreApps = e2eMutation({
  args: { country: v.string(), entries: v.array(entryValidator) },
  handler: (ctx, { country, entries }): Promise<number> => upsertStoreAppsCore(ctx, country, entries, Date.now()),
});

/**
 * e2e : le contrôle d'une app semée, avec les pages données ici (ce que TikTok
 * aurait rendu). Même décision et même écriture que le passage réel ; une page
 * absente de la liste est un hashtag ou un compte qui n'existe pas.
 */
export const e2eCheckStoreApp = e2eMutation({
  args: {
    storeId: v.string(),
    tags: v.array(v.object({ tag: v.string(), videos: v.number(), views: v.number(), items: v.array(v.object({ author: v.string(), desc: v.string() })) })),
    profiles: v.array(v.object({ handle: v.string(), fans: v.number(), bio: v.string(), verified: v.optional(v.boolean()), descs: v.array(v.string()) })),
  },
  handler: async (ctx, { storeId, tags, profiles }): Promise<{ outcome: string; creators: number; read: { tags: string[]; profiles: string[] } } | null> => {
    const app = await ctx.db.query("radarStoreApps").withIndex("by_store", (q) => q.eq("storeId", storeId)).first();
    if (!app) return null;
    const followed = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
    const read = { tags: [] as string[], profiles: [] as string[] };
    const r = await checkStoreApp(
      app,
      followed,
      {
        tag: async (tag) => {
          read.tags.push(tag);
          const p = tags.find((t) => t.tag === tag);
          return p ? { videos: p.videos, views: p.views, items: p.items } : "absent";
        },
        profile: async (handle) => {
          read.profiles.push(handle);
          const p = profiles.find((x) => x.handle === handle);
          return p ? { fans: p.fans, bio: p.bio, verified: p.verified === true, descs: p.descs } : "absent";
        },
        stopped: () => false,
      },
      new Map(),
    );
    if (r.outcome === "stopped") return null;
    const best = "best" in r ? r.best : null;
    await applyStoreCheckCore(ctx, app._id, r.outcome, best, Date.now());
    return { outcome: r.outcome, creators: best?.creators.length ?? 0, read };
  },
});

/** e2e : efface les apps des classements dont l'identifiant commence par `prefix`, et les apps repérées qui en viennent. */
export const e2eClearStore = e2eMutation({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }): Promise<number> => {
    let n = 0;
    const apps = await ctx.db
      .query("radarStoreApps")
      .withIndex("by_store", (q) => q.gte("storeId", prefix).lt("storeId", `${prefix}￿`))
      .collect();
    for (const a of apps) {
      const c = await ctx.db.query("radarAppCandidates").withIndex("by_key", (q) => q.eq("key", storeCandidateKey(a.storeId))).first();
      if (c) await ctx.db.delete(c._id);
      await ctx.db.delete(a._id);
      n++;
    }
    return n;
  },
});

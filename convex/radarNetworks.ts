/**
 * NOUVEAU RADAR — réseaux d'apps : les apps qu'on suit (concurrentes de Snytch,
 * de BLUSH, ou non), les comptes TikTok qui les poussent, et le relevé de ces
 * comptes. Règles pures : convex/radarNetworkMath.
 *
 * Deux tâches, tenues par le budget du mois (convex/radarSignalsMath) :
 *  - RÉSEAU (toutes les 6 h) : pour chaque app jamais cherchée ou cherchée il y
 *    a plus d'une semaine, ses recherches (mots-clés, hashtags, 2 pages) ; un
 *    auteur dont la légende cite l'app rejoint son réseau ;
 *  - COMPTES (toutes les heures) : les comptes dus sont relevés (9 dernières
 *    vidéos, 1 crédit) ; la médiane du compte donne le multiplicateur de chaque
 *    vidéo, celles qui sortent du lot sont promues dans Signaux.
 *
 * Données GLOBALES (les réseaux sont les mêmes pour tous les projets).
 */
import { v } from "convex/values";
import { ERR, err } from "./errorCodes";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { e2eMutation, permissionMutation, permissionQuery, type ProjectQueryCtx } from "./functions";
import { normalizeTikTokHandle } from "./radarApi";
import {
  MAX_READ_ERRORS,
  MAX_TRACKED,
  MEDIAN_WINDOW,
  NETWORK_PAGES,
  NETWORK_REFRESH_MS,
  citesApp,
  medianViews,
  multiplierOf,
  nextReadAt,
  normalize,
  searchKind,
  shouldPromote,
} from "./radarNetworkMath";
import { RETENTION_DAYS, allowance, budgetState, keepSignal, ratioOf, addSnapshot } from "./radarSignalsMath";
import {
  appRef,
  attachAccount,
  ensureSeedApps,
  maybeAlert,
  projectSlugOf,
  signalInput,
  todayCredits,
  writeSignal,
  type JobState,
  type RunResult,
  type TrackedCounter,
} from "./radarSignals";
import { scKeyPresent, scNetworkPage, scProfileVideos } from "./scrapeCreatorsApi";

const DAY = 86_400_000;
/** La tâche réseau tourne 4 fois par jour, celle des comptes 24 fois. */
const NETWORK_RUNS_PER_DAY = 4;
const ACCOUNT_RUNS_PER_DAY = 24;

const videoUrl = (handle: string, videoId: string) => `https://www.tiktok.com/@${handle}/video/${videoId}`;

// ─── Lectures des tâches (types de retour DÉCLARÉS, cf radarSignals) ─────────

type DueApp = { id: Id<"radarApps">; name: string; searches: string[] };
type DueAccount = { id: Id<"radarTracked">; handle: string };

export const dueApps = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<DueApp[]> => {
    const apps = await ctx.db.query("radarApps").withIndex("by_status", (q) => q.eq("status", "active")).collect();
    return apps
      .filter((a) => a.networkSearchedAt === undefined || now - a.networkSearchedAt >= NETWORK_REFRESH_MS)
      .map((a) => ({ id: a._id, name: a.name, searches: a.searches }));
  },
});

export const dueAccounts = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }): Promise<DueAccount[]> => {
    if (limit <= 0) return [];
    const rows = await ctx.db
      .query("radarTracked")
      .withIndex("by_due", (q) => q.eq("status", "active").lte("nextReadAt", now))
      .take(limit);
    return rows.map((r) => ({ id: r._id, handle: r.handle }));
  },
});

// ─── Écritures des tâches ────────────────────────────────────────────────────

export const seedApps = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => ensureSeedApps(ctx),
});

/**
 * Une page de recherche du réseau d'une app : chaque vidéo qui cite l'app
 * rattache son auteur au réseau, et entre dans Signaux si elle sort du lot.
 */
export const attachFromSearch = internalMutation({
  args: { appId: v.id("radarApps"), videos: v.array(signalInput), foundBy: v.string(), now: v.number() },
  handler: async (ctx, { appId, videos, foundBy, now }): Promise<{ attached: number; signals: number }> => {
    const app = await ctx.db.get(appId);
    if (!app) return { attached: 0, signals: 0 };
    const counter: TrackedCounter = {};
    let attached = 0;
    let signals = 0;
    for (const s of videos) {
      if (!citesApp(s.caption, s.authorHandle, app)) continue;
      if ((await attachAccount(ctx, appId, s.authorHandle, s.authorFans, "caption", now, counter)) === "added") attached++;
      const r = await writeSignal(ctx, s, now, {
        insert: keepSignal(s) && s.publishedAt >= now - RETENTION_DAYS * DAY,
        foundBy,
        app: appRef(app),
      });
      if (r === "inserted") signals++;
    }
    return { attached, signals };
  },
});

export const markNetworkSearched = internalMutation({
  args: { appId: v.id("radarApps"), now: v.number() },
  handler: async (ctx, { appId, now }): Promise<void> => {
    await ctx.db.patch(appId, { networkSearchedAt: now });
  },
});

/**
 * Le relevé d'un compte : ses vidéos sont rangées (avec leur relevé), sa médiane
 * et ses agrégats recalculés, son prochain relevé fixé, et ses vidéos qui sortent
 * du lot promues dans Signaux (celles déjà promues restent à jour).
 */
export const applyAccountRead = internalMutation({
  args: { accountId: v.id("radarTracked"), videos: v.array(signalInput), now: v.number() },
  handler: async (ctx, { accountId, videos, now }): Promise<{ promoted: number }> => {
    const acc = await ctx.db.get(accountId);
    if (!acc) return { promoted: 0 };
    const app = await ctx.db.get(acc.appId);
    let added = 0;
    for (const s of videos) {
      const known = await ctx.db.query("radarTrackedVideos").withIndex("by_video", (q) => q.eq("videoId", s.videoId)).first();
      if (known) {
        await ctx.db.patch(known._id, { views: Math.max(known.views, s.views), snapshots: addSnapshot(known.snapshots, now, s.views), lastSeenAt: now });
      } else {
        await ctx.db.insert("radarTrackedVideos", {
          accountId,
          appId: acc.appId,
          videoId: s.videoId,
          publishedAt: s.publishedAt,
          views: s.views,
          snapshots: [{ at: now, views: s.views }],
          lastSeenAt: now,
        });
        added++;
      }
    }
    const recent = await ctx.db
      .query("radarTrackedVideos")
      .withIndex("by_account_published", (q) => q.eq("accountId", accountId))
      .order("desc")
      .take(MEDIAN_WINDOW);
    const median = medianViews(recent.map((r) => r.views));
    const fans = videos[0]?.authorFans ?? acc.fans;
    const lastPostAt = Math.max(acc.lastPostAt ?? 0, recent[0]?.publishedAt ?? 0) || undefined;
    const week = recent.filter((r) => now - r.publishedAt <= 7 * DAY);
    let best: Doc<"radarTracked">["best7d"];
    for (const r of week) {
      const m = multiplierOf(r.views, median) ?? ratioOf(r.views, fans);
      if (!best || m > best.multiplier) best = { videoId: r.videoId, url: videoUrl(acc.handle, r.videoId), views: r.views, multiplier: m, publishedAt: r.publishedAt };
    }
    await ctx.db.patch(accountId, {
      fans,
      medianViews: median,
      videosSeen: acc.videosSeen + added,
      lastPostAt,
      readAt: now,
      nextReadAt: nextReadAt(lastPostAt, now),
      readErrors: 0,
      posts7d: week.length,
      best7d: best,
    });
    let promoted = 0;
    for (const s of videos) {
      const multiplier = multiplierOf(s.views, median);
      const promote = shouldPromote(s.views, multiplier, ratioOf(s.views, s.authorFans)) && s.publishedAt >= now - RETENTION_DAYS * DAY;
      const r = await writeSignal(ctx, s, now, {
        insert: promote,
        foundBy: "compte suivi",
        ...(app ? { app: appRef(app) } : {}),
        trackedAccountId: accountId,
        ...(multiplier !== undefined ? { multiplier } : {}),
      });
      if (r === "inserted") promoted++;
    }
    return { promoted };
  },
});

/** Relevé en échec : 3 de suite (compte supprimé, privé, renommé) et le compte passe en pause. */
export const markReadError = internalMutation({
  args: { accountId: v.id("radarTracked"), now: v.number() },
  handler: async (ctx, { accountId, now }): Promise<void> => {
    const acc = await ctx.db.get(accountId);
    if (!acc) return;
    const errors = acc.readErrors + 1;
    await ctx.db.patch(accountId, { readErrors: errors, nextReadAt: now + DAY, ...(errors >= MAX_READ_ERRORS ? { status: "paused" as const } : {}) });
  },
});

// ─── Tâches ──────────────────────────────────────────────────────────────────

/** Réseau : les recherches des apps dues, dans la limite du budget. */
export const runNetworkSearch = internalAction({
  args: {},
  handler: async (ctx): Promise<RunResult> => {
    const now = Date.now();
    if (!scKeyPresent()) return { skipped: "no-key" };
    await ctx.runMutation(internal.radarNetworks.seedApps, {});
    const st: JobState = await ctx.runQuery(internal.radarSignals.jobState, { now });
    const b = budgetState(st.budget, st.usage);
    const left = allowance(st.budget, b, "network", todayCredits(st, "network"), NETWORK_RUNS_PER_DAY);
    const due: DueApp[] = await ctx.runQuery(internal.radarNetworks.dueApps, { now });
    let credits = 0;
    let calls = 0;
    let errors = 0;
    let creditsRemaining: number | undefined;
    let lastError: string | undefined;
    let stop = false;
    for (const app of due) {
      let complete = true;
      for (const raw of app.searches) {
        const { kind, value } = searchKind(raw);
        let cursor: number | undefined;
        for (let page = 0; page < NETWORK_PAGES; page++) {
          if (credits >= left) {
            stop = true;
            complete = false;
            break;
          }
          const r = await scNetworkPage(kind, value, cursor);
          calls++;
          credits += r.credits;
          if (!r.ok) {
            errors++;
            lastError = r.error;
            if (r.noCredits) {
              stop = true;
              complete = false;
            }
            break;
          }
          if (r.creditsRemaining !== undefined) creditsRemaining = r.creditsRemaining;
          await ctx.runMutation(internal.radarNetworks.attachFromSearch, { appId: app.id, videos: r.value.videos, foundBy: `réseau ${app.name}`, now });
          cursor = r.value.cursor;
          if (cursor === undefined || r.value.videos.length === 0) break;
        }
        if (stop) break;
      }
      // Une app à moitié cherchée (budget du passage épuisé) reprend au suivant.
      if (complete) await ctx.runMutation(internal.radarNetworks.markNetworkSearched, { appId: app.id, now });
      if (stop) break;
    }
    await ctx.runMutation(internal.radarSignals.recordRun, {
      poste: "network",
      credits,
      calls,
      errors,
      now,
      ...(creditsRemaining !== undefined ? { creditsRemaining } : {}),
      ...(lastError ? { lastError } : {}),
    });
    if (calls) await maybeAlert(ctx, now);
    return { calls, credits, errors };
  },
});

/** Comptes : les relevés dus, dans la limite du budget. */
export const runAccountReads = internalAction({
  args: {},
  handler: async (ctx): Promise<RunResult> => {
    const now = Date.now();
    if (!scKeyPresent()) return { skipped: "no-key" };
    const st: JobState = await ctx.runQuery(internal.radarSignals.jobState, { now });
    const b = budgetState(st.budget, st.usage);
    const n = allowance(st.budget, b, "tiktok", todayCredits(st, "tiktok"), ACCOUNT_RUNS_PER_DAY);
    const due: DueAccount[] = await ctx.runQuery(internal.radarNetworks.dueAccounts, { now, limit: n });
    let credits = 0;
    let errors = 0;
    let creditsRemaining: number | undefined;
    let lastError: string | undefined;
    for (const acc of due) {
      const r = await scProfileVideos(acc.handle);
      credits += r.credits;
      if (!r.ok) {
        errors++;
        lastError = r.error;
        if (r.noCredits) break;
        await ctx.runMutation(internal.radarNetworks.markReadError, { accountId: acc.id, now });
        continue;
      }
      if (r.creditsRemaining !== undefined) creditsRemaining = r.creditsRemaining;
      await ctx.runMutation(internal.radarNetworks.applyAccountRead, { accountId: acc.id, videos: r.value, now });
    }
    await ctx.runMutation(internal.radarSignals.recordRun, {
      poste: "tiktok",
      credits,
      calls: due.length,
      errors,
      now,
      ...(creditsRemaining !== undefined ? { creditsRemaining } : {}),
      ...(lastError ? { lastError } : {}),
    });
    if (due.length) await maybeAlert(ctx, now);
    return { calls: due.length, credits, errors };
  },
});

// ─── Écran et outil MCP ──────────────────────────────────────────────────────

/**
 * Les apps suivies et leur réseau, pour l'onglet Comptes suivis : comptes,
 * publications de la semaine, meilleure vidéo. Les concurrentes du projet en
 * tête. Lit les comptes (1 000 au plus), jamais leurs vidéos.
 */
export async function listNetworksCore(ctx: ProjectQueryCtx) {
  const slug = await projectSlugOf(ctx);
  const apps = await ctx.db.query("radarApps").collect();
  const tracked = await ctx.db.query("radarTracked").take(MAX_TRACKED + 100);
  const rows = apps.map((a) => {
    const mine = tracked.filter((t) => t.appId === a._id);
    let best: { handle: string; url: string; views: number; multiplier: number; publishedAt: number } | null = null;
    for (const t of mine) {
      if (t.best7d && (!best || t.best7d.multiplier > best.multiplier)) {
        const b = t.best7d;
        best = { handle: t.handle, url: b.url, views: b.views, multiplier: b.multiplier, publishedAt: b.publishedAt };
      }
    }
    const group: "rival" | "otherRival" | "other" = a.rivalOf.includes(slug) ? "rival" : a.rivalOf.length ? "otherRival" : "other";
    return {
      id: a._id,
      slug: a.slug,
      name: a.name,
      rivalOf: a.rivalOf,
      group,
      status: a.status,
      source: a.source,
      searches: a.searches,
      accounts: mine.length,
      activeAccounts: mine.filter((t) => t.status === "active").length,
      posts7d: mine.reduce((s, t) => s + (t.posts7d ?? 0), 0),
      best,
      networkSearchedAt: a.networkSearchedAt ?? null,
    };
  });
  const order = { rival: 0, otherRival: 1, other: 2 } as const;
  rows.sort((x, y) => order[x.group] - order[y.group] || y.accounts - x.accounts || x.name.localeCompare(y.name));
  return {
    max: MAX_TRACKED,
    total: tracked.length,
    active: tracked.filter((t) => t.status === "active").length,
    projectSlug: slug,
    apps: rows,
  };
}

export const listNetworks = permissionQuery("radar.use")({
  args: {},
  handler: (ctx) => listNetworksCore(ctx),
});

/** Les comptes du réseau d'une app, les plus en forme d'abord. */
export async function listAppAccountsCore(ctx: ProjectQueryCtx, { appId }: { appId: Id<"radarApps"> }) {
  const rows = await ctx.db.query("radarTracked").withIndex("by_app", (q) => q.eq("appId", appId)).collect();
  return rows
    .map((t) => ({
      id: t._id,
      handle: t.handle,
      url: `https://www.tiktok.com/@${t.handle}`,
      status: t.status,
      matchedBy: t.matchedBy,
      fans: t.fans,
      medianViews: t.medianViews ?? null,
      videosSeen: t.videosSeen,
      posts7d: t.posts7d ?? 0,
      lastPostAt: t.lastPostAt ?? null,
      readAt: t.readAt ?? null,
      best7d: t.best7d ?? null,
    }))
    .sort((x, y) => (y.best7d?.multiplier ?? -1) - (x.best7d?.multiplier ?? -1) || y.fans - x.fans);
}

export const listAppAccounts = permissionQuery("radar.use")({
  args: { appId: v.id("radarApps") },
  handler: (ctx, args) => listAppAccountsCore(ctx, args),
});

/** Ajoute une app à suivre : ses motifs (cités dans une légende) font aussi ses recherches. */
export const addApp = permissionMutation("radar.use")({
  args: { name: v.string(), rivalOf: v.array(v.string()), patterns: v.array(v.string()) },
  handler: async (ctx, { name, rivalOf, patterns }) => {
    const clean = name.trim().slice(0, 60);
    const strong = Array.from(new Set(patterns.map((p) => normalize(p.replace(/^#/, "")).compact).filter((p) => p.length >= 3)));
    if (!clean || strong.length === 0) throw err(ERR.RADAR_APP_INVALID, "Un nom et au moins un motif de 3 caractères.");
    const slug = normalize(clean).compact.replace(/[^a-z0-9.]/g, "");
    if (await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", slug)).first()) {
      throw err(ERR.RADAR_APP_ALREADY_FOLLOWED, `L'app « ${clean} » est déjà suivie.`, { name: clean });
    }
    const id = await ctx.db.insert("radarApps", {
      slug,
      name: clean,
      rivalOf: rivalOf.filter((r) => /^[a-z0-9-]+$/.test(r)),
      strong,
      weak: [],
      context: [],
      searches: [...strong, ...strong.map((p) => `#${p}`)],
      status: "active",
      source: "manual",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.radarNetworks.runNetworkSearch, {});
    return id;
  },
});

export const setAppStatus = permissionMutation("radar.use")({
  args: { appId: v.id("radarApps"), status: v.union(v.literal("active"), v.literal("paused")) },
  handler: async (ctx, { appId, status }) => {
    await ctx.db.patch(appId, { status });
    return status;
  },
});

/** Relance tout de suite la recherche du réseau d'une app (dans la limite du budget). */
export const searchAppNow = permissionMutation("radar.use")({
  args: { appId: v.id("radarApps") },
  handler: async (ctx, { appId }) => {
    await ctx.db.patch(appId, { networkSearchedAt: undefined });
    await ctx.scheduler.runAfter(0, internal.radarNetworks.runNetworkSearch, {});
    return null;
  },
});

/** Ajoute un compte au réseau d'une app, à la main : il est relevé dans l'heure. */
export const addTrackedAccount = permissionMutation("radar.use")({
  args: { appId: v.id("radarApps"), handle: v.string() },
  handler: async (ctx, { appId, handle }) => {
    const h = normalizeTikTokHandle(handle);
    if (!h) throw err(ERR.RADAR_HANDLE_INVALID, "Pseudo ou lien TikTok illisible.");
    if (!(await ctx.db.get(appId))) throw err(ERR.RADAR_APP_NOT_FOUND, "App introuvable.");
    const r = await attachAccount(ctx, appId, h, 0, "manual", Date.now(), {});
    if (r === "full") throw err(ERR.RADAR_TRACKED_FULL, `Déjà ${MAX_TRACKED} comptes suivis : mets-en en pause d'abord.`, { max: MAX_TRACKED });
    if (r === "added") await ctx.scheduler.runAfter(0, internal.radarNetworks.runAccountReads, {});
    return r;
  },
});

export const setTrackedStatus = permissionMutation("radar.use")({
  args: { accountId: v.id("radarTracked"), status: v.union(v.literal("active"), v.literal("paused")) },
  handler: async (ctx, { accountId, status }) => {
    await ctx.db.patch(accountId, { status, ...(status === "active" ? { nextReadAt: Date.now(), readErrors: 0 } : {}) });
    return status;
  },
});

// ─── E2E ─────────────────────────────────────────────────────────────────────

/** E2E — sème des apps et leurs comptes (global : effacés par `e2eClearNetwork`). */
export const e2eSeedNetwork = e2eMutation({
  args: {
    apps: v.array(v.object({ slug: v.string(), name: v.string(), rivalOf: v.array(v.string()), strong: v.array(v.string()) })),
    accounts: v.array(
      v.object({
        handle: v.string(),
        appSlug: v.string(),
        fans: v.number(),
        medianViews: v.optional(v.number()),
        posts7d: v.number(),
        best7d: v.optional(v.object({ videoId: v.string(), views: v.number(), multiplier: v.number(), publishedAt: v.number() })),
      }),
    ),
  },
  handler: async (ctx, { apps, accounts }) => {
    const now = Date.now();
    const ids = new Map<string, Id<"radarApps">>();
    for (const a of apps) {
      ids.set(
        a.slug,
        await ctx.db.insert("radarApps", { ...a, weak: [], context: [], searches: a.strong, status: "active", source: "manual", networkSearchedAt: now, createdAt: now }),
      );
    }
    for (const t of accounts) {
      const appId = ids.get(t.appSlug)!;
      await ctx.db.insert("radarTracked", {
        platform: "tiktok",
        handle: t.handle,
        appId,
        status: "active",
        matchedBy: "caption",
        fans: t.fans,
        ...(t.medianViews !== undefined ? { medianViews: t.medianViews } : {}),
        videosSeen: 9,
        posts7d: t.posts7d,
        ...(t.best7d ? { best7d: { ...t.best7d, url: videoUrl(t.handle, t.best7d.videoId) } } : {}),
        lastPostAt: now - DAY,
        readAt: now,
        nextReadAt: now + DAY,
        readErrors: 0,
        addedAt: now,
      });
    }
    return { appIds: Object.fromEntries(ids) };
  },
});

/** E2E — efface les apps dont le slug commence par `prefix`, leurs comptes et leurs vidéos. */
export const e2eClearNetwork = e2eMutation({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }) => {
    let n = 0;
    for (const a of await ctx.db.query("radarApps").collect()) {
      if (!a.slug.startsWith(prefix)) continue;
      for (const t of await ctx.db.query("radarTracked").withIndex("by_app", (q) => q.eq("appId", a._id)).collect()) {
        for (const vid of await ctx.db.query("radarTrackedVideos").withIndex("by_account_published", (q) => q.eq("accountId", t._id)).collect()) {
          await ctx.db.delete(vid._id);
        }
        await ctx.db.delete(t._id);
      }
      await ctx.db.delete(a._id);
      n++;
    }
    return { deleted: n };
  },
});

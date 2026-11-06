/**
 * NOUVEAU RADAR — réseaux d'apps : les apps qu'on suit (concurrentes de Snytch,
 * de BLUSH, ou non), les comptes TikTok qui les poussent, et le relevé de ces
 * comptes. Règles pures : convex/radarNetworkMath.
 *
 * Deux tâches, tenues par le budget du mois (convex/radarSignalsMath) :
 *  - RÉSEAU (toutes les 6 h) : chaque app jamais cherchée, ou cherchée il y a
 *    plus de 3 jours (concurrente) ou d'une semaine (les autres), concurrentes
 *    d'abord : ses recherches (mots-clés, hashtags ; 3 pages pour une
 *    concurrente, 2 sinon) ; un auteur dont la légende cite l'app rejoint son
 *    réseau ;
 *  - COMPTES (toutes les heures) : les comptes dus sont relevés (9 dernières
 *    vidéos, 1 crédit) ; la médiane du compte donne le multiplicateur de chaque
 *    vidéo, celles qui sortent du lot sont promues dans Signaux.
 *
 * Chaque relevé tient aussi deux choses :
 *  - les FORMATS QUI CIRCULENT : le même gabarit de hook (texte à l'écran, ses
 *    4 premiers mots) ou le même son repris par au moins deux comptes suivis en
 *    14 jours (radarFormats) — 3 comptes en 48 h chez une concurrente déclenchent
 *    une alerte Telegram aux projets concernés ;
 *  - les APPS REPÉRÉES : les comptes mentionnés et les domaines que citent les
 *    comptes (radarAppCandidates). Suivre une app repérée rattache à son réseau
 *    les comptes qui la citaient : la boule de neige créatrices → apps → créatrices.
 *
 * Données GLOBALES (les réseaux sont les mêmes pour tous les projets).
 */
import { v } from "convex/values";
import { ERR, err } from "./errorCodes";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { e2eMutation, permissionMutation, permissionQuery, type ProjectQueryCtx } from "./functions";
import { normalizeTikTokHandle } from "./radarApi";
import {
  FORMAT_MAX_MEMBERS,
  FORMAT_WINDOW_MS,
  MAX_READ_ERRORS,
  MAX_TRACKED,
  MEDIAN_WINDOW,
  citesApp,
  formatStarting,
  hookTemplate,
  igHandleFromBio,
  medianViews,
  multiplierOf,
  networkPages,
  networkRefreshMs,
  nextReadAt,
  normalize,
  patternsOfCandidate,
  searchKind,
  shouldPromote,
} from "./radarNetworkMath";
import { RETENTION_DAYS, allowance, budgetState, cleanText, keepSignal, ratioOf, addSnapshot } from "./radarSignalsMath";
import {
  appRef,
  attachAccount,
  ensureSeedApps,
  maybeAlert,
  noteCandidates,
  projectSlugOf,
  signalInput,
  todayCredits,
  writeSignal,
  type JobState,
  type RunResult,
  type TrackedCounter,
} from "./radarSignals";
import { scKeyPresent, scNetworkPage, scProfileVideos } from "./scrapeCreatorsApi";
import { deliver } from "./notifications";
import { escapeTelegram, notifyConfig } from "./notifyApi";

const DAY = 86_400_000;
/** La tâche réseau tourne 4 fois par jour, celle des comptes 24 fois. */
const NETWORK_RUNS_PER_DAY = 4;
const ACCOUNT_RUNS_PER_DAY = 24;

const videoUrl = (handle: string, videoId: string) => `https://www.tiktok.com/@${handle}/video/${videoId}`;

// ─── Lectures des tâches (types de retour DÉCLARÉS, cf radarSignals) ─────────

type DueApp = { id: Id<"radarApps">; name: string; searches: string[]; rival: boolean };
type DueAccount = { id: Id<"radarTracked">; handle: string };

export const dueApps = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<DueApp[]> => {
    const apps = await ctx.db.query("radarApps").withIndex("by_status", (q) => q.eq("status", "active")).collect();
    return apps
      .filter((a) => a.networkSearchedAt === undefined || now - a.networkSearchedAt >= networkRefreshMs(a.rivalOf.length > 0))
      .sort((x, y) => Number(y.rivalOf.length > 0) - Number(x.rivalOf.length > 0) || (x.networkSearchedAt ?? 0) - (y.networkSearchedAt ?? 0))
      .map((a) => ({ id: a._id, name: a.name, searches: a.searches, rival: a.rivalOf.length > 0 }));
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
      if ((await attachAccount(ctx, app, s.authorHandle, s.authorFans, "caption", now, counter)) === "added") attached++;
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

type Member = Doc<"radarFormats">["members"][number];

/** Ce que l'écran lit d'un format : comptes distincts, apps, vues max, dernière publication. */
function summarize(members: Member[]) {
  const sorted = [...members].sort((a, b) => b.views - a.views).slice(0, FORMAT_MAX_MEMBERS);
  return {
    members: sorted,
    accountCount: new Set(sorted.map((m) => m.accountId)).size,
    appIds: Array.from(new Set(sorted.map((m) => m.appId))),
    maxViews: Math.max(0, ...sorted.map((m) => m.views)),
    lastPostAt: Math.max(0, ...sorted.map((m) => m.publishedAt)),
  };
}

/**
 * Range une vidéo dans le format de son hook ou de son son. Un format n'existe
 * qu'à partir de DEUX comptes : tant qu'il n'y en a pas, on cherche si un autre
 * compte suivi a publié le même hook (ou le même son) dans les 14 derniers jours.
 */
export async function shareFormat(ctx: MutationCtx, kind: "hook" | "sound", key: string, label: string, member: Member, now: number) {
  const existing = await ctx.db.query("radarFormats").withIndex("by_key", (q) => q.eq("kind", kind).eq("key", key)).first();
  if (existing) {
    const sum = summarize([...existing.members.filter((m) => m.videoId !== member.videoId), member]);
    await ctx.db.patch(existing._id, sum);
    await maybeAlertFormat(ctx, existing._id, sum, existing.alertedProjects ?? [], now);
    return;
  }
  const peers =
    kind === "hook"
      ? await ctx.db.query("radarTrackedVideos").withIndex("by_hook", (q) => q.eq("hookKey", key)).take(50)
      : await ctx.db.query("radarTrackedVideos").withIndex("by_music", (q) => q.eq("musicId", key)).take(50);
  const others = peers.filter((p) => p.accountId !== member.accountId && p.publishedAt >= now - FORMAT_WINDOW_MS);
  if (others.length === 0) return;
  const members: Member[] = [member];
  for (const p of others) {
    const a = await ctx.db.get(p.accountId);
    if (!a) continue;
    members.push({
      accountId: p.accountId,
      handle: p.platform === "instagram" ? (a.igHandle ?? a.handle) : a.handle,
      appId: p.appId,
      videoId: p.videoId,
      publishedAt: p.publishedAt,
      views: p.views,
      ...(p.hook ? { hook: p.hook } : {}),
      ...(p.platform ? { platform: p.platform } : {}),
    });
  }
  const sum = summarize(members);
  const id = await ctx.db.insert("radarFormats", { kind, key, label, ...sum, firstSeenAt: now });
  await maybeAlertFormat(ctx, id, sum, [], now);
}

/**
 * Un format DÉMARRE chez une concurrente (3 comptes en 48 h, cf formatStarting) :
 * les projets dont elle est concurrente sont prévenus sur Telegram, une fois.
 */
async function maybeAlertFormat(ctx: MutationCtx, id: Id<"radarFormats">, sum: ReturnType<typeof summarize>, alerted: string[], now: number) {
  if (!formatStarting(sum.members, now)) return;
  const slugs = new Set<string>();
  for (const appId of sum.appIds) for (const slug of (await ctx.db.get(appId))?.rivalOf ?? []) slugs.add(slug);
  const toAlert = [...slugs].filter((slug) => !alerted.includes(slug));
  if (toAlert.length === 0) return;
  await ctx.db.patch(id, { alertedProjects: [...alerted, ...toAlert] });
  await ctx.scheduler.runAfter(0, internal.radarNetworks.alertFormat, { formatId: id, slugs: toAlert });
}

type FormatAlert = { kind: "hook" | "sound"; label: string; accounts: number; maxViews: number; apps: string[] };

export const formatForAlert = internalQuery({
  args: { formatId: v.id("radarFormats"), slug: v.string() },
  handler: async (ctx, { formatId, slug }): Promise<{ f: FormatAlert; projectId: Id<"projects"> } | null> => {
    const f = await ctx.db.get(formatId);
    const project = await ctx.db.query("projects").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    if (!f || !project) return null;
    const apps: string[] = [];
    for (const id of f.appIds) {
      const a = await ctx.db.get(id);
      if (a && a.rivalOf.includes(slug)) apps.push(a.name);
    }
    return { f: { kind: f.kind, label: f.label, accounts: f.accountCount, maxViews: f.maxViews, apps }, projectId: project._id };
  },
});

/** Le message Telegram d'un format qui démarre chez un concurrent. */
export const alertFormat = internalAction({
  args: { formatId: v.id("radarFormats"), slugs: v.array(v.string()) },
  handler: async (ctx, { formatId, slugs }): Promise<void> => {
    for (const slug of slugs) {
      const r = await ctx.runQuery(internal.radarNetworks.formatForAlert, { formatId, slug });
      if (!r) continue;
      const p = await ctx.runQuery(internal.notifications.getProjectNotify, { projectId: r.projectId });
      const cfg = p ? notifyConfig(p.notify, p.name) : null;
      if (!p || !cfg) continue;
      const quoi = r.f.kind === "hook" ? `le hook « ${escapeTelegram(r.f.label)} »` : `le son « ${escapeTelegram(r.f.label)} »`;
      await deliver(
        cfg,
        "format radar",
        `🔥 Radar : un format démarre chez ${escapeTelegram(r.f.apps.join(", "))} — ${quoi}, repris par ${r.f.accounts} comptes, ` +
          `jusqu'à ${new Intl.NumberFormat("fr-FR").format(r.f.maxViews)} vues.` +
          `\n<a href="${cfg.appBaseUrl}/admin/${p.slug}/radar?onglet=formats">Voir les formats</a>`,
      );
    }
  },
});

/**
 * Le relevé d'un compte : ses vidéos sont rangées (avec leur relevé, leur hook,
 * leur son), sa médiane et ses agrégats recalculés, son prochain relevé fixé, ses
 * vidéos qui sortent du lot promues dans Signaux (celles déjà promues restent à
 * jour) ; ses hooks et sons partagés tiennent les formats qui circulent, ce qu'il
 * cite nourrit les apps repérées.
 */
export const applyAccountRead = internalMutation({
  args: { accountId: v.id("radarTracked"), videos: v.array(signalInput), now: v.number() },
  handler: async (ctx, { accountId, videos, now }): Promise<{ promoted: number }> => {
    const acc = await ctx.db.get(accountId);
    if (!acc) return { promoted: 0 };
    const app = await ctx.db.get(acc.appId);
    const fresh: typeof videos = [];
    for (const s of videos) {
      const hk = hookTemplate(s.hook);
      const extra = {
        ...(s.caption ? { caption: cleanText(s.caption, 300) } : {}),
        ...(s.hook ? { hook: s.hook } : {}),
        ...(hk ? { hookKey: hk } : {}),
        ...(s.musicId ? { musicId: s.musicId } : {}),
        ...(s.musicTitle ? { musicTitle: s.musicTitle } : {}),
      };
      const known = await ctx.db.query("radarTrackedVideos").withIndex("by_video", (q) => q.eq("videoId", s.videoId)).first();
      if (known) {
        await ctx.db.patch(known._id, {
          views: Math.max(known.views, s.views),
          snapshots: addSnapshot(known.snapshots, now, s.views),
          lastSeenAt: now,
          // Vidéo relevée avant qu'on lise hook et son, ou avant les gabarits : on complète.
          ...(known.caption === undefined || known.hookKey !== extra.hookKey ? extra : {}),
        });
      } else {
        await ctx.db.insert("radarTrackedVideos", {
          accountId,
          appId: acc.appId,
          videoId: s.videoId,
          publishedAt: s.publishedAt,
          views: s.views,
          snapshots: [{ at: now, views: s.views }],
          lastSeenAt: now,
          ...extra,
        });
        fresh.push(s);
      }
    }
    const recent = await ctx.db
      .query("radarTrackedVideos")
      .withIndex("by_account_published", (q) => q.eq("accountId", accountId))
      .order("desc")
      .take(MEDIAN_WINDOW);
    const median = medianViews(recent.map((r) => r.views));
    const fans = videos[0]?.authorFans ?? acc.fans;
    const bio = videos.find((s) => s.authorBio)?.authorBio;
    // Son Instagram, s'il le donne : relevé à son tour (convex/radarSources).
    const ig = acc.igHandle ? null : igHandleFromBio(bio);
    const langs = videos.map((s) => s.lang).filter((l) => l !== "autre");
    const lang = langs.sort((a, b) => langs.filter((x) => x === b).length - langs.filter((x) => x === a).length)[0];
    const lastPostAt = Math.max(acc.lastPostAt ?? 0, recent[0]?.publishedAt ?? 0) || undefined;
    const week = recent.filter((r) => now - r.publishedAt <= 7 * DAY);
    let best: Doc<"radarTracked">["best7d"];
    for (const r of week) {
      const m = multiplierOf(r.views, median) ?? ratioOf(r.views, fans);
      if (!best || m > best.multiplier) {
        best = { videoId: r.videoId, url: videoUrl(acc.handle, r.videoId), views: r.views, multiplier: m, publishedAt: r.publishedAt, ...(r.hook ? { hook: r.hook } : {}) };
      }
    }
    await ctx.db.patch(accountId, {
      fans,
      ...(bio ? { bio } : {}),
      ...(ig ? { igHandle: ig, igNextReadAt: now, igReadErrors: 0 } : {}),
      ...(lang ? { lang } : {}),
      medianViews: median,
      videosSeen: acc.videosSeen + fresh.length,
      lastPostAt,
      readAt: now,
      nextReadAt: nextReadAt(lastPostAt, now),
      readErrors: 0,
      posts7d: week.length,
      best7d: best,
    });

    for (const s of videos) {
      if (s.publishedAt < now - FORMAT_WINDOW_MS) continue;
      const multiplier = multiplierOf(s.views, median);
      const member: Member = {
        accountId,
        handle: acc.handle,
        appId: acc.appId,
        videoId: s.videoId,
        publishedAt: s.publishedAt,
        views: s.views,
        ...(multiplier !== undefined ? { multiplier } : {}),
        ...(s.hook ? { hook: s.hook } : {}),
      };
      const hk = hookTemplate(s.hook);
      if (hk && s.hook) await shareFormat(ctx, "hook", hk, s.hook, member, now);
      if (s.musicId && s.musicTitle) await shareFormat(ctx, "sound", s.musicId, s.musicTitle, member, now);
    }

    const apps = await ctx.db.query("radarApps").collect();
    for (const s of fresh) await noteCandidates(ctx, { ...s, authorBio: undefined }, now, apps, acc.appId);
    if (bio && bio !== acc.bio && videos[0]) await noteCandidates(ctx, { ...videos[0], caption: "", mentions: undefined, authorBio: bio }, now, apps, acc.appId);

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
        for (let page = 0; page < networkPages(app.rival); page++) {
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
    await ctx.runMutation(internal.radarNetworks.seedApps, {});
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
      igHandle: t.igHandle ?? null,
      igBest7d: t.igBest7d ?? null,
      igReadAt: t.igReadAt ?? null,
    }))
    .sort((x, y) => (y.best7d?.multiplier ?? -1) - (x.best7d?.multiplier ?? -1) || y.fans - x.fans);
}

export const listAppAccounts = permissionQuery("radar.use")({
  args: { appId: v.id("radarApps") },
  handler: (ctx, args) => listAppAccountsCore(ctx, args),
});

/**
 * Les formats qui circulent (même hook ou même son chez au moins deux comptes
 * suivis, 14 derniers jours) : ceux poussés par une concurrente du projet
 * d'abord, puis les plus repris, puis les plus vus.
 */
export async function listFormatsCore(ctx: ProjectQueryCtx) {
  const slug = await projectSlugOf(ctx);
  const now = Date.now();
  const apps = new Map((await ctx.db.query("radarApps").collect()).map((a) => [a._id as string, a]));
  const rows = await ctx.db.query("radarFormats").withIndex("by_shared", (q) => q.gte("accountCount", 2)).order("desc").take(300);
  return rows
    .filter((r) => r.lastPostAt >= now - FORMAT_WINDOW_MS)
    .map((r) => {
      const fmtApps = r.appIds.map((id) => apps.get(id)).filter((a): a is Doc<"radarApps"> => !!a);
      const best = Math.max(0, ...r.members.map((m) => m.multiplier ?? 0));
      const variants = new Set(r.members.map((m) => m.hook).filter(Boolean)).size;
      return {
        id: r._id,
        kind: r.kind,
        // La variante la plus vue du gabarit (les membres sont rangés par vues).
        label: (r.kind === "hook" ? r.members.find((m) => m.hook)?.hook : undefined) ?? r.label,
        variants: r.kind === "hook" ? Math.max(1, variants) : 1,
        accountCount: r.accountCount,
        apps: fmtApps.map((a) => ({ name: a.name, rival: a.rivalOf.includes(slug) })),
        rival: fmtApps.some((a) => a.rivalOf.includes(slug)),
        maxViews: r.maxViews,
        bestMultiplier: best > 0 ? best : null,
        lastPostAt: r.lastPostAt,
        firstSeenAt: r.firstSeenAt,
        members: r.members.slice(0, 6).map((m) => ({
          handle: m.handle,
          platform: m.platform ?? ("tiktok" as const),
          hook: m.hook ?? null,
          url: m.platform === "instagram" ? `https://www.instagram.com/reel/${m.videoId.replace(/^ig:/, "")}/` : videoUrl(m.handle, m.videoId),
          views: m.views,
          multiplier: m.multiplier ?? null,
          app: apps.get(m.appId)?.name ?? null,
          publishedAt: m.publishedAt,
        })),
      };
    })
    .sort((x, y) => Number(y.rival) - Number(x.rival) || y.accountCount - x.accountCount || y.maxViews - x.maxViews)
    .slice(0, 100);
}

export const listFormats = permissionQuery("radar.use")({
  args: {},
  handler: (ctx) => listFormatsCore(ctx),
});

/** Les apps repérées chez les comptes (citées par au moins deux), les plus citées d'abord. */
export async function listCandidatesCore(ctx: ProjectQueryCtx) {
  const apps = new Map((await ctx.db.query("radarApps").collect()).map((a) => [a._id as string, a.name]));
  const rows = await ctx.db
    .query("radarAppCandidates")
    .withIndex("by_status_count", (q) => q.eq("status", "new").gte("authorCount", 2))
    .order("desc")
    .take(30);
  return rows.map((c) => ({
    id: c._id,
    kind: c.kind,
    label: c.label,
    authorCount: c.authorCount,
    fromApps: c.fromApps.map((id) => apps.get(id)).filter((n): n is string => !!n),
    examples: c.examples,
    patterns: patternsOfCandidate(c),
    firstSeenAt: c.firstSeenAt,
    lastSeenAt: c.lastSeenAt,
  }));
}

export const listCandidates = permissionQuery("radar.use")({
  args: {},
  handler: (ctx) => listCandidatesCore(ctx),
});

/** Crée une app suivie : ses motifs (cités dans une légende) font aussi ses recherches. */
async function createApp(ctx: MutationCtx, name: string, rivalOf: string[], patterns: string[]): Promise<Doc<"radarApps">> {
  const clean = cleanText(name.trim(), 60);
  const strong = Array.from(new Set(patterns.map((p) => normalize(p.replace(/^[#@]/, "")).compact).filter((p) => p.length >= 3)));
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
    searches: [...strong, ...strong.map((p) => `#${p.replace(/\.[a-z]+$/, "")}`)].filter((x, i, a) => a.indexOf(x) === i),
    status: "active",
    source: "manual",
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.radarNetworks.runNetworkSearch, {});
  return (await ctx.db.get(id))!;
}

export const addApp = permissionMutation("radar.use")({
  args: { name: v.string(), rivalOf: v.array(v.string()), patterns: v.array(v.string()) },
  handler: async (ctx, { name, rivalOf, patterns }) => (await createApp(ctx, name, rivalOf, patterns))._id,
});

/**
 * Suit une app repérée : elle devient une app suivie, et les comptes qui la
 * citaient rejoignent son réseau (dans la limite des places) — ils sont relevés
 * dans l'heure.
 */
export const followCandidate = permissionMutation("radar.use")({
  args: { candidateId: v.id("radarAppCandidates"), name: v.string(), rivalOf: v.array(v.string()), patterns: v.array(v.string()) },
  handler: async (ctx, { candidateId, name, rivalOf, patterns }) => {
    const c = await ctx.db.get(candidateId);
    if (!c) throw err(ERR.RADAR_APP_NOT_FOUND, "App repérée introuvable.");
    const app = await createApp(ctx, name, rivalOf, patterns);
    const now = Date.now();
    const counter: TrackedCounter = {};
    let attached = 0;
    for (const handle of c.authors) {
      if ((await attachAccount(ctx, app, handle, 0, "caption", now, counter)) === "added") attached++;
    }
    await ctx.db.patch(candidateId, { status: "followed" });
    if (attached) await ctx.scheduler.runAfter(0, internal.radarNetworks.runAccountReads, {});
    return { appId: app._id, attached };
  },
});

export const ignoreCandidate = permissionMutation("radar.use")({
  args: { candidateId: v.id("radarAppCandidates") },
  handler: async (ctx, { candidateId }) => {
    await ctx.db.patch(candidateId, { status: "ignored" });
    return null;
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
    const app = await ctx.db.get(appId);
    if (!app) throw err(ERR.RADAR_APP_NOT_FOUND, "App introuvable.");
    const r = await attachAccount(ctx, app, h, 0, "manual", Date.now(), {});
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

/**
 * Purge : les formats sans publication depuis 30 jours, et les apps repérées une
 * seule fois qui n'ont plus été citées depuis 30 jours.
 */
export const purgeNetworks = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const before = Date.now() - 30 * DAY;
    const formats = await ctx.db.query("radarFormats").withIndex("by_last", (q) => q.lt("lastPostAt", before)).take(200);
    for (const f of formats) await ctx.db.delete(f._id);
    const cands = (await ctx.db.query("radarAppCandidates").withIndex("by_last", (q) => q.lt("lastSeenAt", before)).take(400)).filter(
      (c) => c.status === "new" && c.authorCount < 2,
    );
    for (const c of cands) await ctx.db.delete(c._id);
    if (formats.length === 200) await ctx.scheduler.runAfter(0, internal.radarNetworks.purgeNetworks, {});
    return formats.length + cands.length;
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
        best7d: v.optional(v.object({ videoId: v.string(), views: v.number(), multiplier: v.number(), publishedAt: v.number(), hook: v.optional(v.string()) })),
        igHandle: v.optional(v.string()),
        igBest7d: v.optional(v.object({ code: v.string(), views: v.number(), multiplier: v.number() })),
      }),
    ),
    // Formats : chaque membre désigne un compte semé ci-dessus par son pseudo.
    formats: v.optional(
      v.array(
        v.object({
          kind: v.union(v.literal("hook"), v.literal("sound")),
          key: v.string(),
          label: v.string(),
          members: v.array(
            v.object({ handle: v.string(), videoId: v.string(), views: v.number(), multiplier: v.optional(v.number()), ageH: v.number(), hook: v.optional(v.string()), instagram: v.optional(v.boolean()) }),
          ),
        }),
      ),
    ),
    candidates: v.optional(
      v.array(v.object({ key: v.string(), kind: v.union(v.literal("mention"), v.literal("domain")), label: v.string(), authors: v.array(v.string()), fromApps: v.array(v.string()) })),
    ),
  },
  handler: async (ctx, { apps, accounts, formats, candidates }) => {
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
        ...(t.igHandle ? { igHandle: t.igHandle, igReadAt: now, igNextReadAt: now + DAY } : {}),
        ...(t.igBest7d
          ? { igBest7d: { code: t.igBest7d.code, url: `https://www.instagram.com/reel/${t.igBest7d.code}/`, views: t.igBest7d.views, multiplier: t.igBest7d.multiplier, publishedAt: now - DAY } }
          : {}),
        lastPostAt: now - DAY,
        readAt: now,
        nextReadAt: now + DAY,
        readErrors: 0,
        addedAt: now,
      });
    }
    for (const f of formats ?? []) {
      const members: Member[] = [];
      for (const m of f.members) {
        const t = await ctx.db.query("radarTracked").withIndex("by_handle", (q) => q.eq("platform", "tiktok").eq("handle", m.handle)).first();
        if (t) {
          members.push({
            accountId: t._id,
            handle: m.instagram ? (t.igHandle ?? t.handle) : t.handle,
            appId: t.appId,
            videoId: m.instagram ? `ig:${m.videoId}` : m.videoId,
            publishedAt: now - m.ageH * 3_600_000,
            views: m.views,
            ...(m.multiplier !== undefined ? { multiplier: m.multiplier } : {}),
            ...(m.hook ? { hook: m.hook } : {}),
            ...(m.instagram ? { platform: "instagram" as const } : {}),
          });
        }
      }
      await ctx.db.insert("radarFormats", { kind: f.kind, key: f.key, label: f.label, ...summarize(members), firstSeenAt: now });
    }
    for (const c of candidates ?? []) {
      await ctx.db.insert("radarAppCandidates", {
        key: c.key,
        kind: c.kind,
        label: c.label,
        authors: c.authors,
        authorCount: c.authors.length,
        fromApps: c.fromApps.map((slug) => ids.get(slug)).filter((x): x is Id<"radarApps"> => !!x),
        examples: c.authors.slice(0, 5).map((h) => ({ handle: h, url: `https://www.tiktok.com/@${h}` })),
        status: "new",
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
    return { appIds: Object.fromEntries(ids) };
  },
});

/**
 * E2E — efface les apps dont le slug commence par `prefix`, leurs comptes, leurs
 * vidéos et leurs formats, et les apps repérées dont la clé contient `prefix`.
 */
export const e2eClearNetwork = e2eMutation({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }) => {
    let n = 0;
    const gone = new Set((await ctx.db.query("radarApps").collect()).filter((a) => a.slug.startsWith(prefix)).map((a) => a._id as string));
    for (const f of await ctx.db.query("radarFormats").collect()) {
      if (f.appIds.some((id) => gone.has(id)) || f.key.includes(prefix)) await ctx.db.delete(f._id);
    }
    for (const c of await ctx.db.query("radarAppCandidates").collect()) {
      if (c.key.includes(prefix) || c.label.toLowerCase().includes(prefix)) await ctx.db.delete(c._id);
    }
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

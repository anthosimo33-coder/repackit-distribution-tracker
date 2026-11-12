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
import { v, type Infer } from "convex/values";
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
  FRESH_VIDEO_MS,
  MEDIAN_WINDOW,
  citesApp,
  formatStarting,
  isHotFormat,
  hookTemplate,
  igHandleFromBio,
  accountLang,
  accountVerdict,
  bioNamesApp,
  canRejudge,
  formatSuccess,
  nextReadAtFor,
  videoApp,
  videoCitesApp,
  medianViews,
  multiplierOf,
  networkPages,
  networkRefreshMs,
  nextReadAt,
  normalize,
  patternsOfCandidate,
  shadowingApp,
  effectiveRivalOf,
  withRivalChoice,
  suggestedAppName,
  networkFoundBy,
  networkPasses,
  shouldPromote,
} from "./radarNetworkMath";
import { LANG_BY_HAND, OFF_TOPIC_BY_HAND } from "./radarSeedAccounts";
import { screenLang } from "./radarTextLang";
import { isEarlyHit, isTextOnShot } from "./radarDisplay";
import { networkSearchOutcome, networkSearchOutcomeValidator, networkSearchPhase, networkSearchValidator } from "./radarNetworkSearch";
import { RETENTION_DAYS, allowance, budgetState, cleanText, keepSignal, ratioOf, addSnapshot } from "./radarSignalsMath";
import {
  appRef,
  attachAccount,
  ensureSeedApps,
  moveAccount,
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
      // Une recherche demandée à l'écran tourne déjà : la tâche ne la double pas.
      .filter((a) => networkSearchPhase(a.networkSearch, now) !== "running")
      .sort((x, y) => Number(y.rivalOf.length > 0) - Number(x.rivalOf.length > 0) || (x.networkSearchedAt ?? 0) - (y.networkSearchedAt ?? 0))
      .map((a) => ({ id: a._id, name: a.name, searches: a.searches, rival: a.rivalOf.length > 0 }));
  },
});

/** L'app dont la recherche a été demandée à l'écran : `null` si elle n'existe plus, `paused` si elle a été mise en pause entre-temps. */
export const appToSearch = internalQuery({
  args: { appId: v.id("radarApps") },
  handler: async (ctx, { appId }): Promise<DueApp | "paused" | null> => {
    const a = await ctx.db.get(appId);
    if (!a) return null;
    if (a.status !== "active") return "paused";
    return { id: a._id, name: a.name, searches: a.searches, rival: a.rivalOf.length > 0 };
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
  args: { appId: v.id("radarApps"), videos: v.array(signalInput), foundBy: v.string(), now: v.number(), step: v.optional(v.number()) },
  handler: (ctx, args): Promise<{ attached: number; signals: number }> => attachFromSearchCore(ctx, args),
});

async function attachFromSearchCore(
  ctx: MutationCtx,
  { appId, videos, foundBy, now, step }: { appId: Id<"radarApps">; videos: Infer<typeof signalInput>[]; foundBy: string; now: number; step?: number },
): Promise<{ attached: number; signals: number }> {
  const app = await ctx.db.get(appId);
  if (!app) return { attached: 0, signals: 0 };
  const counter: TrackedCounter = {};
  let attached = 0;
  let signals = 0;
  for (const s of videos) {
    if (!citesApp(s.caption, s.authorHandle, app)) continue;
    // La langue de la vidéo suit : un compte francophone entre même si son app non concurrente a fait le plein.
    if ((await attachAccount(ctx, app, s.authorHandle, s.authorFans, "caption", now, counter, s.lang)) === "added") attached++;
    const r = await writeSignal(ctx, s, now, {
      insert: keepSignal(s) && s.publishedAt >= now - RETENTION_DAYS * DAY,
      foundBy,
      app: appRef(app),
    });
    if (r === "inserted") signals++;
  }
  // La progression que l'écran affiche pendant la recherche.
  const ns = app.networkSearch;
  if (ns && ns.finishedAt === undefined) {
    await ctx.db.patch(appId, { networkSearch: { ...ns, step: step ?? ns.step, attached: ns.attached + attached, signals: ns.signals + signals } });
  }
  return { attached, signals };
}

/** E2E — ce que la recherche du réseau d'une app semée rattache, pour des vidéos données (légende, langue). */
export const e2eAttachFromSearch = e2eMutation({
  args: { appSlug: v.string(), videos: v.array(v.object({ handle: v.string(), fans: v.number(), caption: v.string(), lang: v.string() })) },
  handler: async (ctx, { appSlug, videos }) => {
    const app = await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", appSlug)).first();
    if (!app) return { attached: 0, signals: 0 };
    const now = Date.now();
    return attachFromSearchCore(ctx, {
      appId: app._id,
      now,
      foundBy: networkFoundBy(app.name, "FR"),
      videos: videos.map((x, i) => ({
        videoId: `${appSlug}v${i}`,
        url: `https://www.tiktok.com/@${x.handle}/video/${appSlug}v${i}`,
        authorId: x.handle,
        authorHandle: x.handle,
        authorFans: x.fans,
        caption: x.caption,
        lang: x.lang,
        publishedAt: now - DAY,
        isAd: false,
        views: 100,
        likes: 5,
        comments: 0,
        shares: 0,
        saves: 0,
      })),
    });
  },
});

/** Début de la recherche du réseau d'une app : `steps` recherches à lire. Une demande faite à l'écran garde son heure. */
export const startNetworkSearch = internalMutation({
  args: { appId: v.id("radarApps"), now: v.number(), steps: v.number() },
  handler: async (ctx, { appId, now, steps }): Promise<void> => {
    const app = await ctx.db.get(appId);
    if (!app) return;
    const prev = app.networkSearch;
    const requestedAt = prev && prev.finishedAt === undefined ? prev.requestedAt : now;
    await ctx.db.patch(appId, { networkSearch: { requestedAt, startedAt: now, step: 0, steps, attached: 0, signals: 0 } });
  },
});

/**
 * Fin de la recherche du réseau d'une app, avec son issue. `searched` : toutes
 * ses recherches ont été lues, elle ne revient qu'à son prochain tour (3 jours
 * pour une concurrente, une semaine sinon) ; sinon elle reprend au passage suivant.
 */
export const finishNetworkSearch = internalMutation({
  args: { appId: v.id("radarApps"), now: v.number(), outcome: networkSearchOutcomeValidator, error: v.optional(v.string()), searched: v.boolean() },
  handler: async (ctx, { appId, now, outcome, error, searched }): Promise<void> => {
    const app = await ctx.db.get(appId);
    if (!app) return;
    const p = app.networkSearch ?? { requestedAt: now, step: 0, steps: 0, attached: 0, signals: 0 };
    // Recopié champ à champ : l'erreur d'une recherche d'avant ne survit pas.
    const base = { requestedAt: p.requestedAt, step: p.step, steps: p.steps, attached: p.attached, signals: p.signals };
    await ctx.db.patch(appId, {
      networkSearch: { ...base, ...(p.startedAt !== undefined ? { startedAt: p.startedAt } : {}), finishedAt: now, outcome, ...(error ? { error: error.slice(0, 200) } : {}) },
      ...(searched ? { networkSearchedAt: now } : {}),
    });
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
          `\n<a href="${cfg.appBaseUrl}/admin/${p.slug}/radar?onglet=explorer&amp;vue=formats">Voir les formats</a>`,
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
    let app = await ctx.db.get(acc.appId);
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
    // Le compte va dans le réseau de l'app qu'il cite le plus ; s'il n'en cite
    // aucune (sur ses dernières vidéos lues), il n'est plus relevé.
    const apps = await ctx.db.query("radarApps").collect();
    const own = app;
    // Sa bio, lue à ce relevé (sinon celle déjà connue) : si elle nomme son app, le compte reste dans son réseau.
    const bio = videos.find((s) => s.authorBio)?.authorBio;
    const verdict = own ? accountVerdict(acc.matchedBy, recent, acc.handle, own, otherActiveApps(apps, own._id), bio ?? acc.bio) : { kind: "keep" as const };
    if (own && verdict.kind === "move") {
      await moveAccount(ctx, acc, own, verdict.to, recent);
      app = verdict.to;
    }
    const appId = app?._id ?? acc.appId;
    const offTopic = verdict.kind === "offTopic" && !acc.keptByHand;
    const fans = videos[0]?.authorFans ?? acc.fans;
    // Son Instagram, s'il le donne : relevé à son tour (convex/radarSources).
    const ig = acc.igHandle ? null : igHandleFromBio(bio);
    // Sa langue : celle déclarée à la main, sinon la plus fréquente de ses légendes ; et quand TikTok n'en donne
    // aucune (des légendes faites de hashtags), celle du texte à l'écran de ses vidéos (convex/radarTextLang).
    const lang =
      accountLang(acc.handle, videos.map((s) => s.lang), LANG_BY_HAND) ??
      screenLang(recent.map((r) => r.hook), videos.map((s) => s.region));
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
      // Calé sur sa dernière publication + 18 h (second regard sur une vidéo neuve), sinon à son rythme.
      nextReadAt: nextReadAtFor(lastPostAt, now, recent.filter((r) => !r.platform && now - r.publishedAt < FRESH_VIDEO_MS).at(-1)?.publishedAt),
      readErrors: 0,
      posts7d: week.length,
      best7d: best,
      ...(offTopic ? { status: "paused" as const, pausedReason: "offTopic" as const } : {}),
    });

    for (const s of videos) {
      if (s.publishedAt < now - FORMAT_WINDOW_MS) continue;
      const multiplier = multiplierOf(s.views, median);
      const member: Member = {
        accountId,
        handle: acc.handle,
        appId,
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

    for (const s of fresh) await noteCandidates(ctx, { ...s, authorBio: undefined }, now, apps, appId);
    if (bio && bio !== acc.bio && videos[0]) await noteCandidates(ctx, { ...videos[0], caption: "", mentions: undefined, authorBio: bio }, now, apps, appId);

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
      // En train de partir chez une concurrente, et la vidéo la cite : on prévient ses
      // projets. L'app est celle que la vidéo cite (la sienne d'abord), jamais un
      // « texte sur plan » de 12 secondes ou moins.
      if (app && multiplier !== undefined && !isTextOnShot(s) && isEarlyHit({ publishedAt: s.publishedAt, views: s.views, multiplier }, now)) {
        const text = { caption: s.caption, hook: s.hook, handle: acc.handle };
        const cited = videoCitesApp(text, app) ? app : videoApp(text, otherActiveApps(apps, app._id));
        if (cited && cited.rivalOf.length > 0) await maybeAlertEarly(ctx, s.videoId, s.platform ?? "tiktok", cited.rivalOf, cited.name);
      }
    }
    return { promoted };
  },
});

/** Les autres apps suivies (actives) : celles qu'un compte ou une vidéo peut citer à la place de la sienne. */
const otherActiveApps = (apps: readonly Doc<"radarApps">[], own: Id<"radarApps">) => apps.filter((a) => a._id !== own && a.status === "active");

/** Comptes en pause relus par passage. */
const REJUDGE_BATCH = 400;

/**
 * Rejuge les comptes mis en pause comme « hors sujet » (aucun crédit : leurs
 * vidéos déjà lues suffisent). Un compte en pause n'est plus relevé, donc plus
 * jamais jugé : quand une app qu'il cite devient suivie (FollowOtter le
 * 09/11/2026), ou que les motifs de la sienne changent, il resterait en pause
 * pour toujours. Il change alors de réseau, ou reprend dans le sien, et son
 * prochain relevé est immédiat.
 */
export const rejudgePaused = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ moved: number; resumed: number }> => {
    // Les apps de départ d'abord : une app ajoutée au code doit exister avant qu'on y range ses comptes.
    await ensureSeedApps(ctx);
    return rejudgePausedCore(ctx);
  },
});

async function rejudgePausedCore(ctx: MutationCtx): Promise<{ moved: number; resumed: number }> {
  const now = Date.now();
  const apps = await ctx.db.query("radarApps").collect();
  const byId = new Map(apps.map((a) => [a._id, a]));
  const paused = await ctx.db.query("radarTracked").withIndex("by_due", (q) => q.eq("status", "paused")).take(REJUDGE_BATCH);
  let moved = 0;
  let resumed = 0;
  for (const t of paused) {
    const own = byId.get(t.appId);
    if (!canRejudge(t, OFF_TOPIC_BY_HAND) || !own) continue;
    const recent = await ctx.db
      .query("radarTrackedVideos")
      .withIndex("by_account_published", (q) => q.eq("accountId", t._id))
      .order("desc")
      .take(MEDIAN_WINDOW);
    const verdict = accountVerdict(t.matchedBy, recent, t.handle, own, otherActiveApps(apps, own._id), t.bio);
    if (verdict.kind === "move") {
      await moveAccount(ctx, t, own, verdict.to, recent);
      moved++;
    } else if (bioNamesApp(t.bio, own) || recent.some((r) => !r.platform && videoCitesApp({ caption: r.caption ?? "", hook: r.hook, handle: t.handle }, own))) {
      // Sa bio nomme son app, ou une vidéo la cite maintenant (ses motifs ont changé). Des vidéos purgées
      // ne suffisent pas à le relancer : il faut une citation.
      resumed++;
    } else continue;
    await ctx.db.patch(t._id, { status: "active", pausedReason: undefined, nextReadAt: now, readErrors: 0 });
  }
  return { moved, resumed };
}

/**
 * e2e : le relevé d'un compte semé, avec les vidéos données ici (ce que TikTok aurait rendu). Rend ce que le
 * relevé a écrit sur le compte, relu en base.
 */
export const e2eApplyAccountRead = e2eMutation({
  args: {
    handle: v.string(),
    videos: v.array(
      v.object({ videoId: v.string(), ageH: v.number(), views: v.number(), caption: v.string(), lang: v.string(), hook: v.optional(v.string()), region: v.optional(v.string()) }),
    ),
  },
  handler: async (ctx, { handle, videos }): Promise<{ lang: string | null; status: "active" | "paused" } | null> => {
    const acc = await ctx.db.query("radarTracked").withIndex("by_handle", (q) => q.eq("platform", "tiktok").eq("handle", handle)).first();
    if (!acc) return null;
    const now = Date.now();
    await ctx.runMutation(internal.radarNetworks.applyAccountRead, {
      accountId: acc._id,
      now,
      videos: videos.map((x) => ({
        videoId: x.videoId,
        url: videoUrl(handle, x.videoId),
        authorId: handle,
        authorHandle: handle,
        authorFans: acc.fans,
        caption: x.caption,
        lang: x.lang,
        ...(x.region ? { region: x.region } : {}),
        publishedAt: now - x.ageH * 3_600_000,
        isAd: false,
        views: x.views,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        ...(x.hook ? { hook: x.hook } : {}),
      })),
    });
    const after = await ctx.db.get(acc._id);
    return after ? { lang: after.lang ?? null, status: after.status } : null;
  },
});

/** e2e : rejuge tout de suite (la tâche passe toutes les 6 h), sans créer les apps de départ. */
export const e2eRejudgePaused = e2eMutation({
  args: {},
  handler: (ctx) => rejudgePausedCore(ctx),
});

/** Prévient (une fois par projet) qu'une vidéo d'un concurrent part tôt. */
async function maybeAlertEarly(ctx: MutationCtx, videoId: string, platform: "tiktok" | "instagram", slugs: readonly string[], app: string): Promise<void> {
  const sig = await ctx.db
    .query("radarSignals")
    .withIndex("by_video", (q) => q.eq("platform", platform).eq("videoId", videoId))
    .first();
  if (!sig) return;
  const already = sig.earlyAlerted ?? [];
  const toAlert = slugs.filter((x) => !already.includes(x));
  if (toAlert.length === 0) return;
  await ctx.db.patch(sig._id, { earlyAlerted: [...already, ...toAlert] });
  await ctx.scheduler.runAfter(0, internal.radarNetworks.alertEarly, { signalId: sig._id, slugs: toAlert, app });
}

type EarlyAlert = { app: string; handle: string; views: number; hours: number; multiplier: number; hook: string | null };

export const earlyForAlert = internalQuery({
  // `app` : l'app que la vidéo cite (celle du signal quand elle n'est pas donnée).
  args: { signalId: v.id("radarSignals"), slug: v.string(), app: v.optional(v.string()) },
  handler: async (ctx, { signalId, slug, app }): Promise<{ e: EarlyAlert; projectId: Id<"projects"> } | null> => {
    const s = await ctx.db.get(signalId);
    const project = await ctx.db.query("projects").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    const name = app ?? s?.appName;
    if (!s || !project || !name) return null;
    return {
      e: {
        app: name,
        handle: s.authorHandle,
        views: s.views,
        hours: Math.max(1, Math.round((Date.now() - s.publishedAt) / 3_600_000)),
        multiplier: Math.round(s.multiplier ?? 0),
        hook: s.hook ?? null,
      },
      projectId: project._id,
    };
  },
});

/** Le message Telegram d'une vidéo de concurrent qui part tôt. */
export const alertEarly = internalAction({
  args: { signalId: v.id("radarSignals"), slugs: v.array(v.string()), app: v.optional(v.string()) },
  handler: async (ctx, { signalId, slugs, app }): Promise<void> => {
    for (const slug of slugs) {
      const r = await ctx.runQuery(internal.radarNetworks.earlyForAlert, { signalId, slug, ...(app ? { app } : {}) });
      if (!r) continue;
      const p = await ctx.runQuery(internal.notifications.getProjectNotify, { projectId: r.projectId });
      const cfg = p ? notifyConfig(p.notify, p.name) : null;
      if (!p || !cfg) continue;
      await deliver(
        cfg,
        "hit radar",
        `🚀 Radar : en train de partir chez ${escapeTelegram(r.e.app)} — @${escapeTelegram(r.e.handle)}, ` +
          `${new Intl.NumberFormat("fr-FR").format(r.e.views)} vues en ${r.e.hours} h (${r.e.multiplier}× sa normale).` +
          (r.e.hook ? ` « ${escapeTelegram(r.e.hook.slice(0, 120))} »` : "") +
          `\n<a href="${cfg.appBaseUrl}/admin/${p.slug}/radar">Ouvrir le Radar</a>`,
      );
    }
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

/**
 * Réseau : les recherches des apps dues, dans la limite du budget. Avec `appId`
 * (bouton « Chercher son réseau », app ajoutée), cette app seule, tout de suite,
 * sur ce qui reste du budget du jour. Chaque app cherchée note sa progression
 * et son issue (radarApps.networkSearch) : l'écran les affiche.
 */
export const runNetworkSearch = internalAction({
  args: { appId: v.optional(v.id("radarApps")) },
  handler: async (ctx, { appId }): Promise<RunResult> => {
    const now = Date.now();
    if (!scKeyPresent()) {
      if (appId) await ctx.runMutation(internal.radarNetworks.finishNetworkSearch, { appId, now, outcome: "no-key", searched: false });
      return { skipped: "no-key" };
    }
    await ctx.runMutation(internal.radarNetworks.seedApps, {});
    const st: JobState = await ctx.runQuery(internal.radarSignals.jobState, { now });
    const b = budgetState(st.budget, st.usage);
    // Demandée à la main : tout ce qui reste du jour, pas la part d'un passage.
    const left = allowance(st.budget, b, "network", todayCredits(st, "network"), appId ? 1 : NETWORK_RUNS_PER_DAY);
    let due: DueApp[];
    if (appId) {
      const one = await ctx.runQuery(internal.radarNetworks.appToSearch, { appId });
      if (one === "paused") await ctx.runMutation(internal.radarNetworks.finishNetworkSearch, { appId, now, outcome: "paused", searched: false });
      due = one && one !== "paused" ? [one] : [];
    } else {
      // Budget du passage déjà à zéro : aucune app touchée (sa dernière issue reste affichée).
      due = left > 0 ? await ctx.runQuery(internal.radarNetworks.dueApps, { now }) : [];
    }
    let credits = 0;
    let calls = 0;
    let errors = 0;
    let creditsRemaining: number | undefined;
    let lastError: string | undefined;
    let stop = false;
    let attached = 0;
    for (const app of due) {
      // Chaque recherche de l'app passe deux fois : sans région, puis par la France (radarNetworkMath.NETWORK_REGIONS).
      const passes = networkPasses(app.searches);
      await ctx.runMutation(internal.radarNetworks.startNetworkSearch, { appId: app.id, now: Date.now(), steps: passes.length });
      let complete = true;
      let noCredits = false;
      let appCalls = 0;
      let appFailures = 0;
      let appError: string | undefined;
      let crashed = false;
      let appAttached = 0;
      try {
        for (const [i, { kind, value, region }] of passes.entries()) {
          let cursor: number | undefined;
          for (let page = 0; page < networkPages(app.rival); page++) {
            if (credits >= left) {
              stop = true;
              complete = false;
              break;
            }
            const r = await scNetworkPage(kind, value, cursor, region ?? undefined);
            calls++;
            appCalls++;
            credits += r.credits;
            if (!r.ok) {
              errors++;
              appFailures++;
              lastError = r.error;
              appError = r.error;
              if (r.noCredits) {
                stop = true;
                complete = false;
                noCredits = true;
              }
              break;
            }
            if (r.creditsRemaining !== undefined) creditsRemaining = r.creditsRemaining;
            const found: { attached: number } = await ctx.runMutation(internal.radarNetworks.attachFromSearch, {
              appId: app.id,
              videos: r.value.videos,
              foundBy: networkFoundBy(app.name, region),
              now,
              step: i + 1,
            });
            appAttached += found.attached;
            cursor = r.value.cursor;
            if (cursor === undefined || r.value.videos.length === 0) break;
          }
          if (stop) break;
        }
      } catch (e) {
        // Une page illisible ne laisse pas l'app « en cours » pour toujours : son issue est notée, la tâche continue.
        crashed = true;
        complete = false;
        errors++;
        appError = e instanceof Error ? e.message : String(e);
        lastError = appError;
      }
      // Une app à moitié cherchée (budget du passage épuisé) reprend au suivant.
      const outcome = crashed ? "error" : networkSearchOutcome({ complete, noCredits, calls: appCalls, failures: appFailures });
      await ctx.runMutation(internal.radarNetworks.finishNetworkSearch, {
        appId: app.id,
        now: Date.now(),
        outcome,
        searched: complete,
        ...(outcome !== "done" && outcome !== "budget" && appError ? { error: appError } : {}),
      });
      attached += appAttached;
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
    // Les comptes trouvés à la demande sont relevés tout de suite, pas à l'heure suivante.
    if (appId && attached) await ctx.scheduler.runAfter(0, internal.radarNetworks.runAccountReads, {});
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
  // Un doublon fondu dans une autre app (`mergedInto`) n'est plus une app à part.
  const apps = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
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
      networkSearch: a.networkSearch ?? null,
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
      pausedReason: t.pausedReason ?? null,
    }))
    .sort((x, y) => (y.best7d?.multiplier ?? -1) - (x.best7d?.multiplier ?? -1) || y.fans - x.fans);
}

export const listAppAccounts = permissionQuery("radar.use")({
  args: { appId: v.id("radarApps") },
  handler: (ctx, args) => listAppAccountsCore(ctx, args),
});

/**
 * Les formats qui circulent (même hook ou même son chez au moins deux comptes
 * suivis, 14 derniers jours) : ceux qui pètent d'abord (cf isHotFormat), puis
 * les plus vus — toutes apps confondues.
 */
export async function listFormatsCore(ctx: ProjectQueryCtx) {
  const slug = await projectSlugOf(ctx);
  const now = Date.now();
  const apps = new Map((await ctx.db.query("radarApps").collect()).map((a) => [a._id as string, a]));
  const rows = (await ctx.db.query("radarFormats").withIndex("by_shared", (q) => q.gte("accountCount", 2)).order("desc").take(300)).filter(
    (r) => r.lastPostAt >= now - FORMAT_WINDOW_MS,
  );
  // Familles d'une langue à l'autre (convex/radarFamilies) : leur étiquette.
  const familyLabel = new Map<string, string>();
  for (const id of new Set(rows.flatMap((r) => (r.familyId ? [r.familyId] : [])))) {
    const f = await ctx.db.get(id);
    if (f) familyLabel.set(id, f.label);
  }
  return rows
    .map((r) => {
      const fmtApps = r.appIds.map((id) => apps.get(id)).filter((a): a is Doc<"radarApps"> => !!a);
      const best = Math.max(0, ...r.members.map((m) => m.multiplier ?? 0));
      const variants = new Set(r.members.map((m) => m.hook).filter(Boolean)).size;
      const bestMultiplier = best > 0 ? best : null;
      // Réussite : ses reprises, pas son meilleur coup (radarNetworkMath.formatSuccess).
      const success = formatSuccess(r.members);
      return {
        id: r._id,
        kind: r.kind,
        // La variante la plus vue du gabarit (les membres sont rangés par vues).
        label: (r.kind === "hook" ? r.members.find((m) => m.hook)?.hook : undefined) ?? r.label,
        variants: r.kind === "hook" ? Math.max(1, variants) : 1,
        accountCount: r.accountCount,
        // Par nom : un doublon fondu porte le nom de la vraie app.
        apps: fmtApps.filter((a, i) => fmtApps.findIndex((b) => b.name === a.name) === i).map((a) => ({ name: a.name, rival: a.rivalOf.includes(slug) })),
        rival: fmtApps.some((a) => a.rivalOf.includes(slug)),
        // Repris seulement chez des concurrentes d'AUTRES projets : Aujourd'hui le laisse à ces projets.
        elsewhere: fmtApps.length > 0 && fmtApps.every((a) => a.rivalOf.length > 0 && !a.rivalOf.includes(slug)),
        hot: isHotFormat({ kind: r.kind, label: r.label, maxViews: r.maxViews, bestMultiplier }),
        maxViews: r.maxViews,
        bestMultiplier,
        measured: success.measured,
        wins: success.wins,
        medianMultiplier: success.median,
        winning: success.winning,
        lastPostAt: r.lastPostAt,
        firstSeenAt: r.firstSeenAt,
        family: r.familyId && familyLabel.has(r.familyId) ? { id: r.familyId, label: familyLabel.get(r.familyId)! } : null,
        lang: r.lang ?? null,
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
    // Ceux qui RÉUSSISSENT d'abord (part des reprises, puis leur médiane), puis ceux
    // qui pètent, les plus vus d'abord — peu importe la niche.
    .sort(
      (x, y) =>
        Number(y.winning) - Number(x.winning) ||
        (y.winning ? y.wins / y.measured - x.wins / x.measured || (y.medianMultiplier ?? 0) - (x.medianMultiplier ?? 0) : 0) ||
        Number(y.hot) - Number(x.hot) ||
        y.maxViews - x.maxViews ||
        y.accountCount - x.accountCount,
    )
    .slice(0, 150);
}

export const listFormats = permissionQuery("radar.use")({
  args: {},
  handler: (ctx) => listFormatsCore(ctx),
});

/** Les apps repérées chez les comptes (citées par au moins deux), les plus citées d'abord. */
export async function listCandidatesCore(ctx: ProjectQueryCtx) {
  const apps = new Map((await ctx.db.query("radarApps").collect()).map((a) => [a._id as string, a.name]));
  // Les comptes et les sites cités par les comptes suivis. Les apps des classements ont leur liste (radarStore.listStoreCandidates).
  const cited = async (kind: "mention" | "domain") =>
    (
      await ctx.db
        .query("radarAppCandidates")
        .withIndex("by_kind_status_count", (q) => q.eq("kind", kind).eq("status", "new").gte("authorCount", 2))
        .order("desc")
        .take(30)
    ).map((c) => ({ c, kind }));
  const rows = [...(await cited("mention")), ...(await cited("domain"))].sort((a, b) => b.c.authorCount - a.c.authorCount).slice(0, 30);
  return rows.map(({ c, kind }) => ({
    id: c._id,
    kind,
    label: c.label,
    authorCount: c.authorCount,
    fromApps: c.fromApps.map((id) => apps.get(id)).filter((n): n is string => !!n),
    examples: c.examples,
    patterns: patternsOfCandidate({ kind, label: c.label }),
    // Le nom et les motifs proposés à l'écran pour la suivre (le pseudo sans son slogan).
    name: suggestedAppName({ kind, label: c.label }),
    firstSeenAt: c.firstSeenAt,
    lastSeenAt: c.lastSeenAt,
  }));
}

export const listCandidates = permissionQuery("radar.use")({
  args: {},
  handler: (ctx) => listCandidatesCore(ctx),
});

/**
 * Demande la recherche du réseau d'une app, tout de suite et pour elle seule :
 * l'écran la montre « en cours » dès cet instant, la tâche y note sa progression
 * puis son issue.
 */
async function requestNetworkSearch(ctx: MutationCtx, appId: Id<"radarApps">, steps: number, now: number): Promise<void> {
  await ctx.db.patch(appId, { networkSearch: { requestedAt: now, step: 0, steps, attached: 0, signals: 0 } });
  await ctx.scheduler.runAfter(0, internal.radarNetworks.runNetworkSearch, { appId });
}

/** Crée une app suivie : ses motifs (cités dans une légende) font aussi ses recherches. */
async function createApp(ctx: MutationCtx, name: string, rivalOf: string[], patterns: string[]): Promise<Doc<"radarApps">> {
  const clean = cleanText(name.trim(), 60);
  const strong = Array.from(new Set(patterns.map((p) => normalize(p.replace(/^[#@]/, "")).compact).filter((p) => p.length >= 3)));
  if (!clean || strong.length === 0) throw err(ERR.RADAR_APP_INVALID, "Un nom et au moins un motif de 3 caractères.");
  const slug = normalize(clean).compact.replace(/[^a-z0-9.]/g, "");
  if (await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", slug)).first()) {
    throw err(ERR.RADAR_APP_ALREADY_FOLLOWED, `L'app « ${clean} » est déjà suivie.`, { name: clean });
  }
  // Un motif contenu dans celui d'une app suivie en ferait un doublon (« vocaa » dans « vocaai »).
  const followed = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
  for (const p of strong) {
    const taken = shadowingApp(p, followed);
    if (taken) throw err(ERR.RADAR_APP_PATTERN_TAKEN, `Le motif « ${p} » est déjà dans ceux de « ${taken.name} ».`, { pattern: p, name: taken.name });
  }
  const searches = [...strong, ...strong.map((p) => `#${p.replace(/\.[a-z]+$/, "")}`)].filter((x, i, a) => a.indexOf(x) === i);
  const now = Date.now();
  const id = await ctx.db.insert("radarApps", {
    slug,
    name: clean,
    rivalOf: rivalOf.filter((r) => /^[a-z0-9-]+$/.test(r)),
    // Cochée « concurrente » à la création : une décision à la main, qui tiendra si l'app entre un jour dans la liste de départ.
    rivalByHand: rivalOf.filter((r) => /^[a-z0-9-]+$/.test(r)).map((project) => ({ project, rival: true })),
    strong,
    weak: [],
    context: [],
    searches,
    status: "active",
    source: "manual",
    createdAt: now,
  });
  await requestNetworkSearch(ctx, id, searches.length, now);
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
    // Un doublon fondu reste en pause : il n'existe plus que comme renvoi.
    if ((await ctx.db.get(appId))?.mergedInto !== undefined) return "paused" as const;
    await ctx.db.patch(appId, { status });
    return status;
  },
});

/**
 * Classe une app concurrente du projet, ou la retire de ses concurrentes, à la
 * main. La décision vaut pour CE projet seulement (une app peut être
 * concurrente de plusieurs) et tient contre la liste de départ, qui est
 * resynchronisée toutes les heures (radarNetworkMath.effectiveRivalOf). Tout
 * le reste suit `rivalOf`, lu en direct : la file du jour, les alertes, la
 * fréquence de recherche de son réseau, la vue d'ensemble des concurrents.
 */
export const setAppRival = permissionMutation("radar.use")({
  args: { appId: v.id("radarApps"), rival: v.boolean() },
  handler: async (ctx, { appId, rival }): Promise<boolean> => {
    const app = await ctx.db.get(appId);
    if (!app || app.mergedInto !== undefined) throw err(ERR.RADAR_APP_NOT_FOUND, "App introuvable.");
    const project = await projectSlugOf(ctx);
    const rivalByHand = withRivalChoice(app.rivalByHand ?? [], { project, rival });
    const rivalOf = effectiveRivalOf(app.rivalOf, rivalByHand);
    await ctx.db.patch(appId, { rivalByHand, rivalOf });
    // Un doublon fondu dans cette app se lit sous elle : il suit tout de suite.
    for (const a of await ctx.db.query("radarApps").collect()) {
      if (a.mergedInto === appId) await ctx.db.patch(a._id, { rivalOf });
    }
    return rivalOf.includes(project);
  },
});

/**
 * Cherche tout de suite le réseau d'une app, elle seule, sur ce qui reste du
 * budget du jour. `running` : une recherche de cette app tourne déjà, rien
 * n'est relancé. La date de la dernière recherche reste celle d'avant tant que
 * la nouvelle n'a pas fini (avant le 09/11, elle était effacée : « jamais »).
 */
export const searchAppNow = permissionMutation("radar.use")({
  args: { appId: v.id("radarApps") },
  handler: async (ctx, { appId }): Promise<"started" | "running"> => {
    const app = await ctx.db.get(appId);
    if (!app) throw err(ERR.RADAR_APP_NOT_FOUND, "App introuvable.");
    const now = Date.now();
    if (networkSearchPhase(app.networkSearch, now) === "running") return "running";
    await requestNetworkSearch(ctx, appId, app.searches.length, now);
    return "started";
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
    const acc = await ctx.db.get(accountId);
    if (!acc) return status;
    await ctx.db.patch(accountId, {
      status,
      pausedReason: undefined,
      ...(status === "active" ? { nextReadAt: Date.now(), readErrors: 0 } : {}),
      // Réactivé après une pause « ne cite jamais l'app » : on le garde pour de bon.
      ...(status === "active" && acc.pausedReason === "offTopic" ? { keptByHand: true } : {}),
    });
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
    apps: v.array(
      v.object({ slug: v.string(), name: v.string(), rivalOf: v.array(v.string()), strong: v.array(v.string()), networkSearch: v.optional(networkSearchValidator) }),
    ),
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
        // Semé déjà mis en pause parce qu'il ne cite jamais l'app.
        offTopic: v.optional(v.boolean()),
        lang: v.optional(v.string()),
        bio: v.optional(v.string()),
        // Ses vidéos relevées (radarTrackedVideos), pour « ce qui sort du lot ».
        videos: v.optional(
          v.array(v.object({ videoId: v.string(), ageH: v.number(), views: v.number(), hook: v.optional(v.string()), musicTitle: v.optional(v.string()), caption: v.optional(v.string()) })),
        ),
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
          // Déjà rangé dans une famille (son étiquette) et sa langue.
          family: v.optional(v.string()),
          lang: v.optional(v.string()),
          firstSeenAgeH: v.optional(v.number()),
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
    for (const { videos, ...t } of accounts) {
      const appId = ids.get(t.appSlug)!;
      const accountId = await ctx.db.insert("radarTracked", {
        platform: "tiktok",
        handle: t.handle,
        appId,
        status: t.offTopic ? "paused" : "active",
        ...(t.offTopic ? { pausedReason: "offTopic" as const } : {}),
        matchedBy: "caption",
        fans: t.fans,
        ...(t.medianViews !== undefined ? { medianViews: t.medianViews } : {}),
        ...(t.lang !== undefined ? { lang: t.lang } : {}),
        ...(t.bio !== undefined ? { bio: t.bio } : {}),
        videosSeen: videos?.length ?? 9,
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
      for (const vid of videos ?? []) {
        const publishedAt = now - vid.ageH * 3_600_000;
        await ctx.db.insert("radarTrackedVideos", {
          accountId,
          appId,
          videoId: vid.videoId,
          publishedAt,
          views: vid.views,
          snapshots: [{ at: now, views: vid.views }],
          lastSeenAt: now,
          ...(vid.hook !== undefined ? { hook: vid.hook } : {}),
          ...(vid.musicTitle !== undefined ? { musicTitle: vid.musicTitle } : {}),
          ...(vid.caption !== undefined ? { caption: vid.caption } : {}),
        });
      }
    }
    const families = new Map<string, Id<"radarHookFamilies">>();
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
      let familyId: Id<"radarHookFamilies"> | undefined;
      if (f.family) {
        familyId =
          families.get(f.family) ?? (await ctx.db.insert("radarHookFamilies", { label: f.family, examples: [], createdAt: now, lastSeenAt: now }));
        families.set(f.family, familyId);
      }
      await ctx.db.insert("radarFormats", {
        kind: f.kind,
        key: f.key,
        label: f.label,
        ...summarize(members),
        firstSeenAt: f.firstSeenAgeH !== undefined ? now - f.firstSeenAgeH * 3_600_000 : now,
        ...(familyId ? { familyId, familyCheckedAt: now } : {}),
        ...(f.lang ? { lang: f.lang } : {}),
      });
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
    for (const fam of await ctx.db.query("radarHookFamilies").collect()) {
      if (fam.label.includes(prefix)) await ctx.db.delete(fam._id);
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

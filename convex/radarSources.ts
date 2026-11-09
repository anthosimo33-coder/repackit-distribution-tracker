/**
 * NOUVEAU RADAR — trois sources de plus (06/11/2026), tenues par le budget du
 * mois comme les autres (convex/radarSignalsMath) ; lecture pure :
 * convex/radarSourcesMath.
 *
 *  - PUBS (toutes les 6 h) : les bibliothèques de pubs TikTok et Meta, pour
 *    chaque app suivie (concurrentes tous les 3 jours, les autres chaque
 *    semaine). Une pub qui tourne longtemps est un format que l'app PAIE pour
 *    pousser : le signal le plus sûr qu'il marche.
 *  - INSTAGRAM (toutes les heures) : le compte Instagram que donne la bio TikTok
 *    d'un compte suivi (radarTracked.igHandle) ; ses Reels ont leur propre
 *    médiane, ceux qui sortent du lot entrent dans Signaux (plateforme
 *    « instagram »), leurs hooks nourrissent les formats qui circulent.
 *  - TRANSCRIPTIONS (toutes les 2 h) : ce qui est dit dans les signaux TikTok les
 *    plus vus de la semaine (2 minutes au plus).
 *
 * Données GLOBALES (pas de projet), comme les réseaux.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { e2eMutation, permissionQuery, type ProjectQueryCtx } from "./functions";
import { MAX_READ_ERRORS, MEDIAN_WINDOW, hookTemplate, medianViews, multiplierOf, nextReadAt, shouldPromote, videoApp, videoCitesApp } from "./radarNetworkMath";
import { isTextOnShot } from "./radarDisplay";
import { RETENTION_DAYS, addSnapshot, allowance, budgetState, ratioOf, type SignalInput } from "./radarSignalsMath";
import { TRANSCRIPT_MAX_SEC, adCitesApp, adRunDays, type AdInput } from "./radarSourcesMath";
import { appRef, maybeAlert, projectSlugOf, todayCredits, writeSignal, type JobState, type RunResult } from "./radarSignals";
import { shareFormat } from "./radarNetworks";
import { scIgFollowers, scIgReels, scKeyPresent, scMetaAds, scTikTokAds, scTranscript } from "./scrapeCreatorsApi";

const DAY = 86_400_000;
const ADS_RUNS_PER_DAY = 4;
const INSTA_RUNS_PER_DAY = 24;
const TRANSCRIPT_RUNS_PER_DAY = 12;

const adInput = v.object({
  platform: v.union(v.literal("tiktok"), v.literal("meta")),
  adId: v.string(),
  advertiser: v.string(),
  text: v.optional(v.string()),
  firstShownAt: v.optional(v.number()),
  lastShownAt: v.optional(v.number()),
  active: v.boolean(),
  audience: v.optional(v.string()),
  variants: v.optional(v.number()),
  platforms: v.array(v.string()),
  url: v.string(),
  videoUrl: v.optional(v.string()),
  coverUrl: v.optional(v.string()),
});

const igReelInput = v.object({
  code: v.string(),
  url: v.string(),
  publishedAt: v.number(),
  views: v.number(),
  likes: v.number(),
  comments: v.number(),
  durationSec: v.optional(v.number()),
  coverUrl: v.optional(v.string()),
  hook: v.optional(v.string()),
});

// ─── Pubs ────────────────────────────────────────────────────────────────────

type DueAdApp = { id: Id<"radarApps">; name: string; slug: string; rival: boolean; strong: string[]; weak: string[]; context: string[] };

export const dueAdApps = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<DueAdApp[]> => {
    const apps = await ctx.db.query("radarApps").withIndex("by_status", (q) => q.eq("status", "active")).collect();
    return apps
      .filter((a) => a.adsSearchedAt === undefined || now - a.adsSearchedAt >= (a.rivalOf.length ? 3 : 7) * DAY)
      .sort((x, y) => Number(y.rivalOf.length > 0) - Number(x.rivalOf.length > 0) || (x.adsSearchedAt ?? 0) - (y.adsSearchedAt ?? 0))
      .map((a) => ({ id: a._id, name: a.name, slug: a.slug, rival: a.rivalOf.length > 0, strong: a.strong, weak: a.weak, context: a.context }));
  },
});

/** Range les pubs d'une app (une pub déjà vue est mise à jour : encore active ?). */
export const saveAds = internalMutation({
  args: { appId: v.id("radarApps"), ads: v.array(adInput), now: v.number() },
  handler: async (ctx, { appId, ads, now }): Promise<number> => {
    let added = 0;
    for (const a of ads) {
      const got = await ctx.db.query("radarAds").withIndex("by_ad", (q) => q.eq("platform", a.platform).eq("adId", a.adId)).first();
      if (got) {
        await ctx.db.patch(got._id, { ...a, lastSeenAt: now });
      } else {
        await ctx.db.insert("radarAds", { ...a, appId, firstSeenAt: now, lastSeenAt: now });
        added++;
      }
    }
    return added;
  },
});

export const markAdsSearched = internalMutation({
  args: { appId: v.id("radarApps"), now: v.number() },
  handler: async (ctx, { appId, now }): Promise<void> => {
    await ctx.db.patch(appId, { adsSearchedAt: now });
  },
});

/**
 * Pubs : chaque app due, sur TikTok (mot-clé = son slug, s'il fait au moins 5
 * lettres : « flo » ramènerait n'importe quoi) puis sur Meta (son nom). Meta
 * cherche large : seules les pubs qui CITENT l'app sont gardées.
 */
export const runAdsSearch = internalAction({
  args: {},
  handler: async (ctx): Promise<RunResult> => {
    const now = Date.now();
    if (!scKeyPresent()) return { skipped: "no-key" };
    const st: JobState = await ctx.runQuery(internal.radarSignals.jobState, { now });
    const left = allowance(st.budget, budgetState(st.budget, st.usage), "ads", todayCredits(st, "ads"), ADS_RUNS_PER_DAY);
    const due: DueAdApp[] = await ctx.runQuery(internal.radarSources.dueAdApps, { now });
    let credits = 0;
    let calls = 0;
    let errors = 0;
    let creditsRemaining: number | undefined;
    let lastError: string | undefined;
    for (const app of due) {
      if (credits + 2 > left) break;
      const tiktok = app.slug.length >= 5 ? await scTikTokAds(app.slug, now) : null;
      const meta = await scMetaAds(app.name);
      let stop = false;
      const keep: AdInput[] = [];
      for (const r of [tiktok, meta]) {
        if (!r) continue;
        calls++;
        credits += r.credits;
        if (!r.ok) {
          errors++;
          lastError = r.error;
          if (r.noCredits) stop = true;
          continue;
        }
        if (r.creditsRemaining !== undefined) creditsRemaining = r.creditsRemaining;
        for (const ad of r.value) {
          if (adCitesApp(ad, app)) keep.push(ad);
        }
      }
      if (keep.length) await ctx.runMutation(internal.radarSources.saveAds, { appId: app.id, ads: keep, now });
      if (stop) break;
      await ctx.runMutation(internal.radarSources.markAdsSearched, { appId: app.id, now });
    }
    await ctx.runMutation(internal.radarSignals.recordRun, {
      poste: "ads",
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

/**
 * Les pubs des apps suivies : concurrentes du projet d'abord, actives d'abord,
 * puis les plus longues à tourner (une pub qu'on garde est une pub qui marche).
 */
export async function listAdsCore(ctx: ProjectQueryCtx) {
  const slug = await projectSlugOf(ctx);
  const now = Date.now();
  const apps = new Map((await ctx.db.query("radarApps").collect()).map((a) => [a._id as string, a]));
  const rows = await ctx.db.query("radarAds").withIndex("by_last").order("desc").take(600);
  return rows
    // Les pubs gardées avant la règle de citation (homonymes) ne s'affichent plus.
    .filter((r) => {
      const app = apps.get(r.appId);
      return !!app && adCitesApp(r, app);
    })
    .map((r) => {
      const app = apps.get(r.appId);
      return {
        id: r._id,
        platform: r.platform,
        app: app?.name ?? null,
        rival: !!app?.rivalOf.includes(slug),
        advertiser: r.advertiser,
        text: r.text ?? null,
        active: r.active,
        runDays: adRunDays(r, now),
        firstShownAt: r.firstShownAt ?? null,
        lastShownAt: r.lastShownAt ?? null,
        audience: r.audience ?? null,
        variants: r.variants ?? null,
        platforms: r.platforms,
        url: r.url,
        videoUrl: r.videoUrl ?? null,
        coverUrl: r.coverUrl ?? null,
      };
    })
    .sort((x, y) => Number(y.rival) - Number(x.rival) || Number(y.active) - Number(x.active) || (y.runDays ?? 0) - (x.runDays ?? 0))
    .slice(0, 300);
}

export const listAds = permissionQuery("radar.use")({
  args: {},
  handler: (ctx) => listAdsCore(ctx),
});

// ─── Instagram ───────────────────────────────────────────────────────────────

type DueIg = { id: Id<"radarTracked">; igHandle: string; needFans: boolean };

export const dueIgAccounts = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }): Promise<DueIg[]> => {
    if (limit <= 0) return [];
    const rows = await ctx.db
      .query("radarTracked")
      // gte(0) : un compte sans Instagram (igNextReadAt absent) n'est jamais dû.
      .withIndex("by_ig_due", (q) => q.eq("status", "active").gte("igNextReadAt", 0).lte("igNextReadAt", now))
      .take(limit);
    return rows.filter((r) => r.igHandle).map((r) => ({ id: r._id, igHandle: r.igHandle!, needFans: r.igFans === undefined }));
  },
});

/**
 * Le relevé Instagram d'un compte suivi : ses Reels rangés (videoId « ig:<code> »),
 * sa médiane Instagram, ses hooks dans les formats, et ses Reels qui sortent du
 * lot promus dans Signaux.
 */
export const applyIgRead = internalMutation({
  args: { accountId: v.id("radarTracked"), reels: v.array(igReelInput), fans: v.optional(v.number()), now: v.number() },
  handler: async (ctx, { accountId, reels, fans, now }): Promise<{ promoted: number }> => {
    const acc = await ctx.db.get(accountId);
    if (!acc?.igHandle) return { promoted: 0 };
    const app = await ctx.db.get(acc.appId);
    const handle = acc.igHandle;
    for (const r of reels) {
      const videoId = `ig:${r.code}`;
      const hk = hookTemplate(r.hook);
      const known = await ctx.db.query("radarTrackedVideos").withIndex("by_video", (q) => q.eq("videoId", videoId)).first();
      if (known) {
        await ctx.db.patch(known._id, { views: Math.max(known.views, r.views), snapshots: addSnapshot(known.snapshots, now, r.views), lastSeenAt: now });
      } else {
        await ctx.db.insert("radarTrackedVideos", {
          accountId,
          appId: acc.appId,
          platform: "instagram",
          videoId,
          publishedAt: r.publishedAt,
          views: r.views,
          snapshots: [{ at: now, views: r.views }],
          lastSeenAt: now,
          ...(r.hook ? { hook: r.hook } : {}),
          ...(hk ? { hookKey: hk } : {}),
        });
      }
    }
    const recent = (await ctx.db.query("radarTrackedVideos").withIndex("by_account_published", (q) => q.eq("accountId", accountId)).order("desc").take(MEDIAN_WINDOW * 3))
      .filter((r) => r.platform === "instagram")
      .slice(0, MEDIAN_WINDOW);
    const median = medianViews(recent.map((r) => r.views));
    const igFans = fans ?? acc.igFans;
    const lastIg = recent[0]?.publishedAt;
    const week = recent.filter((r) => now - r.publishedAt <= 7 * DAY);
    let best: Doc<"radarTracked">["igBest7d"];
    for (const r of week) {
      const m = multiplierOf(r.views, median) ?? ratioOf(r.views, igFans ?? 0);
      const code = r.videoId.replace(/^ig:/, "");
      if (!best || m > best.multiplier) best = { code, url: `https://www.instagram.com/reel/${code}/`, views: r.views, multiplier: m, publishedAt: r.publishedAt };
    }
    await ctx.db.patch(accountId, {
      ...(igFans !== undefined ? { igFans } : {}),
      igMedianViews: median,
      igReadAt: now,
      igNextReadAt: nextReadAt(lastIg, now),
      igReadErrors: 0,
      igPosts7d: week.length,
      igBest7d: best,
    });

    let promoted = 0;
    for (const r of reels) {
      const multiplier = multiplierOf(r.views, median);
      if (r.hook && now - r.publishedAt <= 14 * DAY) {
        const hk = hookTemplate(r.hook);
        if (hk) {
          await shareFormat(ctx, "hook", hk, r.hook, {
            accountId,
            handle,
            appId: acc.appId,
            videoId: `ig:${r.code}`,
            publishedAt: r.publishedAt,
            views: r.views,
            ...(multiplier !== undefined ? { multiplier } : {}),
            hook: r.hook,
            platform: "instagram",
          }, now);
        }
      }
      const s: Omit<SignalInput, "lang"> & { lang: string } = {
        platform: "instagram",
        videoId: `ig:${r.code}`,
        url: r.url,
        authorId: handle,
        authorHandle: handle,
        authorFans: igFans ?? 0,
        caption: "",
        lang: acc.lang ?? "autre",
        publishedAt: r.publishedAt,
        ...(r.durationSec !== undefined ? { durationSec: r.durationSec } : {}),
        ...(r.coverUrl ? { coverUrl: r.coverUrl } : {}),
        isAd: false,
        views: r.views,
        likes: r.likes,
        comments: r.comments,
        shares: 0,
        saves: 0,
        ...(r.hook ? { hook: r.hook } : {}),
      };
      // Sans médiane (moins de 5 Reels), pas de promotion : les abonnés Instagram
      // seuls ne disent pas assez.
      const promote = multiplier !== undefined && shouldPromote(r.views, multiplier, 0) && r.publishedAt >= now - RETENTION_DAYS * DAY;
      const w = await writeSignal(ctx, s, now, {
        insert: promote,
        foundBy: "compte suivi · Instagram",
        ...(app ? { app: appRef(app) } : {}),
        trackedAccountId: accountId,
        ...(multiplier !== undefined ? { multiplier } : {}),
      });
      if (w === "inserted") promoted++;
    }
    return { promoted };
  },
});

/** Relevé Instagram en échec : 3 de suite (compte privé, introuvable) et on ne le relève plus. */
export const markIgError = internalMutation({
  args: { accountId: v.id("radarTracked"), now: v.number() },
  handler: async (ctx, { accountId, now }): Promise<void> => {
    const acc = await ctx.db.get(accountId);
    if (!acc) return;
    const errors = (acc.igReadErrors ?? 0) + 1;
    await ctx.db.patch(accountId, { igReadErrors: errors, igNextReadAt: errors >= MAX_READ_ERRORS ? undefined : now + DAY });
  },
});

export const runInstaReads = internalAction({
  args: {},
  handler: async (ctx): Promise<RunResult> => {
    const now = Date.now();
    if (!scKeyPresent()) return { skipped: "no-key" };
    const st: JobState = await ctx.runQuery(internal.radarSignals.jobState, { now });
    const left = allowance(st.budget, budgetState(st.budget, st.usage), "insta", todayCredits(st, "insta"), INSTA_RUNS_PER_DAY);
    const due: DueIg[] = await ctx.runQuery(internal.radarSources.dueIgAccounts, { now, limit: left });
    let credits = 0;
    let calls = 0;
    let errors = 0;
    let creditsRemaining: number | undefined;
    let lastError: string | undefined;
    for (const acc of due) {
      if (credits >= left) break;
      let fans: number | undefined;
      if (acc.needFans) {
        const f = await scIgFollowers(acc.igHandle);
        calls++;
        credits += f.credits;
        if (f.ok) fans = f.value;
      }
      const r = await scIgReels(acc.igHandle);
      calls++;
      credits += r.credits;
      if (!r.ok) {
        errors++;
        lastError = r.error;
        if (r.noCredits) break;
        await ctx.runMutation(internal.radarSources.markIgError, { accountId: acc.id, now });
        continue;
      }
      if (r.creditsRemaining !== undefined) creditsRemaining = r.creditsRemaining;
      await ctx.runMutation(internal.radarSources.applyIgRead, { accountId: acc.id, reels: r.value, ...(fans !== undefined ? { fans } : {}), now });
    }
    await ctx.runMutation(internal.radarSignals.recordRun, {
      poste: "insta",
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

// ─── Transcriptions ──────────────────────────────────────────────────────────

type DueTranscript = { id: Id<"radarSignals">; url: string };

/**
 * Les signaux TikTok de la semaine pas encore transcrits : ceux qui citent une
 * concurrente d'abord, puis une autre app suivie, puis la découverte ; les plus
 * vus d'abord dans chaque rang. Jamais une vidéo d'un compte suivi qui ne cite
 * aucune app (elle n'est montrée nulle part), ni un « texte sur plan » de 12
 * secondes ou moins (personne n'y parle). Du 06 au 09/11/2026, triées par vues
 * seules, 37 transcriptions utiles sur 173 et 18 % des vidéos de concurrents
 * couvertes.
 */
export const dueTranscripts = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }): Promise<DueTranscript[]> => {
    if (limit <= 0) return [];
    const rows = await ctx.db.query("radarSignals").withIndex("by_published", (q) => q.gte("publishedAt", now - 7 * DAY)).order("desc").take(800);
    const apps = await ctx.db.query("radarApps").collect();
    const byId = new Map(apps.map((a) => [a._id, a]));
    const active = apps.filter((a) => a.status === "active");
    const ranked: { r: Doc<"radarSignals">; rank: number }[] = [];
    for (const r of rows) {
      if (r.platform !== "tiktok" || r.transcribedAt !== undefined || isTextOnShot(r)) continue;
      if (r.durationSec !== undefined && r.durationSec > TRANSCRIPT_MAX_SEC) continue;
      const own = r.appId ? byId.get(r.appId) : undefined;
      const text = { caption: r.caption, hook: r.hook, handle: r.authorHandle };
      const cited = own ? (videoCitesApp(text, own) ? own : videoApp(text, active)) : undefined;
      if (own && !cited) continue;
      ranked.push({ r, rank: cited ? (cited.rivalOf.length > 0 ? 0 : 1) : 2 });
    }
    return ranked
      .sort((a, b) => a.rank - b.rank || b.r.views - a.r.views)
      .slice(0, limit)
      .map(({ r }) => ({ id: r._id, url: r.url }));
  },
});

export const setTranscript = internalMutation({
  args: { signalId: v.id("radarSignals"), text: v.union(v.string(), v.null()), now: v.number() },
  handler: async (ctx, { signalId, text, now }): Promise<void> => {
    if (!(await ctx.db.get(signalId))) return;
    await ctx.db.patch(signalId, { ...(text ? { transcript: text } : {}), transcribedAt: now });
  },
});

export const runTranscripts = internalAction({
  args: {},
  handler: async (ctx): Promise<RunResult> => {
    const now = Date.now();
    if (!scKeyPresent()) return { skipped: "no-key" };
    const st: JobState = await ctx.runQuery(internal.radarSignals.jobState, { now });
    const n = allowance(st.budget, budgetState(st.budget, st.usage), "transcript", todayCredits(st, "transcript"), TRANSCRIPT_RUNS_PER_DAY);
    const due: DueTranscript[] = await ctx.runQuery(internal.radarSources.dueTranscripts, { now, limit: n });
    let credits = 0;
    let errors = 0;
    let creditsRemaining: number | undefined;
    let lastError: string | undefined;
    for (const s of due) {
      const r = await scTranscript(s.url);
      credits += r.credits;
      if (!r.ok) {
        errors++;
        lastError = r.error;
        if (r.noCredits) break;
        // Vidéo supprimée ou illisible : on ne repaie pas à chaque passage.
        await ctx.runMutation(internal.radarSources.setTranscript, { signalId: s.id, text: null, now });
        continue;
      }
      if (r.creditsRemaining !== undefined) creditsRemaining = r.creditsRemaining;
      await ctx.runMutation(internal.radarSources.setTranscript, { signalId: s.id, text: r.value, now });
    }
    await ctx.runMutation(internal.radarSignals.recordRun, {
      poste: "transcript",
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

// ─── Purge, E2E ──────────────────────────────────────────────────────────────

/** Les pubs plus revues depuis 90 jours. */
export const purgeAds = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const old = await ctx.db.query("radarAds").withIndex("by_last", (q) => q.lt("lastSeenAt", Date.now() - 90 * DAY)).take(300);
    for (const a of old) await ctx.db.delete(a._id);
    return old.length;
  },
});

/** E2E — sème des pubs pour des apps semées (par slug) ; effacées par `e2eClearAds`. */
export const e2eSeedAds = e2eMutation({
  args: { ads: v.array(v.object({ appSlug: v.string(), ad: adInput })) },
  handler: async (ctx, { ads }) => {
    const now = Date.now();
    for (const { appSlug, ad } of ads) {
      const app = await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", appSlug)).first();
      if (app) await ctx.db.insert("radarAds", { ...ad, appId: app._id, firstSeenAt: now, lastSeenAt: now });
    }
    return null;
  },
});

export const e2eClearAds = e2eMutation({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }) => {
    let n = 0;
    for (const a of await ctx.db.query("radarAds").collect()) {
      if (!a.adId.startsWith(prefix)) continue;
      await ctx.db.delete(a._id);
      n++;
    }
    return { deleted: n };
  },
});

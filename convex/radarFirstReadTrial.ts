/**
 * RADAR — LA MESURE DU PREMIER RELEVÉ GRATUIT, côte à côte avec le payant (14/11/2026). Règles et bornes :
 * radarFreeMath (TRIAL_*). Le premier relevé payant d'un compte tiré au sort est rangé ici (radarNetworks, au relevé) ;
 * cette tâche relève ensuite le même compte gratuitement et range le résultat à côté. Rien de ce relevé gratuit
 * n'est montré ni ne change le compte : la ligne sert à comparer avant de décider de brancher C4. 0 crédit.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import {
  FREE_RETRY_MS,
  TRIAL_PER_DAY,
  TRIAL_TOTAL,
  freeProfileUrl,
  freeVideoUrl,
  paced,
  parseFreeProfile,
  parseFreeVideo,
  retrying,
  trialPlan,
  type FreePage,
} from "./radarFreeMath";
import { fetchEmbedPage, storePauseMs } from "./radarStoreMath";
import type { SignalInput } from "./radarSignalsMath";

const DAY = 86_400_000;
/** Comptes relevés gratuitement par passage (toutes les 15 minutes) : ~100 par jour au plus, au rythme de la voie gratuite. */
const TRIALS_PER_RUN = 12;
/** Un premier relevé payant attend 2 minutes avant son relevé gratuit (les deux au plus près, sans se croiser). */
const TRIAL_DELAY_MS = 2 * 60_000;
/** La voie gratuite s'est fermée il y a moins de 30 minutes (TikTok refuse les profils) : la mesure ne charge pas TikTok. */
const LANE_STOP_QUIET_MS = 30 * 60_000;
/** Refus d'affilée qui arrêtent un passage de la mesure. */
const TRIAL_BREAKER = 3;

const trialVideo = v.object({
  videoId: v.string(),
  publishedAt: v.number(),
  views: v.number(),
  caption: v.optional(v.string()),
  hook: v.optional(v.string()),
  musicId: v.optional(v.string()),
  region: v.optional(v.string()),
  lang: v.optional(v.string()),
});
type TrialVideo = { videoId: string; publishedAt: number; views: number; caption?: string; hook?: string; musicId?: string; region?: string; lang?: string };

/** Une vidéo relevée, réduite à ce qu'on compare (textes coupés à 120 caractères). */
export const asTrialVideo = (s: SignalInput): TrialVideo => ({
  videoId: s.videoId,
  publishedAt: s.publishedAt,
  views: s.views,
  ...(s.caption ? { caption: s.caption.slice(0, 120) } : {}),
  ...(s.hook ? { hook: s.hook.slice(0, 120) } : {}),
  ...(s.musicId ? { musicId: s.musicId } : {}),
  ...(s.region ? { region: s.region } : {}),
  ...(s.lang ? { lang: s.lang } : {}),
});

/** Range le premier relevé payant d'un compte tiré au sort, dans les bornes du jour et du total. */
export const noteFirstReadTrial = internalMutation({
  args: { accountId: v.id("radarTracked"), handle: v.string(), videos: v.array(trialVideo), now: v.number() },
  handler: async (ctx, { accountId, handle, videos, now }): Promise<boolean> => {
    const total = await ctx.db.query("radarFirstReadTrials").take(TRIAL_TOTAL);
    if (total.length >= TRIAL_TOTAL) return false;
    const today = await ctx.db
      .query("radarFirstReadTrials")
      .withIndex("by_paid", (q) => q.gte("paidAt", now - DAY))
      .take(TRIAL_PER_DAY);
    if (today.length >= TRIAL_PER_DAY || total.some((t) => t.accountId === accountId)) return false;
    await ctx.db.insert("radarFirstReadTrials", { accountId, handle, state: "pending", paidAt: now, paid: videos });
    return true;
  },
});

type PendingTrial = { id: Id<"radarFirstReadTrials">; handle: string };

export const pendingTrials = internalQuery({
  args: { before: v.number(), limit: v.number() },
  handler: async (ctx, { before, limit }): Promise<{ trials: PendingTrial[]; laneStoppedAt: number | null }> => {
    const rows = await ctx.db
      .query("radarFirstReadTrials")
      .withIndex("by_state_paid", (q) => q.eq("state", "pending").lte("paidAt", before))
      .take(limit);
    const s = await ctx.db.query("radarSettings").first();
    return { trials: rows.map((r) => ({ id: r._id, handle: r.handle })), laneStoppedAt: s?.lastFreeStop ? (s.lastFreeAt ?? null) : null };
  },
});

export const saveTrialFree = internalMutation({
  args: {
    id: v.id("radarFirstReadTrials"),
    now: v.number(),
    free: v.object({
      ok: v.boolean(),
      why: v.optional(v.string()),
      listed: v.number(),
      pages: v.number(),
      list: v.array(v.object({ videoId: v.string(), publishedAt: v.number(), views: v.number() })),
      videos: v.array(trialVideo),
    }),
  },
  handler: async (ctx, { id, now, free }) => {
    await ctx.db.patch(id, { state: "done", freeAt: now, free });
    return null;
  },
});

/** Le relevé gratuit des comptes en attente de mesure : la liste du profil, puis les pages de ses vidéos récentes. */
export const runFirstReadTrials = internalAction({
  args: {},
  handler: async (ctx): Promise<{ done: number; pages: number; stopped: string | null }> => {
    const now = Date.now();
    const { trials, laneStoppedAt }: { trials: PendingTrial[]; laneStoppedAt: number | null } = await ctx.runQuery(internal.radarFirstReadTrial.pendingTrials, {
      before: now - TRIAL_DELAY_MS,
      limit: TRIALS_PER_RUN,
    });
    if (trials.length === 0) return { done: 0, pages: 0, stopped: null };
    if (laneStoppedAt !== null && now - laneStoppedAt < LANE_STOP_QUIET_MS) return { done: 0, pages: 0, stopped: "voie gratuite fermée" };
    const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
    let refused = 0;
    const page = retrying(
      paced(
        async (url: string): Promise<FreePage> => {
          const r = await fetchEmbedPage(url);
          return r.kind === "ok" ? { ok: true, text: r.text } : r.kind === "suspect" ? { ok: false, kind: "suspect", reason: r.reason } : { ok: false, kind: "absent" };
        },
        () => sleep(storePauseMs(Math.random())),
      ),
      () => sleep(FREE_RETRY_MS),
    );
    let done = 0;
    let pages = 0;
    for (const t of trials) {
      if (refused >= TRIAL_BREAKER) return { done, pages, stopped: `${TRIAL_BREAKER} profils refusés d'affilée` };
      pages++;
      const p = await page(freeProfileUrl(t.handle));
      const profile = p.ok ? parseFreeProfile(p.text) : null;
      if (!p.ok && p.kind === "suspect") refused++;
      if (!profile) {
        // Un refus de TikTok n'est pas une mesure : la ligne reste en attente. Une page absente ou illisible, si.
        if (!p.ok && p.kind === "suspect") continue;
        await ctx.runMutation(internal.radarFirstReadTrial.saveTrialFree, { id: t.id, now: Date.now(), free: { ok: false, why: p.ok ? "illisible" : p.kind, listed: 0, pages: 1, list: [], videos: [] } });
        done++;
        continue;
      }
      refused = 0;
      const videos: TrialVideo[] = [];
      let used = 1;
      for (const listed of trialPlan(profile.videos, now)) {
        used++;
        const vp = await page(freeVideoUrl(t.handle, listed.videoId));
        const parsed = vp.ok ? parseFreeVideo(vp.text, t.handle) : null;
        if (parsed && parsed !== "gone") videos.push(asTrialVideo({ ...parsed, views: Math.max(parsed.views, listed.views) }));
      }
      pages += used - 1;
      await ctx.runMutation(internal.radarFirstReadTrial.saveTrialFree, {
        id: t.id,
        now: Date.now(),
        free: {
          ok: !profile.private,
          ...(profile.private ? { why: "private" } : {}),
          listed: profile.videos.length,
          pages: used,
          list: profile.videos.map((x) => ({ videoId: x.videoId, publishedAt: x.publishedAt, views: x.views })),
          videos,
        },
      });
      done++;
    }
    return { done, pages, stopped: null };
  },
});

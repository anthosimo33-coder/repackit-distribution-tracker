/**
 * NOUVEAU RADAR — vidéos devenues INVISIBLES sur TikTok : le contrôle, ses
 * écritures et l'alerte. Règles pures et raison d'être : convex/radarAvailabilityMath.
 *
 *  - CONTRÔLE (toutes les 2 heures) : jusqu'à 40 vidéos signalées depuis 8 jours,
 *    une par compte, lues sur leur page publique (convex/tiktokPublicPage : aucun
 *    crédit). Une vidéo que TikTok ne sert plus garde son motif (`unavailable`) ;
 *    un compte passé en privé vaut pour toutes ses vidéos.
 *  - À L'OUVERTURE dans « Regarder une par une » : un contrôle tout de suite, pour
 *    ne jamais montrer le lecteur cassé de TikTok entre deux passages.
 *  - ALERTE : 5 comptes privés ou plus dans le réseau d'une concurrente, et les
 *    projets dont elle est concurrente sont prévenus sur Telegram, une fois, quand
 *    le nombre ne bouge plus d'un passage à l'autre.
 *
 * Sans SCRAPECREATORS_API_KEY (tests, poste local), rien ne part sur le réseau :
 * même garde que les autres tâches du Radar.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { e2eMutation, permissionMutation } from "./functions";
import { deliver } from "./notifications";
import { escapeTelegram, notifyConfig } from "./notifyApi";
import {
  CHECKS_PER_RUN,
  CHECK_WINDOW_MS,
  ON_VIEW_FRESH_MS,
  darkStep,
  isTikTokVideoId,
  outcomeOf,
  parisHourOf,
  pickDue,
  quietHour,
  type CheckOutcome,
} from "./radarAvailabilityMath";
import { scKeyPresent } from "./scrapeCreatorsApi";
import { BREAKER_CLOSED, nextBreaker, pageDelayMs } from "./tiktokInternal";
import { fetchTikTokPublicStats } from "./tiktokPublicPage";

/** Le motif stocké sur le signal (schema.radarSignals.unavailable). */
export const unavailableReason = v.union(
  v.literal("private"),
  v.literal("region"),
  v.literal("removed"),
  v.literal("review"),
  v.literal("restricted"),
  v.literal("other"),
);

const outcomeValidator = v.union(
  v.object({ kind: v.literal("visible") }),
  v.object({ kind: v.literal("unavailable"), reason: unavailableReason }),
  v.object({ kind: v.literal("unknown") }),
);

type DueCheck = { id: Id<"radarSignals">; url: string; videoId: string };

/** Les signaux TikTok publiés dans la fenêtre du contrôle. */
async function windowSignals(ctx: { db: MutationCtx["db"] }, now: number): Promise<Doc<"radarSignals">[]> {
  const rows = await ctx.db
    .query("radarSignals")
    .withIndex("by_published", (q) => q.gte("publishedAt", now - CHECK_WINDOW_MS))
    .collect();
  return rows.filter((r) => r.platform === "tiktok");
}

export const dueChecks = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }): Promise<DueCheck[]> => {
    if (limit <= 0) return [];
    const rows = await ctx.db
      .query("radarSignals")
      .withIndex("by_published", (q) => q.gte("publishedAt", now - CHECK_WINDOW_MS))
      .collect();
    const due = pickDue(
      rows.filter((r) => isTikTokVideoId(r.videoId)).map((r) => ({
        id: r._id,
        url: r.url,
        videoId: r.videoId,
        handle: r.authorHandle,
        platform: r.platform,
        publishedAt: r.publishedAt,
        checkedAt: r.checkedAt,
        unavailable: r.unavailable,
        score: r.multiplier ?? r.ratio,
      })),
      now,
      limit,
    );
    return due.map((r) => ({ id: r.id, url: r.url, videoId: r.videoId }));
  },
});

export const signalForCheck = internalQuery({
  args: { id: v.id("radarSignals") },
  handler: async (ctx, { id }): Promise<DueCheck | null> => {
    const s = await ctx.db.get(id);
    return s && s.platform === "tiktok" && isTikTokVideoId(s.videoId) ? { id: s._id, url: s.url, videoId: s.videoId } : null;
  },
});

/**
 * Range le constat d'un contrôle. Le compte passé en privé vaut pour toutes ses
 * vidéos ; redevenu public, il les libère. Une page illisible ne
 * change rien à ce qu'on savait : on note seulement qu'on a essayé.
 */
export async function applyCheckCore(ctx: MutationCtx, id: Id<"radarSignals">, outcome: CheckOutcome, now: number): Promise<void> {
  const s = await ctx.db.get(id);
  if (!s) return;
  if (outcome.kind === "unknown") {
    await ctx.db.patch(id, { checkedAt: now });
    return;
  }
  // Toutes les vidéos TikTok du compte, anciennes comprises : Explorer les montre aussi.
  const sameAuthor = async () =>
    (await ctx.db.query("radarSignals").withIndex("by_author", (q) => q.eq("authorHandle", s.authorHandle)).collect()).filter((o) => o._id !== s._id && o.platform === "tiktok");
  if (outcome.kind === "visible") {
    await ctx.db.patch(id, { checkedAt: now, unavailable: undefined });
    if (s.unavailable?.reason === "private") {
      for (const o of await sameAuthor()) if (o.unavailable?.reason === "private") await ctx.db.patch(o._id, { checkedAt: now, unavailable: undefined });
    }
    return;
  }
  // La date du constat reste celle du PREMIER constat tant que le motif ne change pas.
  const at = s.unavailable?.reason === outcome.reason ? s.unavailable.at : now;
  await ctx.db.patch(id, { checkedAt: now, unavailable: { reason: outcome.reason, at } });
  if (outcome.reason === "private") {
    for (const o of await sameAuthor()) {
      if (o.unavailable?.reason !== "private") await ctx.db.patch(o._id, { checkedAt: now, unavailable: { reason: "private", at: now } });
    }
  }
}

export const applyCheck = internalMutation({
  args: { id: v.id("radarSignals"), outcome: outcomeValidator, now: v.number() },
  handler: (ctx, { id, outcome, now }): Promise<void> => applyCheckCore(ctx, id, outcome, now),
});

/**
 * Les réseaux passés en privé : pour chaque app CONCURRENTE d'un projet, le
 * nombre de comptes dont les vidéos de la fenêtre sont privées. Le réseau est
 * celui du compte suivi aujourd'hui (il a pu changer d'app), sinon celui du
 * signal. Prévient une fois par vague, quand elle est comptée (radarAvailabilityMath.darkStep).
 */
export async function noteDarkCore(ctx: MutationCtx, now: number): Promise<number> {
  const dark = new Map<Id<"radarApps">, { handles: Set<string>; videos: number }>();
  const appOfAccount = new Map<Id<"radarTracked">, Id<"radarApps"> | undefined>();
  const privees = await ctx.db.query("radarSignals").withIndex("by_unavailable", (q) => q.eq("unavailable.reason", "private")).collect();
  for (const r of privees) {
    // Dans la fenêtre du contrôle seulement : un compte privé depuis des mois n'est pas une vague.
    if (r.platform !== "tiktok" || now - r.publishedAt > CHECK_WINDOW_MS) continue;
    let appId = r.appId;
    if (r.trackedAccountId) {
      if (!appOfAccount.has(r.trackedAccountId)) appOfAccount.set(r.trackedAccountId, (await ctx.db.get(r.trackedAccountId))?.appId);
      appId = appOfAccount.get(r.trackedAccountId) ?? appId;
    }
    if (!appId) continue;
    const e = dark.get(appId) ?? { handles: new Set<string>(), videos: 0 };
    e.handles.add(r.authorHandle.toLowerCase());
    e.videos++;
    dark.set(appId, e);
  }
  let alerts = 0;
  for (const a of await ctx.db.query("radarApps").collect()) {
    if (a.mergedInto !== undefined || a.rivalOf.length === 0) continue;
    const n = dark.get(a._id)?.handles.size ?? 0;
    const step = darkStep(n, a.darkSeen, a.darkAlerted);
    if (step.alert) {
      alerts++;
      await ctx.scheduler.runAfter(0, internal.radarAvailability.alertDark, { appId: a._id, accounts: n, videos: dark.get(a._id)?.videos ?? 0 });
    }
    if (step.seen !== a.darkSeen || step.alerted !== a.darkAlerted) await ctx.db.patch(a._id, { darkSeen: step.seen, darkAlerted: step.alerted });
  }
  return alerts;
}

export const noteDarkNetworks = internalMutation({
  args: { now: v.number() },
  handler: (ctx, { now }): Promise<number> => noteDarkCore(ctx, now),
});

/**
 * E2E — range un constat comme le ferait le contrôle (et, avec `note`, compte les
 * réseaux passés en privé), puis rend l'état des vidéos du marqueur et de l'app.
 */
export const e2eApplyCheck = e2eMutation({
  args: { videoId: v.string(), outcome: outcomeValidator, prefix: v.string(), appSlug: v.string(), note: v.optional(v.boolean()) },
  handler: async (ctx, { videoId, outcome, prefix, appSlug, note }) => {
    const s = await ctx.db
      .query("radarSignals")
      .withIndex("by_video", (q) => q.eq("platform", "tiktok").eq("videoId", videoId))
      .first();
    if (!s) throw new Error(`signal ${videoId} introuvable`);
    const now = Date.now();
    await applyCheckCore(ctx, s._id, outcome, now);
    const alerts = note ? await noteDarkCore(ctx, now) : 0;
    const videos = (await windowSignals(ctx, now))
      .filter((r) => r.videoId.startsWith(prefix))
      .map((r) => ({ videoId: r.videoId, reason: r.unavailable?.reason ?? null, checked: r.checkedAt !== undefined }))
      .sort((a, b) => a.videoId.localeCompare(b.videoId));
    const app = await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", appSlug)).first();
    return { alerts, videos, darkAlerted: app?.darkAlerted ?? null };
  },
});

export const darkForAlert = internalQuery({
  args: { appId: v.id("radarApps") },
  handler: async (ctx, { appId }): Promise<{ name: string; projects: Id<"projects">[] } | null> => {
    const a = await ctx.db.get(appId);
    if (!a) return null;
    const projects: Id<"projects">[] = [];
    for (const slug of a.rivalOf) {
      const p = await ctx.db.query("projects").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
      if (p) projects.push(p._id);
    }
    return { name: a.name, projects };
  },
});

/** Le message Telegram : le réseau d'une concurrente est passé en privé. */
export const alertDark = internalAction({
  args: { appId: v.id("radarApps"), accounts: v.number(), videos: v.number() },
  handler: async (ctx, { appId, accounts, videos }): Promise<void> => {
    const r = await ctx.runQuery(internal.radarAvailability.darkForAlert, { appId });
    if (!r) return;
    for (const projectId of r.projects) {
      const p = await ctx.runQuery(internal.notifications.getProjectNotify, { projectId });
      const cfg = p ? notifyConfig(p.notify, p.name) : null;
      if (!p || !cfg) continue;
      await deliver(
        cfg,
        "réseau radar en privé",
        `🕶️ Radar : ${accounts} comptes de ${escapeTelegram(r.name)} sont passés en privé. ` +
          (videos === 1 ? "Une de leurs vidéos signalées n'est plus visible." : `${videos} de leurs vidéos signalées ne sont plus visibles.`) +
          `\n<a href="${cfg.appBaseUrl}/admin/${p.slug}/radar">Ouvrir le Radar</a>`,
      );
    }
  },
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type CheckRun = { skipped: "no-key" | "quiet" } | { checked: number; unavailable: number; unknown: number; stopped: string | null; alerts: number };

/** Le passage (toutes les 2 heures) : les vidéos dues, une page à la fois, avec la pause et le coupe-circuit du relevé de vues. */
export const runChecks = internalAction({
  args: {},
  handler: async (ctx): Promise<CheckRun> => {
    const start = Date.now();
    if (!scKeyPresent()) return { skipped: "no-key" };
    if (quietHour(parisHourOf(start))) return { skipped: "quiet" };
    const due: DueCheck[] = await ctx.runQuery(internal.radarAvailability.dueChecks, { now: start, limit: CHECKS_PER_RUN });
    let breaker = BREAKER_CLOSED;
    let checked = 0;
    let unavailable = 0;
    let unknown = 0;
    for (const d of due) {
      if (checked > 0) await sleep(pageDelayMs(Math.random()));
      const page = await fetchTikTokPublicStats(d.url, d.videoId);
      breaker = nextBreaker(breaker, page);
      const outcome = outcomeOf(page);
      await ctx.runMutation(internal.radarAvailability.applyCheck, { id: d.id, outcome, now: Date.now() });
      checked++;
      if (outcome.kind === "unavailable") unavailable++;
      if (outcome.kind === "unknown") unknown++;
      // TikTok ne répond plus à cette IP : on s'arrête, le passage suivant réessaiera.
      if (breaker.trippedReason !== null) break;
    }
    const alerts: number = await ctx.runMutation(internal.radarAvailability.noteDarkNetworks, { now: Date.now() });
    return { checked, unavailable, unknown, stopped: breaker.trippedReason, alerts };
  },
});

/** Un seul signal, tout de suite : demandé à l'ouverture dans le lecteur. */
export const checkOne = internalAction({
  args: { id: v.id("radarSignals") },
  handler: async (ctx, { id }): Promise<void> => {
    if (!scKeyPresent()) return;
    const d: DueCheck | null = await ctx.runQuery(internal.radarAvailability.signalForCheck, { id });
    if (!d) return;
    const page = await fetchTikTokPublicStats(d.url, d.videoId);
    await ctx.runMutation(internal.radarAvailability.applyCheck, { id, outcome: outcomeOf(page), now: Date.now() });
  },
});

/**
 * L'équipe ouvre une vidéo dans « Regarder une par une » : si elle n'a pas été
 * contrôlée dans l'heure, on la contrôle maintenant. L'écran, branché sur le
 * signal, remplace le lecteur dès que le constat arrive.
 */
export const requestCheck = permissionMutation("radar.use")({
  args: { signalId: v.id("radarSignals") },
  handler: async (ctx, { signalId }): Promise<boolean> => {
    const s = await ctx.db.get(signalId);
    if (!s || s.platform !== "tiktok" || !isTikTokVideoId(s.videoId) || !scKeyPresent()) return false;
    if (s.checkedAt !== undefined && Date.now() - s.checkedAt < ON_VIEW_FRESH_MS) return false;
    await ctx.scheduler.runAfter(0, internal.radarAvailability.checkOne, { id: signalId });
    return true;
  },
});

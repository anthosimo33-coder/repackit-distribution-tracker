/**
 * NOUVEAU RADAR — signaux : les vidéos qui sortent du lot en ce moment, dans
 * toutes les apps, à adapter pour Snytch et BLUSH.
 *
 * Deux tâches, payées au crédit ScrapeCreators et tenues par le budget du mois :
 *  - DÉCOUVERTE (toutes les 6 h) : une part de la rotation de recherches
 *    (convex/radarDiscoveryQueries) ; on garde les vidéos assez vues et assez
 *    au-dessus de leur compte, les jeunes et rapides entrent dans la courbe ;
 *  - COURBE (toutes les heures) : relevé des vidéos admises à H+6, H+24, H+48.
 *
 * Données GLOBALES (la veille est la même pour tous les projets) ; seul le
 * statut posé par une équipe est par projet. Règles : convex/radarSignalsMath.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { e2eMutation, permissionMutation, permissionQuery, type ProjectQueryCtx } from "./functions";
import { dayKeyParis, monthKeyParis } from "./dateFr";
import { notifyConfig } from "./notifyApi";
import { deliver } from "./notifications";
import { DISCOVERY_QUERIES } from "./radarDiscoveryQueries";
import {
  DISCOVERY_RUNS_PER_DAY,
  RETENTION_DAYS,
  SIGNALS_LIST_CAP,
  SC_CURRENCY,
  SC_PRICE_PER_CREDIT,
  addSnapshot,
  allowance,
  budgetState,
  competitorOf,
  curveAdmissionsLeft,
  curveCandidate,
  foundByLabel,
  keepSignal,
  nextCheckpointAt,
  nextQueries,
  normalizeBudget,
  plannedUsd,
  ratioOf,
  type BudgetSettings,
} from "./radarSignalsMath";
import { scKeyPresent, scSearchKeyword, scVideoInfo } from "./scrapeCreatorsApi";

const DAY = 86_400_000;

const signalInput = v.object({
  videoId: v.string(),
  url: v.string(),
  authorId: v.string(),
  authorHandle: v.string(),
  authorFans: v.number(),
  caption: v.string(),
  lang: v.string(),
  region: v.optional(v.string()),
  publishedAt: v.number(),
  durationSec: v.optional(v.number()),
  coverUrl: v.optional(v.string()),
  isAd: v.boolean(),
  views: v.number(),
  likes: v.number(),
  comments: v.number(),
  shares: v.number(),
  saves: v.number(),
});

const statusArg = v.union(v.literal("nouveau"), v.literal("enregistre"), v.literal("adapte"), v.literal("ignore"));

async function readSettings(ctx: QueryCtx): Promise<Doc<"radarSettings"> | null> {
  return ctx.db.query("radarSettings").withIndex("by_key", (q) => q.eq("key", "global")).first();
}

/** Le document de réglages, créé avec le budget par défaut au premier besoin. */
async function ensureSettings(ctx: MutationCtx): Promise<Doc<"radarSettings">> {
  const got = await readSettings(ctx);
  if (got) return got;
  const d = normalizeBudget(null);
  const id = await ctx.db.insert("radarSettings", {
    key: "global",
    capUsd: d.capUsd,
    postes: d.postes,
    cutOrder: d.cutOrder,
    alert80: d.alert80,
    discoveryCursor: 0,
    curveAdmitted: 0,
    updatedAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

async function monthUsage(ctx: QueryCtx, month: string) {
  return ctx.db.query("radarUsage").withIndex("by_month", (q) => q.eq("month", month)).collect();
}

// ─── Lecture pour les tâches ─────────────────────────────────────────────────
// Types de retour DÉCLARÉS : les actions de ce module appellent ces fonctions par
// `internal.radarSignals.*` ; inférés, ils bouclent et font tomber toute l'API
// générée en `any` (erreurs dans des fichiers sans rapport).

type JobState = {
  budget: BudgetSettings;
  cursor: number;
  usage: { poste: string; credits: number; day: string }[];
  day: string;
  month: string;
};
type DueCheck = { id: Id<"radarSignals">; url: string };
type RunResult = { skipped: "no-key" } | { calls: number; credits: number; errors: number };

export const jobState = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<JobState> => {
    const settings = await readSettings(ctx);
    const month = monthKeyParis(now);
    const day = dayKeyParis(now);
    const usage = await monthUsage(ctx, month);
    return {
      budget: normalizeBudget(settings),
      cursor: settings?.discoveryCursor ?? 0,
      usage: usage.map((u) => ({ poste: u.poste, credits: u.credits, day: u.day })),
      day,
      month,
    };
  },
});

export const dueCurve = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }): Promise<DueCheck[]> => {
    if (limit <= 0) return [];
    const rows = await ctx.db
      .query("radarSignals")
      .withIndex("by_next_check", (q) => q.gt("nextCheckAt", 0).lte("nextCheckAt", now))
      .take(limit);
    return rows.map((r) => ({ id: r._id, url: r.url }));
  },
});

// ─── Écritures des tâches ────────────────────────────────────────────────────

/**
 * Range le résultat d'une recherche. Une vidéo déjà connue est mise à jour
 * (vues, abonnés, relevé) même si elle a baissé sous les seuils ; une vidéo neuve
 * n'entre que si elle les passe. Les jeunes et rapides entrent dans la courbe,
 * dans la limite des admissions du jour.
 */
export const upsertDiscovered = internalMutation({
  args: { videos: v.array(signalInput), foundBy: v.string(), now: v.number() },
  handler: async (ctx, { videos, foundBy, now }): Promise<{ inserted: number; updated: number; admitted: number }> => {
    const settings = await ensureSettings(ctx);
    const budget = normalizeBudget(settings);
    const day = dayKeyParis(now);
    let admittedToday = settings.curveDay === day ? settings.curveAdmitted : 0;
    let inserted = 0;
    let updated = 0;
    let admitted = 0;
    for (const s of videos) {
      const ratio = ratioOf(s.views, s.authorFans);
      const competitor = competitorOf(s.caption, s.authorHandle);
      const existing = await ctx.db
        .query("radarSignals")
        .withIndex("by_video", (q) => q.eq("platform", "tiktok").eq("videoId", s.videoId))
        .first();
      const admit =
        (!existing || existing.curveStartedAt === undefined) &&
        curveCandidate(s, now) &&
        curveAdmissionsLeft(budget, admittedToday) > 0;
      const next = admit ? nextCheckpointAt(s.publishedAt, now) : undefined;
      const curve: { nextCheckAt?: number; curveStartedAt?: number } =
        admit && next !== undefined ? { nextCheckAt: next, curveStartedAt: now } : {};
      if (curve.curveStartedAt) {
        admittedToday++;
        admitted++;
      }
      if (existing) {
        await ctx.db.patch(existing._id, {
          authorFans: s.authorFans,
          caption: s.caption,
          views: Math.max(existing.views, s.views),
          likes: s.likes,
          comments: s.comments,
          shares: s.shares,
          saves: s.saves,
          ratio: ratioOf(Math.max(existing.views, s.views), s.authorFans),
          snapshots: addSnapshot(existing.snapshots, now, s.views),
          ...(s.coverUrl ? { coverUrl: s.coverUrl } : {}),
          ...(competitor ? { competitor } : {}),
          foundBy: existing.foundBy.includes(foundBy) ? existing.foundBy : [...existing.foundBy, foundBy].slice(-10),
          lastSeenAt: now,
          ...curve,
        });
        updated++;
        continue;
      }
      if (!keepSignal(s) || s.publishedAt < now - RETENTION_DAYS * DAY) continue;
      await ctx.db.insert("radarSignals", {
        platform: "tiktok",
        videoId: s.videoId,
        url: s.url,
        authorId: s.authorId,
        authorHandle: s.authorHandle,
        authorFans: s.authorFans,
        caption: s.caption,
        lang: s.lang,
        ...(s.region ? { region: s.region } : {}),
        publishedAt: s.publishedAt,
        ...(s.durationSec !== undefined ? { durationSec: s.durationSec } : {}),
        ...(s.coverUrl ? { coverUrl: s.coverUrl } : {}),
        views: s.views,
        likes: s.likes,
        comments: s.comments,
        shares: s.shares,
        saves: s.saves,
        ratio,
        snapshots: [{ at: now, views: s.views }],
        ...(competitor ? { competitor } : {}),
        foundBy: [foundBy],
        firstSeenAt: now,
        lastSeenAt: now,
        ...curve,
      });
      inserted++;
    }
    if (admitted > 0 || settings.curveDay !== day) {
      await ctx.db.patch(settings._id, { curveDay: day, curveAdmitted: admittedToday });
    }
    return { inserted, updated, admitted };
  },
});

/** Range un relevé de courbe ; `video: null` = vidéo disparue (privée, supprimée) → courbe finie. */
export const applyCurve = internalMutation({
  args: { id: v.id("radarSignals"), video: v.union(signalInput, v.null()), now: v.number() },
  handler: async (ctx, { id, video, now }): Promise<void> => {
    const s = await ctx.db.get(id);
    if (!s) return;
    if (video === null) {
      await ctx.db.patch(id, { nextCheckAt: undefined });
      return;
    }
    const views = Math.max(s.views, video.views);
    await ctx.db.patch(id, {
      authorFans: video.authorFans,
      views,
      likes: video.likes,
      comments: video.comments,
      shares: video.shares,
      saves: video.saves,
      ratio: ratioOf(views, video.authorFans),
      snapshots: addSnapshot(s.snapshots, now, video.views, true),
      nextCheckAt: nextCheckpointAt(s.publishedAt, now),
      lastSeenAt: now,
    });
  },
});

/** Ajoute la consommation d'un passage à la ligne (jour, poste) et l'état des tâches. */
export const recordRun = internalMutation({
  args: {
    poste: v.string(),
    credits: v.number(),
    calls: v.number(),
    errors: v.number(),
    now: v.number(),
    creditsRemaining: v.optional(v.number()),
    lastError: v.optional(v.string()),
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, a): Promise<void> => {
    const settings = await ensureSettings(ctx);
    const day = dayKeyParis(a.now);
    if (a.calls > 0 || a.credits > 0) {
      const row = await ctx.db
        .query("radarUsage")
        .withIndex("by_day_poste", (q) => q.eq("day", day).eq("poste", a.poste))
        .first();
      if (row) {
        await ctx.db.patch(row._id, { credits: row.credits + a.credits, calls: row.calls + a.calls, errors: row.errors + a.errors });
      } else {
        await ctx.db.insert("radarUsage", { day, month: monthKeyParis(a.now), poste: a.poste, credits: a.credits, calls: a.calls, errors: a.errors });
      }
    }
    await ctx.db.patch(settings._id, {
      ...(a.poste === "search" ? { lastDiscoveryAt: a.now } : { lastCurveAt: a.now }),
      ...(a.creditsRemaining !== undefined ? { creditsRemaining: a.creditsRemaining, creditsSeenAt: a.now } : {}),
      ...(a.cursor !== undefined ? { discoveryCursor: a.cursor } : {}),
      lastError: a.lastError,
    });
  },
});

/** Réserve l'alerte 80 % du mois : vrai une seule fois par mois (lu et écrit ensemble). */
export const claimAlert = internalMutation({
  args: { month: v.string() },
  handler: async (ctx, { month }): Promise<Id<"projects"> | null> => {
    const s = await readSettings(ctx);
    if (!s || !s.alert80 || !s.alertProjectId || s.alertedMonth === month) return null;
    await ctx.db.patch(s._id, { alertedMonth: month });
    return s.alertProjectId;
  },
});

/** Efface les signaux plus vieux que la rétention, et leurs statuts (par lots). */
export const purgeOldSignals = internalMutation({
  args: {},
  handler: async (ctx) => {
    const before = Date.now() - RETENTION_DAYS * DAY;
    const old = await ctx.db.query("radarSignals").withIndex("by_published", (q) => q.lt("publishedAt", before)).take(200);
    for (const s of old) {
      for (const m of await ctx.db.query("radarSignalMarks").filter((q) => q.eq(q.field("signalId"), s._id)).collect()) {
        await ctx.db.delete(m._id);
      }
      await ctx.db.delete(s._id);
    }
    if (old.length === 200) await ctx.scheduler.runAfter(0, internal.radarSignals.purgeOldSignals, {});
    return old.length;
  },
});

// ─── Tâches ──────────────────────────────────────────────────────────────────

async function maybeAlert(ctx: ActionCtx, now: number): Promise<void> {
  const st: JobState = await ctx.runQuery(internal.radarSignals.jobState, { now });
  const b = budgetState(st.budget, st.usage);
  if (!b.over80) return;
  const projectId: Id<"projects"> | null = await ctx.runMutation(internal.radarSignals.claimAlert, { month: st.month });
  if (!projectId) return;
  const p = await ctx.runQuery(internal.notifications.getProjectNotify, { projectId });
  const cfg = p ? notifyConfig(p.notify, p.name) : null;
  if (!p || !cfg) return;
  const usd = (x: number) => x.toFixed(2).replace(".", ",");
  await deliver(
    cfg,
    "budget radar",
    `📡 Radar : ${usd(b.spentUsd)} $ dépensés sur ${usd(st.budget.capUsd)} $ ce mois-ci (80 % du plafond).` +
      (b.cut.length ? ` Postes coupés pour tenir le plafond : ${b.cut.join(", ")}.` : "") +
      `\n<a href="${cfg.appBaseUrl}/admin/${p.slug}/radar?onglet=budget">Ouvrir le budget</a>`,
  );
}

/** Découverte : la part du passage de la rotation, dans la limite du budget. */
export const runDiscovery = internalAction({
  args: {},
  handler: async (ctx): Promise<RunResult> => {
    const now = Date.now();
    if (!scKeyPresent()) {
      console.warn("[radar] découverte sautée : SCRAPECREATORS_API_KEY absente");
      return { skipped: "no-key" };
    }
    const st: JobState = await ctx.runQuery(internal.radarSignals.jobState, { now });
    const b = budgetState(st.budget, st.usage);
    const today = st.usage.filter((u) => u.day === st.day && u.poste === "search").reduce((s, u) => s + u.credits, 0);
    const n = allowance(st.budget, b, "search", today, DISCOVERY_RUNS_PER_DAY);
    const { queries } = nextQueries(st.cursor, n, DISCOVERY_QUERIES);
    let credits = 0;
    let calls = 0;
    let errors = 0;
    let creditsRemaining: number | undefined;
    let lastError: string | undefined;
    let done = 0;
    for (const dq of queries) {
      const r = await scSearchKeyword(dq.query, dq.region, dq.lang);
      calls++;
      credits += r.credits;
      done++;
      if (!r.ok) {
        errors++;
        lastError = r.error;
        console.error(`[radar] recherche « ${dq.query} » (${dq.region}) : ${r.error}`);
        if (r.noCredits) break;
        continue;
      }
      if (r.creditsRemaining !== undefined) creditsRemaining = r.creditsRemaining;
      await ctx.runMutation(internal.radarSignals.upsertDiscovered, { videos: r.value, foundBy: foundByLabel(dq), now });
    }
    await ctx.runMutation(internal.radarSignals.recordRun, {
      poste: "search",
      credits,
      calls,
      errors,
      now,
      ...(creditsRemaining !== undefined ? { creditsRemaining } : {}),
      ...(lastError ? { lastError } : {}),
      // Le curseur n'avance que des recherches réellement passées.
      cursor: nextQueries(st.cursor, done, DISCOVERY_QUERIES).cursor,
    });
    await maybeAlert(ctx, now);
    return { calls: done, credits, errors };
  },
});

/** Courbe : les relevés dus (H+6, H+24, H+48), dans la limite du budget. */
export const runCurve = internalAction({
  args: {},
  handler: async (ctx): Promise<RunResult> => {
    const now = Date.now();
    if (!scKeyPresent()) return { skipped: "no-key" };
    const st: JobState = await ctx.runQuery(internal.radarSignals.jobState, { now });
    const b = budgetState(st.budget, st.usage);
    const today = st.usage.filter((u) => u.day === st.day && u.poste === "curve").reduce((s, u) => s + u.credits, 0);
    const n = allowance(st.budget, b, "curve", today, 24);
    const due: DueCheck[] = await ctx.runQuery(internal.radarSignals.dueCurve, { now, limit: n });
    let credits = 0;
    let errors = 0;
    let creditsRemaining: number | undefined;
    let lastError: string | undefined;
    for (const d of due) {
      const r = await scVideoInfo(d.url);
      credits += r.credits;
      if (!r.ok) {
        errors++;
        lastError = r.error;
        if (r.noCredits) break;
        // Une vidéo introuvable sort de la courbe ; une panne réseau aussi : au
        // pire un relevé manqué, jamais une boucle qui repaie la même vidéo.
        await ctx.runMutation(internal.radarSignals.applyCurve, { id: d.id, video: null, now });
        continue;
      }
      if (r.creditsRemaining !== undefined) creditsRemaining = r.creditsRemaining;
      await ctx.runMutation(internal.radarSignals.applyCurve, { id: d.id, video: r.value, now });
    }
    await ctx.runMutation(internal.radarSignals.recordRun, {
      poste: "curve",
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

/** Les signaux publiés depuis `since` (les plus récents d'abord), avec le statut du projet. */
export async function listSignalsCore(ctx: ProjectQueryCtx, { since }: { since: number }) {
  const rows = await ctx.db
    .query("radarSignals")
    .withIndex("by_published", (q) => q.gte("publishedAt", since))
    .order("desc")
    .take(SIGNALS_LIST_CAP);
  const marks = await ctx.db
    .query("radarSignalMarks")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect();
  const statusOf = new Map<Id<"radarSignals">, Doc<"radarSignalMarks">["status"]>(marks.map((m) => [m.signalId, m.status]));
  return {
    truncated: rows.length === SIGNALS_LIST_CAP,
    signals: rows.map((r) => ({
      id: r._id,
      videoId: r.videoId,
      url: r.url,
      handle: r.authorHandle,
      fans: r.authorFans,
      caption: r.caption.slice(0, 300),
      lang: r.lang,
      region: r.region ?? null,
      publishedAt: r.publishedAt,
      durationSec: r.durationSec ?? null,
      coverUrl: r.coverUrl ?? null,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      saves: r.saves,
      ratio: r.ratio,
      snapshots: r.snapshots,
      competitor: r.competitor ?? null,
      inCurve: r.nextCheckAt !== undefined,
      status: statusOf.get(r._id) ?? ("nouveau" as const),
    })),
  };
}

export const listSignals = permissionQuery("radar.use")({
  args: { since: v.number() },
  handler: (ctx, args) => listSignalsCore(ctx, args),
});

/** Le budget du mois : réglages, dépense par poste, projection, état des tâches. */
export async function getRadarBudgetCore(ctx: ProjectQueryCtx) {
  const now = Date.now();
  const settings = await readSettings(ctx);
  const budget: BudgetSettings = normalizeBudget(settings);
  const month = monthKeyParis(now);
  const usage = await monthUsage(ctx, month);
  const state = budgetState(budget, usage);
  return {
    month,
    budget,
    plannedUsd: plannedUsd(budget),
    pricePerCredit: SC_PRICE_PER_CREDIT,
    currency: SC_CURRENCY,
    state,
    days: usage
      .reduce<{ day: string; credits: number }[]>((acc, u) => {
        const d = acc.find((x) => x.day === u.day);
        if (d) d.credits += u.credits;
        else acc.push({ day: u.day, credits: u.credits });
        return acc;
      }, [])
      .sort((a, b) => a.day.localeCompare(b.day)),
    jobs: {
      keyPresent: scKeyPresent(),
      lastDiscoveryAt: settings?.lastDiscoveryAt ?? null,
      lastCurveAt: settings?.lastCurveAt ?? null,
      lastError: settings?.lastError ?? null,
      creditsRemaining: settings?.creditsRemaining ?? null,
      creditsSeenAt: settings?.creditsSeenAt ?? null,
    },
    alertHere: settings?.alertProjectId === ctx.projectId,
  };
}

export const getRadarBudget = permissionQuery("radar.use")({
  args: {},
  handler: (ctx) => getRadarBudgetCore(ctx),
});

/**
 * Enregistre le budget. Gardé par les réglages du projet (dépenser de l'argent
 * n'est pas « utiliser le Radar ») ; le canal de l'alerte devient ce projet.
 */
export const saveRadarBudget = permissionMutation("project.settings")({
  args: {
    capUsd: v.number(),
    postes: v.array(v.object({ key: v.string(), qty: v.number(), on: v.boolean() })),
    cutOrder: v.array(v.string()),
    alert80: v.boolean(),
  },
  handler: async (ctx, args) => {
    const b = normalizeBudget(args);
    const s = await ensureSettings(ctx);
    await ctx.db.patch(s._id, {
      capUsd: b.capUsd,
      postes: b.postes,
      cutOrder: b.cutOrder,
      alert80: b.alert80,
      alertProjectId: ctx.projectId,
      updatedAt: Date.now(),
    });
    return b;
  },
});

/** Statut d'un signal pour ce projet (« nouveau » efface le statut). */
export const markSignal = permissionMutation("radar.use")({
  args: { signalId: v.id("radarSignals"), status: statusArg },
  handler: async (ctx, { signalId, status }) => {
    if (!(await ctx.db.get(signalId))) return null;
    const mark = await ctx.db
      .query("radarSignalMarks")
      .withIndex("by_project_signal", (q) => q.eq("projectId", ctx.projectId).eq("signalId", signalId))
      .first();
    if (status === "nouveau") {
      if (mark) await ctx.db.delete(mark._id);
      return status;
    }
    if (mark) await ctx.db.patch(mark._id, { status, updatedAt: Date.now(), updatedBy: ctx.userId });
    else await ctx.db.insert("radarSignalMarks", { projectId: ctx.projectId, signalId, status, updatedAt: Date.now(), updatedBy: ctx.userId });
    return status;
  },
});

// ─── E2E ─────────────────────────────────────────────────────────────────────

/** E2E — sème des signaux (cache global : effacés par `e2eClearSignals`). */
export const e2eSeedSignals = e2eMutation({
  args: {
    signals: v.array(
      v.object({
        videoId: v.string(),
        handle: v.string(),
        fans: v.number(),
        caption: v.string(),
        lang: v.string(),
        publishedAt: v.number(),
        views: v.number(),
        snapshots: v.optional(v.array(v.object({ at: v.number(), views: v.number() }))),
      }),
    ),
  },
  handler: async (ctx, { signals }) => {
    const now = Date.now();
    const ids: Id<"radarSignals">[] = [];
    for (const s of signals) {
      const competitor = competitorOf(s.caption, s.handle);
      ids.push(
        await ctx.db.insert("radarSignals", {
          platform: "tiktok",
          videoId: s.videoId,
          url: `https://www.tiktok.com/@${s.handle}/video/${s.videoId}`,
          authorId: s.handle,
          authorHandle: s.handle,
          authorFans: s.fans,
          caption: s.caption,
          lang: s.lang,
          publishedAt: s.publishedAt,
          views: s.views,
          likes: Math.round(s.views / 20),
          comments: Math.round(s.views / 500),
          shares: Math.round(s.views / 300),
          saves: Math.round(s.views / 200),
          ratio: ratioOf(s.views, s.fans),
          snapshots: s.snapshots ?? [{ at: now, views: s.views }],
          ...(competitor ? { competitor } : {}),
          foundBy: ["e2e"],
          firstSeenAt: now,
          lastSeenAt: now,
        }),
      );
    }
    return { ids };
  },
});

/** E2E — efface les signaux dont l'id vidéo commence par `prefix`, et leurs statuts. */
export const e2eClearSignals = e2eMutation({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }) => {
    let n = 0;
    for (const s of await ctx.db.query("radarSignals").collect()) {
      if (!s.videoId.startsWith(prefix)) continue;
      for (const m of await ctx.db.query("radarSignalMarks").filter((q) => q.eq(q.field("signalId"), s._id)).collect()) {
        await ctx.db.delete(m._id);
      }
      await ctx.db.delete(s._id);
      n++;
    }
    return { deleted: n };
  },
});

/** E2E — remet le budget à zéro (réglages et consommation), éventuellement avec une dépense du mois. */
export const e2eResetRadarBudget = e2eMutation({
  args: { searchCredits: v.optional(v.number()) },
  handler: async (ctx, { searchCredits }) => {
    for (const s of await ctx.db.query("radarSettings").collect()) await ctx.db.delete(s._id);
    for (const u of await ctx.db.query("radarUsage").collect()) await ctx.db.delete(u._id);
    if (searchCredits) {
      const now = Date.now();
      await ctx.db.insert("radarUsage", { day: dayKeyParis(now), month: monthKeyParis(now), poste: "search", credits: searchCredits, calls: searchCredits, errors: 0 });
    }
    return null;
  },
});

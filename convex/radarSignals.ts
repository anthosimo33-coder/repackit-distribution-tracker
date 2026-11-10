/**
 * NOUVEAU RADAR — signaux : les vidéos qui sortent du lot en ce moment, dans
 * toutes les apps, à adapter pour Snytch et BLUSH.
 *
 * Deux tâches ici, payées au crédit ScrapeCreators et tenues par le budget du
 * mois (les réseaux d'apps et le relevé de leurs comptes : convex/radarNetworks) :
 *  - DÉCOUVERTE (toutes les 6 h) : une part de la rotation de recherches
 *    (convex/radarDiscoveryQueries) ; on garde les vidéos assez vues et assez
 *    au-dessus de leur compte, les jeunes et rapides entrent dans la courbe. Une
 *    vidéo qui cite une app suivie y est rattachée, et son auteur rejoint le
 *    réseau de l'app (convex/radarNetworkMath) ;
 *  - COURBE (toutes les heures) : relevé des vidéos admises à H+6, H+24, H+48.
 *
 * Données GLOBALES (la veille est la même pour tous les projets) ; le statut posé
 * par une équipe, et « concurrent » (une app est concurrente d'un projet donné),
 * se lisent par projet. Règles : convex/radarSignalsMath.
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
import { DISCOVERY_ROTATION } from "./radarDiscoveryQueries";
import { SEED_APPS, canTrack, candidatesOf, findApp, rivalElsewhere, seedSync, videoApp, videoCitesApp, type SeedApp, type SeedSync } from "./radarNetworkMath";
import { isTextOnShot } from "./radarDisplay";
import { SEED_ACCOUNTS } from "./radarSeedAccounts";
import {
  BUDGET_VERSION,
  DISCOVERY_RUNS_PER_DAY,
  RETENTION_DAYS,
  SIGNALS_LIST_CAP,
  SC_CURRENCY,
  SC_PRICE_PER_CREDIT,
  addSnapshot,
  allowance,
  cleanText,
  budgetState,
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
  type SignalInput,
} from "./radarSignalsMath";
import { scKeyPresent, scSearchKeyword, scVideoInfo } from "./scrapeCreatorsApi";

const DAY = 86_400_000;

export const signalInput = v.object({
  platform: v.optional(v.union(v.literal("tiktok"), v.literal("instagram"))),
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
  hook: v.optional(v.string()),
  musicId: v.optional(v.string()),
  musicTitle: v.optional(v.string()),
  musicOwner: v.optional(v.string()),
  mentions: v.optional(v.array(v.object({ id: v.string(), label: v.string() }))),
  authorBio: v.optional(v.string()),
});

const statusArg = v.union(v.literal("nouveau"), v.literal("enregistre"), v.literal("adapte"), v.literal("ignore"));

export async function readSettings(ctx: QueryCtx): Promise<Doc<"radarSettings"> | null> {
  return ctx.db.query("radarSettings").withIndex("by_key", (q) => q.eq("key", "global")).first();
}

/** Le document de réglages, créé avec le budget par défaut au premier besoin. */
export async function ensureSettings(ctx: MutationCtx): Promise<Doc<"radarSettings">> {
  const got = await readSettings(ctx);
  if (got) return got;
  const d = normalizeBudget(null);
  const id = await ctx.db.insert("radarSettings", {
    key: "global",
    capUsd: d.capUsd,
    postes: d.postes,
    cutOrder: d.cutOrder,
    alert80: d.alert80,
    budgetVersion: BUDGET_VERSION,
    discoveryCursor: 0,
    curveAdmitted: 0,
    updatedAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

async function monthUsage(ctx: QueryCtx, month: string) {
  return ctx.db.query("radarUsage").withIndex("by_month", (q) => q.eq("month", month)).collect();
}

// ─── Apps et réseaux : ce que partagent découverte et relevés de comptes ────

/** Une app suivie, telle que le rattachement et l'écriture d'un signal la lisent. */
export type AppRef = { id: Id<"radarApps">; name: string; rivalOf: string[] };

/** Les apps actives, dans l'ordre de création (la première citée l'emporte). */
export async function activeApps(ctx: QueryCtx) {
  return ctx.db.query("radarApps").withIndex("by_status", (q) => q.eq("status", "active")).collect();
}

export const appRef = (a: Doc<"radarApps">): AppRef => ({ id: a._id, name: a.name, rivalOf: a.rivalOf });

/**
 * Les apps de départ et leurs comptes de départ (idempotent). Une app de départ
 * suit le code : ses motifs, recherches et concurrences y sont recopiés. Une app
 * ajoutée à la main n'est jamais touchée — sauf quand elle entre dans la liste
 * des apps de départ : elle est alors adoptée (radarNetworkMath.seedSync).
 */
export async function ensureSeedApps(ctx: MutationCtx): Promise<number> {
  let created = 0;
  const now = Date.now();
  const counter: TrackedCounter = {};
  for (const s of SEED_APPS) {
    const r = await syncSeedApp(ctx, s, now);
    if (r.sync === "create") created++;
    if (!r.app) continue;
    for (const handle of SEED_ACCOUNTS[s.slug] ?? []) await attachAccount(ctx, r.app, handle, 0, "seed", now, counter);
  }
  return created;
}

/** Aligne UNE app de départ sur le code : créée, adoptée (ajoutée à la main avant), réalignée ou laissée. */
async function syncSeedApp(ctx: MutationCtx, s: SeedApp, now: number): Promise<{ app: Doc<"radarApps"> | null; sync: SeedSync }> {
  const fields = {
    name: s.name,
    rivalOf: [...s.rivalOf],
    strong: [...s.strong],
    weak: [...(s.weak ?? [])],
    context: [...(s.context ?? [])],
    searches: [...s.searches],
    ...(s.not ? { not: [...s.not] } : {}),
  };
  const app = await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", s.slug)).first();
  const same = app !== null && JSON.stringify(Object.keys(fields).map((k) => app[k as keyof typeof fields])) === JSON.stringify(Object.values(fields));
  const sync = seedSync(app, same);
  if (sync === "create") {
    const id = await ctx.db.insert("radarApps", { slug: s.slug, ...fields, status: "active", source: "seed", createdAt: now });
    return { app: await ctx.db.get(id), sync };
  }
  if (!app || sync === "keep") return { app, sync };
  // « adopt » : l'app ajoutée à la main devient une app de départ ; ses comptes et ses vidéos restent.
  const patch = { ...fields, ...(sync === "adopt" ? { source: "seed" as const } : {}) };
  await ctx.db.patch(app._id, patch);
  return { app: { ...app, ...patch }, sync };
}

/** e2e : aligne une app sur une entrée de la liste de départ donnée ici (la vraie liste n'est pas semée en e2e). */
export const e2eSyncSeedApp = e2eMutation({
  args: { seed: v.object({ slug: v.string(), name: v.string(), rivalOf: v.array(v.string()), strong: v.array(v.string()), searches: v.array(v.string()) }) },
  handler: async (ctx, { seed }) => {
    const { sync } = await syncSeedApp(ctx, seed, Date.now());
    // Relue en base : c'est ce qui est écrit qu'on vérifie, pas ce que la fonction renvoie.
    const app = await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", seed.slug)).first();
    return { sync, source: app?.source ?? null, name: app?.name ?? null, rivalOf: app?.rivalOf ?? [], strong: app?.strong ?? [] };
  },
});

/**
 * Comptes suivis par app, lus UNE fois par mutation dans le compteur de chaque app
 * (`radarApps.trackedCount`) : relire 3 000 comptes à chaque ajout coûterait ~1 Go
 * de lectures par jour. Une app sans compteur (créée avant lui) est comptée une
 * fois par son index, puis le garde.
 */
export type TrackedCounter = { counts?: { total: number; byApp: Map<string, number>; others: number } };

async function trackedCounts(ctx: MutationCtx) {
  const byApp = new Map<string, number>();
  let total = 0;
  let others = 0;
  for (const a of await ctx.db.query("radarApps").collect()) {
    let n = a.trackedCount;
    if (n === undefined) {
      n = (await ctx.db.query("radarTracked").withIndex("by_app", (q) => q.eq("appId", a._id)).collect()).length;
      await ctx.db.patch(a._id, { trackedCount: n });
    }
    byApp.set(a._id, n);
    total += n;
    if (a.rivalOf.length === 0) others += n;
  }
  return { total, byApp, others };
}

/**
 * Ajoute un compte au réseau d'une app, s'il n'y est pas déjà et qu'il reste de
 * la place (cf radarNetworkMath.canTrack). Son premier relevé est immédiat.
 */
export async function attachAccount(
  ctx: MutationCtx,
  app: Doc<"radarApps">,
  handle: string,
  fans: number,
  matchedBy: "caption" | "manual" | "seed",
  now: number,
  counter: TrackedCounter,
): Promise<"added" | "known" | "full"> {
  const known = await ctx.db.query("radarTracked").withIndex("by_handle", (q) => q.eq("platform", "tiktok").eq("handle", handle)).first();
  if (known) return "known";
  counter.counts ??= await trackedCounts(ctx);
  const c = counter.counts;
  const rival = app.rivalOf.length > 0;
  if (!canTrack({ total: c.total, ofApp: c.byApp.get(app._id) ?? 0, others: c.others }, rival, matchedBy !== "caption")) return "full";
  c.total++;
  const ofApp = (c.byApp.get(app._id) ?? 0) + 1;
  c.byApp.set(app._id, ofApp);
  if (!rival) c.others++;
  await ctx.db.patch(app._id, { trackedCount: ofApp });
  await ctx.db.insert("radarTracked", {
    platform: "tiktok",
    handle,
    appId: app._id,
    status: "active",
    matchedBy,
    fans,
    videosSeen: 0,
    nextReadAt: now,
    readErrors: 0,
    addedAt: now,
  });
  return "added";
}

/**
 * Ce qu'une vidéo cite et qui pourrait être une app (compte mentionné, domaine) :
 * rangé dans radarAppCandidates, un auteur compté une fois. Ce qui cite déjà une
 * app suivie n'y entre pas.
 */
export async function noteCandidates(
  ctx: MutationCtx,
  s: Pick<SignalInput, "caption" | "authorId" | "authorHandle" | "url" | "mentions" | "authorBio">,
  now: number,
  apps: readonly Doc<"radarApps">[],
  fromApp?: Id<"radarApps">,
): Promise<void> {
  for (const c of candidatesOf(s)) {
    if (findApp(c.label, "", apps)) continue;
    const got = await ctx.db.query("radarAppCandidates").withIndex("by_key", (q) => q.eq("key", c.key)).first();
    const example = { handle: s.authorHandle, url: s.url };
    if (!got) {
      await ctx.db.insert("radarAppCandidates", {
        key: c.key,
        kind: c.kind,
        label: c.label,
        authors: [s.authorHandle],
        authorCount: 1,
        fromApps: fromApp ? [fromApp] : [],
        examples: [example],
        status: "new",
        firstSeenAt: now,
        lastSeenAt: now,
      });
    } else if (!got.authors.includes(s.authorHandle)) {
      await ctx.db.patch(got._id, {
        authors: [...got.authors, s.authorHandle].slice(-50),
        authorCount: got.authorCount + 1,
        ...(fromApp && !got.fromApps.includes(fromApp) ? { fromApps: [...got.fromApps, fromApp] } : {}),
        ...(got.examples.length < 5 ? { examples: [...got.examples, example] } : {}),
        lastSeenAt: now,
      });
    }
  }
}

/**
 * Écrit un signal : met à jour une vidéo connue (vues, abonnés, relevé), ou en
 * insère une neuve — à l'appelant de dire si elle mérite d'entrer (`insert`).
 */
export async function writeSignal(
  ctx: MutationCtx,
  // La langue arrive des arguments Convex en texte (déjà rangée par langBucket).
  s: Omit<SignalInput, "lang"> & { lang: string },
  now: number,
  opts: {
    insert: boolean;
    foundBy?: string;
    app?: AppRef;
    trackedAccountId?: Id<"radarTracked">;
    multiplier?: number;
    curve?: { nextCheckAt?: number; curveStartedAt?: number };
    forceSnapshot?: boolean;
  },
): Promise<"inserted" | "updated" | "skipped"> {
  const platform = s.platform ?? "tiktok";
  const existing = await ctx.db
    .query("radarSignals")
    .withIndex("by_video", (q) => q.eq("platform", platform).eq("videoId", s.videoId))
    .first();
  const app = opts.app ? { appId: opts.app.id, appName: opts.app.name, appRivalOf: opts.app.rivalOf } : {};
  const tracked = opts.trackedAccountId ? { trackedAccountId: opts.trackedAccountId } : {};
  const mult = opts.multiplier !== undefined ? { multiplier: opts.multiplier } : {};
  if (existing) {
    const views = Math.max(existing.views, s.views);
    await ctx.db.patch(existing._id, {
      authorFans: s.authorFans,
      caption: s.caption,
      views,
      likes: s.likes,
      comments: s.comments,
      shares: s.shares,
      saves: s.saves,
      ratio: ratioOf(views, s.authorFans),
      snapshots: addSnapshot(existing.snapshots, now, s.views, opts.forceSnapshot),
      ...(s.coverUrl ? { coverUrl: s.coverUrl } : {}),
      ...(s.hook ? { hook: s.hook } : {}),
      ...(s.musicTitle ? { musicTitle: s.musicTitle } : {}),
      ...(opts.foundBy && !existing.foundBy.includes(opts.foundBy) ? { foundBy: [...existing.foundBy, opts.foundBy].slice(-10) } : {}),
      ...app,
      ...tracked,
      ...mult,
      lastSeenAt: now,
      ...(opts.curve ?? {}),
    });
    return "updated";
  }
  if (!opts.insert) return "skipped";
  await ctx.db.insert("radarSignals", {
    platform,
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
    ...(s.hook ? { hook: s.hook } : {}),
    ...(s.musicTitle ? { musicTitle: s.musicTitle } : {}),
    views: s.views,
    likes: s.likes,
    comments: s.comments,
    shares: s.shares,
    saves: s.saves,
    ratio: ratioOf(s.views, s.authorFans),
    snapshots: [{ at: now, views: s.views }],
    ...app,
    ...tracked,
    ...mult,
    foundBy: opts.foundBy ? [opts.foundBy] : [],
    firstSeenAt: now,
    lastSeenAt: now,
    ...(opts.curve ?? {}),
  });
  return "inserted";
}

// ─── Lecture pour les tâches ─────────────────────────────────────────────────
// Types de retour DÉCLARÉS : les actions appellent ces fonctions par
// `internal.radarSignals.*` ; inférés, ils bouclent et font tomber toute l'API
// générée en `any` (erreurs dans des fichiers sans rapport).

export type JobState = {
  budget: BudgetSettings;
  cursor: number;
  usage: { poste: string; credits: number; day: string; usd?: number }[];
  day: string;
  month: string;
};
type DueCheck = { id: Id<"radarSignals">; url: string };
export type RunResult = { skipped: "no-key" } | { calls: number; credits: number; errors: number };

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
      usage: usage.map((u) => ({ poste: u.poste, credits: u.credits, day: u.day, ...(u.usd !== undefined ? { usd: u.usd } : {}) })),
      day,
      month,
    };
  },
});

/** Crédits déjà dépensés aujourd'hui par un poste. */
export const todayCredits = (st: JobState, poste: string) =>
  st.usage.filter((u) => u.day === st.day && u.poste === poste).reduce((s, u) => s + u.credits, 0);

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
 * Range le résultat d'une recherche. Une vidéo déjà connue est mise à jour même
 * si elle a baissé sous les seuils ; une vidéo neuve n'entre que si elle les
 * passe. Les jeunes et rapides entrent dans la courbe (limite d'admissions du
 * jour). Une vidéo qui cite une app suivie y est rattachée, et son auteur entre
 * dans le réseau de l'app.
 */
export const upsertDiscovered = internalMutation({
  args: { videos: v.array(signalInput), foundBy: v.string(), now: v.number() },
  handler: async (ctx, { videos, foundBy, now }): Promise<{ inserted: number; updated: number; admitted: number; attached: number }> => {
    const settings = await ensureSettings(ctx);
    const budget = normalizeBudget(settings);
    const apps = await activeApps(ctx);
    const day = dayKeyParis(now);
    let admittedToday = settings.curveDay === day ? settings.curveAdmitted : 0;
    let inserted = 0;
    let updated = 0;
    let admitted = 0;
    let attached = 0;
    const counter: TrackedCounter = {};
    for (const s of videos) {
      const app = findApp(s.caption, s.authorHandle, apps);
      if (app && (await attachAccount(ctx, app, s.authorHandle, s.authorFans, "caption", now, counter)) === "added") attached++;
      await noteCandidates(ctx, s, now, apps, app?._id);
      const existing = await ctx.db
        .query("radarSignals")
        .withIndex("by_video", (q) => q.eq("platform", "tiktok").eq("videoId", s.videoId))
        .first();
      // La courbe ne suit que ce qui cite une app suivie, hors « texte sur plan » :
      // du 06 au 09/11/2026, 58 des 62 vidéos suivies étaient hors niche, et
      // aucune décision ne lisait leur courbe.
      const admit =
        (!existing || existing.curveStartedAt === undefined) &&
        app !== undefined &&
        !isTextOnShot(s) &&
        curveCandidate(s, now) &&
        curveAdmissionsLeft(budget, admittedToday) > 0;
      const next = admit ? nextCheckpointAt(s.publishedAt, now) : undefined;
      const curve: { nextCheckAt?: number; curveStartedAt?: number } =
        admit && next !== undefined ? { nextCheckAt: next, curveStartedAt: now } : {};
      const r = await writeSignal(ctx, s, now, {
        insert: keepSignal(s) && s.publishedAt >= now - RETENTION_DAYS * DAY,
        foundBy,
        ...(app ? { app: appRef(app) } : {}),
        curve,
      });
      if (r === "skipped") continue;
      if (r === "inserted") inserted++;
      else updated++;
      if (curve.curveStartedAt) {
        admittedToday++;
        admitted++;
      }
    }
    if (admitted > 0 || settings.curveDay !== day) {
      await ctx.db.patch(settings._id, { curveDay: day, curveAdmitted: admittedToday });
    }
    return { inserted, updated, admitted, attached };
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

const LAST_RUN_FIELD: Record<string, "lastDiscoveryAt" | "lastCurveAt" | "lastAccountsAt" | "lastNetworkAt" | "lastInstaAt" | "lastTranscriptAt" | "lastAdsAt"> = {
  search: "lastDiscoveryAt",
  curve: "lastCurveAt",
  tiktok: "lastAccountsAt",
  network: "lastNetworkAt",
  insta: "lastInstaAt",
  transcript: "lastTranscriptAt",
  ads: "lastAdsAt",
};

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
    // Dépense en dollars (l'analyse IA), en plus des crédits.
    usd: v.optional(v.number()),
  },
  handler: async (ctx, a): Promise<void> => {
    const settings = await ensureSettings(ctx);
    const day = dayKeyParis(a.now);
    if (a.calls > 0 || a.credits > 0) {
      const row = await ctx.db
        .query("radarUsage")
        .withIndex("by_day_poste", (q) => q.eq("day", day).eq("poste", a.poste))
        .first();
      const usd = a.usd !== undefined ? { usd: (row?.usd ?? 0) + a.usd } : {};
      if (row) {
        await ctx.db.patch(row._id, { credits: row.credits + a.credits, calls: row.calls + a.calls, errors: row.errors + a.errors, ...usd });
      } else {
        await ctx.db.insert("radarUsage", { day, month: monthKeyParis(a.now), poste: a.poste, credits: a.credits, calls: a.calls, errors: a.errors, ...usd });
      }
    }
    const field = LAST_RUN_FIELD[a.poste];
    await ctx.db.patch(settings._id, {
      ...(field ? { [field]: a.now } : {}),
      ...(a.creditsRemaining !== undefined ? { creditsRemaining: a.creditsRemaining, creditsSeenAt: a.now } : {}),
      ...(a.cursor !== undefined ? { discoveryCursor: a.cursor } : {}),
      // Une erreur du passage s'affiche ; un passage propre l'efface.
      ...(a.lastError !== undefined || a.calls > 0 ? { lastError: a.lastError } : {}),
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

/** Alerte Telegram à 80 % du plafond, une fois par mois. */
export async function maybeAlert(ctx: ActionCtx, now: number): Promise<void> {
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
      `\n<a href="${cfg.appBaseUrl}/admin/${p.slug}/radar?onglet=reglages">Ouvrir le budget</a>`,
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
    const n = allowance(st.budget, b, "search", todayCredits(st, "search"), DISCOVERY_RUNS_PER_DAY);
    const { queries } = nextQueries(st.cursor, n, DISCOVERY_ROTATION);
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
      cursor: nextQueries(st.cursor, done, DISCOVERY_ROTATION).cursor,
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
    const n = allowance(st.budget, b, "curve", todayCredits(st, "curve"), 24);
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

/** Slug du projet courant : « concurrent » se lit par projet. */
export async function projectSlugOf(ctx: ProjectQueryCtx): Promise<string> {
  return (await ctx.db.get(ctx.projectId))?.slug ?? "";
}

/**
 * Concurrent du projet ? Une app suivie l'est si le projet figure dans son
 * `rivalOf`. Les signaux de la phase 1 (champ `competitor`, The Ick reconnu au
 * motif) comptent comme concurrents de Snytch.
 */
export function competitorFor(r: Pick<Doc<"radarSignals">, "appName" | "appRivalOf" | "competitor">, projectSlug: string): string | null {
  if (r.appName) return r.appRivalOf?.includes(projectSlug) ? r.appName : null;
  return r.competitor && projectSlug === "snytch" ? r.competitor : null;
}

/** Les signaux publiés depuis `since` (les plus récents d'abord), avec le statut du projet. */
export async function listSignalsCore(ctx: ProjectQueryCtx, { since }: { since: number }) {
  const slug = await projectSlugOf(ctx);
  const rows = await ctx.db
    .query("radarSignals")
    .withIndex("by_published", (q) => q.gte("publishedAt", since))
    .order("desc")
    .take(SIGNALS_LIST_CAP);
  const marks = await ctx.db
    .query("radarSignalMarks")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect();
  const markOf = new Map<Id<"radarSignals">, Doc<"radarSignalMarks">>(marks.map((m) => [m.signalId, m]));
  // Les règles de chaque app (une quarantaine de lignes) : une vidéo est rangée
  // sous l'app qu'elle CITE (radarNetworkMath.videoCitesApp) — celle de son
  // réseau d'abord, sinon une autre app suivie (une vidéo FollowOtter d'un
  // compte rangé sous FollowSpy, 09/11/2026). L'app et ses concurrences sont
  // lues en direct : une app déclassée ou un compte changé de réseau valent
  // aussi pour les vidéos déjà relevées.
  const apps = await ctx.db.query("radarApps").collect();
  const rules = new Map(apps.map((a) => [a._id, a]));
  const active = apps.filter((a) => a.status === "active");
  return {
    truncated: rows.length === SIGNALS_LIST_CAP,
    signals: rows.map((r) => {
      const own = r.appId ? rules.get(r.appId) : undefined;
      const text = { caption: r.caption, hook: r.hook, transcript: r.transcript, handle: r.authorHandle };
      // Une vidéo de compte suivi qui ne cite aucune app suivie n'est « de »
      // personne : ni étiquette, ni concurrent ; l'écran dit seulement pour
      // quelle app son compte est suivi (`network`).
      const shown = own ? (videoCitesApp(text, own) ? own : videoApp(text, active)) : undefined;
      const cited = !own || shown !== undefined;
      return {
      id: r._id,
      videoId: r.videoId,
      url: r.url,
      handle: r.authorHandle,
      fans: r.authorFans,
      caption: cleanText(r.caption, 300),
      hook: r.hook ?? null,
      musicTitle: r.musicTitle ?? null,
      transcript: r.transcript ?? null,
      platform: r.platform,
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
      multiplier: r.multiplier ?? null,
      snapshots: r.snapshots,
      app: shown ? shown.name : cited ? (r.appName ?? r.competitor ?? null) : null,
      network: cited ? null : (own?.name ?? r.appName ?? null),
      competitor: shown ? (shown.rivalOf.includes(slug) ? shown.name : null) : cited ? competitorFor(r, slug) : null,
      // L'app (ou le réseau) n'est concurrente que d'AUTRES projets : The Ick dans le
      // Radar de BLUSH. Explorer la montre ; Aujourd'hui la laisse aux autres.
      elsewhere: rivalElsewhere((shown ?? own)?.rivalOf ?? r.appRivalOf ?? (r.competitor ? ["snytch"] : []), slug),
      tracked: r.trackedAccountId !== undefined,
      inCurve: r.nextCheckAt !== undefined,
      status: markOf.get(r._id)?.status ?? ("nouveau" as const),
      // Quand l'équipe l'a traitée : « N traitées aujourd'hui » (radarDisplay.handledToday).
      markedAt: markOf.get(r._id)?.updatedAt ?? null,
      };
    }),
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
      lastAccountsAt: settings?.lastAccountsAt ?? null,
      lastNetworkAt: settings?.lastNetworkAt ?? null,
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
    // Ce que l'écran envoie est déjà au format courant.
    const b = normalizeBudget({ ...args, budgetVersion: BUDGET_VERSION });
    const s = await ensureSettings(ctx);
    await ctx.db.patch(s._id, {
      capUsd: b.capUsd,
      postes: b.postes,
      cutOrder: b.cutOrder,
      alert80: b.alert80,
      budgetVersion: BUDGET_VERSION,
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

/**
 * E2E — sème des signaux (cache global : effacés par `e2eClearSignals`). Une
 * légende qui cite une app de départ y est rattachée ; `rivalProject` ajoute un
 * projet (celui de la spec) aux concurrents de cette app.
 */
export const e2eSeedSignals = e2eMutation({
  args: {
    rivalProject: v.optional(v.string()),
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
        multiplier: v.optional(v.number()),
        hook: v.optional(v.string()),
        transcript: v.optional(v.string()),
        platform: v.optional(v.literal("instagram")),
        // L'app poussée, nommée directement (une app semée par e2eSeedNetwork) ;
        // sinon reconnue dans la légende parmi les apps de départ.
        app: v.optional(v.string()),
        // Partages (« se partage » au-delà de 2 % des vues) ; sinon vues ÷ 300.
        shares: v.optional(v.number()),
        // Durée : 12 secondes ou moins = « texte sur plan », hors d'Aujourd'hui.
        durationSec: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { signals, rivalProject }) => {
    const now = Date.now();
    const ids: Id<"radarSignals">[] = [];
    // Une app semée nommée par `app` : la vidéo lui est rattachée comme en vrai (appId),
    // donc soumise à la même vérification « la vidéo cite-t-elle l'app ? ».
    const semees = await ctx.db.query("radarApps").collect();
    for (const s of signals) {
      const seed = findApp(s.caption, s.handle, SEED_APPS);
      const semee = s.app ? semees.find((a) => a.name === s.app) : undefined;
      const app = s.app
        ? { ...(semee ? { appId: semee._id } : {}), appName: s.app, appRivalOf: semee ? semee.rivalOf : rivalProject ? [rivalProject] : [] }
        : seed
          ? { appName: seed.name, appRivalOf: [...seed.rivalOf, ...(rivalProject ? [rivalProject] : [])] }
          : {};
      ids.push(
        await ctx.db.insert("radarSignals", {
          platform: s.platform ?? "tiktok",
          videoId: s.videoId,
          url: s.platform === "instagram" ? `https://www.instagram.com/reel/${s.videoId}/` : `https://www.tiktok.com/@${s.handle}/video/${s.videoId}`,
          authorId: s.handle,
          authorHandle: s.handle,
          authorFans: s.fans,
          caption: s.caption,
          lang: s.lang,
          publishedAt: s.publishedAt,
          views: s.views,
          likes: Math.round(s.views / 20),
          comments: Math.round(s.views / 500),
          shares: s.shares ?? Math.round(s.views / 300),
          saves: Math.round(s.views / 200),
          ratio: ratioOf(s.views, s.fans),
          snapshots: s.snapshots ?? [{ at: now, views: s.views }],
          ...app,
          ...(s.multiplier !== undefined ? { multiplier: s.multiplier } : {}),
          ...(s.durationSec !== undefined ? { durationSec: s.durationSec } : {}),
          ...(s.hook ? { hook: s.hook } : {}),
          ...(s.transcript ? { transcript: s.transcript, transcribedAt: now } : {}),
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
  args: { searchCredits: v.optional(v.number()), v1Settings: v.optional(v.boolean()) },
  handler: async (ctx, { searchCredits, v1Settings }) => {
    for (const s of await ctx.db.query("radarSettings").collect()) await ctx.db.delete(s._id);
    for (const u of await ctx.db.query("radarUsage").collect()) await ctx.db.delete(u._id);
    const now = Date.now();
    if (searchCredits) {
      await ctx.db.insert("radarUsage", { day: dayKeyParis(now), month: monthKeyParis(now), poste: "search", credits: searchCredits, calls: searchCredits, errors: 0 });
    }
    if (v1Settings) {
      // Des réglages tels que la phase 1 les écrivait : `tiktok` en comptes et éteint.
      await ctx.db.insert("radarSettings", {
        key: "global",
        capUsd: 60,
        postes: [
          { key: "search", qty: 60, on: true },
          { key: "curve", qty: 100, on: true },
          { key: "tiktok", qty: 200, on: false },
          { key: "demand", qty: 1_500, on: false },
        ],
        cutOrder: ["search", "transcript", "curve", "insta", "ai", "tiktok"],
        alert80: true,
        discoveryCursor: 0,
        curveAdmitted: 0,
        updatedAt: now,
      });
    }
    return null;
  },
});

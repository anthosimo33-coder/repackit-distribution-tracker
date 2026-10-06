import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { e2eMutation } from "./functions";
import { internal } from "./_generated/api";
import { v, type Infer } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  apifyFailureReason,
  fetchApifyViewsForPlatform,
  type ApifyPostStat,
} from "./apifyApi";
import { fetchTikTokPublicStats } from "./tiktokPublicPage";
import {
  BREAKER_CLOSED,
  nextBreaker,
  pageDelayMs,
  type BreakerState,
} from "./tiktokInternal";
import {
  EARLY_CANDIDATE_MARGIN_MS,
  EARLY_TIKTOK_SUSPEND_MS,
  EARLY_WINDOW_MS,
  isNightlyQuietWindow,
  parisMinutesOfDay,
  selectEarlyTargets,
  tiktokSuspended,
  type EarlyCandidate,
  type EarlyTarget,
} from "./earlyTracking";

/**
 * RELEVÉ RAPIDE — l'exécution. La politique (qui, quand) vit dans
 * `convex/earlyTracking.ts`, testée en vitest ; ce module ne fait que lire,
 * appeler les plateformes et écrire.
 *
 * Cron toutes les 30 min (cf `convex/crons.ts`). Chaque passage :
 *   1. se tait pendant la fenêtre du relevé nocturne (23 h 25 – 0 h 25 Paris) ;
 *   2. choisit les vidéos dues (moins de 36 h, dernier relevé ≥ 2 h) ;
 *   3. TikTok : page publique, une à la fois, 1,5 à 3 s entre deux pages,
 *      coupe-circuit à 5 pages illisibles d'affilée — et alors TikTok est
 *      suspendu 6 h. AUCUN secours Apify : ce relevé ne doit rien coûter ;
 *   4. Instagram : un run Apify par lot de 25 (facturé au résultat) ;
 *   5. écrit les relevés dans `earlyReadings`, la tentative de chaque post dans
 *      `earlyReadingAttempts` (c'est elle qui porte la cadence, échec compris),
 *      et le passage dans `earlyReadingRuns`.
 *
 * N'écrit RIEN sur les publications ni dans `metricSnapshots` : ni marqueur
 * d'échec (le relevé nocturne les tient, et deux sources qui les écrivent se
 * contrediraient), ni `vuesLatest`. Un relevé raté n'est pas un incident ici,
 * c'est un point de courbe manquant.
 */

const DAY_MS = 86_400_000;

/** Journal des passages : au-delà, on efface. */
const RUN_LOG_RETENTION_MS = 30 * DAY_MS;

/**
 * Un relevé déjà écrit à moins de 10 min pour la même publication = doublon (un
 * passage rejoué). On ne l'écrit pas deux fois.
 */
const DUPLICATE_WINDOW_MS = 10 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Lectures ────────────────────────────────────────────────────────────────

/**
 * Les publications TikTok/Instagram susceptibles d'avoir moins de 36 h, avec
 * leur dernier point de mesure : dernière TENTATIVE du relevé rapide (réussie
 * ou non, cf `earlyReadingAttempts`) ou relevé de nuit.
 *
 * Lecture bornée par l'index `by_datePubli` : ~25 publications par jour sur
 * Snytch, donc quelques dizaines de lignes. Le filtre fin sur l'âge RÉEL se
 * fait dans `selectEarlyTargets`, qui lit l'instant dans l'URL.
 */
export const listEarlyCandidates = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }): Promise<EarlyCandidate[]> => {
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_datePubli", (q) => q.gte("datePubli", since))
      .collect();
    const out: EarlyCandidate[] = [];
    for (const p of pubs) {
      if (p.plateforme !== "TikTok" && p.plateforme !== "Instagram") continue;
      if (typeof p.postUrl !== "string" || p.postUrl.length === 0) continue;
      if (p.isWarmup === true) continue;
      const attempt = await ctx.db
        .query("earlyReadingAttempts")
        .withIndex("by_publication", (q) => q.eq("publicationId", p._id))
        .first();
      const points = [attempt?.at, p.latestSnapshotAt].filter(
        (t): t is number => t !== undefined,
      );
      out.push({
        _id: p._id,
        projectId: p.projectId,
        compte: p.compte,
        plateforme: p.plateforme,
        postUrl: p.postUrl,
        datePubli: p.datePubli,
        isWarmup: p.isWarmup,
        lastReadingAt: points.length > 0 ? Math.max(...points) : undefined,
      });
    }
    return out;
  },
});

/** Dernier coupe-circuit TikTok du relevé rapide encore dans sa suspension. */
export const lastTikTokTrip = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }): Promise<number | null> => {
    const runs = await ctx.db
      .query("earlyReadingRuns")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", since))
      .collect();
    let last: number | null = null;
    for (const r of runs) {
      if (r.tiktok.breakerTripped === undefined) continue;
      if (last === null || r.startedAt > last) last = r.startedAt;
    }
    return last;
  },
});

// ─── Écritures ───────────────────────────────────────────────────────────────

const readingValidator = v.object({
  publicationId: v.id("publications"),
  capturedAt: v.number(),
  postedAt: v.number(),
  postedAtSource: v.union(v.literal("url"), v.literal("datePubli")),
  vues: v.number(),
  likes: v.optional(v.number()),
  comments: v.optional(v.number()),
  saves: v.optional(v.number()),
  shares: v.optional(v.number()),
  source: v.union(v.literal("tiktok"), v.literal("instagram")),
});

const outcomeValidator = v.union(
  v.literal("read"),
  v.literal("refused"),
  v.literal("unreadable"),
  v.literal("missing"),
);

const attemptValidator = v.object({
  publicationId: v.id("publications"),
  at: v.number(),
  outcome: outcomeValidator,
});

/**
 * Écrit le résultat d'un passage : les relevés, et la tentative de CHAQUE
 * publication visée, réussie ou non. Même transaction : une tentative sans son
 * relevé repousserait le post de 2 h pour rien. Rend le nombre de relevés écrits.
 */
export const recordEarlyPass = internalMutation({
  args: { readings: v.array(readingValidator), attempts: v.array(attemptValidator) },
  handler: async (ctx, args): Promise<number> => writeEarlyPass(ctx, args),
});

/**
 * Test e2e — écrit un passage du relevé rapide par le MÊME chemin que le cron
 * (doublons, invariant « pas avant la mise en ligne »), sans appeler TikTok ni
 * Apify. Gated par le secret e2e.
 */
export const e2eRecordEarlyPass = e2eMutation({
  args: { readings: v.array(readingValidator), attempts: v.array(attemptValidator) },
  handler: async (ctx, args): Promise<number> => writeEarlyPass(ctx, args),
});

async function writeEarlyPass(
  ctx: MutationCtx,
  {
    readings,
    attempts,
  }: {
    readings: Infer<typeof readingValidator>[];
    attempts: Infer<typeof attemptValidator>[];
  },
): Promise<number> {
  for (const a of attempts) {
    const pub = await ctx.db.get(a.publicationId);
    if (!pub) continue;
    const existing = await ctx.db
      .query("earlyReadingAttempts")
      .withIndex("by_publication", (q) => q.eq("publicationId", a.publicationId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { at: a.at, outcome: a.outcome });
    else await ctx.db.insert("earlyReadingAttempts", { ...a, projectId: pub.projectId });
  }
  let written = 0;
  for (const r of readings) {
    const pub = await ctx.db.get(r.publicationId);
    if (!pub) continue;
    // Même invariant que metricSnapshots : pas de relevé avant la mise en ligne.
    if (r.capturedAt < r.postedAt) continue;
    const recent = await ctx.db
      .query("earlyReadings")
      .withIndex("by_publication_capturedAt", (q) =>
        q
          .eq("publicationId", r.publicationId)
          .gte("capturedAt", r.capturedAt - DUPLICATE_WINDOW_MS),
      )
      .first();
    if (recent) continue;
    await ctx.db.insert("earlyReadings", { ...r, projectId: pub.projectId });
    written += 1;
  }
  return written;
}

const runValidator = v.object({
  startedAt: v.number(),
  finishedAt: v.number(),
  skipped: v.optional(
    v.union(v.literal("nightly-quiet"), v.literal("paris-clock-unavailable")),
  ),
  candidates: v.number(),
  tiktok: v.object({
    targets: v.number(),
    pages: v.number(),
    read: v.number(),
    refused: v.number(),
    unreadable: v.number(),
    deferred: v.number(),
    breakerTripped: v.optional(v.string()),
    suspended: v.boolean(),
  }),
  instagram: v.object({
    targets: v.number(),
    read: v.number(),
    missing: v.number(),
    runs: v.number(),
    deferred: v.number(),
    error: v.optional(v.string()),
  }),
});

/** Journalise un passage et efface le journal de plus de 30 jours (par lots). */
export const recordEarlyRun = internalMutation({
  args: { run: runValidator },
  handler: async (ctx, { run }): Promise<null> => {
    await ctx.db.insert("earlyReadingRuns", run);
    const old = await ctx.db
      .query("earlyReadingRuns")
      .withIndex("by_startedAt", (q) => q.lt("startedAt", run.startedAt - RUN_LOG_RETENTION_MS))
      .take(100);
    for (const r of old) await ctx.db.delete(r._id);
    return null;
  },
});

// ─── Collecte ────────────────────────────────────────────────────────────────

type Reading = Infer<typeof readingValidator>;
type Attempt = Infer<typeof attemptValidator>;

/** La tentative, pour chaque publication rattachée à la vidéo. */
function attemptsFor(t: EarlyTarget, at: number, outcome: Attempt["outcome"]): Attempt[] {
  return t.publications.map((p) => ({
    publicationId: p.publicationId as Id<"publications">,
    at,
    outcome,
  }));
}

/** Un relevé par publication rattachée à la vidéo (cf doublons de liens). */
function readingsFor(
  t: EarlyTarget,
  capturedAt: number,
  counts: Omit<Reading, "publicationId" | "capturedAt" | "postedAt" | "postedAtSource" | "source">,
  source: Reading["source"],
): Reading[] {
  return t.publications.map((p) => ({
    publicationId: p.publicationId as Id<"publications">,
    capturedAt,
    postedAt: t.postedAt,
    postedAtSource: t.postedAtSource,
    ...counts,
    source,
  }));
}

/** `null` (non fourni) devient ABSENT — jamais un zéro. */
function count(n: number | null): number | undefined {
  return n === null ? undefined : n;
}

async function collectTikTok(targets: readonly EarlyTarget[]): Promise<{
  readings: Reading[];
  attempts: Attempt[];
  pages: number;
  read: number;
  refused: number;
  unreadable: number;
  breaker: BreakerState;
}> {
  const out = {
    readings: [] as Reading[],
    attempts: [] as Attempt[],
    pages: 0,
    read: 0,
    refused: 0,
    unreadable: 0,
    breaker: BREAKER_CLOSED,
  };
  for (const t of targets) {
    if (out.breaker.trippedReason !== null) break;
    if (out.pages > 0) await sleep(pageDelayMs(Math.random()));
    out.pages += 1;
    const r = await fetchTikTokPublicStats(t.url, t.key);
    const at = Date.now();
    out.breaker = nextBreaker(out.breaker, r);
    if (r.kind === "unreadable") {
      out.unreadable += 1;
      out.attempts.push(...attemptsFor(t, at, "unreadable"));
      continue;
    }
    if (r.kind === "refused") {
      out.refused += 1;
      out.attempts.push(...attemptsFor(t, at, "refused"));
      continue;
    }
    out.read += 1;
    out.attempts.push(...attemptsFor(t, at, "read"));
    out.readings.push(
      ...readingsFor(
        t,
        at,
        {
          vues: r.stats.views,
          likes: count(r.stats.likes),
          comments: count(r.stats.comments),
          saves: count(r.stats.saves),
          shares: count(r.stats.shares),
        },
        "tiktok",
      ),
    );
  }
  return out;
}

async function collectInstagram(targets: readonly EarlyTarget[]): Promise<{
  readings: Reading[];
  attempts: Attempt[];
  read: number;
  missing: number;
  runs: number;
  error?: string;
}> {
  if (targets.length === 0) {
    return { readings: [], attempts: [], read: 0, missing: 0, runs: 0 };
  }
  const apiToken = process.env.APIFY_API_TOKEN;
  if (!apiToken) {
    // Aucune tentative inscrite : rien n'a été demandé à Apify, le post n'a pas
    // à attendre 2 h de plus quand le jeton reviendra.
    return {
      readings: [],
      attempts: [],
      read: 0,
      missing: targets.length,
      runs: 0,
      error: "APIFY_API_TOKEN absent",
    };
  }
  let stats: Record<string, ApifyPostStat> = {};
  let runs = 0;
  let error: string | undefined;
  try {
    const r = await fetchApifyViewsForPlatform(
      "Instagram",
      targets.map((t) => t.url),
      apiToken,
    );
    stats = r.stats;
    runs = r.runs;
    if (r.errors.length > 0) error = apifyFailureReason(r.errors[0]);
  } catch (e) {
    error = `Apify en échec (${String(e).slice(0, 80)})`;
  }
  const capturedAt = Date.now();
  const readings: Reading[] = [];
  const attempts: Attempt[] = [];
  let read = 0;
  for (const t of targets) {
    const s = stats[t.key];
    if (s === undefined) {
      attempts.push(...attemptsFor(t, capturedAt, "missing"));
      continue;
    }
    read += 1;
    attempts.push(...attemptsFor(t, capturedAt, "read"));
    readings.push(
      ...readingsFor(
        t,
        capturedAt,
        {
          vues: s.views,
          likes: count(s.likes),
          comments: count(s.comments),
          saves: count(s.saves),
        },
        "instagram",
      ),
    );
  }
  return { readings, attempts, read, missing: targets.length - read, runs, error };
}

const EMPTY_TIKTOK = {
  targets: 0,
  pages: 0,
  read: 0,
  refused: 0,
  unreadable: 0,
  deferred: 0,
  suspended: false,
};
const EMPTY_INSTAGRAM = { targets: 0, read: 0, missing: 0, runs: 0, deferred: 0 };

async function logSkipped(
  ctx: ActionCtx,
  startedAt: number,
  skipped: "nightly-quiet" | "paris-clock-unavailable",
): Promise<void> {
  await ctx.runMutation(internal.earlyReadings.recordEarlyRun, {
    run: {
      startedAt,
      finishedAt: Date.now(),
      skipped,
      candidates: 0,
      tiktok: EMPTY_TIKTOK,
      instagram: EMPTY_INSTAGRAM,
    },
  });
}

/** Point d'entrée du cron (toutes les 30 min). Ne lève jamais. */
export const runEarlyReadings = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const startedAt = Date.now();
    // Heure de Paris incalculable : on ne relève rien. Un repli sur UTC
    // déplacerait la fenêtre de silence d'une à deux heures — donc en plein
    // relevé nocturne. En cas de doute, on se tait (même règle que le nocturne).
    const minutes = parisMinutesOfDay(startedAt);
    if (minutes === null) {
      console.error("[early-readings] heure de Paris incalculable — passage sauté.");
      await logSkipped(ctx, startedAt, "paris-clock-unavailable");
      return null;
    }
    if (isNightlyQuietWindow(minutes)) {
      await logSkipped(ctx, startedAt, "nightly-quiet");
      return null;
    }

    const candidates = await ctx.runQuery(internal.earlyReadings.listEarlyCandidates, {
      since: startedAt - EARLY_WINDOW_MS - EARLY_CANDIDATE_MARGIN_MS,
    });
    const plan = selectEarlyTargets(candidates, startedAt);

    const lastTrip = await ctx.runQuery(internal.earlyReadings.lastTikTokTrip, {
      since: startedAt - EARLY_TIKTOK_SUSPEND_MS,
    });
    const suspended = tiktokSuspended(lastTrip ?? undefined, startedAt);

    const tiktok = suspended
      ? {
          readings: [],
          attempts: [],
          pages: 0,
          read: 0,
          refused: 0,
          unreadable: 0,
          breaker: BREAKER_CLOSED,
        }
      : await collectTikTok(plan.tiktok);
    const instagram = await collectInstagram(plan.instagram);

    const readings = [...tiktok.readings, ...instagram.readings];
    const attempts = [...tiktok.attempts, ...instagram.attempts];
    const written =
      attempts.length === 0
        ? 0
        : await ctx.runMutation(internal.earlyReadings.recordEarlyPass, { readings, attempts });

    const breakerTripped = tiktok.breaker.trippedReason ?? undefined;
    if (breakerTripped !== undefined) {
      console.error(
        `[early-readings] COUPE-CIRCUIT TikTok — ${breakerTripped}. ` +
          `Relevé rapide TikTok suspendu ${EARLY_TIKTOK_SUSPEND_MS / 3_600_000} h ; ` +
          `le relevé nocturne n'est pas concerné.`,
      );
    }
    await ctx.runMutation(internal.earlyReadings.recordEarlyRun, {
      run: {
        startedAt,
        finishedAt: Date.now(),
        candidates: candidates.length,
        tiktok: {
          targets: plan.tiktok.length,
          pages: tiktok.pages,
          read: tiktok.read,
          refused: tiktok.refused,
          unreadable: tiktok.unreadable,
          deferred: plan.deferred.tiktok,
          breakerTripped,
          suspended,
        },
        instagram: {
          targets: plan.instagram.length,
          read: instagram.read,
          missing: instagram.missing,
          runs: instagram.runs,
          deferred: plan.deferred.instagram,
          error: instagram.error,
        },
      },
    });
    console.info(
      `[early-readings] ${candidates.length} candidate(s) — TikTok ${tiktok.read}/${plan.tiktok.length}` +
        `${suspended ? " (suspendu)" : ""}, ${tiktok.pages} page(s) ; Instagram ${instagram.read}/` +
        `${plan.instagram.length}, ${instagram.runs} run(s) ; ${written} relevé(s) écrit(s) ; ` +
        `reportés ${plan.deferred.tiktok}+${plan.deferred.instagram} ; ${Date.now() - startedAt} ms.`,
    );
    return null;
  },
});

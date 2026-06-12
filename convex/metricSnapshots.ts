import { internalMutation, type MutationCtx } from "./_generated/server";
import { authedMutation, authedQuery, e2eMutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";

const DAY_MS = 24 * 60 * 60 * 1000;

const sourceValidator = v.union(
  v.literal("manual"),
  v.literal("import"),
  v.literal("migration"),
);

/**
 * Recalcule les valeurs dénormalisées "latest known" sur la publication à
 * partir du snapshot le plus récent (capturedAt max). Helper interne appelé
 * après chaque create/update/delete de snapshot. Si plus aucun snapshot :
 * tous les champs latest sont effacés (patch undefined).
 *
 * On réécrit SYSTÉMATIQUEMENT les 7 champs latest (y compris à undefined) pour
 * qu'une valeur devenue obsolète (ex: saves présent dans l'ancien latest mais
 * absent du nouveau) soit bien purgée.
 */
async function recomputeLatestMetrics(
  ctx: MutationCtx,
  publicationId: Id<"publications">,
): Promise<void> {
  const snapshots = await ctx.db
    .query("metricSnapshots")
    .withIndex("by_publication_and_capturedAt", (q) =>
      q.eq("publicationId", publicationId),
    )
    .order("desc")
    .collect();

  if (snapshots.length === 0) {
    await ctx.db.patch(publicationId, {
      vuesLatest: undefined,
      likesLatest: undefined,
      savesLatest: undefined,
      subsGainedLatest: undefined,
      commentsLatest: undefined,
      latestSnapshotId: undefined,
      latestSnapshotAt: undefined,
    });
    return;
  }

  const latest = snapshots[0];
  await ctx.db.patch(publicationId, {
    vuesLatest: latest.vues,
    likesLatest: latest.likes,
    savesLatest: latest.saves,
    subsGainedLatest: latest.subsGained,
    commentsLatest: latest.comments,
    latestSnapshotId: latest._id,
    latestSnapshotAt: latest.capturedAt,
  });
}

/** Clé de bucket calendaire (UTC) pour l'axe X du graphe aggregate.
 *  day → YYYY-MM-DD ; week → YYYY-Www (ISO 8601). Lexicographique =
 *  chronologique. Dupliqué de l'ancien lib/analytics-stats (cross-tsconfig). */
function bucketKey(timestamp: number, granularity: "day" | "week"): string {
  const d = new Date(timestamp);
  const y = d.getUTCFullYear();
  if (granularity === "day") {
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const target = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNum = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

const metricArg = v.union(
  v.literal("vues"),
  v.literal("likes"),
  v.literal("saves"),
  v.literal("subsGained"),
  v.literal("comments"),
);

function readSnapshotMetric(
  s: {
    vues: number;
    likes: number;
    saves?: number;
    subsGained?: number;
    comments?: number;
  },
  metric: "vues" | "likes" | "saves" | "subsGained" | "comments",
): number | null {
  switch (metric) {
    case "vues":
      return s.vues;
    case "likes":
      return s.likes;
    case "saves":
      return s.saves ?? null;
    case "subsGained":
      return s.subsGained ?? null;
    case "comments":
      return s.comments ?? null;
  }
}

/**
 * Série temporelle AGRÉGÉE (mode aggregate du graphe Évolution) : somme d'une
 * métrique par bucket de date (capturedAt), sur [dateFrom, dateTo], filtrée
 * optionnellement par mediaType. Retourne [{ date, value }] trié chronologique.
 */
export const aggregateTimeseries = authedQuery({
  args: {
    metric: metricArg,
    dateFrom: v.number(),
    dateTo: v.number(),
    granularity: v.union(v.literal("day"), v.literal("week")),
    mediaType: v.optional(
      v.union(
        v.literal("carousel"),
        v.literal("short"),
        v.literal("screenrecorder"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const snaps = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_capturedAt", (q) =>
        q.gte("capturedAt", args.dateFrom).lte("capturedAt", args.dateTo),
      )
      .collect();

    let filtered = snaps;
    if (args.mediaType !== undefined) {
      const pubs = await ctx.db.query("publications").collect();
      const mtById = new Map(
        pubs.map((p) => [p._id, p.mediaType ?? "carousel"]),
      );
      filtered = snaps.filter(
        (s) => mtById.get(s.publicationId) === args.mediaType,
      );
    }

    const buckets = new Map<string, number>();
    for (const s of filtered) {
      const value = readSnapshotMetric(s, args.metric);
      if (value === null) continue;
      const key = bucketKey(s.capturedAt, args.granularity);
      buckets.set(key, (buckets.get(key) ?? 0) + value);
    }

    return [...buckets.entries()]
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
});

/** Snapshots d'une publication, triés par capturedAt desc (plus récent d'abord). */
export const listSnapshotsByPublication = authedQuery({
  args: { publicationId: v.id("publications") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("metricSnapshots")
      .withIndex("by_publication_and_capturedAt", (q) =>
        q.eq("publicationId", args.publicationId),
      )
      .order("desc")
      .collect();
  },
});

export const createSnapshot = authedMutation({
  args: {
    publicationId: v.id("publications"),
    capturedAt: v.number(),
    vues: v.number(),
    likes: v.number(),
    saves: v.optional(v.number()),
    subsGained: v.optional(v.number()),
    comments: v.optional(v.number()),
    // Optional côté args → défaut "manual" (l'UI de saisie ne renseigne que
    // des snapshots manuels ; import/migration passent par d'autres chemins).
    source: v.optional(sourceValidator),
  },
  handler: async (ctx, args) => {
    const pub = await ctx.db.get(args.publicationId);
    if (!pub) throw new ConvexError("Publication introuvable.");

    if (args.capturedAt < pub.datePubli) {
      throw new ConvexError(
        "Date de capture antérieure à la date de publication.",
      );
    }

    const daysSincePublication = Math.floor(
      (args.capturedAt - pub.datePubli) / DAY_MS,
    );

    const id = await ctx.db.insert("metricSnapshots", {
      publicationId: args.publicationId,
      capturedAt: args.capturedAt,
      daysSincePublication,
      vues: args.vues,
      likes: args.likes,
      saves: args.saves,
      subsGained: args.subsGained,
      comments: args.comments,
      createdAt: Date.now(),
      source: args.source ?? "manual",
    });

    await recomputeLatestMetrics(ctx, args.publicationId);
    return { id };
  },
});

export const updateSnapshot = authedMutation({
  args: {
    id: v.id("metricSnapshots"),
    vues: v.optional(v.number()),
    likes: v.optional(v.number()),
    saves: v.optional(v.number()),
    subsGained: v.optional(v.number()),
    comments: v.optional(v.number()),
    capturedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const snap = await ctx.db.get(args.id);
    if (!snap) throw new ConvexError("Snapshot introuvable.");

    const patch: Record<string, unknown> = {};
    if (args.vues !== undefined) patch.vues = args.vues;
    if (args.likes !== undefined) patch.likes = args.likes;
    if (args.saves !== undefined) patch.saves = args.saves;
    if (args.subsGained !== undefined) patch.subsGained = args.subsGained;
    if (args.comments !== undefined) patch.comments = args.comments;

    if (args.capturedAt !== undefined) {
      const pub = await ctx.db.get(snap.publicationId);
      if (!pub) throw new ConvexError("Publication introuvable.");
      if (args.capturedAt < pub.datePubli) {
        throw new ConvexError(
          "Date de capture antérieure à la date de publication.",
        );
      }
      patch.capturedAt = args.capturedAt;
      patch.daysSincePublication = Math.floor(
        (args.capturedAt - pub.datePubli) / DAY_MS,
      );
    }

    await ctx.db.patch(args.id, patch);
    // Le latest a pu changer (capturedAt modifié ou valeurs du latest éditées).
    await recomputeLatestMetrics(ctx, snap.publicationId);
    return { ok: true };
  },
});

export const deleteSnapshot = authedMutation({
  args: { id: v.id("metricSnapshots") },
  handler: async (ctx, args) => {
    const snap = await ctx.db.get(args.id);
    if (!snap) throw new ConvexError("Snapshot introuvable.");
    const publicationId = snap.publicationId;
    await ctx.db.delete(args.id);
    await recomputeLatestMetrics(ctx, publicationId);
    return { ok: true };
  },
});

/**
 * Nettoyage e2e — supprime les snapshots orphelins (publication supprimée) ou
 * rattachés à une publication de test ([E2E_TEST] dans notes). Robuste à
 * l'ordre de teardown (pubs supprimées avant ou après).
 */
export const cleanupTestSnapshots = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const snaps = await ctx.db.query("metricSnapshots").collect();
    let deleted = 0;
    for (const s of snaps) {
      const pub = await ctx.db.get(s.publicationId);
      const isTest =
        pub === null ||
        (typeof pub.notes === "string" && pub.notes.startsWith("[E2E_TEST]"));
      if (isTest) {
        await ctx.db.delete(s._id);
        deleted += 1;
        if (pub !== null) await recomputeLatestMetrics(ctx, s.publicationId);
      }
    }
    return { deleted };
  },
});

/**
 * Migration data ONE-SHOT (internal — lancer une seule fois post-deploy via
 * `convex run --prod metricSnapshots:migrateMetricsToSnapshots`). Convertit les
 * champs legacy vuesJ1/vuesJ3/vuesJ7 (les SEULS offsets existants en base) en
 * metricSnapshots datés. Les métriques sans offset temporel (likes, saves,
 * subsGained, commentsTotal) sont rattachées au snapshot vues le plus tardif
 * (J7 > J3 > J1), best guess documenté.
 *
 * IDEMPOTENT : skip toute publication ayant déjà ≥1 snapshot. Relançable.
 * Les publications sans aucune vue legacy (drafts, jamais mesurées) ne
 * génèrent aucun snapshot.
 */
export const migrateMetricsToSnapshots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pubs = await ctx.db.query("publications").collect();

    let publicationsProcessed = 0;
    let snapshotsCreated = 0;
    let publicationsSkipped = 0;

    for (const pub of pubs) {
      const existing = await ctx.db
        .query("metricSnapshots")
        .withIndex("by_publication", (q) => q.eq("publicationId", pub._id))
        .first();
      if (existing) {
        publicationsSkipped += 1;
        continue;
      }

      // Offsets legacy existants uniquement (J1/J3/J7). Tableau ordonné
      // croissant → le dernier non-null est le "primary" (J7>J3>J1).
      const legacy: { days: number; vues: number | null }[] = [
        { days: 1, vues: pub.vuesJ1 },
        { days: 3, vues: pub.vuesJ3 },
        { days: 7, vues: pub.vuesJ7 },
      ];
      const points = legacy.filter(
        (p): p is { days: number; vues: number } => p.vues !== null,
      );

      if (points.length === 0) {
        // Aucune vue mesurée → pas de snapshot (drafts, non mesurés).
        publicationsSkipped += 1;
        continue;
      }

      const primaryDays = points[points.length - 1].days;

      for (const point of points) {
        const isPrimary = point.days === primaryDays;
        await ctx.db.insert("metricSnapshots", {
          publicationId: pub._id,
          capturedAt: pub.datePubli + point.days * DAY_MS,
          daysSincePublication: point.days,
          vues: point.vues,
          // likes requis : 0 par défaut, valeur réelle sur le snapshot primary.
          likes: isPrimary ? pub.likes ?? 0 : 0,
          saves: isPrimary ? pub.saves ?? undefined : undefined,
          subsGained: isPrimary ? pub.subsGained ?? undefined : undefined,
          comments: isPrimary ? pub.commentsTotal ?? undefined : undefined,
          createdAt: Date.now(),
          source: "migration",
        });
        snapshotsCreated += 1;
      }

      await recomputeLatestMetrics(ctx, pub._id);
      publicationsProcessed += 1;
    }

    return { publicationsProcessed, snapshotsCreated, publicationsSkipped };
  },
});

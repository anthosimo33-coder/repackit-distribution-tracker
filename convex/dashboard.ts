import { projectQuery } from "./functions";
import { v } from "convex/values";
import { coerceSnapshotAge } from "./snapshotMatching";
import {
  buildDisplayMetrics,
  groupSnapshotsByPublication,
} from "./metricsDisplay";

/**
 * KPIs cross-format du dashboard, calculés à partir des snapshots résolus
 * pour la période d'âge sélectionnée (décision C1 — KPI + verdict suivent le
 * SnapshotAgeSelector global). Seules les publications publiées (postUrl non
 * vide) entrent dans les agrégats ; les drafts sont comptés à part.
 *
 * Save rate / winners = carrousels uniquement (pas de saves côté short/SR).
 * Engagement rate = (likes + comments) / vues, cross-format.
 */
export const dashboardKpis = projectQuery({
  args: {
    snapshotAge: v.optional(v.string()),
    customDay: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const age = coerceSnapshotAge(args.snapshotAge);
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const allSnaps = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const snapsByPub = groupSnapshotsByPublication(allSnaps);

    let totalPublished = 0;
    let totalDrafts = 0;
    let vuesTotal = 0;
    let likesTotal = 0;
    let savesTotal = 0;
    let subsGainedTotal = 0;
    let commentsTotal = 0;
    let winnersCount = 0;
    const carouselRates: number[] = [];

    for (const p of pubs) {
      const published =
        typeof p.postUrl === "string" && p.postUrl.length > 0;
      if (!published) {
        totalDrafts += 1;
        continue;
      }
      totalPublished += 1;

      const dm = buildDisplayMetrics(
        snapsByPub.get(p._id) ?? [],
        age,
        args.customDay,
      );
      if (dm.vues !== null) vuesTotal += dm.vues;
      if (dm.likes !== null) likesTotal += dm.likes;
      if (dm.saves !== null) savesTotal += dm.saves;
      if (dm.subsGained !== null) subsGainedTotal += dm.subsGained;
      if (dm.comments !== null) commentsTotal += dm.comments;

      const mediaType = p.mediaType ?? "carousel";
      if (mediaType === "carousel") {
        const saveRate =
          dm.saves !== null && dm.vues !== null && dm.vues > 0
            ? dm.saves / dm.vues
            : null;
        if (saveRate !== null) {
          carouselRates.push(saveRate);
          if (saveRate >= 0.03) winnersCount += 1;
        }
      }
    }

    const saveRateAvg =
      carouselRates.length > 0
        ? carouselRates.reduce((a, b) => a + b, 0) / carouselRates.length
        : null;
    const engagementRate =
      vuesTotal > 0 ? (likesTotal + commentsTotal) / vuesTotal : null;

    return {
      totalPublished,
      totalDrafts,
      vuesTotal,
      likesTotal,
      savesTotal,
      subsGainedTotal,
      commentsTotal,
      saveRateAvg,
      winnersCount,
      engagementRate,
    };
  },
});

import { adminQuery } from "./functions";
import { v } from "convex/values";
import { coerceSnapshotAge } from "./snapshotMatching";
import { resolveDisplayMetrics } from "./metricsDisplay";
import { passesWarmupMode } from "./warmupMode";

/**
 * KPIs cross-format du dashboard, calculés à partir des snapshots résolus
 * pour la période d'âge sélectionnée (décision C1 — KPI + verdict suivent le
 * SnapshotAgeSelector global). Seules les publications publiées (postUrl non
 * vide) entrent dans les agrégats ; les drafts sont comptés à part.
 *
 * Save rate / winners = carrousels uniquement (pas de saves côté short/SR).
 * Engagement rate = (likes + comments) / vues, cross-format.
 *
 * ⚠️ Warmup (TD-019, helper unique convex/warmupMode) : les SOMMES de métriques
 * (vues/likes/saves/subs/comments) et les RATIOS (engagement, save rate, winners)
 * EXCLUENT les posts de chauffe. Les COUNTS structurels (totalPublished/
 * totalDrafts) restent sur TOUS les posts — totalPublished est une sonde
 * d'accrual e2e (validation-accrual.spec.ts) qui ne doit pas bouger.
 *
 * ⚠️ NE PAS SUPPRIMER — ce N'EST PAS du code mort, malgré les apparences.
 * Aucun composant applicatif ne l'appelle : le dashboard admin (ActionDashboard)
 * calcule ses cartes côté client à partir de listAssignments / listComptes /
 * listCreators. Un grep de « consommateurs » scopé à app/ et components/
 * renvoie donc ZÉRO et conclut à tort à du code mort.
 *
 * En réalité e2e/validation-accrual.spec.ts l'interroge directement comme sonde :
 * il compare totalPublished avant/après une publication pour vérifier l'accrual.
 * La supprimer imposerait de réécrire une assertion du spec d'accrual de PAIE
 * (logique d'argent) pour ne gagner qu'une query : mauvais ratio risque/valeur.
 * Si le sujet revient, chercher les usages dans e2e/ AVANT de conclure.
 */
export const dashboardKpis = adminQuery({
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

    // Métriques résolues par publication PUBLIÉE. Vue "latest" (défaut) → champs
    // dénormalisés, ZÉRO lecture de metricSnapshots ; vues âgées → range-scan
    // borné par publication (parallèle pour ne pas sérialiser les lectures).
    const isPublished = (p: (typeof pubs)[number]) =>
      typeof p.postUrl === "string" && p.postUrl.length > 0;
    const publishedPubs = pubs.filter(isPublished);
    const dms = await Promise.all(
      publishedPubs.map((p) =>
        resolveDisplayMetrics(ctx, p, age, args.customDay),
      ),
    );

    let totalPublished = 0;
    const totalDrafts = pubs.length - publishedPubs.length;
    let vuesTotal = 0;
    let likesTotal = 0;
    let savesTotal = 0;
    let subsGainedTotal = 0;
    let commentsTotal = 0;
    let winnersCount = 0;
    const carouselRates: number[] = [];

    for (let i = 0; i < publishedPubs.length; i++) {
      const p = publishedPubs[i];
      const dm = dms[i];
      totalPublished += 1; // compte TOUS les publiés (sonde d'accrual e2e)

      // Perf hors warmup (TD-019, helper unique) : un post de chauffe est publié
      // — il compte dans totalPublished — mais ses métriques ne mesurent pas la
      // perf du contenu et fausseraient vues/engagement/save rate/winners.
      if (!passesWarmupMode(p.isWarmup === true, "exclude")) continue;

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

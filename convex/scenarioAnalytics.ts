/**
 * ANALYTICS PAR SCÉNARIO — « Scénario » mesuré comme hook, flux, description et
 * notif : nombre de posts, vues médianes à J+7, verdict à partir de 50 posts.
 *
 * Dans une campagne, chaque scénario est déjà une brique (onglet Scénario) et
 * l'analytics de la campagne le juge parmi les autres. Ici, le scénario est
 * mesuré TOUTES CAMPAGNES CONFONDUES (il peut tourner en A et en E), et jugé
 * parmi les autres scénarios du projet — avec le même moteur de verdict que
 * les briques (convex/scriptDecision).
 *
 * Coût borné : un projet sans brique reliée à un scénario sort tout de suite ;
 * sinon on ne relit les relevés QUE des posts de scénario (index by_publication).
 * Les posts de chauffe sont exclus, comme partout dans les verdicts (TD-019).
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { permissionQuery } from "./functions";
import { findMatchingSnapshot } from "./snapshotMatching";
import { passesWarmupMode } from "./warmupMode";
import { decideBriques, DECISION_THRESHOLD } from "./scriptDecision";
import { agregerParScenario, type EchantillonScenario } from "./scenarioPerf";

const FENETRE = v.union(v.literal("j3"), v.literal("j7"), v.literal("j14"), v.literal("j30"));

export const perfParScenario = permissionQuery("content.analytics")({
  args: { fenetre: v.optional(FENETRE) },
  handler: async (ctx, args) => {
    const fenetre = args.fenetre ?? "j7";
    const bricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const briqueVersScenario = new Map<string, Id<"scenarios">>();
    for (const b of bricks) {
      if (b.kind === "conversation" && b.scenarioId) briqueVersScenario.set(b._id, b.scenarioId);
    }
    if (briqueVersScenario.size === 0) {
      return { fenetre, seuil: DECISION_THRESHOLD, scenarios: [] };
    }

    const pubs = (
      await ctx.db
        .query("publications")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).filter(
      (p) =>
        p.scriptCombo?.conversationBrickId !== undefined &&
        briqueVersScenario.has(p.scriptCombo.conversationBrickId) &&
        passesWarmupMode(p.isWarmup === true, "exclude"),
    );
    const echantillons: EchantillonScenario[] = [];
    for (const p of pubs) {
      const releves = await ctx.db
        .query("metricSnapshots")
        .withIndex("by_publication", (q) => q.eq("publicationId", p._id))
        .collect();
      const match = findMatchingSnapshot(releves, fenetre);
      if (!match) continue; // pas encore de relevé à la fenêtre : hors échantillon
      echantillons.push({
        scenarioId: briqueVersScenario.get(p.scriptCombo!.conversationBrickId!)!,
        campaignId: p.scriptCombo!.campaignId,
        vues: match.vues,
      });
    }

    const perf = agregerParScenario(echantillons);
    const verdicts = new Map(
      decideBriques(
        perf.map((s) => ({
          key: s.scenarioId,
          label: s.scenarioId,
          kind: "scenario",
          postCount: s.posts,
          viewsMedian: s.vuesMediane,
        })),
      ).map((d) => [d.key, d]),
    );
    const nomsCampagnes = new Map<string, string>();
    for (const id of new Set(perf.flatMap((s) => s.campagnes.map((c) => c.campaignId)))) {
      const c = await ctx.db.get(id as Id<"scriptCampaigns">);
      if (c && c.projectId === ctx.projectId) nomsCampagnes.set(id, c.name);
    }
    return {
      fenetre,
      seuil: DECISION_THRESHOLD,
      scenarios: perf.map((s) => ({
        scenarioId: s.scenarioId as Id<"scenarios">,
        posts: s.posts,
        vuesMediane: s.vuesMediane,
        verdict: verdicts.get(s.scenarioId)?.verdict ?? "en_test",
        ecartPairs: verdicts.get(s.scenarioId)?.deltaVsPeerMedian ?? null,
        campagnes: s.campagnes.map((c) => ({
          campaignId: c.campaignId as Id<"scriptCampaigns">,
          nom: nomsCampagnes.get(c.campaignId) ?? null,
          posts: c.posts,
          vuesMediane: c.vuesMediane,
        })),
      })),
    };
  },
});

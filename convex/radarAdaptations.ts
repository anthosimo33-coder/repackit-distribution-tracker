/**
 * RADAR — TES ADAPTATIONS (Aujourd'hui) : chaque vidéo « à adapter » se relie à
 * la campagne qui la reprend ; ses missions disent quand on la tourne, ses
 * publications disent si le format marche CHEZ NOUS, jugées comme le Pilote
 * (convex/radarAdaptMath). Trois temps : à adapter (pas de campagne), en
 * tournage (rien de mesuré), résultats chez nous (au moins une vidéo mesurée).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { ERR, err } from "./errorCodes";
import { permissionMutation, permissionQuery } from "./functions";
import { depuisPublications, videoDe } from "./pilote";
import { medianesDe, PILOTE, type VideoPassee } from "./pilotePlan";
import { adaptResult, type AdaptResult } from "./radarAdaptMath";
import { scoreOf, type ScoreBasis } from "./radarDisplay";

type Adaptation = {
  signalId: Id<"radarSignals">;
  hook: string;
  handle: string;
  url: string;
  app: string | null;
  score: number;
  basis: ScoreBasis;
};
type Reliee = Adaptation & {
  campaign: { id: Id<"scriptCampaigns">; name: string };
  missions: number;
  firstDay: number | null;
  lastDay: number | null;
  result: AdaptResult;
};

/** Adaptations lues : les plus récentes d'abord. */
const MAX_ADAPTATIONS = 40;
const JOUR_MS = 24 * 3_600_000;

/** Relie (ou délie, `null`) une vidéo à la campagne du projet qui la reprend ; elle passe « à adapter ». */
export const linkAdaptation = permissionMutation("radar.use")({
  args: { signalId: v.id("radarSignals"), campaignId: v.union(v.id("scriptCampaigns"), v.null()) },
  handler: async (ctx, { signalId, campaignId }) => {
    if (!(await ctx.db.get(signalId))) return null;
    if (campaignId !== null) {
      const c = await ctx.db.get(campaignId);
      if (!c || c.projectId !== ctx.projectId) throw err(ERR.CAMPAIGN_NOT_FOUND, "Campagne introuvable.");
    }
    const mark = await ctx.db
      .query("radarSignalMarks")
      .withIndex("by_project_signal", (q) => q.eq("projectId", ctx.projectId).eq("signalId", signalId))
      .first();
    const fields = { status: "adapte" as const, updatedAt: Date.now(), updatedBy: ctx.userId };
    if (mark) await ctx.db.patch(mark._id, { ...fields, campaignId: campaignId ?? undefined });
    else await ctx.db.insert("radarSignalMarks", { projectId: ctx.projectId, signalId, ...fields, ...(campaignId ? { campaignId } : {}) });
    return campaignId;
  },
});

export const listAdaptations = permissionQuery("radar.use")({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Les plus récentes d'abord ; une vidéo purgée de la veille ne prend pas de place.
    const adaptees = (await ctx.db.query("radarSignalMarks").withIndex("by_project", (q) => q.eq("projectId", ctx.projectId)).collect())
      .filter((m) => m.status === "adapte")
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const marks: { m: Doc<"radarSignalMarks">; s: Doc<"radarSignals"> }[] = [];
    for (const m of adaptees) {
      if (marks.length >= MAX_ADAPTATIONS) break;
      const s = await ctx.db.get(m.signalId);
      if (s) marks.push({ m, s });
    }
    const campaigns = await ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const campaignById = new Map(campaigns.map((c) => [c._id as string, c]));
    const etageDe = (id: string) => campaignById.get(id)?.funnelStage ?? null;

    // Les publications, lues une fois : celles des campagnes reliées, puis celles
    // des créatrices qui les tournent (leurs médianes, comme le Pilote).
    const pubs = new Map<string, Doc<"publications">>();
    const lirePublications = async (xs: readonly Doc<"assignments">[], depuis: number) => {
      for (const x of xs) {
        for (const t of x.targets ?? []) {
          if (!t.publicationId || pubs.has(t.publicationId)) continue;
          const p = await ctx.db.get(t.publicationId);
          if (p && p.projectId === ctx.projectId && p.datePubli >= depuis) pubs.set(p._id, p);
        }
      }
    };
    const videosDe = (xs: readonly Doc<"assignments">[]): VideoPassee[] => xs.flatMap((x) => videoDe(x, (id) => pubs.get(id)) ?? []);

    const missionsOf = new Map<string, Doc<"assignments">[]>();
    for (const { m } of marks) {
      if (!m.campaignId || missionsOf.has(m.campaignId) || !campaignById.has(m.campaignId)) continue;
      const xs = await ctx.db
        .query("assignments")
        .withIndex("by_campaign", (q) => q.eq("scriptCombo.campaignId", m.campaignId as Id<"scriptCampaigns">))
        .collect();
      const live = xs.filter((x) => x.projectId === ctx.projectId && x.status !== "cancelled");
      missionsOf.set(m.campaignId, live);
      await lirePublications(live, 0);
    }
    const videosOf = new Map([...missionsOf].map(([id, xs]) => [id, videosDe(xs)]));

    const depuis = depuisPublications(now);
    const medianes = new Map<string, Record<string, number | null>>();
    for (const creatorId of new Set([...videosOf.values()].flat().map((v) => v.creatorId))) {
      const siennes = (await ctx.db.query("assignments").withIndex("by_creator", (q) => q.eq("creatorId", creatorId as Id<"creators">)).collect()).filter(
        (x) => x.projectId === ctx.projectId && x.status !== "cancelled" && (x.postDate ?? x.dueDate) >= depuis - 7 * JOUR_MS,
      );
      await lirePublications(siennes, depuis);
      medianes.set(creatorId, medianesDe(videosDe(siennes), now, etageDe));
    }

    const todo: Adaptation[] = [];
    const doing: Reliee[] = [];
    const results: Reliee[] = [];
    for (const { m, s } of marks) {
      const score = scoreOf(s);
      const base: Adaptation = {
        signalId: s._id,
        hook: (s.hook ?? s.caption).replace(/\s+/g, " ").trim().slice(0, 160),
        handle: s.authorHandle,
        url: s.url,
        app: s.appName ?? null,
        score: score.value,
        basis: score.basis,
      };
      const c = m.campaignId ? campaignById.get(m.campaignId) : undefined;
      if (!c) {
        todo.push(base);
        continue;
      }
      const xs = missionsOf.get(c._id) ?? [];
      const days = xs.flatMap((x) => (x.postDate !== undefined ? [x.postDate] : [])).sort((a, b) => a - b);
      const result = adaptResult(videosOf.get(c._id) ?? [], etageDe(c._id), (id) => medianes.get(id) ?? {}, now);
      // Rien de publié : le premier jour prévu à venir, plus 72 h.
      const prochain = days.find((d) => d + JOUR_MS > now);
      const nextResultAt = result.nextResultAt ?? (result.published === 0 && prochain !== undefined ? prochain + PILOTE.maturiteMs : null);
      const item: Reliee = {
        signalId: base.signalId,
        hook: base.hook,
        handle: base.handle,
        url: base.url,
        app: base.app,
        score: base.score,
        basis: base.basis,
        campaign: { id: c._id, name: c.name },
        missions: xs.length,
        firstDay: days[0] ?? null,
        lastDay: days.at(-1) ?? null,
        result: {
          published: result.published,
          measured: result.measured,
          wins: result.wins,
          medianRatio: result.medianRatio,
          medianViews: result.medianViews,
          nextResultAt,
          verdict: result.verdict,
        },
      };
      (result.measured > 0 ? results : doing).push(item);
    }

    return {
      // Les campagnes actives du projet, pour relier : les plus récentes d'abord.
      campaigns: campaigns
        .filter((c) => c.status === "active")
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((c) => ({ id: c._id, name: c.name })),
      todo,
      doing,
      results,
    };
  },
});

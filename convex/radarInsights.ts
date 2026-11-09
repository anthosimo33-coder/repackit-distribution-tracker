/**
 * RADAR — CE QUI SORT DU LOT chez les concurrents d'un projet (Concurrents › Vue
 * d'ensemble). Les règles vivent dans le module pur `convex/radarInsightsMath` ;
 * ici, le calcul est TENU toutes les 6 h dans `radarInsights` (un document par
 * projet) : l'écran lit ce document, jamais les milliers de vidéos relevées.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { e2eMutation, permissionQuery } from "./functions";
import { projectSlugOf } from "./radarSignals";
import { headline, INSIGHT_MAX_AGE_MS, INSIGHT_MIN_AGE_MS, pctOf, standout, type Bucket, type InsightVideo } from "./radarInsightsMath";

/** Calcule et range ce qui sort du lot chez les concurrents de `project`. */
async function computeFor(ctx: MutationCtx, project: string, now: number) {
  const apps = (await ctx.db.query("radarApps").collect()).filter((a) => a.rivalOf.includes(project));
  const videos: InsightVideo[] = [];
  for (const app of apps) {
    const accounts = await ctx.db.query("radarTracked").withIndex("by_app", (q) => q.eq("appId", app._id)).collect();
    for (const t of accounts) {
      // Un compte mis en pause parce qu'il ne cite jamais l'app ne dit rien d'elle.
      if (t.pausedReason === "offTopic" || t.medianViews === undefined) continue;
      const vids = await ctx.db
        .query("radarTrackedVideos")
        .withIndex("by_account_published", (q) =>
          q.eq("accountId", t._id).gte("publishedAt", now - INSIGHT_MAX_AGE_MS).lte("publishedAt", now - INSIGHT_MIN_AGE_MS),
        )
        .collect();
      for (const vid of vids) {
        if (vid.platform === "instagram") continue; // la médiane est celle de son TikTok
        videos.push({
          appId: app._id,
          appName: app.name,
          lang: t.lang ?? "autre",
          publishedAt: vid.publishedAt,
          views: vid.views,
          median: t.medianViews,
          ...(vid.hook !== undefined ? { hook: vid.hook } : {}),
          ...(vid.musicTitle !== undefined ? { musicTitle: vid.musicTitle } : {}),
        });
      }
    }
  }
  const r = standout(videos, now);
  const doc = { project, computedAt: now, n: r.n, wins: r.wins, byLang: r.byLang, byApp: r.byApp, attrs: r.attrs };
  const prev = await ctx.db.query("radarInsights").withIndex("by_project", (q) => q.eq("project", project)).first();
  if (prev) await ctx.db.replace(prev._id, doc);
  else await ctx.db.insert("radarInsights", doc);
  return { project, videos: r.n };
}

export const computeInsights = internalMutation({
  args: { project: v.string() },
  handler: (ctx, { project }) => computeFor(ctx, project, Date.now()),
});

/** Toutes les 6 h : un calcul par projet qui a des concurrents suivis (chacun dans sa mutation). */
export const refreshInsights = internalMutation({
  args: {},
  handler: async (ctx) => {
    const projects = new Set((await ctx.db.query("radarApps").collect()).flatMap((a) => a.rivalOf));
    for (const project of projects) await ctx.scheduler.runAfter(0, internal.radarInsights.computeInsights, { project });
    return { projects: projects.size };
  },
});

const row = (b: Bucket) => ({ key: b.key, label: b.label ?? null, n: b.n, pct: Math.round(pctOf(b)) });

/** Ce qui sort du lot chez les concurrents du projet ; `null` tant que rien n'est calculé. */
export const getInsights = permissionQuery("radar.use")({
  args: {},
  handler: async (ctx) => {
    const slug = await projectSlugOf(ctx);
    const d = await ctx.db.query("radarInsights").withIndex("by_project", (q) => q.eq("project", slug)).first();
    if (!d) return null;
    const head = headline(d.byLang);
    return {
      computedAt: d.computedAt,
      n: d.n,
      pct: Math.round(pctOf(d)),
      headline: head ? { best: head.best.key, bestPct: Math.round(pctOf(head.best)), worst: head.worst.key, worstPct: Math.round(pctOf(head.worst)), ratio: head.ratio } : null,
      // Toutes les façons de faire se valent : la phrase de tête le dit.
      sameFacon: d.attrs.every((a) => a.verdict !== "ecart"),
      byLang: d.byLang.map(row),
      byApp: d.byApp.map((b) => ({ ...row(b), appId: b.key as Id<"radarApps"> })),
      attrs: d.attrs.map((a) => ({ key: a.key, verdict: a.verdict, better: a.better, gapPts: Math.abs(a.gapPts), a: row(a.a), b: row(a.b) })),
    };
  },
});

/** e2e : calcule tout de suite (le cron passe toutes les 6 h). */
export const e2eComputeInsights = e2eMutation({
  args: { project: v.string() },
  handler: (ctx, { project }) => computeFor(ctx, project, Date.now()),
});

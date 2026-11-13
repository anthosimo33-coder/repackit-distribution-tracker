/**
 * RADAR — LES PETITS RÉSEAUX (règles et raisons : convex/radarNamingMath). Deux fois par jour, les tournures qui
 * nomment un produit (« le site c'est… ») sont cherchées dans tout TikTok, les plus récentes d'abord, sans seuil
 * de vues. Un site cité par de petits comptes entre dans les apps repérées ; une vidéo qui cite une app suivie
 * rattache son compte. Payé sur le poste « recherche » du budget (16 crédits par passage).
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { e2eMutation } from "./functions";
import { dayKeyParis } from "./dateFr";
import { activeApps, attachAccount, noteCandidates, refreshAppNet, signalInput, type JobState, type RunResult, type TrackedCounter } from "./radarSignals";
import { allowance, budgetState } from "./radarSignalsMath";
import { findApp } from "./radarNetworkMath";
import { isSmallAccount, mergeKnown, NAMING_PER_RUN, NAMING_QUERIES, namingText } from "./radarNamingMath";
import { scKeyPresent, scSearchRecent } from "./scrapeCreatorsApi";
import type { Infer } from "convex/values";

type Video = Infer<typeof signalInput>;

/**
 * Ce que des vidéos trouvées par une tournure apportent : le compte d'une vidéo qui cite une app suivie rejoint
 * son réseau ; sinon, les sites qu'un PETIT compte cite (légende ou texte à l'écran) sont comptés parmi les apps
 * repérées. Le témoin du jour est tenu.
 */
async function applyNamedCore(ctx: MutationCtx, videos: readonly Video[], now: number): Promise<{ attached: number; small: number; known: number }> {
  const apps = await activeApps(ctx);
  const counter: TrackedCounter = {};
  let attached = 0;
  let small = 0;
  const hits: { slug: string; author: string }[] = [];
  const grown = new Set<Id<"radarApps">>();
  for (const s of videos) {
    const text = namingText(s);
    const app = findApp(text, s.authorHandle, apps);
    if (app) {
      hits.push({ slug: app.slug, author: s.authorHandle });
      if ((await attachAccount(ctx, app, s.authorHandle, s.authorFans, "caption", now, counter, s.lang)) === "added") {
        attached++;
        grown.add(app._id);
      }
      continue;
    }
    if (!isSmallAccount(s.authorFans)) continue;
    small++;
    // Les sites seulement : un compte mentionné par un petit compte est le plus souvent un ami.
    await noteCandidates(ctx, { caption: text, authorId: s.authorId, authorHandle: s.authorHandle, url: s.url, authorBio: s.authorBio }, now, apps);
  }
  // Le compteur de comptes des apps qui en ont gagné suit tout de suite à l'écran.
  for (const id of grown) await refreshAppNet(ctx, id, now);
  const day = dayKeyParis(now);
  const got = await ctx.db.query("radarNamingStats").withIndex("by_day", (q) => q.eq("day", day)).first();
  if (got) await ctx.db.patch(got._id, { videos: got.videos + videos.length, small: got.small + small, known: mergeKnown(got.known, hits) });
  else await ctx.db.insert("radarNamingStats", { day, videos: videos.length, small, known: mergeKnown([], hits) });
  return { attached, small, known: hits.length };
}

export const applyNamed = internalMutation({
  args: { videos: v.array(signalInput), now: v.number() },
  handler: (ctx, { videos, now }): Promise<{ attached: number; small: number; known: number }> => applyNamedCore(ctx, videos, now),
});

export const runNaming = internalAction({
  args: {},
  handler: async (ctx): Promise<RunResult> => {
    const now = Date.now();
    if (!scKeyPresent()) return { skipped: "no-key" };
    const st: JobState = await ctx.runQuery(internal.radarSignals.jobState, { now });
    const spent = st.usage.filter((u) => u.poste === "search" && u.day === dayKeyParis(now)).reduce((sum, u) => sum + u.credits, 0);
    // Ce qui reste du jour sur le poste « recherche », au plus une page par tournure.
    const n = Math.min(NAMING_PER_RUN, allowance(st.budget, budgetState(st.budget, st.usage), "search", spent, 1));
    let credits = 0;
    let calls = 0;
    let errors = 0;
    let creditsRemaining: number | undefined;
    let lastError: string | undefined;
    for (const q of NAMING_QUERIES.slice(0, Math.max(0, n))) {
      const r = await scSearchRecent(q.query, q.region, q.lang);
      calls++;
      credits += r.credits;
      if (!r.ok) {
        errors++;
        lastError = r.error;
        if (r.noCredits) break;
        continue;
      }
      if (r.creditsRemaining !== undefined) creditsRemaining = r.creditsRemaining;
      await ctx.runMutation(internal.radarNaming.applyNamed, { videos: r.value, now });
    }
    await ctx.runMutation(internal.radarSignals.recordRun, {
      poste: "search",
      credits,
      calls,
      errors,
      now,
      ...(creditsRemaining !== undefined ? { creditsRemaining } : {}),
      ...(lastError ? { lastError } : {}),
    });
    return { calls, credits, errors };
  },
});

/** e2e : ce que des vidéos trouvées par une tournure apportent (la vraie recherche ne tourne pas en e2e). */
export const e2eApplyNamed = e2eMutation({
  args: { videos: v.array(v.object({ videoId: v.string(), handle: v.string(), fans: v.number(), caption: v.string(), hook: v.optional(v.string()) })) },
  handler: async (ctx, { videos }): Promise<{ attached: number; small: number; known: number }> => {
    const now = Date.now();
    return applyNamedCore(
      ctx,
      videos.map((x) => ({
        videoId: x.videoId,
        url: `https://www.tiktok.com/@${x.handle}/video/${x.videoId}`,
        authorId: x.handle,
        authorHandle: x.handle,
        authorFans: x.fans,
        caption: x.caption,
        lang: "fr",
        publishedAt: now - 3_600_000,
        isAd: false,
        views: 320,
        likes: 4,
        comments: 0,
        shares: 0,
        saves: 0,
        ...(x.hook ? { hook: x.hook } : {}),
      })),
      now,
    );
  },
});

/** e2e : le témoin du jour (apps suivies retrouvées), puis l'efface pour les pseudos qui contiennent `marker`. */
export const e2eNamingStats = e2eMutation({
  args: { marker: v.string(), clear: v.optional(v.boolean()) },
  handler: async (ctx, { marker, clear }): Promise<{ slug: string; videos: number; authors: string[] }[]> => {
    const got = await ctx.db.query("radarNamingStats").withIndex("by_day", (q) => q.eq("day", dayKeyParis(Date.now()))).first();
    const mine = (got?.known ?? []).map((k) => ({ ...k, authors: k.authors.filter((a) => a.includes(marker)) })).filter((k) => k.authors.length > 0);
    if (clear && got) await ctx.db.patch(got._id, { known: got.known.map((k) => ({ ...k, authors: k.authors.filter((a) => !a.includes(marker)) })).filter((k) => k.authors.length > 0) });
    return mine;
  },
});

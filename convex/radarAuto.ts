/**
 * RADAR — SUIVI D'OFFICE des apps trouvées (décidé par le fondateur le 13/11/2026 : « les apps trouvées sont
 * suivies d'office »). Toutes les 10 minutes, les apps repérées par les classements de l'App Store et par la
 * place de marché de campagnes sont regardées une fois :
 *  - une app des classements entre quand ses comptes créateurs la prouvent assez (radarAutoMath.autoPlan) ;
 *  - un produit de la place de marché entre dès que l'IA l'a dit « app » ou « logiciel » : une campagne paie.
 * Entrer = créer l'app (jamais « concurrente » d'un projet), rattacher ses comptes, et lancer sa recherche
 * complète. Ce qui n'entre pas reste PROPOSÉ à l'écran, avec la raison. Les sites cités par de petits comptes
 * (convex/radarNaming) ne sont pas suivis d'office : cette recherche est encore à l'essai.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { e2eMutation } from "./functions";
import { ERR } from "./errorCodes";
import { followCandidateCore } from "./radarNetworks";
import { autoPlan } from "./radarAutoMath";
import { alreadyFollowed } from "./radarStoreMath";
import { scKeyPresent } from "./scrapeCreatorsApi";

/** Apps regardées par passage et par source. */
const AUTO_BATCH = 15;

async function autoFollowCore(ctx: MutationCtx, now: number, only?: (key: string) => boolean): Promise<{ followed: number; kept: number; attached: number }> {
  const pick = async (kind: "store" | "market") =>
    (
      await ctx.db
        .query("radarAppCandidates")
        .withIndex("by_kind_status_count", (q) => q.eq("kind", kind).eq("status", "new"))
        .order("desc")
        .take(300)
    )
      .filter((c) => c.autoAt === undefined && (!only || only(c.key)))
      .slice(0, AUTO_BATCH);
  let followed = 0;
  let kept = 0;
  let attached = 0;
  for (const c of [...(await pick("store")), ...(await pick("market"))]) {
    const plan = autoPlan(c);
    if ("skip" in plan) {
      await ctx.db.patch(c._id, { autoAt: now, autoNote: plan.skip });
      kept++;
      continue;
    }
    // Déjà suivie sous ce motif (liste de départ, ou suivie à l'écran entre-temps) : plus à proposer.
    const apps = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
    if (alreadyFollowed(plan.patterns, apps)) {
      await ctx.db.patch(c._id, { status: "followed", autoAt: now, autoNote: "déjà suivie" });
      continue;
    }
    try {
      const r = await followCandidateCore(ctx, c, c.label, [], plan.patterns, now);
      await ctx.db.patch(c._id, { autoAt: now, autoNote: "suivie d'office" });
      followed++;
      attached += r.attached;
    } catch (e) {
      // Le même nom qu'une app suivie : c'est elle. Un motif pris dans celui d'une autre : à trancher à la main.
      const code = e instanceof ConvexError ? (e.data as { code?: string } | undefined)?.code : undefined;
      if (code === undefined) throw e;
      if (code === ERR.RADAR_APP_ALREADY_FOLLOWED) await ctx.db.patch(c._id, { status: "followed", autoAt: now, autoNote: "déjà suivie" });
      else {
        await ctx.db.patch(c._id, { autoAt: now, autoNote: code === ERR.RADAR_APP_PATTERN_TAKEN ? "motif déjà pris par une autre app" : "à suivre à la main" });
        kept++;
      }
    }
  }
  return { followed, kept, attached };
}

export const autoFollow = internalMutation({
  args: { now: v.number() },
  handler: (ctx, { now }): Promise<{ followed: number; kept: number; attached: number }> => autoFollowCore(ctx, now),
});

export const runAutoFollow = internalAction({
  args: {},
  handler: async (ctx): Promise<{ skipped: "no-key" } | { followed: number; kept: number; attached: number }> => {
    // Sans la clé du fournisseur de données (tests, intégration continue), rien n'est suivi d'office.
    if (!scKeyPresent()) return { skipped: "no-key" };
    const r: { followed: number; kept: number; attached: number } = await ctx.runMutation(internal.radarAuto.autoFollow, { now: Date.now() });
    // Les comptes rattachés sont relevés tout de suite ; la recherche complète de l'app part à la tâche de l'heure.
    if (r.attached) await ctx.scheduler.runAfter(0, internal.radarNetworks.runAccountReads, {});
    return r;
  },
});

/** e2e : un passage du suivi d'office sur les apps repérées dont la clé contient un de ces marqueurs (la tâche ne tourne pas sans la clé du fournisseur). */
export const e2eAutoFollow = e2eMutation({
  args: { markers: v.array(v.string()) },
  handler: (ctx, { markers }): Promise<{ followed: number; kept: number; attached: number }> => autoFollowCore(ctx, Date.now(), (key) => markers.some((m) => key.includes(m))),
});

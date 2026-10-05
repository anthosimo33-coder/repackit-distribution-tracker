import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { comboCooldownDaysOf } from "./comboCooldown";
import { invalidateDashboardCache } from "./dashboardCache";
import { planMissionOps, type OpsScriptCombo } from "./missionOpsPlan";
import { ecrireCombo, missionAvecTexte } from "./assignmentScriptText";

/**
 * ⚠️ NE PLUS S'EN SERVIR SUR LA PROD (règle du 05/10/2026) : ces écritures
 * passent HORS du journal des modifications — ni traçables, ni défaisables. La
 * réécriture d'une mission (hook, flux, légende, notif, consigne) passe par
 * l'outil MCP `reecrire_mission` (convex/mcpWritesMissions), journalisé avec la
 * mission avant/après et défaisable par `defaire`. Gardé pour les tests et le
 * dépannage local.
 *
 * RÉÉCRITURE DE MISSIONS SUR PLACE — l'exécutant du plan de
 * convex/missionOpsPlan.ts (le POURQUOI et les garde-fous y sont écrits).
 *
 * internal = jamais exposé à l'API publique, ni à un écran, ni au MCP. Se lance
 * en production par le passage obligé, d'abord À BLANC :
 *   ./scripts/convex-prod.sh run missionOps:apply '{"projectSlug":"snytch","dryRun":true,…}'
 * puis avec `dryRun: false` une fois le plan relu. Le plan entier tient dans UNE
 * transaction : un garde-fou qui casse et rien n'est écrit.
 *
 * N'envoie AUCUN email : c'est la raison d'être de cet outil face à
 * « annuler puis réassigner ».
 */

const kind = v.union(
  v.literal("hook"),
  v.literal("flux"),
  v.literal("cta"),
  v.literal("notif"),
);

export const apply = internalMutation({
  args: {
    projectSlug: v.string(),
    dryRun: v.boolean(),
    bricksToCreate: v.optional(
      v.array(
        v.object({
          campaignId: v.id("scriptCampaigns"),
          kind,
          content: v.string(),
          /** Nom court (interne) — absent = le texte lui-même. */
          label: v.optional(v.string()),
          instruction: v.optional(v.string()),
          active: v.boolean(),
        }),
      ),
    ),
    brickInstructions: v.optional(
      v.array(v.object({ brickId: v.id("scriptBricks"), instruction: v.string() })),
    ),
    brickTextFixes: v.optional(
      v.array(
        v.object({ brickId: v.id("scriptBricks"), from: v.string(), to: v.string() }),
      ),
    ),
    frozenTextFixes: v.optional(
      v.array(
        v.object({
          assignmentId: v.id("assignments"),
          expectCreatorId: v.id("creators"),
          from: v.string(),
          to: v.string(),
        }),
      ),
    ),
    assignmentRewrites: v.optional(
      v.array(
        v.object({
          assignmentId: v.id("assignments"),
          expectCreatorId: v.id("creators"),
          expectCampaignId: v.id("scriptCampaigns"),
          combo: v.optional(
            v.object({
              campaignId: v.id("scriptCampaigns"),
              hookBrickId: v.id("scriptBricks"),
              fluxBrickId: v.id("scriptBricks"),
              ctaBrickId: v.id("scriptBricks"),
              notifBrickId: v.optional(v.id("scriptBricks")),
              notifContent: v.optional(v.string()),
            }),
          ),
          notif: v.optional(
            v.object({
              brickId: v.optional(v.id("scriptBricks")),
              content: v.optional(v.string()),
            }),
          ),
          dueOnPostDay: v.optional(v.boolean()),
          dueDay: v.optional(v.string()),
          clearInstructions: v.optional(v.boolean()),
          clearOverlayText: v.optional(v.boolean()),
          contentType: v.optional(v.union(v.literal("promo"), v.literal("warmup"))),
          remunerated: v.optional(v.boolean()),
        }),
      ),
    ),
    archiveCampaignIds: v.optional(v.array(v.id("scriptCampaigns"))),
  },
  handler: async (ctx, { projectSlug, dryRun, ...request }) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", projectSlug))
      .unique();
    if (!project) throw new Error(`Projet introuvable : « ${projectSlug} ».`);
    const projectId = project._id;

    const [bricks, campaigns, stockees] = await Promise.all([
      ctx.db
        .query("scriptBricks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
      ctx.db
        .query("scriptCampaigns")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
      ctx.db
        .query("assignments")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    ]);

    // Le plan raisonne sur les combos AVEC leur texte (il les compare, il peut
    // corriger le texte) : on le lui rend, il vit hors du document.
    const assignments = await Promise.all(
      stockees.map((a) => missionAvecTexte(ctx, a)),
    );
    const stockeeParId = new Map(stockees.map((a) => [a._id as string, a]));

    // Le plan ne voit QUE ce projet : un id d'un autre projet y est « inconnu »
    // et fait échouer le passage.
    const plan = planMissionOps({
      bricks,
      campaigns,
      assignments,
      cooldownDays: comboCooldownDaysOf(project),
      request,
    });
    if (dryRun) return { dryRun: true, ...plan };

    const now = Date.now();
    const refs = new Map<string, Id<"scriptBricks">>();
    for (const c of plan.brickCreates) {
      const id = await ctx.db.insert("scriptBricks", {
        projectId,
        campaignId: c.campaignId as Id<"scriptCampaigns">,
        kind: c.kind,
        label: c.label,
        content: c.content,
        ...(c.instruction ? { instruction: c.instruction } : {}),
        active: c.active,
        createdAt: now,
      });
      refs.set(c.ref, id);
    }
    const brickId = (id: string) =>
      refs.get(id) ?? (id as Id<"scriptBricks">);

    for (const p of plan.brickPatches) {
      await ctx.db.patch(p.id as Id<"scriptBricks">, p.set);
    }

    const toDbCombo = (
      c: OpsScriptCombo,
    ): NonNullable<Doc<"assignments">["scriptCombo"]> => ({
      campaignId: c.campaignId as Id<"scriptCampaigns">,
      hookBrickId: brickId(c.hookBrickId),
      ...(c.corpsBrickId ? { corpsBrickId: brickId(c.corpsBrickId) } : {}),
      fluxBrickId: brickId(c.fluxBrickId),
      ctaBrickId: brickId(c.ctaBrickId),
      assembledScript: c.assembledScript,
      ...(c.editedOnce !== undefined ? { editedOnce: c.editedOnce } : {}),
      ...(c.notifBrickId
        ? { notifBrickId: brickId(c.notifBrickId), notifText: c.notifText ?? "" }
        : {}),
    });

    for (const p of plan.assignmentPatches) {
      const reste = {
        ...(p.set.comboKey !== undefined ? { comboKey: p.set.comboKey } : {}),
        ...(p.set.comboImposed ? { comboImposed: true } : {}),
        ...(p.set.dueDate !== undefined ? { dueDate: p.set.dueDate } : {}),
        ...(p.set.contentType !== undefined ? { contentType: p.set.contentType } : {}),
        ...(p.set.remunerated !== undefined ? { remunerated: p.set.remunerated } : {}),
        // `undefined` RETIRE le champ : « pas de consigne » est une absence.
        ...Object.fromEntries(p.clear.map((f) => [f, undefined])),
      };
      if (p.set.scriptCombo) {
        // Le combo et son texte s'écrivent ensemble, le texte hors du document.
        await ecrireCombo(
          ctx,
          stockeeParId.get(p.id)!,
          toDbCombo(p.set.scriptCombo),
          reste,
        );
      } else {
        await ctx.db.patch(p.id as Id<"assignments">, reste);
      }
    }

    for (const p of plan.campaignPatches) {
      await ctx.db.patch(p.id as Id<"scriptCampaigns">, {
        status: p.set.status,
        updatedAt: now,
      });
    }

    // L'accueil admin lit un pré-calcul des décisions sur les briques : le
    // rendre faux tout de suite après l'écriture serait trompeur.
    if (plan.brickCreates.length > 0 || plan.brickPatches.length > 0) {
      await invalidateDashboardCache(ctx, projectId, "decisions");
    }

    return {
      dryRun: false,
      ...plan,
      createdBrickIds: Object.fromEntries(refs),
    };
  },
});

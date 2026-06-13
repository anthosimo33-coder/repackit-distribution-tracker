import { adminMutation, adminQuery, e2eMutation } from "./functions";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * S1 — Système de scripts combinatoire (fondation). Une vidéo = 1 hook + 1
 * corps + 1 flux + 1 cta posés sur un socle démo fixe. CRUD admin des campagnes
 * et de leurs bricks + import (COPIE) de hooks depuis la bibliothèque. TOUT
 * passe par adminQuery/adminMutation → le rôle creator n'a aucun accès. Pas
 * d'assignation/affichage créateur/analytics ici (chantiers suivants).
 *
 * L'assemblage (assembleScript) et le décompte (countCombinations) vivent dans
 * lib/scriptAssembly.ts (pur, testé) et sont consommés CÔTÉ CLIENT — aucune
 * réplique convex nécessaire (règle A6 non déclenchée).
 */

const KIND = v.union(
  v.literal("hook"),
  v.literal("corps"),
  v.literal("flux"),
  v.literal("cta"),
);
const TIER = v.union(v.literal("S"), v.literal("A"), v.literal("B"));

const KIND_ORDER: Record<string, number> = {
  hook: 0,
  corps: 1,
  flux: 2,
  cta: 3,
};

/** Récupère une campagne du projet courant ou rejette. */
async function requireCampaign(
  ctx: QueryCtx | MutationCtx,
  id: Id<"scriptCampaigns">,
  projectId: Id<"projects">,
): Promise<Doc<"scriptCampaigns">> {
  const c = await ctx.db.get(id);
  if (!c || c.projectId !== projectId) {
    throw new ConvexError("Campagne introuvable.");
  }
  return c;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** Campagnes du projet (actives d'abord, puis par nom). */
export const listCampaigns = adminQuery({
  args: {},
  handler: async (ctx) => {
    const campaigns = await ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return campaigns.sort((a, b) => {
      const byStatus =
        (a.status === "archived" ? 1 : 0) - (b.status === "archived" ? 1 : 0);
      if (byStatus !== 0) return byStatus;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    });
  },
});

/** Détail d'une campagne + ses bricks (triés kind puis order/createdAt). */
export const getCampaign = adminQuery({
  args: { id: v.id("scriptCampaigns") },
  handler: async (ctx, { id }) => {
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.projectId !== ctx.projectId) return null;
    const bricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", id))
      .collect();
    bricks.sort((a, b) => {
      if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      return (a.order ?? a.createdAt) - (b.order ?? b.createdAt);
    });
    return { ...campaign, bricks };
  },
});

// ─── Mutations — campagnes ───────────────────────────────────────────────────

export const createCampaign = adminMutation({
  args: { name: v.string(), demoBlock: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0) {
      throw new ConvexError("Le nom de la campagne est requis.");
    }
    const now = Date.now();
    return await ctx.db.insert("scriptCampaigns", {
      projectId: ctx.projectId,
      name,
      demoBlock: args.demoBlock ?? "",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateCampaign = adminMutation({
  args: {
    id: v.id("scriptCampaigns"),
    name: v.optional(v.string()),
    demoBlock: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    await requireCampaign(ctx, args.id, ctx.projectId);
    const patch: Partial<Doc<"scriptCampaigns">> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length === 0) throw new ConvexError("Le nom est requis.");
      patch.name = name;
    }
    if (args.demoBlock !== undefined) patch.demoBlock = args.demoBlock;
    if (args.status !== undefined) patch.status = args.status;
    await ctx.db.patch(args.id, patch);
    return { ok: true };
  },
});

/**
 * Suppression d'une campagne (cascade ses bricks).
 * S2 : à refuser si des assignments référencent la campagne (le champ de
 * référence sera ajouté en S2). Pour l'instant aucune table ne la référence →
 * suppression autorisée. Côté UI, l'archivage reste l'action douce préférée.
 */
export const deleteCampaign = adminMutation({
  args: { id: v.id("scriptCampaigns") },
  handler: async (ctx, { id }) => {
    await requireCampaign(ctx, id, ctx.projectId);
    const bricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", id))
      .collect();
    for (const b of bricks) await ctx.db.delete(b._id);
    await ctx.db.delete(id);
    return { deleted: bricks.length };
  },
});

// ─── Mutations — bricks ──────────────────────────────────────────────────────

export const createBrick = adminMutation({
  args: {
    campaignId: v.id("scriptCampaigns"),
    kind: KIND,
    label: v.string(),
    content: v.string(),
    tier: v.optional(TIER),
  },
  handler: async (ctx, args) => {
    await requireCampaign(ctx, args.campaignId, ctx.projectId);
    const label = args.label.trim();
    if (label.length === 0) {
      throw new ConvexError("Le label de la brique est requis.");
    }
    return await ctx.db.insert("scriptBricks", {
      projectId: ctx.projectId,
      campaignId: args.campaignId,
      kind: args.kind,
      label,
      content: args.content,
      // tier UNIQUEMENT pour les hooks.
      tier: args.kind === "hook" ? args.tier : undefined,
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const updateBrick = adminMutation({
  args: {
    id: v.id("scriptBricks"),
    label: v.optional(v.string()),
    content: v.optional(v.string()),
    // null = retirer le tier ; "S"|"A"|"B" = définir (ignoré si non-hook).
    tier: v.optional(v.union(TIER, v.null())),
    active: v.optional(v.boolean()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const brick = await ctx.db.get(args.id);
    if (!brick || brick.projectId !== ctx.projectId) {
      throw new ConvexError("Brique introuvable.");
    }
    const patch: Partial<Doc<"scriptBricks">> = {};
    if (args.label !== undefined) {
      const label = args.label.trim();
      if (label.length === 0) throw new ConvexError("Le label est requis.");
      patch.label = label;
    }
    if (args.content !== undefined) patch.content = args.content;
    if (args.active !== undefined) patch.active = args.active;
    if (args.order !== undefined) patch.order = args.order;
    if (args.tier !== undefined && brick.kind === "hook") {
      patch.tier = args.tier === null ? undefined : args.tier;
    }
    await ctx.db.patch(args.id, patch);
    return { ok: true };
  },
});

export const deleteBrick = adminMutation({
  args: { id: v.id("scriptBricks") },
  handler: async (ctx, { id }) => {
    const brick = await ctx.db.get(id);
    if (!brick || brick.projectId !== ctx.projectId) return { ok: true };
    await ctx.db.delete(id);
    return { ok: true };
  },
});

/**
 * Importe des hooks de la BIBLIOTHÈQUE (table hooks) en scriptBricks kind="hook".
 * COPIE : le texte du hook devient un brick indépendant (taggable par tier sans
 * toucher la biblio). La table hooks est seulement LUE → reste intacte.
 */
export const importHooks = adminMutation({
  args: {
    campaignId: v.id("scriptCampaigns"),
    hookIds: v.array(v.id("hooks")),
  },
  handler: async (ctx, args) => {
    await requireCampaign(ctx, args.campaignId, ctx.projectId);
    const now = Date.now();
    let imported = 0;
    for (const hookId of args.hookIds) {
      const hook = await ctx.db.get(hookId);
      // Isolation projet : on n'importe que les hooks du projet courant.
      if (!hook || hook.projectId !== ctx.projectId) continue;
      const label =
        hook.text.length > 60 ? `${hook.text.slice(0, 57)}…` : hook.text;
      await ctx.db.insert("scriptBricks", {
        projectId: ctx.projectId,
        campaignId: args.campaignId,
        kind: "hook",
        label,
        content: hook.text,
        tier: undefined,
        active: true,
        createdAt: now,
      });
      imported++;
    }
    return { imported };
  },
});

// ─── Cleanup e2e (gated E2E_SECRET) ──────────────────────────────────────────

/** Supprime les campagnes de test ([E2E_TEST]) + leurs bricks (cascade). */
export const cleanupTestScripts = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const campaigns = await ctx.db.query("scriptCampaigns").collect();
    let deleted = 0;
    for (const c of campaigns) {
      if (!c.name.startsWith("[E2E_TEST]")) continue;
      const bricks = await ctx.db
        .query("scriptBricks")
        .withIndex("by_campaign", (q) => q.eq("campaignId", c._id))
        .collect();
      for (const b of bricks) await ctx.db.delete(b._id);
      await ctx.db.delete(c._id);
      deleted++;
    }
    return { deleted };
  },
});

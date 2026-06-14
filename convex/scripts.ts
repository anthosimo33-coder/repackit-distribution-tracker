import { adminMutation, adminQuery, e2eMutation } from "./functions";
import { internalMutation } from "./_generated/server";
import { CAMPAIGN_NAME, DEMO_BLOCK, SEED_BRICKS } from "./scriptSeedData";
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

// ─── Réplique serveur de lib/scriptCombos + lib/scriptAssembly (règle A6) ─────
// convex/ ne peut pas importer lib/ → la génération/sélection des combos est
// dupliquée ici pour l'anti-coordination SERVEUR. DOIT rester aligné sur lib.
// Le créateur lit un script naturel → assemblage SANS étiquettes de section.
type ServerCombo = {
  hookBrickId: Id<"scriptBricks">;
  corpsBrickId: Id<"scriptBricks">;
  fluxBrickId: Id<"scriptBricks">;
  ctaBrickId: Id<"scriptBricks">;
  assembledScript: string;
};

function assembleNoLabels(p: {
  hook: string;
  corps: string;
  flux: string;
  cta: string;
  demoBlock: string;
}): string {
  return [p.hook, p.corps, p.flux, p.cta, p.demoBlock]
    .map((s) => s.trim())
    .join("\n\n");
}

function comboKeyOf(c: {
  hookBrickId: string;
  corpsBrickId: string;
  fluxBrickId: string;
  ctaBrickId: string;
}): string {
  return `${c.hookBrickId}:${c.corpsBrickId}:${c.fluxBrickId}:${c.ctaBrickId}`;
}

function generateCombosServer(
  bricks: Doc<"scriptBricks">[],
  demoBlock: string,
): ServerCombo[] {
  const of = (k: string) => bricks.filter((b) => b.active && b.kind === k);
  const out: ServerCombo[] = [];
  for (const h of of("hook")) {
    for (const c of of("corps")) {
      for (const f of of("flux")) {
        for (const t of of("cta")) {
          out.push({
            hookBrickId: h._id,
            corpsBrickId: c._id,
            fluxBrickId: f._id,
            ctaBrickId: t._id,
            assembledScript: assembleNoLabels({
              hook: h.content,
              corps: c.content,
              flux: f.content,
              cta: t.content,
              demoBlock,
            }),
          });
        }
      }
    }
  }
  return out;
}

/** Round-robin par hook (diversité), exclut les combos déjà reçus, ≤ n. */
function pickCombosServer(
  all: ServerCombo[],
  usedKeys: Set<string>,
  n: number,
): ServerCombo[] {
  if (n <= 0) return [];
  const available = all.filter((c) => !usedKeys.has(comboKeyOf(c)));
  const buckets = new Map<string, ServerCombo[]>();
  for (const c of available) {
    const b = buckets.get(c.hookBrickId);
    if (b) b.push(c);
    else buckets.set(c.hookBrickId, [c]);
  }
  const order = [...buckets.values()];
  const picked: ServerCombo[] = [];
  let progressed = true;
  while (picked.length < n && progressed) {
    progressed = false;
    for (const bucket of order) {
      if (picked.length >= n) break;
      const next = bucket.shift();
      if (next) {
        picked.push(next);
        progressed = true;
      }
    }
  }
  return picked;
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
 * Suppression d'une campagne (cascade ses bricks). S2 : REFUSÉE si la campagne
 * est référencée par des assignments (le combo figé doit rester traçable) →
 * archiver plutôt que supprimer.
 */
export const deleteCampaign = adminMutation({
  args: { id: v.id("scriptCampaigns") },
  handler: async (ctx, { id }) => {
    await requireCampaign(ctx, id, ctx.projectId);
    const projectAssignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    if (projectAssignments.some((a) => a.scriptCombo?.campaignId === id)) {
      throw new ConvexError(
        "Campagne référencée par des assignments : archive-la plutôt que de la supprimer.",
      );
    }
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

// ─── Assignation en masse (S2) — anti-coordination par créateur ──────────────

const RATE_MODEL = v.object({
  basePerPost: v.number(),
  viewBonusPer1k: v.optional(v.number()),
});

/**
 * Assigne une campagne à N créateurs × M vidéos. ANTI-COORDINATION : pour chaque
 * créateur, on pioche M combos DISTINCTS jamais déjà reçus par CE créateur sur
 * CETTE campagne (diversité de hook maximisée). Deux créateurs PEUVENT partager
 * un combo (anti-coordination par-créateur, pas globale). Chaque assignment
 * porte son scriptCombo (assembledScript FIGÉ) + rateSnapshot figé. Épuisement
 * (créateur ayant déjà reçu tous les combos dispo) signalé via `shortages`.
 */
export const assignScriptCampaign = adminMutation({
  args: {
    campaignId: v.id("scriptCampaigns"),
    creatorIds: v.array(v.id("creators")),
    videosPerCreator: v.number(),
    dueDate: v.number(),
    rateModel: RATE_MODEL,
    tier: v.optional(TIER),
  },
  handler: async (ctx, args) => {
    const campaign = await requireCampaign(ctx, args.campaignId, ctx.projectId);
    if (campaign.status === "archived") {
      throw new ConvexError("Campagne archivée : réactive-la pour l'assigner.");
    }
    if (
      !Number.isInteger(args.videosPerCreator) ||
      args.videosPerCreator < 1 ||
      args.videosPerCreator > 50
    ) {
      throw new ConvexError("Nombre de vidéos par créateur invalide (1–50).");
    }
    if (args.creatorIds.length === 0) {
      throw new ConvexError("Sélectionne au moins un créateur.");
    }
    if (
      !Number.isFinite(args.rateModel.basePerPost) ||
      args.rateModel.basePerPost < 0
    ) {
      throw new ConvexError("Le tarif de base doit être un nombre ≥ 0.");
    }
    if (
      args.rateModel.viewBonusPer1k !== undefined &&
      (!Number.isFinite(args.rateModel.viewBonusPer1k) ||
        args.rateModel.viewBonusPer1k < 0)
    ) {
      throw new ConvexError("Le bonus aux vues doit être un nombre ≥ 0.");
    }

    // Bricks actives de la campagne (+ filtre tier sur les hooks si demandé).
    const allBricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const bricks =
      args.tier === undefined
        ? allBricks
        : allBricks.filter((b) => b.kind !== "hook" || b.tier === args.tier);
    const combos = generateCombosServer(bricks, campaign.demoBlock);
    if (combos.length === 0) {
      throw new ConvexError(
        "Aucun combo disponible (un type de brique manque, ou aucun hook actif pour ce tier).",
      );
    }

    // rateModel figé sur chaque assignment (comme rateSnapshot de format).
    const rateSnapshot = {
      basePerPost: args.rateModel.basePerPost,
      viewBonusPer1k: args.rateModel.viewBonusPer1k,
    };
    const now = Date.now();
    let created = 0;
    const shortages: { name: string; requested: number; assigned: number }[] =
      [];

    for (const creatorId of args.creatorIds) {
      const creator = await ctx.db.get(creatorId);
      if (!creator || creator.projectId !== ctx.projectId) {
        throw new ConvexError("Créateur introuvable dans le projet.");
      }
      if (
        creator.userId === undefined ||
        (creator.status !== "active" && creator.status !== "onboarding")
      ) {
        throw new ConvexError(
          `Créateur non assignable (${creator.name} : non onboardé ou inactif).`,
        );
      }

      // Anti-coordination : combos déjà reçus par CE créateur sur CETTE campagne.
      const existing = await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect();
      const usedKeys = new Set(
        existing
          .filter(
            (a) => a.scriptCombo?.campaignId === args.campaignId && a.comboKey,
          )
          .map((a) => a.comboKey as string),
      );
      const picked = pickCombosServer(combos, usedKeys, args.videosPerCreator);
      if (picked.length < args.videosPerCreator) {
        shortages.push({
          name: creator.name,
          requested: args.videosPerCreator,
          assigned: picked.length,
        });
      }

      for (const combo of picked) {
        await ctx.db.insert("assignments", {
          projectId: ctx.projectId,
          creatorId,
          scriptCombo: {
            campaignId: args.campaignId,
            hookBrickId: combo.hookBrickId,
            corpsBrickId: combo.corpsBrickId,
            fluxBrickId: combo.fluxBrickId,
            ctaBrickId: combo.ctaBrickId,
            assembledScript: combo.assembledScript,
          },
          comboKey: comboKeyOf(combo),
          dueDate: args.dueDate,
          status: "todo",
          rateSnapshot,
          createdAt: now,
        });
        created++;
      }
    }
    return { created, shortages, totalCombos: combos.length };
  },
});

// ─── Cleanup e2e (gated E2E_SECRET) ──────────────────────────────────────────

/**
 * SEED — campagne « RepackIt — Bulk Testing » pré-remplie (contenu réel
 * verbatim, cf convex/scriptSeedData.ts généré). internalMutation runnable via
 * `npx convex run scripts:seedRepackitScriptCampaign` (dev ET --prod).
 *
 * IDEMPOTENCE STRICTE : si une campagne du même nom existe déjà sur le projet
 * `repackit`, ne crée RIEN (ni campagne ni bricks). Relançable sans doublon.
 */
export const seedRepackitScriptCampaign = internalMutation({
  args: {},
  handler: async (ctx) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", "repackit"))
      .first();
    if (!project) {
      throw new Error("Projet de slug 'repackit' introuvable sur ce déploiement.");
    }
    const projectId = project._id;

    const existing = (
      await ctx.db
        .query("scriptCampaigns")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    ).find((c) => c.name === CAMPAIGN_NAME);
    if (existing) {
      return {
        created: false,
        reason: "déjà seedée",
        campaignId: existing._id,
        bricks: 0,
      };
    }

    const now = Date.now();
    const campaignId = await ctx.db.insert("scriptCampaigns", {
      projectId,
      name: CAMPAIGN_NAME,
      demoBlock: DEMO_BLOCK,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    let bricks = 0;
    for (const b of SEED_BRICKS) {
      await ctx.db.insert("scriptBricks", {
        projectId,
        campaignId,
        kind: b.kind,
        label: b.label,
        content: b.content,
        // Schéma : tier optional (S|A|B) — null (non-hook / non taggé) → undefined.
        tier: b.tier ?? undefined,
        active: b.active,
        createdAt: now,
      });
      bricks++;
    }
    return { created: true, campaignId, bricks };
  },
});

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

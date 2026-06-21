import { adminMutation, adminQuery, e2eMutation } from "./functions";
import { internalMutation } from "./_generated/server";
import { CAMPAIGN_NAME, DEMO_BLOCK, SEED_BRICKS } from "./scriptSeedData";
import { targetInputValidator, validateTargets } from "./assignments";
import { buildPricingSnapshot } from "./pricing";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * S1 — Système de scripts combinatoire (fondation). Refonte 3 briques : une
 * vidéo = 1 hook + 1 flux + 1 cta (le kind "corps" et le socle démo ont été
 * retirés du montage). CRUD admin des campagnes et de leurs bricks + import
 * (COPIE) de hooks depuis la bibliothèque. TOUT passe par adminQuery/
 * adminMutation → le rôle creator n'a aucun accès.
 *
 * L'assemblage (assembleScript) et le décompte (countCombinations) vivent dans
 * lib/scriptAssembly.ts (pur, testé) et sont consommés CÔTÉ CLIENT. La
 * génération/sélection des combos est RÉPLIQUÉE ci-dessous (règle A6 : convex/
 * ne peut pas importer lib/) pour l'anti-coordination serveur.
 */

// Kinds créables : refonte → hook/flux/cta. "corps" n'est plus créable (les
// corps existants sont reclassés en hook par migrateCorpsToHooks).
const KIND = v.union(v.literal("hook"), v.literal("flux"), v.literal("cta"));
const TIER = v.union(v.literal("S"), v.literal("A"), v.literal("B"));

// Ordre d'affichage. Un kind inconnu (ex. "corps" legacy pas encore migré)
// retombe en fin de liste via `?? 99` côté tri.
const KIND_ORDER: Record<string, number> = {
  hook: 0,
  flux: 1,
  cta: 2,
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
// Refonte 3 briques : combo = hook × flux × cta, comboKey 3 segments, aucun
// socle démo. Le créateur lit un script naturel → assemblage SANS étiquettes.
type ServerCombo = {
  hookBrickId: Id<"scriptBricks">;
  fluxBrickId: Id<"scriptBricks">;
  ctaBrickId: Id<"scriptBricks">;
  assembledScript: string;
};

function assembleNoLabels(p: {
  hook: string;
  flux: string;
  cta: string;
}): string {
  return [p.hook, p.flux, p.cta].map((s) => s.trim()).join("\n\n");
}

function comboKeyOf(c: {
  hookBrickId: string;
  fluxBrickId: string;
  ctaBrickId: string;
}): string {
  return `${c.hookBrickId}:${c.fluxBrickId}:${c.ctaBrickId}`;
}

function generateCombosServer(bricks: Doc<"scriptBricks">[]): ServerCombo[] {
  const of = (k: string) => bricks.filter((b) => b.active && b.kind === k);
  const out: ServerCombo[] = [];
  for (const h of of("hook")) {
    for (const f of of("flux")) {
      for (const t of of("cta")) {
        out.push({
          hookBrickId: h._id,
          fluxBrickId: f._id,
          ctaBrickId: t._id,
          assembledScript: assembleNoLabels({
            hook: h.content,
            flux: f.content,
            cta: t.content,
          }),
        });
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
      if (a.kind !== b.kind)
        return (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
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

/**
 * Assigne une campagne à N créateurs × M vidéos. ANTI-COORDINATION : pour chaque
 * créateur, on pioche M combos DISTINCTS jamais déjà reçus par CE créateur sur
 * CETTE campagne (diversité de hook maximisée). Deux créateurs PEUVENT partager
 * un combo (anti-coordination par-créateur, pas globale). Chaque assignment
 * porte son scriptCombo (assembledScript FIGÉ) + pricingSnapshot figé. Épuisement
 * (créateur ayant déjà reçu tous les combos dispo) signalé via `shortages`.
 *
 * PRICING OBLIGATOIRE : le barème de paie (fixe/CPM/paliers) vient EXCLUSIVEMENT
 * du pricing choisi, figé en pricingSnapshot. Les anciens champs tarif de base /
 * bonus aux vues (rateModel legacy) sont RETIRÉS de l'assignation.
 */
export const assignScriptCampaign = adminMutation({
  args: {
    campaignId: v.id("scriptCampaigns"),
    creatorId: v.id("creators"),
    targets: v.array(targetInputValidator),
    videosPerCreator: v.number(),
    dueDate: v.number(),
    tier: v.optional(TIER),
    // Pricing OBLIGATOIRE (barème de paie). Validator `optional` UNIQUEMENT pour
    // émettre un ConvexError lisible si absent (sinon erreur validator brute) ;
    // le handler le rend requis. Plus aucun mode "sans pricing" (legacy retiré).
    pricingId: v.optional(v.id("pricings")),
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
      throw new ConvexError("Nombre de vidéos invalide (1–50).");
    }
    if (!args.pricingId) {
      throw new ConvexError("Un barème de paie est requis.");
    }

    const creator = await ctx.db.get(args.creatorId);
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
    // Chantier C — cibles multi-plateformes (1 vidéo de script → N posts).
    await validateTargets(ctx, ctx.projectId, args.creatorId, args.targets);

    // Bricks actives de la campagne (+ filtre tier sur les hooks si demandé).
    const allBricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const bricks =
      args.tier === undefined
        ? allBricks
        : allBricks.filter((b) => b.kind !== "hook" || b.tier === args.tier);
    const combos = generateCombosServer(bricks);
    if (combos.length === 0) {
      throw new ConvexError(
        "Aucun combo disponible (un type de brique manque, ou aucun hook actif pour ce tier).",
      );
    }

    // Pricing OBLIGATOIRE = source unique du barème (fixe/CPM/paliers), figé à
    // l'attribution. rateSnapshot devient un placeholder neutre : le schéma le
    // requiert (assignments.rateSnapshot), mais Guard C (pricingSnapshot présent)
    // garantit qu'il n'est JAMAIS lu pour la paie (cf accrueBaseLineItem /
    // confirmPublication). buildPricingSnapshot rejette un pricing introuvable
    // ou archivé (ConvexError lisible).
    const pricingSnapshot = await buildPricingSnapshot(
      ctx,
      ctx.projectId,
      args.pricingId,
    );
    const rateSnapshot = { basePerPost: 0 };
    const targets = args.targets.map((t) => ({
      platform: t.platform,
      accountId: t.accountId,
    }));
    const now = Date.now();
    const shortages: { name: string; requested: number; assigned: number }[] =
      [];

    // Anti-coordination : combos déjà reçus par CE créateur sur CETTE campagne.
    const existing = await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
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

    let created = 0;
    for (const combo of picked) {
      await ctx.db.insert("assignments", {
        projectId: ctx.projectId,
        creatorId: args.creatorId,
        scriptCombo: {
          campaignId: args.campaignId,
          hookBrickId: combo.hookBrickId,
          fluxBrickId: combo.fluxBrickId,
          ctaBrickId: combo.ctaBrickId,
          assembledScript: combo.assembledScript,
        },
        comboKey: comboKeyOf(combo),
        targets,
        dueDate: args.dueDate,
        status: "todo",
        rateSnapshot,
        pricingSnapshot,
        createdAt: now,
      });
      created++;
    }
    return { created, shortages, totalCombos: combos.length };
  },
});

// ─── Correction d'UNE brique du combo (une seule fois, avant publication) ─────
// Réplique de lib/script-combo-edit (règle A6) : statuts pré-soumission. Dès
// qu'une vidéo est soumise/publiée, le combo est verrouillé (le script affiché
// doit rester ce qui a été produit/publié).
const COMBO_EDITABLE_STATUSES = ["todo", "in_progress"];
const SLOT = v.union(v.literal("hook"), v.literal("flux"), v.literal("cta"));

/**
 * Remplace UNE brique (hook | flux | cta) du combo d'un assignment de script,
 * UNE SEULE FOIS, et UNIQUEMENT si l'assignment n'est pas encore soumis/publié.
 * Re-fige assembledScript + comboKey via le MÊME chemin que l'assignation
 * (assembleNoLabels → rendu créateur labels:false). pricingSnapshot INCHANGÉ.
 *
 * Sécurité analytics : l'édition n'est permise qu'en todo/in_progress → AUCUNE
 * publication/snapshot n'est encore rattachée (matérialisées à la publication),
 * donc re-figer n'altère aucune donnée de perf historique.
 */
export const editScriptCombo = adminMutation({
  args: {
    id: v.id("assignments"),
    slot: SLOT,
    newBrickId: v.id("scriptBricks"),
  },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    const combo = a.scriptCombo;
    if (!combo) {
      throw new ConvexError("Cet assignment n'est pas un script.");
    }
    if (!COMBO_EDITABLE_STATUSES.includes(a.status)) {
      throw new ConvexError(
        "Le combo ne peut plus être modifié après publication.",
      );
    }
    if (combo.editedOnce) {
      throw new ConvexError("Le combo a déjà été modifié une fois.");
    }
    // Nouvelle brique : même projet + même campagne + bon kind + active.
    const newBrick = await ctx.db.get(args.newBrickId);
    if (
      !newBrick ||
      newBrick.projectId !== ctx.projectId ||
      newBrick.campaignId !== combo.campaignId
    ) {
      throw new ConvexError("Brique introuvable dans la campagne.");
    }
    if (newBrick.kind !== args.slot) {
      throw new ConvexError(`La brique doit être de type « ${args.slot} ».`);
    }
    if (!newBrick.active) {
      throw new ConvexError("La brique choisie est désactivée.");
    }

    const hookBrickId =
      args.slot === "hook" ? newBrick._id : combo.hookBrickId;
    const fluxBrickId =
      args.slot === "flux" ? newBrick._id : combo.fluxBrickId;
    const ctaBrickId = args.slot === "cta" ? newBrick._id : combo.ctaBrickId;

    const [hook, flux, cta] = await Promise.all([
      ctx.db.get(hookBrickId),
      ctx.db.get(fluxBrickId),
      ctx.db.get(ctaBrickId),
    ]);
    if (!hook || !flux || !cta) {
      throw new ConvexError("Brique du combo introuvable.");
    }
    const assembledScript = assembleNoLabels({
      hook: hook.content,
      flux: flux.content,
      cta: cta.content,
    });
    const comboKey = comboKeyOf({ hookBrickId, fluxBrickId, ctaBrickId });

    await ctx.db.patch(args.id, {
      // Combo RE-FIGÉ (3 kinds, sans corpsBrickId legacy) + verrou une seule fois.
      scriptCombo: {
        campaignId: combo.campaignId,
        hookBrickId,
        fluxBrickId,
        ctaBrickId,
        assembledScript,
        editedOnce: true,
      },
      comboKey,
      // pricingSnapshot, rateSnapshot, status… : STRICTEMENT inchangés.
    });
    return { ok: true, comboKey };
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

/**
 * REFONTE 3 briques — migration data : reclasse TOUTES les briques kind="corps"
 * en kind="hook" tier "A" (l'audit confirme que les corps sont des hooks). PATCH
 * uniquement (même _id), JAMAIS de delete → 0 perte d'historique. Les combos
 * figés (assignments.scriptCombo.assembledScript) sont du TEXTE autonome : ils
 * ne bougent pas. Les publications.scriptCombo.corpsBrickId historiques pointent
 * toujours vers la brique (désormais un hook) — leur _id ne change pas.
 *
 * IDEMPOTENTE : relançable sans effet (no-op s'il ne reste aucun corps). Tourne
 * sur TOUS les projets (internalMutation, pas de ctx.projectId). À lancer après
 * le deploy du code 3-kinds (même PR) :
 *   npx convex run scripts:migrateCorpsToHooks --prod
 */
export const migrateCorpsToHooks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("scriptBricks").collect();
    let migrated = 0;
    for (const b of all) {
      if (b.kind !== "corps") continue;
      await ctx.db.patch(b._id, { kind: "hook", tier: "A" });
      migrated++;
    }
    return { migrated };
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

import { adminMutation, adminQuery, e2eMutation } from "./functions";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { CAMPAIGN_NAME, DEMO_BLOCK, SEED_BRICKS } from "./scriptSeedData";
import {
  targetInputValidator,
  validateTargets,
  resolveManagedTargets,
  normalizeOverlayText,
  validateProjectFolderIds,
  buildModelVideoItemsServer,
} from "./assignments";
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
// 2 tiers visuels : "S" → « Argent », "A" → « Autre » (cf lib/script-tier).
// "B" reste TOLÉRÉ par les args (legacy back-compat / seed de migration), mais
// l'UI ne le propose plus jamais ; migrateTierBToA reclasse les "B" en "A".
const TIER = v.union(v.literal("S"), v.literal("A"), v.literal("B"));

// SNYTCH — mode d'usage d'une brique DANS LA VIDÉO (hook / flux) : à dire / à
// afficher / les deux. Stocké UNIQUEMENT pour hook/flux (cf create/updateBrick).
const MODE = v.union(
  v.literal("dire"),
  v.literal("afficher"),
  v.literal("les_deux"),
);

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

/**
 * Valide un combo IMPOSÉ (« Rejouer ce script » / mode « Combinaison choisie »)
 * et l'assemble depuis les briques VIVANTES (pas un texte figé). Rejette
 * (ConvexError lisible) si une brique est introuvable/supprimée, désactivée, du
 * mauvais kind ou hors campagne — les mêmes cas que l'UI signale au
 * pré-remplissage. On réassemble à neuf (labels:false, comme l'auto) → si une
 * brique a été éditée depuis la source, la reprise reflète la version ACTUELLE.
 */
function validateImposedCombo(
  allBricks: Doc<"scriptBricks">[],
  chosen: {
    hookBrickId: Id<"scriptBricks">;
    fluxBrickId: Id<"scriptBricks">;
    ctaBrickId: Id<"scriptBricks">;
  },
  campaignId: Id<"scriptCampaigns">,
): ServerCombo {
  const byId = new Map(allBricks.map((b) => [b._id as string, b]));
  const pick = (id: Id<"scriptBricks">, kind: "hook" | "flux" | "cta") => {
    const b = byId.get(id as string);
    if (!b || b.campaignId !== campaignId) {
      throw new ConvexError(
        `Brique ${kind} introuvable (supprimée ?) — choisis-en une autre.`,
      );
    }
    if (b.kind !== kind) {
      throw new ConvexError(`Brique ${kind} de type inattendu (${b.kind}).`);
    }
    if (!b.active) {
      throw new ConvexError(
        `Brique ${kind} désactivée — choisis-en une autre.`,
      );
    }
    return b;
  };
  const hook = pick(chosen.hookBrickId, "hook");
  const flux = pick(chosen.fluxBrickId, "flux");
  const cta = pick(chosen.ctaBrickId, "cta");
  return {
    hookBrickId: hook._id,
    fluxBrickId: flux._id,
    ctaBrickId: cta._id,
    assembledScript: assembleNoLabels({
      hook: hook.content,
      flux: flux.content,
      cta: cta.content,
    }),
  };
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

/**
 * Sélection gloutonne « least-used » équilibrant les 3 dimensions (hook/flux/cta).
 * RÉPLIQUE EXACTE de lib/scriptCombos.pickCombosForCreator (règle A6). Score d'un
 * combo = somme des usages de ses 3 bricks ; on prend le score MINIMAL, tie-break
 * stable par ordre de génération. Compteurs amorcés depuis usedKeys (combos déjà
 * pris créateur+plateforme) pour POURSUIVRE l'équilibre. Exclut usedKeys, ≤ n,
 * jamais de doublon.
 */
function pickCombosServer(
  all: ServerCombo[],
  usedKeys: Set<string>,
  n: number,
): ServerCombo[] {
  if (n <= 0) return [];
  const available = all.filter((c) => !usedKeys.has(comboKeyOf(c)));

  const hookUse = new Map<string, number>();
  const fluxUse = new Map<string, number>();
  const ctaUse = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const key of usedKeys) {
    const parts = key.split(":");
    if (parts.length !== 3) continue; // clé legacy 4 segments → ignorée
    bump(hookUse, parts[0]);
    bump(fluxUse, parts[1]);
    bump(ctaUse, parts[2]);
  }

  const picked: ServerCombo[] = [];
  const taken = new Array<boolean>(available.length).fill(false);
  for (let step = 0; step < n; step++) {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < available.length; i++) {
      if (taken[i]) continue;
      const c = available[i];
      const score =
        (hookUse.get(c.hookBrickId) ?? 0) +
        (fluxUse.get(c.fluxBrickId) ?? 0) +
        (ctaUse.get(c.ctaBrickId) ?? 0);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break; // stock épuisé
    taken[bestIdx] = true;
    const c = available[bestIdx];
    picked.push(c);
    bump(hookUse, c.hookBrickId);
    bump(fluxUse, c.fluxBrickId);
    bump(ctaUse, c.ctaBrickId);
  }
  return picked;
}

/**
 * Unicité (comboKey, créateur, plateforme) — RÉPLIQUE de
 * lib/script-combo-uniqueness (règle A6). comboKeys déjà pris par `creatorId`
 * sur AU MOINS UNE des `platforms` (union) parmi `existing`. Sert à exclure de
 * la génération : un combo doit être libre sur CHAQUE plateforme ciblée.
 */
function usedComboKeysForPlatforms(
  existing: Doc<"assignments">[],
  creatorId: Id<"creators">,
  platforms: string[],
): Set<string> {
  const target = new Set(platforms);
  const used = new Set<string>();
  for (const a of existing) {
    if (a.creatorId !== creatorId || !a.comboKey) continue;
    // Combo IMPOSÉ (rejeu / choix manuel) : ne consomme PAS la rotation auto →
    // le triplet reste piochable (« un choix manuel ne retire rien de la
    // rotation »). Réplique A6 : lib/script-combo-uniqueness fait de même.
    if (a.comboImposed === true) continue;
    const aps = (a.targets ?? []).map((t) => t.platform);
    if (aps.some((p) => target.has(p))) used.add(a.comboKey);
  }
  return used;
}

/**
 * Garde serveur d'unicité : rejette (ConvexError lisible) si `comboKey` est déjà
 * utilisé par un AUTRE assignment du même créateur sur l'une des `platforms`.
 * Lit via l'index by_creator_combo (créateur, comboKey).
 */
async function assertComboFreeForCreatorPlatforms(
  ctx: MutationCtx,
  input: {
    comboKey: string;
    creatorId: Id<"creators">;
    platforms: string[];
    excludeAssignmentId?: Id<"assignments">;
  },
): Promise<void> {
  const target = new Set(input.platforms);
  const sameCombo = await ctx.db
    .query("assignments")
    .withIndex("by_creator_combo", (q) =>
      q.eq("creatorId", input.creatorId).eq("comboKey", input.comboKey),
    )
    .collect();
  for (const a of sameCombo) {
    if (a._id === input.excludeAssignmentId) continue;
    const conflict = (a.targets ?? [])
      .map((t) => t.platform)
      .find((p) => target.has(p));
    if (conflict) {
      const creator = await ctx.db.get(input.creatorId);
      throw new ConvexError(
        `Ce combo est déjà utilisé pour ${creator?.name ?? "ce créateur"} sur ${conflict}.`,
      );
    }
  }
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Combos UNIQUES disponibles pour assigner un créateur sur des plateformes
 * données : total des combos de la campagne (après filtre tier) MOINS ceux déjà
 * pris par ce créateur sur l'une des plateformes ciblées (unicité comboKey ×
 * créateur × plateforme). Alimente la modale pour prévenir AVANT d'assigner s'il
 * manque des combos uniques. `available` = combos encore attribuables.
 */
export const availableCombosForAssignment = adminQuery({
  args: {
    campaignId: v.id("scriptCampaigns"),
    creatorId: v.id("creators"),
    platforms: v.array(
      v.union(
        v.literal("TikTok"),
        v.literal("Instagram"),
        v.literal("YouTube"),
      ),
    ),
    tier: v.optional(TIER),
  },
  handler: async (ctx, args) => {
    await requireCampaign(ctx, args.campaignId, ctx.projectId);
    const allBricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const bricks =
      args.tier === undefined
        ? allBricks
        : allBricks.filter((b) => b.kind !== "hook" || b.tier === args.tier);
    const combos = generateCombosServer(bricks);
    const existing = await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    const usedKeys = usedComboKeysForPlatforms(
      existing,
      args.creatorId,
      args.platforms,
    );
    const available = combos.filter((c) => !usedKeys.has(comboKeyOf(c))).length;
    return { total: combos.length, available };
  },
});

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

/**
 * Payload de « Rejouer ce script » : résout, depuis une PUBLICATION (ligne
 * tracker) ou une ASSIGNATION (fiche détail), tout ce dont la modale a besoin
 * pour se pré-remplir :
 *  - `bricks` : les 3 brickIds FIGÉS du combo source (la modale les confronte aux
 *     briques VIVANTES → supprimée/désactivée = slot à re-remplir) ;
 *  - `sourceAssignmentId` : lignage (replayedFrom), même pour une variante ;
 *  - `sourceAssembledScript` : texte FIGÉ de la source → la modale détecte « une
 *     brique a été éditée depuis » (réassemblage live ≠ figé) ;
 *  - `perf` : vues (latest dénormalisé) · date · créatrice, pour le panneau qui
 *     rappelle POURQUOI on rejoue.
 * Renvoie null si la source n'est pas un script (pas de scriptCombo) ou est hors
 * projet. L'entrée ANALYTICS (combo agrégé) ne passe PAS par ici : elle n'a pas de
 * source unique (payload construit côté client depuis ComboPerf).
 */
export const getReplaySource = adminQuery({
  args: {
    publicationId: v.optional(v.id("publications")),
    assignmentId: v.optional(v.id("assignments")),
  },
  handler: async (ctx, args) => {
    // Exactement UNE source.
    if (
      (args.publicationId === undefined) ===
      (args.assignmentId === undefined)
    ) {
      throw new ConvexError("Fournis publicationId OU assignmentId (une seule).");
    }

    let assignment: Doc<"assignments"> | null = null;
    let publication: Doc<"publications"> | null = null;

    if (args.assignmentId) {
      assignment = await ctx.db.get(args.assignmentId);
      if (!assignment || assignment.projectId !== ctx.projectId) return null;
      // Publication derrière l'assignation (targets[].publicationId ou legacy).
      const pubId =
        assignment.publicationId ??
        assignment.targets?.find((t) => t.publicationId)?.publicationId;
      publication = pubId ? await ctx.db.get(pubId) : null;
    } else {
      publication = await ctx.db.get(args.publicationId!);
      if (!publication || publication.projectId !== ctx.projectId) return null;
      // Publications sans back-ref vers l'assignation → scan projet, match sur
      // publicationId (top-level legacy ou targets[]). 1 publication = 1 assignation.
      const projectAssignments = await ctx.db
        .query("assignments")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect();
      const pubIdStr = publication._id as string;
      assignment =
        projectAssignments.find(
          (a) =>
            (a.publicationId as string | undefined) === pubIdStr ||
            (a.targets ?? []).some(
              (t) => (t.publicationId as string | undefined) === pubIdStr,
            ),
        ) ?? null;
    }

    // La source doit porter un combo de script (sinon rien à rejouer).
    const combo = assignment?.scriptCombo ?? publication?.scriptCombo ?? null;
    if (!combo) return null;

    const campaign = await ctx.db.get(combo.campaignId);
    if (!campaign || campaign.projectId !== ctx.projectId) return null;

    // Créatrice : via l'assignation (la publication n'en porte pas).
    let creatorName = assignment?.creatorNameSnapshot ?? "Créateur supprimé";
    if (assignment) {
      const creator = await ctx.db.get(assignment.creatorId);
      if (creator) creatorName = creator.name;
    }

    return {
      campaignId: combo.campaignId,
      campaignName: campaign.name,
      bricks: {
        hookBrickId: combo.hookBrickId,
        fluxBrickId: combo.fluxBrickId,
        ctaBrickId: combo.ctaBrickId,
      },
      sourceAssignmentId: assignment?._id ?? null,
      // La publication ne stocke pas assembledScript → on prend celui, figé, de
      // l'assignation source (null si orpheline → pas de bandeau « éditée depuis »).
      sourceAssembledScript: assignment?.scriptCombo?.assembledScript ?? null,
      // Vues dénormalisées « latest » + date de publi (null si pas encore publié).
      perf: {
        views: publication?.vuesLatest ?? null,
        date: publication?.datePubli ?? assignment?.publishedAt ?? null,
        creatorName,
      },
    };
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
    mode: v.optional(MODE),
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
      // mode (zone vidéo) UNIQUEMENT pour hook/flux ; absent = défaut "les_deux"
      // au read (Snytch). Ignoré pour cta.
      mode:
        args.kind === "hook" || args.kind === "flux" ? args.mode : undefined,
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
    // null = retirer le tier ; "S"|"A" = définir (ignoré si non-hook). "B"
    // encore accepté par TIER (legacy) mais l'UI ne l'envoie plus.
    tier: v.optional(v.union(TIER, v.null())),
    active: v.optional(v.boolean()),
    order: v.optional(v.number()),
    mode: v.optional(MODE),
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
    // mode (zone vidéo) : hook/flux uniquement.
    if (
      args.mode !== undefined &&
      (brick.kind === "hook" || brick.kind === "flux")
    ) {
      patch.mode = args.mode;
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
    // Texte overlay optionnel à incruster en haut de la vidéo (cf schema).
    overlayText: v.optional(v.string()),
    // Pièces jointes optionnelles attachées DÈS l'assignation, via les MÊMES
    // champs/mécanisme que l'attachement manuel post-assignation (setAssetFolders
    // + addModelVideoToAssignment) : dossiers d'assets (bibliothèque Assets) et
    // vidéos modèles (liens « à reproduire », p.ex. inspirations). Optionnels →
    // sans eux, l'assignation est strictement inchangée. En masse, la boucle
    // client rappelle cette mutation par créateur → chacun reçoit les mêmes.
    assetFolderIds: v.optional(v.array(v.id("assetFolders"))),
    modelVideos: v.optional(
      v.array(
        v.object({
          url: v.string(),
          title: v.optional(v.string()),
          note: v.optional(v.string()),
        }),
      ),
    ),
    // Dates de PUBLICATION planifiées (brique A), une par vidéo demandée, dans
    // l'ORDRE : postDates[i] va sur la i-ème vidéo créée (i-ème combo pioché).
    // Optionnel (assignation possible sans planning) ; si moins de combos que
    // demandé (pénurie), les dates en trop sont ignorées. En masse, le client
    // passe le MÊME tableau pour chaque créateur (même répartition pour toutes).
    postDates: v.optional(v.array(v.number())),
    // Combinaison IMPOSÉE (« Rejouer ce script » / mode « Combinaison choisie ») :
    // les 3 briques sont fournies par l'admin au lieu du tirage auto. Présent →
    // court-circuite generateCombos/pickCombos et l'unicité anti-coordination ;
    // les N vidéos demandées portent CE combo (aucun blocage, aucun dédoublonnage :
    // « réutiliser une combinaison est volontaire »). Absent → chemin auto inchangé.
    imposedCombo: v.optional(
      v.object({
        hookBrickId: v.id("scriptBricks"),
        fluxBrickId: v.id("scriptBricks"),
        ctaBrickId: v.id("scriptBricks"),
      }),
    ),
    // Lignage : assignation source d'où le combo est rejoué (stocké tel quel sur
    // chaque ligne créée). Ne concerne que l'imposé ; ignoré en auto.
    replayedFrom: v.optional(v.id("assignments")),
    // Rejeu À L'IDENTIQUE : reproduit le combo FIGÉ de `replayedFrom` (texte qui a
    // réellement marché) au lieu de réassembler depuis les briques vivantes.
    // Nécessite `replayedFrom` avec un scriptCombo. Ignore `imposedCombo`.
    replayVerbatim: v.optional(v.boolean()),
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
    // Lignage de rejeu : la source doit exister DANS le projet (défensif ; l'UI ne
    // l'envoie que depuis une vraie assignation source). N'impose rien sur son
    // combo — une variante (brique changée) reste rattachée à son origine.
    let replaySrc: Doc<"assignments"> | null = null;
    if (args.replayedFrom !== undefined) {
      replaySrc = await ctx.db.get(args.replayedFrom);
      if (!replaySrc || replaySrc.projectId !== ctx.projectId) {
        throw new ConvexError("Assignation source du rejeu introuvable.");
      }
    }
    // Rejeu à l'identique : exige une source portant un script FIGÉ (scriptCombo +
    // comboKey) — on le REPRODUIT tel quel (cf branche de sélection ci-dessous).
    if (args.replayVerbatim) {
      if (!replaySrc) {
        throw new ConvexError("Rejeu à l'identique : source du rejeu requise.");
      }
      if (!replaySrc.scriptCombo || !replaySrc.comboKey) {
        throw new ConvexError(
          "Rejeu à l'identique impossible : la source n'a pas de script figé.",
        );
      }
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

    // Bricks de la campagne — servent au tirage AUTO (generateCombos) ET à valider
    // un combo IMPOSÉ (validateImposedCombo). Le filtre tier et la génération ne
    // s'appliquent qu'au chemin auto (cf branche de sélection ci-dessous).
    const allBricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();

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
    // Comptes GÉRÉS PAR L'ÉQUIPE — MÊME court-circuit que assignFormat, via le
    // helper PARTAGÉ (source unique) : cibles gérées ⇒ assignments créés DIRECT en
    // to_publish + managedByAdmin dénormalisé (l'admin publie via la file « Comptes
    // gérés — à publier »). Homogénéité imposée par le helper.
    const { managed } = await resolveManagedTargets(
      ctx,
      ctx.projectId,
      args.creatorId,
      args.targets,
    );
    const overlayText = normalizeOverlayText(args.overlayText);
    const now = Date.now();
    // Pièces jointes optionnelles — validées/normalisées via les MÊMES helpers que
    // l'attachement manuel (validateProjectFolderIds / buildModelVideoItemsServer),
    // AVANT toute insertion : en masse (une mutation par créateur), une entrée
    // invalide fait échouer CE créateur seul (try/catch client) sans toucher les
    // autres. Attachées à CHAQUE assignment créé pour ce créateur (une par vidéo).
    const linkedFolderIds =
      args.assetFolderIds && args.assetFolderIds.length > 0
        ? await validateProjectFolderIds(ctx, args.assetFolderIds, ctx.projectId)
        : [];
    const linkedModelVideos =
      args.modelVideos && args.modelVideos.length > 0
        ? buildModelVideoItemsServer(args.modelVideos)
        : [];
    const shortages: { name: string; requested: number; assigned: number }[] =
      [];

    // ─── Sélection des combos : IMPOSÉE (rejeu / choix manuel) ou AUTO ──────────
    // Imposée : les 3 briques viennent de l'admin ; CHAQUE vidéo demandée porte ce
    // combo, sans tirage ni contrôle d'unicité (réutilisation volontaire → aucun
    // blocage, aucun avertissement de doublon). Aucune pénurie possible.
    // Auto : tirage anti-coordination least-used + unicité (comboKey × créateur ×
    // plateforme). Les lignes à combo imposé sont ignorées de usedKeys → le triplet
    // imposé reste piochable en auto.
    let picked: ServerCombo[];
    let totalCombos: number;
    // Rejeu à l'identique : on REPRODUIT le combo FIGÉ de la source (validé plus
    // haut). Le texte figé = ce qui a réellement marché ; comboKey de la source →
    // attribution analytics au MÊME combo. Prioritaire sur imposedCombo (ignoré).
    const verbatimCombo =
      args.replayVerbatim && replaySrc?.scriptCombo && replaySrc.comboKey
        ? { combo: replaySrc.scriptCombo, comboKey: replaySrc.comboKey }
        : null;
    if (verbatimCombo) {
      const c = verbatimCombo.combo;
      picked = Array.from({ length: args.videosPerCreator }, () => ({
        hookBrickId: c.hookBrickId,
        fluxBrickId: c.fluxBrickId,
        ctaBrickId: c.ctaBrickId,
        assembledScript: c.assembledScript,
      }));
      totalCombos = 1;
    } else if (args.imposedCombo) {
      const combo = validateImposedCombo(
        allBricks,
        args.imposedCombo,
        args.campaignId,
      );
      picked = Array.from({ length: args.videosPerCreator }, () => combo);
      totalCombos = 1;
    } else {
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
      totalCombos = combos.length;
      // Unicité (comboKey, créateur, PLATEFORME) : on exclut les combos déjà pris
      // par CE créateur sur l'une des plateformes ciblées (union). Cross-plateforme
      // AUTORISÉ → un combo sur le TikTok du créateur reste dispo pour son YouTube.
      // Le créateur est mono-projet → scoping projet implicite ; comboKey embarque
      // les brickIds (uniques par campagne) → pas de collision inter-campagnes.
      const existing = await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
        .collect();
      const targetPlatforms = args.targets.map((t) => t.platform);
      const usedKeys = usedComboKeysForPlatforms(
        existing,
        args.creatorId,
        targetPlatforms,
      );
      picked = pickCombosServer(combos, usedKeys, args.videosPerCreator);
      if (picked.length < args.videosPerCreator) {
        shortages.push({
          name: creator.name,
          requested: args.videosPerCreator,
          assigned: picked.length,
        });
      }
    }

    let created = 0;
    let firstAssignmentId: Id<"assignments"> | null = null;
    // Positionnel : la i-ème vidéo créée reçoit postDates[i] (undefined sinon).
    for (let i = 0; i < picked.length; i++) {
      const combo = picked[i];
      const postDate = args.postDates?.[i];
      const insertedId = await ctx.db.insert("assignments", {
        projectId: ctx.projectId,
        creatorId: args.creatorId,
        scriptCombo: verbatimCombo
          ? {
              // COPIE du combo figé source (texte verbatim + ids + campagne source),
              // sans editedOnce (verrou de correction propre à la source).
              campaignId: verbatimCombo.combo.campaignId,
              hookBrickId: verbatimCombo.combo.hookBrickId,
              ...(verbatimCombo.combo.corpsBrickId
                ? { corpsBrickId: verbatimCombo.combo.corpsBrickId }
                : {}),
              fluxBrickId: verbatimCombo.combo.fluxBrickId,
              ctaBrickId: verbatimCombo.combo.ctaBrickId,
              assembledScript: verbatimCombo.combo.assembledScript,
            }
          : {
              campaignId: args.campaignId,
              hookBrickId: combo.hookBrickId,
              fluxBrickId: combo.fluxBrickId,
              ctaBrickId: combo.ctaBrickId,
              assembledScript: combo.assembledScript,
            },
        // Verbatim → comboKey EXACT de la source (gère le legacy 4 segments) ;
        // sinon signature des 3 briques choisies.
        comboKey: verbatimCombo ? verbatimCombo.comboKey : comboKeyOf(combo),
        // Rejeu / choix manuel — flag + lignage (undefined en auto → 0 bruit).
        ...(args.imposedCombo || verbatimCombo ? { comboImposed: true } : {}),
        ...(args.replayedFrom !== undefined
          ? { replayedFrom: args.replayedFrom }
          : {}),
        ...(args.replayVerbatim ? { replayVerbatim: true } : {}),
        targets,
        dueDate: args.dueDate,
        status: managed ? "to_publish" : "todo",
        // Dénormalisation (undefined si non géré → 0 bruit sur les rows normales).
        managedByAdmin: managed ? true : undefined,
        rateSnapshot,
        pricingSnapshot,
        overlayText,
        // Undefined si aucune pièce jointe → rows inchangées vs aujourd'hui.
        ...(linkedFolderIds.length > 0
          ? { assetFolderIds: linkedFolderIds }
          : {}),
        ...(linkedModelVideos.length > 0
          ? { modelVideos: linkedModelVideos }
          : {}),
        // Date de post planifiée (undefined si non planifiée → row inchangée).
        ...(postDate !== undefined ? { postDate } : {}),
        createdAt: now,
      });
      if (firstAssignmentId === null) firstAssignmentId = insertedId;
      created++;
    }
    // 6e événement email — UNE notification par appel (donc par créateur), même
    // quand N vidéos sont créées. En assignation de MASSE, le bulk boucle sur
    // cette mutation → un envoi planifié par créateur, parallèles et hors
    // transaction : 30 assignations ne ralentissent ni ne font échouer la boucle.
    // Cibles GÉRÉES par l'équipe : le créateur n'a rien à produire, pas de mail.
    if (firstAssignmentId !== null && !managed) {
      await ctx.scheduler.runAfter(0, internal.emails.sendAssignmentCreated, {
        assignmentId: firstAssignmentId,
        count: created,
      });
    }
    return { created, shortages, totalCombos };
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

    // Garde unicité (comboKey, créateur, plateforme) : le nouveau combo ne doit
    // pas déjà être pris par un AUTRE assignment du même créateur sur l'une des
    // plateformes ciblées par CET assignment.
    await assertComboFreeForCreatorPlatforms(ctx, {
      comboKey,
      creatorId: a.creatorId,
      platforms: (a.targets ?? []).map((t) => t.platform),
      excludeAssignmentId: a._id,
    });

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

const MAX_BRICK_TEXT = 2000;

/**
 * Édite le TEXTE d'UNE brique (hook | flux | cta) sur un assignment : FORKE une
 * NOUVELLE brique en bibliothèque (même kind + tier, texte modifié, active,
 * même campagne) et l'applique au combo. La brique d'origine reste INTACTE.
 *
 * MÊMES gardes + MÊME verrou que editScriptCombo (#48 — flag editedOnce partagé) :
 * UNE SEULE édition par assignment (remplacement OU édition de texte), et
 * UNIQUEMENT avant soumission/publication. Re-fige assembledScript + comboKey
 * (assembleNoLabels → rendu créateur labels:false). pricingSnapshot INCHANGÉ.
 * La brique forkée démarre vierge côté analytics (nouvelle brique).
 */
export const editScriptBrickText = adminMutation({
  args: {
    id: v.id("assignments"),
    slot: SLOT,
    newText: v.string(),
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
    const text = args.newText.trim();
    if (text.length === 0) {
      throw new ConvexError("Le texte de la brique est requis.");
    }
    if (text.length > MAX_BRICK_TEXT) {
      throw new ConvexError(`Texte trop long (max ${MAX_BRICK_TEXT} caractères).`);
    }

    // Brique d'origine du slot → on en HÉRITE kind + tier (jamais écrasée).
    const currentId =
      args.slot === "hook"
        ? combo.hookBrickId
        : args.slot === "flux"
          ? combo.fluxBrickId
          : combo.ctaBrickId;
    const orig = await ctx.db.get(currentId);
    if (!orig) {
      throw new ConvexError("Brique d'origine introuvable.");
    }

    // FORK : nouvelle brique en bibliothèque (même kind + tier, texte modifié).
    const forkedId = await ctx.db.insert("scriptBricks", {
      projectId: ctx.projectId,
      campaignId: combo.campaignId,
      kind: orig.kind,
      label: `${orig.label} (variante)`,
      content: text,
      tier: orig.tier, // hérite (undefined si non-hook)
      active: true,
      createdAt: Date.now(),
    });

    const hookBrickId = args.slot === "hook" ? forkedId : combo.hookBrickId;
    const fluxBrickId = args.slot === "flux" ? forkedId : combo.fluxBrickId;
    const ctaBrickId = args.slot === "cta" ? forkedId : combo.ctaBrickId;

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
    // Unicité (comboKey, créateur, plateforme) : le fork crée une brique NEUVE
    // (brickId inédit) → comboKey forcément unique → aucune collision possible
    // avec un assignment existant. Pas de garde nécessaire ici (cf #53).
    const comboKey = comboKeyOf({ hookBrickId, fluxBrickId, ctaBrickId });

    await ctx.db.patch(args.id, {
      scriptCombo: {
        campaignId: combo.campaignId,
        hookBrickId,
        fluxBrickId,
        ctaBrickId,
        assembledScript,
        editedOnce: true, // verrou PARTAGÉ avec editScriptCombo (#48)
      },
      comboKey,
      // pricingSnapshot, rateSnapshot, status… : STRICTEMENT inchangés.
    });
    return { ok: true, forkedBrickId: forkedId, comboKey };
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

/**
 * Passage à 2 tiers (Argent/Autre) : reclasse TOUS les hooks tier "B" en "A".
 * PATCH du seul champ `tier` (même _id) → n'altère AUCUN assembledScript figé,
 * combo, assignment ni snapshot analytics (le tier d'une pub est re-résolu à
 * l'affichage depuis hookBrickId : un ex-"B" affichera « Autre », ce qui est
 * voulu). Tourne sur TOUS les projets (internalMutation, pas de ctx.projectId).
 *
 * IDEMPOTENTE : relançable sans effet (no-op s'il ne reste aucun "B"). À lancer
 * APRÈS le deploy du code 2-tiers (même PR) :
 *   npx convex run scripts:migrateTierBToA --prod
 */
async function reclassTierBToA(
  ctx: MutationCtx,
): Promise<{ migrated: number }> {
  const all = await ctx.db.query("scriptBricks").collect();
  let migrated = 0;
  for (const b of all) {
    if (b.tier !== "B") continue;
    await ctx.db.patch(b._id, { tier: "A" });
    migrated++;
  }
  return { migrated };
}

export const migrateTierBToA = internalMutation({
  args: {},
  handler: (ctx) => reclassTierBToA(ctx),
});

/** Variante e2e (gated E2E_SECRET) pour prouver la migration en test. */
export const e2eMigrateTierBToA = e2eMutation({
  args: {},
  handler: (ctx) => reclassTierBToA(ctx),
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

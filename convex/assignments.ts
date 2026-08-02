import {
  adminMutation,
  adminQuery,
  adminViewAsQuery,
  creatorMutation,
  creatorQuery,
  e2eMutation,
} from "./functions";
import { withResolvedExamples } from "./formats";
import { isFormatAllowedOnPlatform } from "./publications";
import { tierLabel } from "./scriptTier";
import { SNYTCH_SLUG } from "./projects";
import {
  CREATOR_ASSIGNMENT_FIELDS,
  pickCreatorAssignment,
} from "./creatorAssignmentFields";
import {
  accrueBaseLineItem,
  upsertBonusLineItem,
  computeEarnings,
  getOrCreatePayment,
  periodOf,
} from "./payments";
import {
  assignmentViewsAndMetrics,
  buildPricingSnapshot,
  syncBonusUnlocks,
} from "./pricing";
import { isAccountAvailable } from "./warmup";
import { isSnytchProject } from "./projects";
// Statuts « balle au créateur » — source unique partagée avec le cron de rappel.
import { UNFINISHED_STATUSES } from "./emails";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * P7 Portail créateur — assignments. ISOLATION serveur non négociable : toutes
 * les fonctions creator (creatorQuery/creatorMutation) ne renvoient/touchent
 * QUE les rows du creator courant (ctx.creatorId). Les fonctions admin
 * (adminQuery/adminMutation) sont inaccessibles au rôle creator.
 */

type Plateforme = "TikTok" | "Instagram" | "YouTube";

const plateformeValidator = v.union(
  v.literal("TikTok"),
  v.literal("Instagram"),
  v.literal("YouTube"),
);

/** Cible d'assignment à la création : 1 compte (du créateur) sur 1 plateforme. */
export const targetInputValidator = v.object({
  platform: plateformeValidator,
  accountId: v.id("comptes"),
});

/** Détection plateforme depuis l'URL (réplique serveur minimale, règle A6 —
 *  lib/inspiration-url ne peut pas être importée dans convex/). */
function detectPlatform(url: string): Plateforme | undefined {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com")) return "TikTok";
  if (u.includes("instagram.com")) return "Instagram";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "YouTube";
  return undefined;
}

/**
 * Chantier C — valide les CIBLES d'un assignment à la création : 1 à 3 cibles,
 * plateformes UNIQUES, chaque compte appartenant AU créateur (et au projet), de
 * la BONNE plateforme, et DISPONIBLE (isAccountAvailable = warmup terminé). Un
 * compte en warmup ne peut JAMAIS être une cible.
 */
export async function validateTargets(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  targets: { platform: Plateforme; accountId: Id<"comptes"> }[],
): Promise<void> {
  if (targets.length < 1 || targets.length > 3) {
    throw new ConvexError("Un assignment porte 1 à 3 cibles (plateformes).");
  }
  // Gate STRICT pour Snytch : un compte n'est ciblable que s'il est "actif"
  // (validé admin). Hors Snytch : régime lenient historique (warmup terminé
  // suffit) → gating RepackIt inchangé.
  const strict = await isSnytchProject(ctx, projectId);
  const seen = new Set<Plateforme>();
  for (const t of targets) {
    if (seen.has(t.platform)) {
      throw new ConvexError(
        `Une seule cible par plateforme (${t.platform} en double).`,
      );
    }
    seen.add(t.platform);
    const compte = await ctx.db.get(t.accountId);
    if (
      !compte ||
      compte.projectId !== projectId ||
      compte.creatorId !== creatorId
    ) {
      throw new ConvexError("Compte cible introuvable pour ce créateur.");
    }
    if (compte.plateforme !== t.platform) {
      throw new ConvexError(
        `Le compte ${compte.handle} n'est pas un compte ${t.platform}.`,
      );
    }
    if (!isAccountAvailable(compte, { strict })) {
      throw new ConvexError(
        `Le compte ${compte.handle} n'est pas disponible (warmup en cours ou compte non validé).`,
      );
    }
  }
}

/**
 * Comptes GÉRÉS PAR L'ÉQUIPE — SOURCE UNIQUE de détection des cibles gérées,
 * PARTAGÉE par assignFormat ET assignScriptCampaign. (Extraite pour tuer la
 * dérive #107 : le court-circuit géré n'avait été posé que sur le chemin format,
 * laissant le chemin script — primaire côté Snytch — insérer en dur `todo` sans
 * flag.) IMPOSE l'homogénéité : une mission ne mélange pas cibles gérées et non
 * gérées (sinon « qui publie ? » est ambigu). Appelée APRÈS validateTargets
 * (existence/appartenance/disponibilité déjà garanties) ; (projectId, creatorId)
 * re-vérifiés en défense en profondeur, MÊME rejet que validateTargets →
 * behavior-preserving. Renvoie `managed` : true ⇒ l'assignment part DIRECT en
 * to_publish + managedByAdmin (l'admin publie), false ⇒ workflow créateur normal.
 */
export async function resolveManagedTargets(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  targets: { platform: Plateforme; accountId: Id<"comptes"> }[],
): Promise<{ managed: boolean }> {
  const comptes = await Promise.all(targets.map((t) => ctx.db.get(t.accountId)));
  let managedCount = 0;
  for (const compte of comptes) {
    if (
      !compte ||
      compte.projectId !== projectId ||
      compte.creatorId !== creatorId
    ) {
      throw new ConvexError("Compte cible introuvable pour ce créateur.");
    }
    if (compte.managedByAdmin) managedCount++;
  }
  if (managedCount > 0 && managedCount < targets.length) {
    throw new ConvexError(
      "Un assignment ne peut pas mélanger des comptes gérés par l'équipe et des comptes créateur.",
    );
  }
  return { managed: managedCount > 0 };
}

// ─── Admin ─────────────────────────────────────────────────────────────────

/**
 * Créateurs assignables : onboardés (userId posé) et au travail (status
 * active ou onboarding). Exclut invited (pas de compte), paused, churned.
 */
export const listAssignableCreators = adminQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return creators
      .filter(
        (c) =>
          c.userId !== undefined &&
          (c.status === "active" || c.status === "onboarding"),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map((c) => ({ _id: c._id, name: c.name, status: c.status }));
  },
});

/**
 * Assignation EN MASSE — créateurs assignables AVEC leurs comptes DISPONIBLES.
 *
 * Mêmes règles que l'existant, pas de dérive : éligibilité créateur identique à
 * listAssignableCreators (onboardé + actif/onboarding), disponibilité de compte
 * identique à listCreatorAvailableComptes (isAccountAvailable, strict pour Snytch).
 *
 * Sert au picker multi-créateurs : l'admin choisit des PLATEFORMES (et non des
 * comptes, qui sont propres à chaque créateur), et chaque créateur sélectionné est
 * assigné sur SON compte disponible de chacune de ces plateformes. Un créateur sans
 * compte disponible sur les plateformes choisies est signalé INÉLIGIBLE côté UI
 * plutôt que de le laisser échouer à l'assignation.
 */
export const listAssignableCreatorsWithAccounts = adminQuery({
  args: {},
  handler: async (ctx) => {
    const strict = await isSnytchProject(ctx, ctx.projectId);
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const assignable = creators
      .filter(
        (c) =>
          c.userId !== undefined &&
          (c.status === "active" || c.status === "onboarding"),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const out = [];
    for (const c of assignable) {
      const comptes = await ctx.db
        .query("comptes")
        .withIndex("by_project_creator", (q) =>
          q.eq("projectId", ctx.projectId).eq("creatorId", c._id),
        )
        .collect();
      out.push({
        _id: c._id,
        name: c.name,
        status: c.status,
        accounts: comptes
          .filter((a) => isAccountAvailable(a, { strict }))
          .map((a) => ({
            _id: a._id,
            handle: a.handle,
            plateforme: a.plateforme,
          }))
          .sort((a, b) =>
            a.handle.localeCompare(b.handle, "fr", { sensitivity: "base" }),
          ),
      });
    }
    return out;
  },
});

/**
 * Chantier C — assignation d'un FORMAT à UN créateur, sur 1 à 3 CIBLES
 * (1 compte par plateforme, choisi parmi ses comptes DISPONIBLES). `postsPerCreator`
 * vidéos → autant de rows "todo", chacune portant les MÊMES cibles (1 vidéo →
 * N posts). rateSnapshot = copie figée du rateModel (appliqué PAR post).
 */
/** Longueur max d'une phrase d'overlay (une phrase courte à incruster). */
export const OVERLAY_MAX_LENGTH = 200;

/**
 * Normalise le texte overlay : trim, vide → undefined (pas d'overlay), tronqué à
 * OVERLAY_MAX_LENGTH. Trivial et SANS réplique lib (pas d'A6) — partagé par
 * assignFormat / assignScriptCampaign / setAssignmentOverlayText.
 */
export function normalizeOverlayText(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (t.length === 0) return undefined;
  return t.length > OVERLAY_MAX_LENGTH ? t.slice(0, OVERLAY_MAX_LENGTH) : t;
}

// Instructions libres (multi-ligne) admin → créatrice : plafond plus large que
// l'overlay (une phrase) car ce sont des consignes de tournage/montage.
export const INSTRUCTIONS_MAX_LENGTH = 1000;

/**
 * Normalise les instructions : trim, vide → undefined (aucun bloc côté créatrice),
 * tronqué à INSTRUCTIONS_MAX_LENGTH. Les retours à la ligne internes sont
 * CONSERVÉS (consigne multi-ligne). Même patron que normalizeOverlayText.
 */
export function normalizeInstructions(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (t.length === 0) return undefined;
  return t.length > INSTRUCTIONS_MAX_LENGTH ? t.slice(0, INSTRUCTIONS_MAX_LENGTH) : t;
}

export const assignFormat = adminMutation({
  args: {
    formatId: v.id("formats"),
    creatorId: v.id("creators"),
    targets: v.array(targetInputValidator),
    postsPerCreator: v.number(),
    dueDate: v.number(),
    // Nouveau modèle de paie : pricing FIGÉ à l'attribution (Guard A). Optionnel
    // → absent = ancien modèle (rateSnapshot legacy), dual-mode.
    pricingId: v.optional(v.id("pricings")),
    // Texte overlay optionnel à incruster en haut de la vidéo (cf schema).
    overlayText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const format = await ctx.db.get(args.formatId);
    if (!format || format.projectId !== ctx.projectId) {
      throw new ConvexError("Format introuvable.");
    }
    if (format.status === "archived") {
      throw new ConvexError("Format archivé : réactive-le pour l'assigner.");
    }
    if (
      !Number.isInteger(args.postsPerCreator) ||
      args.postsPerCreator < 1 ||
      args.postsPerCreator > 50
    ) {
      throw new ConvexError("Nombre de vidéos invalide (1–50).");
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
    await validateTargets(ctx, ctx.projectId, args.creatorId, args.targets);
    // Compat format/plateforme (non-custom) pour CHAQUE cible.
    if (format.type !== "custom") {
      for (const t of args.targets) {
        if (!isFormatAllowedOnPlatform(format.type, t.platform)) {
          throw new ConvexError(
            `Le format « ${format.name} » (${format.type}) ne peut pas être publié sur ${t.platform}.`,
          );
        }
      }
    }
    const targets = args.targets.map((t) => ({
      platform: t.platform,
      accountId: t.accountId,
    }));
    // ─── Comptes GÉRÉS PAR L'ÉQUIPE (D1/D2) ──────────────────────────────────
    // Cibles gérées ⇒ assignment créé DIRECT en to_publish (saut de todo/…/review
    // — l'admin publie via confirmPublicationAsAdmin) + flag DÉNORMALISÉ copié du
    // compte. Détection + homogénéité déléguées au helper PARTAGÉ (même source que
    // assignScriptCampaign — plus de dérive possible).
    const { managed } = await resolveManagedTargets(
      ctx,
      ctx.projectId,
      args.creatorId,
      args.targets,
    );
    const pricingSnapshot = args.pricingId
      ? await buildPricingSnapshot(ctx, ctx.projectId, args.pricingId)
      : undefined;
    const overlayText = normalizeOverlayText(args.overlayText);
    const now = Date.now();
    let created = 0;
    let firstAssignmentId: Id<"assignments"> | null = null;
    for (let i = 0; i < args.postsPerCreator; i++) {
      const insertedId = await ctx.db.insert("assignments", {
        projectId: ctx.projectId,
        creatorId: args.creatorId,
        formatId: args.formatId,
        targets,
        dueDate: args.dueDate,
        status: managed ? "to_publish" : "todo",
        // Dénormalisation D1 (undefined si non géré → 0 bruit sur les rows normales).
        managedByAdmin: managed ? true : undefined,
        rateSnapshot: format.rateModel,
        pricingSnapshot,
        overlayText,
        createdAt: now,
      });
      if (firstAssignmentId === null) firstAssignmentId = insertedId;
      created++;
    }
    // 6e événement email — une seule notification par appel (cf assignScriptCampaign).
    // Cibles gérées par l'équipe : pas de mail (rien à produire côté créateur).
    if (firstAssignmentId !== null && !managed) {
      await ctx.scheduler.runAfter(0, internal.emails.sendAssignmentCreated, {
        assignmentId: firstAssignmentId,
        count: created,
      });
    }
    return { created };
  },
});

/**
 * Édite le texte overlay d'un assignment EXISTANT (ajout/modif/effacement).
 * Admin only, scopé projet. overlayText absent/vide → efface l'overlay (undefined).
 */
export const setAssignmentOverlayText = adminMutation({
  args: {
    id: v.id("assignments"),
    overlayText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    await ctx.db.patch(args.id, {
      overlayText: normalizeOverlayText(args.overlayText),
    });
    return { ok: true };
  },
});

/**
 * Édite les INSTRUCTIONS libres (consigne créatrice) d'un assignment EXISTANT
 * (ajout / modif / effacement). Admin only, scopé projet. Propre à CETTE
 * assignation (jamais partagé entre créatrices d'un même script). instructions
 * absent/vide → efface (undefined → aucun bloc côté créatrice). Même patron que
 * setAssignmentOverlayText.
 */
export const setAssignmentInstructions = adminMutation({
  args: {
    id: v.id("assignments"),
    instructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    await ctx.db.patch(args.id, {
      instructions: normalizeInstructions(args.instructions),
    });
    return { ok: true };
  },
});

/**
 * Édite la DATE DE PUBLICATION planifiée (postDate) d'un assignment EXISTANT.
 * Admin only, scopé projet. `postDate` absent → efface la date (undefined).
 * Distincte de dueDate (production) : les deux coexistent. Permet de replanifier
 * après coup depuis la page Assignments (édition simple par ligne).
 */
export const setAssignmentPostDate = adminMutation({
  args: {
    id: v.id("assignments"),
    postDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    await ctx.db.patch(args.id, { postDate: args.postDate });
    return { ok: true };
  },
});

// ─── Vidéos modèles (liens à reproduire) — gérées par l'admin, vues créateur ──
// Liens vers des vidéos existantes que le créateur doit reproduire avec son
// script. Ajout/suppression à l'unité APRÈS l'assignation. PAS de fichiers
// (l'hébergement d'assets est un autre chantier). La plateforme est dérivée de
// l'URL CÔTÉ UI (lib/inspiration-url) — non stockée ici.

const MAX_MODEL_VIDEOS = 20;

/** Réplique de lib/model-videos.normalizeModelVideoUrl (règle A6). */
function normalizeModelVideoUrlServer(raw: string): string | null {
  const url = raw.trim();
  if (url.length === 0) return null;
  if (!/^https?:\/\/\S+/i.test(url)) return null;
  return url;
}

/**
 * Construit une liste d'items « vidéos modèles » à partir d'entrées
 * {url, title?, note?} — MÊME logique que addModelVideoToAssignment (normalisation
 * d'URL, dédoublonnage par URL, plafond MAX_MODEL_VIDEOS), mais en LOT pour
 * l'attachement à la CRÉATION (assignScriptCampaign). Chaque item reçoit un id +
 * addedAt. Throw ConvexError sur URL invalide ou dépassement. Partagé pour que
 * « attaché pendant l'assignation » et « attaché après » produisent la MÊME
 * structure (assignments.modelVideos).
 */
export function buildModelVideoItemsServer(
  inputs: { url: string; title?: string; note?: string }[],
): {
  id: string;
  url: string;
  title?: string;
  note?: string;
  addedAt: number;
}[] {
  const now = Date.now();
  const seen = new Set<string>();
  const items: {
    id: string;
    url: string;
    title?: string;
    note?: string;
    addedAt: number;
  }[] = [];
  for (const input of inputs) {
    const url = normalizeModelVideoUrlServer(input.url);
    if (!url) {
      throw new ConvexError(
        "L'URL d'une vidéo modèle est invalide (lien http(s) attendu).",
      );
    }
    if (seen.has(url)) continue; // dédoublonnage par URL (idempotent)
    seen.add(url);
    if (items.length >= MAX_MODEL_VIDEOS) {
      throw new ConvexError(`Trop de vidéos modèles (max ${MAX_MODEL_VIDEOS}).`);
    }
    const title = input.title?.trim();
    const note = input.note?.trim();
    items.push({
      id: crypto.randomUUID(),
      url,
      ...(title ? { title } : {}),
      ...(note ? { note } : {}),
      addedAt: now,
    });
  }
  return items;
}

/** Récupère un assignment du projet courant ou rejette (isolation projet). */
async function requireProjectAssignment(
  ctx: MutationCtx,
  id: Id<"assignments">,
  projectId: Id<"projects">,
): Promise<Doc<"assignments">> {
  const a = await ctx.db.get(id);
  if (!a || a.projectId !== projectId) {
    throw new ConvexError("Assignment introuvable.");
  }
  return a;
}

/** Attache une vidéo modèle (lien) à un assignment. Admin only, scopé projet. */
export const addModelVideoToAssignment = adminMutation({
  args: {
    id: v.id("assignments"),
    url: v.string(),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const a = await requireProjectAssignment(ctx, args.id, ctx.projectId);
    const url = normalizeModelVideoUrlServer(args.url);
    if (!url) {
      throw new ConvexError(
        "L'URL de la vidéo modèle est invalide (lien http(s) attendu).",
      );
    }
    const existing = a.modelVideos ?? [];
    // Dédoublonnage par URL (les 2 voies UI — URL libre + inspiration — peuvent
    // viser le même lien) : no-op idempotent, on renvoie l'entrée existante.
    const dup = existing.find((mv) => mv.url === url);
    if (dup) return { id: dup.id, duplicate: true };
    if (existing.length >= MAX_MODEL_VIDEOS) {
      throw new ConvexError(`Trop de vidéos modèles (max ${MAX_MODEL_VIDEOS}).`);
    }
    const title = args.title?.trim();
    const note = args.note?.trim();
    const item = {
      id: crypto.randomUUID(),
      url,
      ...(title ? { title } : {}),
      ...(note ? { note } : {}),
      addedAt: Date.now(),
    };
    await ctx.db.patch(args.id, { modelVideos: [...existing, item] });
    return { id: item.id, duplicate: false };
  },
});

/** Retire une vidéo modèle d'un assignment (à l'unité). Admin only, scopé projet. */
export const removeModelVideoFromAssignment = adminMutation({
  args: { id: v.id("assignments"), videoId: v.string() },
  handler: async (ctx, args) => {
    const a = await requireProjectAssignment(ctx, args.id, ctx.projectId);
    const next = (a.modelVideos ?? []).filter((mv) => mv.id !== args.videoId);
    await ctx.db.patch(args.id, { modelVideos: next });
    return { ok: true };
  },
});

/**
 * Dossiers d'assets liés à un assignment — lecture DUAL (migration single→array).
 * `assetFolderIds` (nouveau, multi) prime ; sinon fallback sur le legacy
 * `assetFolderId` (single). Source UNIQUE pour toutes les lectures (admin +
 * créateur) → les liens existants restent valides avant la migration.
 * Réplique de lib/asset-folders.resolveLinkedFolderIds (règle A6 ; tests Vitest).
 */
function effectiveAssetFolderIds(a: Doc<"assignments">): Id<"assetFolders">[] {
  if (a.assetFolderIds !== undefined) return a.assetFolderIds;
  return a.assetFolderId ? [a.assetFolderId] : [];
}

/**
 * Valide + dédoublonne une liste de dossiers d'assets pour un projet : chaque
 * dossier doit exister ET appartenir au projet, sinon ConvexError. Renvoie la
 * liste dédoublonnée (ordre d'entrée préservé). Partagé par setAssetFolders
 * (attachement manuel) et assignScriptCampaign (attachement à la création) → un
 * seul mécanisme de lien assignment ↔ dossiers d'assets.
 */
export async function validateProjectFolderIds(
  ctx: MutationCtx,
  folderIds: Id<"assetFolders">[],
  projectId: Id<"projects">,
): Promise<Id<"assetFolders">[]> {
  const seen = new Set<string>();
  const valid: Id<"assetFolders">[] = [];
  for (const fid of folderIds) {
    if (seen.has(fid)) continue;
    seen.add(fid);
    const folder = await ctx.db.get(fid);
    if (!folder || folder.projectId !== projectId) {
      throw new ConvexError("Dossier d'assets introuvable.");
    }
    valid.push(fid);
  }
  return valid;
}

/**
 * Définit l'ensemble des dossiers d'assets liés à un assignment (MULTI). Remplace
 * toute la liste (le multi-select admin soumet l'ensemble) ; [] = délié. Admin
 * only, scopé projet : chaque dossier doit appartenir au projet de l'assignment.
 * Dédoublonne et UNSET le legacy assetFolderId (la source devient assetFolderIds).
 */
export const setAssetFolders = adminMutation({
  args: {
    id: v.id("assignments"),
    folderIds: v.array(v.id("assetFolders")),
  },
  handler: async (ctx, args) => {
    await requireProjectAssignment(ctx, args.id, ctx.projectId);
    const valid = await validateProjectFolderIds(
      ctx,
      args.folderIds,
      ctx.projectId,
    );
    await ctx.db.patch(args.id, {
      assetFolderIds: valid,
      assetFolderId: undefined, // la source unique devient assetFolderIds
    });
    return { ok: true, count: valid.length };
  },
});

/**
 * MIGRATION single→array : convertit assetFolderId (legacy) en assetFolderIds:
 * [id] + unset le legacy. IDEMPOTENTE (saute les rows déjà migrées / sans lien).
 * Tourne sur TOUS les projets. À lancer après le deploy du code dual-read :
 *   npx convex run assignments:migrateAssetFolderToArray --prod
 */
export const migrateAssetFolderToArray = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("assignments").collect();
    let migrated = 0;
    for (const a of all) {
      if (a.assetFolderIds !== undefined) continue; // déjà migré
      if (!a.assetFolderId) continue; // aucun lien à convertir
      await ctx.db.patch(a._id, {
        assetFolderIds: [a.assetFolderId],
        assetFolderId: undefined,
      });
      migrated++;
    }
    return { migrated };
  },
});

/**
 * RÉPLIQUE serveur de lib/assignment-delete.canDeleteAssignment (règle A6 :
 * convex/ ne peut pas importer lib/). DOIT rester alignée. Statuts pré-publication
 * (sans publication matérialisée ni lineItem de paie) → hard-delete sûr. published
 * /paid (+ legacy validated) sont BLOQUÉS : ils portent une publication (analytics)
 * et/ou un paiement → les supprimer orphelinerait l'historique financier.
 */
export const DELETABLE_STATUSES = new Set<string>([
  "todo",
  "in_progress",
  "video_submitted",
  "video_rejected",
  "to_publish",
  "submitted", // legacy
  "rejected", // legacy
]);

/**
 * Purge best-effort la vidéo soumise orpheline d'un assignment (blob Convex +
 * copie Cloudflare Stream, no-op si env absent) PUIS hard-delete la row — ce qui
 * LIBÈRE son comboKey (l'unicité créateur+plateforme est purement basée sur
 * l'existence de la row, cf by_creator_combo). Partagé par deleteAssignment
 * (unitaire) et deleteCreator (cascade) — source unique du nettoyage vidéo.
 * N'effectue AUCUNE garde de statut : l'appelant filtre les statuts supprimables.
 */
export async function purgeAndDeleteAssignment(
  ctx: MutationCtx,
  a: Doc<"assignments">,
): Promise<void> {
  if (a.submittedVideoStorageId) {
    await ctx.storage.delete(a.submittedVideoStorageId);
  }
  if (a.submittedVideoStreamUid) {
    await ctx.scheduler.runAfter(
      0,
      internal.cloudflareStream.deleteStreamAsset,
      { uid: a.submittedVideoStreamUid },
    );
  }
  await ctx.db.delete(a._id);
}

/**
 * SUPPRESSION manuelle d'un assignment (admin) — HARD-DELETE. Libère le comboKey
 * occupé (unicité créateur+plateforme : plus d'assignment = plus d'occupation →
 * le combo redevient assignable). Scopé projet ; admin only.
 *
 * GARDE-FOU statut : refuse published/paid (+ legacy validated) — historique
 * financier/analytics rattaché (publication, snapshots, paiement). Les statuts
 * pré-publication sont librement supprimables (cas d'usage : refaire un lot mal
 * généré).
 *
 * NETTOYAGE best-effort de la vidéo SOUMISE orpheline : blob Convex (storage.delete)
 * + copie Cloudflare Stream (scheduler deleteStreamAsset, no-op si env absent),
 * comme la purge à la re-soumission/publication. Les ASSETS liés (modelVideos =
 * liens ; assetFolderIds = dossiers PARTAGÉS réutilisables) ne sont PAS supprimés —
 * on détache seulement en supprimant l'assignment. Aucune publication n'existe à ce
 * stade (statut pré-published) → rien à cascader.
 *
 * IDEMPOTENT : id déjà supprimé / hors projet → no-op (`alreadyGone`), jamais de crash.
 */
export const deleteAssignment = adminMutation({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    // Déjà supprimé OU hors projet (isolation) → no-op silencieux, pas de crash.
    if (!a || a.projectId !== ctx.projectId) {
      return { ok: true as const, alreadyGone: true };
    }
    if (!DELETABLE_STATUSES.has(a.status)) {
      throw new ConvexError(
        "Un assignment publié ou payé ne peut pas être supprimé (historique financier/analytics).",
      );
    }
    // Purge vidéo orpheline (Convex + Stream) + hard-delete → comboKey libéré.
    await purgeAndDeleteAssignment(ctx, a);
    return { ok: true as const, alreadyGone: false };
  },
});

/** Table admin : tous les assignments du projet, enrichis. */
/**
 * Date de publication RÉELLE représentative d'un assignment (= CONFIRMATION,
 * décision cadrée du chantier calendrier) : la PLUS ANCIENNE date parmi ses cibles
 * (target.publishedAt, posée par confirmPublication), sinon le legacy top-level
 * a.publishedAt, sinon null (pas publié). Sert au statut CALENDRIER (brique B).
 * confirmPublication horodate TOUTES les cibles au même instant → min = max en
 * pratique ; le min ne diffère que si des cibles sont confirmées séparément.
 *
 * ⚠️ Règle A6 — RÉPLIQUE de lib/calendar-status.representativePostedAt (convex/ ne
 * peut pas importer lib/). Toute évolution ici DOIT l'être là-bas (tests Vitest).
 */
function representativePostedAt(a: Doc<"assignments">): number | null {
  const stamps = (a.targets ?? [])
    .map((t) => t.publishedAt)
    .filter((x): x is number => typeof x === "number");
  if (stamps.length > 0) return Math.min(...stamps);
  return typeof a.publishedAt === "number" ? a.publishedAt : null;
}

export const listAssignments = adminQuery({
  args: {},
  handler: async (ctx) => {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const [
      creators,
      formats,
      comptes,
      campaigns,
      scriptBricks,
      assetFolders,
      assets,
    ] = await Promise.all([
        ctx.db
          .query("creators")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("formats")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("comptes")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("scriptCampaigns")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("scriptBricks")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("assetFolders")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("assets")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
      ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    const compteMap = new Map(comptes.map((c) => [c._id, c.handle]));
    // Pays CIBLÉ par compte (label informatif) → drapeau FR/US par post au
    // calendrier de pilotage. Additif ; absent = pas de drapeau affiché.
    const compteCountryMap = new Map(
      comptes.map((c) => [c._id, c.targetCountry ?? null]),
    );
    const campaignMap = new Map(campaigns.map((c) => [c._id, c.name]));
    const brickMap = new Map(scriptBricks.map((b) => [b._id, b]));
    const assetFolderMap = new Map(assetFolders.map((f) => [f._id, f.name]));
    const assetCountByFolder = new Map<string, number>();
    for (const a of assets) {
      assetCountByFolder.set(
        a.folderId,
        (assetCountByFolder.get(a.folderId) ?? 0) + 1,
      );
    }
    return assignments
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((a) => {
        // S2 — résumé combo (ADMIN voit la décomposition ; le créateur, non).
        let scriptCampaignName: string | null = null;
        let comboSummary: string | null = null;
        if (a.scriptCombo) {
          scriptCampaignName =
            campaignMap.get(a.scriptCombo.campaignId) ?? "—";
          const hook = brickMap.get(a.scriptCombo.hookBrickId);
          const flux = brickMap.get(a.scriptCombo.fluxBrickId);
          const cta = brickMap.get(a.scriptCombo.ctaBrickId);
          comboSummary = `${tierLabel(hook?.tier)} · ${flux?.label ?? "?"} · ${cta?.label ?? "?"}`;
        }
        // Chantier C — cibles enrichies (handle + pays + URL par plateforme).
        const targets = (a.targets ?? []).map((t) => ({
          platform: t.platform,
          accountHandle: t.accountId
            ? (compteMap.get(t.accountId) ?? null)
            : null,
          // Pays du compte cible (drapeau FR/US par post au calendrier).
          country: t.accountId
            ? (compteCountryMap.get(t.accountId) ?? null)
            : null,
          publishedUrl: t.publishedUrl ?? null,
        }));
        const linkedAssetFolderIds = effectiveAssetFolderIds(a);
        return {
          ...a,
          creatorName: creatorMap.get(a.creatorId) ?? a.creatorNameSnapshot ?? "—",
          formatName: a.formatId ? (formatMap.get(a.formatId) ?? "—") : null,
          targets,
          origin: (a.scriptCombo ? "script" : "format") as "script" | "format",
          scriptCampaignName,
          comboSummary,
          // Date de publication réelle (confirmation) → statut calendrier (B) et
          // vue calendrier (C). null si pas encore publié.
          postedAt: representativePostedAt(a),
          // Assets — N dossiers liés (badge admin). linkedFolderIds = source
          // résolue (dual-read) pour pré-cocher la modale ; total = somme des
          // fichiers across dossiers liés.
          linkedFolderIds: linkedAssetFolderIds,
          assetFolderNames: linkedAssetFolderIds
            .map((id) => assetFolderMap.get(id))
            .filter((n): n is string => n !== undefined),
          assetFolderCount: linkedAssetFolderIds.reduce(
            (sum, id) => sum + (assetCountByFolder.get(id) ?? 0),
            0,
          ),
        };
      });
  },
});

/** Compteur d'assignments "video_submitted" — badge sidebar de la file de revue. */
export const countVideoSubmitted = adminQuery({
  args: {},
  handler: async (ctx) => {
    const subs = await ctx.db
      .query("assignments")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", ctx.projectId).eq("status", "video_submitted"),
      )
      .collect();
    return subs.length;
  },
});

/**
 * Matérialise la publication d'un assignment de SCRIPT et y RACCORDE le combo
 * (analytics S3). Un script = vidéo verticale → mediaType "short". `opts` porte
 * l'URL/plateforme/date du POST PUBLIÉ (résolus à l'étape `published`).
 *
 * Type de retour ANNOTÉ (ctx.runMutation(internal.*) → TS7022). NE PAS retirer.
 */
async function materializeScriptPublication(
  ctx: MutationCtx,
  a: Doc<"assignments">,
  projectId: Id<"projects">,
  opts: { url: string; platform: Plateforme; datePubli: number },
): Promise<Id<"publications">> {
  if (!a.scriptCombo || a.comboKey === undefined) {
    throw new ConvexError("Combo de script manquant — matérialisation impossible.");
  }
  let compte: string;
  if (a.accountId) {
    const account = await ctx.db.get(a.accountId);
    compte = account?.handle ?? "—";
  } else {
    const creator = await ctx.db.get(a.creatorId);
    compte = creator?.name ?? "—";
  }
  return await ctx.runMutation(internal.publications.createFromAssignment, {
    projectId,
    mediaType: "short",
    plateforme: opts.platform,
    compte,
    datePubli: opts.datePubli,
    postUrl: opts.url,
    scriptCombo: {
      campaignId: a.scriptCombo.campaignId,
      hookBrickId: a.scriptCombo.hookBrickId,
      corpsBrickId: a.scriptCombo.corpsBrickId,
      fluxBrickId: a.scriptCombo.fluxBrickId,
      ctaBrickId: a.scriptCombo.ctaBrickId,
      comboKey: a.comboKey,
    },
  });
}

/**
 * Chantier C — matérialise la publication d'UNE cible (1 plateforme, 1 compte)
 * à la publication. Script → pub "short" + combo ; format non-custom → pub du
 * type ; format custom → pas de pub (null). Compte résolu depuis target.accountId
 * (fallback nom du créateur si legacy sans compte). Appelé en boucle sur les
 * cibles par confirmPublication, qui gère l'accrual base PAR POST.
 *
 * Type de retour ANNOTÉ (ctx.runMutation(internal.*) → TS7022). NE PAS retirer.
 */
async function materializeTargetPublication(
  ctx: MutationCtx,
  a: Doc<"assignments">,
  projectId: Id<"projects">,
  target: { platform: Plateforme; accountId?: Id<"comptes"> },
  url: string,
  datePubli: number,
): Promise<Id<"publications"> | null> {
  let compte: string;
  if (target.accountId) {
    const account = await ctx.db.get(target.accountId);
    compte = account?.handle ?? "—";
  } else {
    const creator = await ctx.db.get(a.creatorId);
    compte = creator?.name ?? "—";
  }
  const isScript = a.scriptCombo !== undefined && a.formatId === undefined;
  if (isScript) {
    if (!a.scriptCombo || a.comboKey === undefined) {
      throw new ConvexError(
        "Combo de script manquant — matérialisation impossible.",
      );
    }
    return await ctx.runMutation(internal.publications.createFromAssignment, {
      projectId,
      mediaType: "short",
      plateforme: target.platform,
      compte,
      datePubli,
      postUrl: url,
      scriptCombo: {
        campaignId: a.scriptCombo.campaignId,
        hookBrickId: a.scriptCombo.hookBrickId,
        corpsBrickId: a.scriptCombo.corpsBrickId,
        fluxBrickId: a.scriptCombo.fluxBrickId,
        ctaBrickId: a.scriptCombo.ctaBrickId,
        comboKey: a.comboKey,
      },
    });
  }
  const format = a.formatId ? await ctx.db.get(a.formatId) : null;
  if (!format) throw new ConvexError("Format introuvable.");
  if (format.type === "custom") return null; // custom = pas de publication trackée.
  return await ctx.runMutation(internal.publications.createFromAssignment, {
    projectId,
    mediaType: format.type,
    plateforme: target.platform,
    compte,
    datePubli,
    postUrl: url,
  });
}

// ─── Revue vidéo (admin) — NE crédite ni ne matérialise RIEN (cf published) ───

/** video_submitted → to_publish. Approuve la vidéo ; le paiement attend la
 *  publication (published). Idempotent. */
export const reviewVideoApprove = adminMutation({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status === "to_publish") return { ok: true, alreadyApproved: true };
    if (a.status !== "video_submitted") {
      throw new ConvexError("Seules les vidéos en revue peuvent être validées.");
    }
    await ctx.db.patch(id, { status: "to_publish" });
    // Notification créateur — hors transaction : un échec d'email ne remet pas
    // en cause la validation. Non atteint sur le retour idempotent ci-dessus,
    // donc re-valider n'envoie pas de second mail.
    await ctx.scheduler.runAfter(0, internal.emails.sendVideoApproved, {
      assignmentId: id,
    });
    return { ok: true, alreadyApproved: false };
  },
});

/** video_submitted → video_rejected (feedback obligatoire, visible créateur). */
export const reviewVideoReject = adminMutation({
  args: { id: v.id("assignments"), feedback: v.string() },
  handler: async (ctx, { id, feedback }) => {
    const a = await ctx.db.get(id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "video_submitted") {
      throw new ConvexError("Seules les vidéos en revue peuvent être refusées.");
    }
    const fb = feedback.trim();
    if (fb.length === 0) {
      throw new ConvexError("Un motif de refus est requis.");
    }
    await ctx.db.patch(id, {
      status: "video_rejected",
      videoReviewFeedback: fb,
      // Horodate le refus → la file « à traiter » peut repérer ceux qui stagnent.
      videoRejectedAt: Date.now(),
    });
    // Notification créateur avec le feedback DÉJÀ saisi ici (aucune ressaisie
    // demandée à l'admin). Hors transaction : le refus reste acquis si l'email
    // échoue.
    await ctx.scheduler.runAfter(0, internal.emails.sendVideoRejected, {
      assignmentId: id,
    });
    return { ok: true };
  },
});

/** Fenêtre anti-spam d'une relance MANUELLE : 1 par mission et par 24 h. */
export const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Relance MANUELLE d'un créateur sur une mission (bouton « Relancer » de la file
 * à traiter et de /assignments). L'email part via le canal du chantier B, donc
 * hors transaction : un Resend en panne ne fait pas échouer la relance côté DB.
 *
 * Anti-spam : une seule relance par mission et par fenêtre de 24 h. Le marqueur
 * est posé DANS la mutation — l'envoi étant asynchrone, on ne peut pas attendre
 * son issue, et il vaut mieux rater une relance qu'en envoyer dix.
 *
 * Ne relance QUE les missions où la balle est dans le camp du créateur
 * (UNFINISHED_STATUSES, partagé avec le cron de rappel).
 */
export const nudgeAssignment = adminMutation({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }) => {
    const a = await ctx.db.get(assignmentId);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Mission introuvable.");
    }
    const relançable = (UNFINISHED_STATUSES as readonly string[]).includes(
      a.status,
    );
    if (!relançable) {
      throw new ConvexError("Cette mission n'attend pas le créateur.");
    }
    const now = Date.now();
    if (
      a.lastNudgeAt !== undefined &&
      now - a.lastNudgeAt < NUDGE_COOLDOWN_MS
    ) {
      return { sent: false, reason: "cooldown" as const };
    }
    await ctx.db.patch(assignmentId, { lastNudgeAt: now });
    await ctx.scheduler.runAfter(0, internal.emails.sendManualNudge, {
      assignmentId,
    });
    return { sent: true, reason: null };
  },
});

/**
 * File de revue vidéo : assignments en video_submitted, avec le MP4 résolu en URL
 * signée (lecture in-app admin). Origin script → nom de campagne visible ADMIN.
 */
export const listVideoSubmitted = adminQuery({
  args: {},
  handler: async (ctx) => {
    const subs = await ctx.db
      .query("assignments")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", ctx.projectId).eq("status", "video_submitted"),
      )
      .collect();
    const [creators, formats, campaigns, comptes, scriptBricks] =
      await Promise.all([
        ctx.db
          .query("creators")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("formats")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("scriptCampaigns")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("comptes")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("scriptBricks")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
      ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    const campaignMap = new Map(campaigns.map((c) => [c._id, c.name]));
    const compteMap = new Map(comptes.map((c) => [c._id, c.handle]));
    const brickMap = new Map(scriptBricks.map((b) => [b._id, b]));
    return Promise.all(
      subs
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(async (a) => {
          const combo = a.scriptCombo;
          // Résumé combo (Tier · Flux · CTA) — contexte ADMIN, comme la modale
          // « Voir le script » côté Assignments. Null hors origine script.
          let comboSummary: string | null = null;
          if (combo) {
            const hook = brickMap.get(combo.hookBrickId);
            const flux = brickMap.get(combo.fluxBrickId);
            const cta = brickMap.get(combo.ctaBrickId);
            comboSummary = `${tierLabel(hook?.tier)} · ${flux?.label ?? "?"} · ${cta?.label ?? "?"}`;
          }
          return {
            _id: a._id,
            creatorName: creatorMap.get(a.creatorId) ?? a.creatorNameSnapshot ?? "—",
            label: combo
              ? (campaignMap.get(combo.campaignId) ?? "Script")
              : a.formatId
                ? (formatMap.get(a.formatId) ?? "—")
                : "—",
            origin: (combo ? "script" : "format") as "script" | "format",
            // Chantier C — cibles (plateforme + compte) : « 1 vidéo → N posts ».
            targets: (a.targets ?? []).map((t) => ({
              platform: t.platform,
              accountHandle: t.accountId
                ? (compteMap.get(t.accountId) ?? null)
                : null,
            })),
            dueDate: a.dueDate,
            videoStorageId: a.submittedVideoStorageId ?? null,
            videoUrl: a.submittedVideoStorageId
              ? await ctx.storage.getUrl(a.submittedVideoStorageId)
              : null,
            videoMimeType: a.submittedVideoMimeType ?? "video/mp4",
            // Cloudflare Stream : UID + état du transcoding. "ready" → la carte
            // affiche le PLAYER Stream (HEVC lisible inline) ; "processing" → un
            // message « transcoding en cours » (la réactivité Convex bascule sur
            // le player dès que c'est prêt) ; null/error → fallback <video> +
            // bouton télécharger. Scopé projet (la soumission appartient au
            // projet), UID exposé au seul admin du projet.
            streamUid: a.submittedVideoStreamUid ?? null,
            streamStatus: a.submittedVideoStreamStatus ?? null,
            // SCRIPT MONTÉ FIGÉ (labels:false, sans titres ##) : on l'AFFICHE
            // tel quel pour comparer vidéo ↔ script attendu. JAMAIS re-dérivé —
            // cohérent avec AssignmentScriptDialog. Null hors origine script.
            assembledScript: combo?.assembledScript ?? null,
            comboSummary,
          };
        }),
    );
  },
});

/** « Publiées récemment » (admin) : assignments en published, URL + créateur. */
export const listPublished = adminQuery({
  args: {},
  handler: async (ctx) => {
    const pubs = await ctx.db
      .query("assignments")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", ctx.projectId).eq("status", "published"),
      )
      .collect();
    const [creators, formats, comptes] = await Promise.all([
      ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("comptes")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    const compteMap = new Map(comptes.map((c) => [c._id, c.handle]));
    // publishedAt représentatif = max des cibles (fallback legacy a.publishedAt).
    const pubAtOf = (a: Doc<"assignments">) =>
      Math.max(
        a.publishedAt ?? 0,
        ...(a.targets ?? []).map((t) => t.publishedAt ?? 0),
      );
    return pubs
      .sort((a, b) => pubAtOf(b) - pubAtOf(a))
      .map((a) => ({
        _id: a._id,
        creatorName: creatorMap.get(a.creatorId) ?? a.creatorNameSnapshot ?? "—",
        label: a.scriptCombo
          ? "Script"
          : a.formatId
            ? (formatMap.get(a.formatId) ?? "—")
            : "—",
        publishedAt: pubAtOf(a) || null,
        // Chantier C — N posts (1 par plateforme) avec URL + compte.
        targets: (a.targets ?? []).map((t) => ({
          platform: t.platform,
          accountHandle: t.accountId
            ? (compteMap.get(t.accountId) ?? null)
            : null,
          publishedUrl: t.publishedUrl ?? null,
        })),
      }));
  },
});

/**
 * COMPTES GÉRÉS — assignments en to_publish à publier PAR L'ÉQUIPE (l'admin colle
 * le lien via confirmPublicationAsAdmin). Sous-ensemble MANAGÉ de to_publish :
 * créés direct en to_publish (D2, aucune vidéo à valider) → absents de « Vidéos à
 * valider ». Enrichi comme listPublished (créateur, format, cibles + handle) +
 * le script monté (à produire/publier par l'équipe).
 */
export const listManagedToPublish = adminQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("assignments")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", ctx.projectId).eq("status", "to_publish"),
      )
      .collect();
    const managed = rows.filter((a) => a.managedByAdmin);
    const [creators, formats, comptes] = await Promise.all([
      ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("comptes")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    const compteMap = new Map(comptes.map((c) => [c._id, c.handle]));
    return managed
      .sort((a, b) => a.dueDate - b.dueDate)
      .map((a) => ({
        _id: a._id,
        creatorName: creatorMap.get(a.creatorId) ?? a.creatorNameSnapshot ?? "—",
        label: a.scriptCombo
          ? "Script"
          : a.formatId
            ? (formatMap.get(a.formatId) ?? "—")
            : "—",
        dueDate: a.dueDate,
        assembledScript: a.scriptCombo?.assembledScript ?? null,
        targets: (a.targets ?? []).map((t) => ({
          platform: t.platform,
          accountHandle: t.accountId
            ? (compteMap.get(t.accountId) ?? null)
            : null,
        })),
      }));
  },
});

/**
 * BACKFILL one-shot (internal) — comptes gérés. Corrige les assignments ORPHELINS
 * créés AVANT le fix du chemin script (assignScriptCampaign insérait `todo` sans
 * flag même sur un compte géré). Pour chaque assignment NON encore agi (todo /
 * in_progress) dont TOUTES les cibles pointent un compte managedByAdmin : pose
 * managedByAdmin:true + status:"to_publish" → il rejoint la file admin « Comptes
 * gérés — à publier » ET sort des actionnables créatrice. Restreint aux non-agis
 * (video_submitted et au-delà = la créatrice a déjà produit → intouché).
 * IDEMPOTENT (rows déjà managed ignorées ; une fois to_publish, plus todo/in_progress).
 * Mix géré/non-géré (créé avant l'homogénéité) → SKIPPÉ + compté, à traiter à la main.
 *
 * Runnable : `npx convex run assignments:backfillManagedAssignments` (dev puis --prod).
 */
export const backfillManagedAssignments = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ updated: number; skippedMixed: number }> => {
    const assignments = await ctx.db.query("assignments").collect();
    let updated = 0;
    let skippedMixed = 0;
    for (const a of assignments) {
      if (a.managedByAdmin) continue; // déjà géré (idempotence)
      if (a.status !== "todo" && a.status !== "in_progress") continue; // non-agi
      const targets = a.targets ?? [];
      if (targets.length === 0) continue;
      const comptes = await Promise.all(
        targets.map((t) => (t.accountId ? ctx.db.get(t.accountId) : null)),
      );
      const managedCount = comptes.filter((c) => c?.managedByAdmin).length;
      if (managedCount === 0) continue; // aucune cible gérée → assignment normal
      if (managedCount < targets.length) {
        // Mix géré/non-géré (antérieur à l'homogénéité) : ambigu → laissé manuel.
        skippedMixed++;
        continue;
      }
      await ctx.db.patch(a._id, { managedByAdmin: true, status: "to_publish" });
      updated++;
    }
    return { updated, skippedMixed };
  },
});

/**
 * S3 — BACKFILL idempotent du raccord combo ↔ publication. À lancer une fois si
 * des posts de SCRIPT ont été validés AVANT S3 (sous S2 : aucune publication
 * n'était matérialisée → publicationId absent). Pour chaque assignment de script
 * validé :
 *   - publication absente (cas S2)  → matérialise + pose publicationId + combo ;
 *   - publication présente sans combo → patche scriptCombo ;
 *   - publication présente avec combo → no-op (idempotent).
 * Un assignment non matérialisable (plateforme/URL manquante) est compté en
 * `skipped` sans interrompre le reste.
 *
 * Runnable : `npx convex run assignments:backfillPublicationCombos` (dev / --prod).
 * Type de retour ANNOTÉ (ctx.runMutation(internal.*) via le helper → TS7022).
 */
export const backfillPublicationCombos = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    materialized: number;
    attached: number;
    alreadyOk: number;
    skipped: number;
  }> => {
    const assignments = await ctx.db.query("assignments").collect();
    let materialized = 0;
    let attached = 0;
    let alreadyOk = 0;
    let skipped = 0;
    for (const a of assignments) {
      // Cible : assignments de SCRIPT validés (ou payés) uniquement.
      if (!a.scriptCombo || a.formatId !== undefined) continue;
      if (a.status !== "validated" && a.status !== "paid") continue;
      if (a.comboKey === undefined) {
        skipped++;
        continue;
      }
      const combo = {
        campaignId: a.scriptCombo.campaignId,
        hookBrickId: a.scriptCombo.hookBrickId,
        corpsBrickId: a.scriptCombo.corpsBrickId,
        fluxBrickId: a.scriptCombo.fluxBrickId,
        ctaBrickId: a.scriptCombo.ctaBrickId,
        comboKey: a.comboKey,
      };
      if (a.publicationId === undefined) {
        // Cas S2 : pas de publication. La matérialiser rétroactivement exige une
        // plateforme + URL (published ou legacy submitted) ; sinon skip propre.
        const url = a.publishedUrl ?? a.submittedUrl;
        if (a.submittedPlatform === undefined || url === undefined) {
          skipped++;
          continue;
        }
        const publicationId = await materializeScriptPublication(
          ctx,
          a,
          a.projectId,
          {
            url,
            platform: a.submittedPlatform,
            datePubli: a.publishedAt ?? a.submittedAt ?? Date.now(),
          },
        );
        await ctx.db.patch(a._id, { publicationId });
        materialized++;
        continue;
      }
      const pub = await ctx.db.get(a.publicationId);
      if (!pub) {
        skipped++;
        continue;
      }
      if (pub.scriptCombo !== undefined) {
        alreadyOk++;
        continue;
      }
      await ctx.db.patch(a.publicationId, { scriptCombo: combo });
      attached++;
    }
    return { materialized, attached, alreadyOk, skipped };
  },
});

/**
 * MIGRATION — réécrit les statuts LEGACY vers la machine MP4 (0 perte, idempotent).
 *   submitted  → video_submitted   (en attente d'action admin)
 *   validated  → published         (URL fournie + pub matérialisée + base créditée)
 *   rejected   → video_rejected     (+ videoReviewFeedback = ancien adminFeedback)
 * Aligne aussi les champs : publishedUrl/publishedAt ← submittedUrl/submittedAt
 * pour les rows désormais published/paid. Idempotent : ne touche que les rows
 * encore sur un statut legacy ou aux champs published manquants.
 *
 * CHOIX : prod n'a que la démo (pas de vrais créateurs) → on migre proprement
 * vers la nouvelle machine. Le retrait des littéraux legacy de l'union (status)
 * est un RESSERRAGE ultérieur, une fois la migration passée partout.
 *
 * Runnable : `npx convex run assignments:migrateAssignmentStatuses [--prod]`.
 */
export const migrateAssignmentStatuses = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    submitted: number;
    validated: number;
    rejected: number;
    fieldsAligned: number;
  }> => {
    const all = await ctx.db.query("assignments").collect();
    let submitted = 0;
    let validated = 0;
    let rejected = 0;
    let fieldsAligned = 0;
    for (const a of all) {
      const patch: Partial<Doc<"assignments">> = {};
      if (a.status === "submitted") {
        patch.status = "video_submitted";
        submitted++;
      } else if (a.status === "validated") {
        patch.status = "published";
        validated++;
      } else if (a.status === "rejected") {
        patch.status = "video_rejected";
        if (a.videoReviewFeedback === undefined && a.adminFeedback !== undefined) {
          patch.videoReviewFeedback = a.adminFeedback;
        }
        rejected++;
      }
      const nextStatus = patch.status ?? a.status;
      if (
        (nextStatus === "published" || nextStatus === "paid") &&
        a.publishedUrl === undefined &&
        a.submittedUrl !== undefined
      ) {
        patch.publishedUrl = a.submittedUrl;
        patch.publishedAt = a.submittedAt ?? a.createdAt;
        fieldsAligned++;
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(a._id, patch);
    }
    return { submitted, validated, rejected, fieldsAligned };
  },
});

/**
 * MIGRATION Chantier C — convertit les assignments MONO-compte (champs legacy
 * accountId/publishedUrl/publishedAt/publicationId + submittedPlatform) vers
 * `targets` à 1 entrée. Idempotent (skip si `targets` déjà présent). Plateforme
 * dérivée du compte (compte.plateforme) sinon de submittedPlatform. **0 perte** :
 * les champs legacy sont CONSERVÉS (resserrage ultérieur). Un legacy sans compte
 * ni plateforme (todo jamais démarré, absent de la démo) est `skipped` proprement.
 * Runnable : `npx convex run assignments:migrateAssignmentsToTargets [--prod]`.
 */
export const migrateAssignmentsToTargets = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ migrated: number; skipped: number; alreadyOk: number }> => {
    const all = await ctx.db.query("assignments").collect();
    let migrated = 0;
    let skipped = 0;
    let alreadyOk = 0;
    for (const a of all) {
      if (a.targets !== undefined && a.targets.length > 0) {
        alreadyOk++;
        continue;
      }
      let platform = a.submittedPlatform as Plateforme | undefined;
      if (a.accountId) {
        const compte = await ctx.db.get(a.accountId);
        if (compte) platform = compte.plateforme;
      }
      if (platform === undefined) {
        skipped++;
        continue;
      }
      await ctx.db.patch(a._id, {
        targets: [
          {
            platform,
            accountId: a.accountId,
            publishedUrl: a.publishedUrl,
            publishedAt: a.publishedAt,
            publicationId: a.publicationId,
          },
        ],
      });
      migrated++;
    }
    return { migrated, skipped, alreadyOk };
  },
});

/**
 * P8 — assignments PUBLIÉS (avec publication) candidats au calcul de bonus,
 * enrichis des vues du dernier snapshot (préremplissage) et du bonus déjà
 * crédité s'il existe.
 */
export const listValidatedForBonus = adminQuery({
  args: {},
  handler: async (ctx) => {
    const validated = (
      await ctx.db
        .query("assignments")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", ctx.projectId).eq("status", "published"),
        )
        .collect()
    ).filter((a) => (a.targets ?? []).some((t) => t.publicationId !== undefined));

    const [creators, formats, payments] = await Promise.all([
      ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("payments")
        .withIndex("by_project_period", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    const bonusByAssignment = new Map<string, number>();
    for (const p of payments) {
      for (const li of p.lineItems) {
        if (li.kind === "bonus" && li.assignmentId)
          bonusByAssignment.set(li.assignmentId, li.amount);
      }
    }

    const rows = await Promise.all(
      validated.map(async (a) => {
        // Chantier C — agrège les vues sur TOUTES les publications des cibles.
        const pubIds = (a.targets ?? [])
          .map((t) => t.publicationId)
          .filter((p): p is Id<"publications"> => p !== undefined);
        // Le préremplissage du bonus est un montant PROPOSÉ À LA PAIE : il doit
        // lire les MÊMES vues que le moteur, donc les vues PAYABLES (posts
        // warmup exclus — le warmup existe précisément pour n'être jamais
        // rémunéré). assignmentViewsAndMetrics est la source unique partagée
        // avec le CPM et les paliers : aucune logique d'exclusion dupliquée ici.
        const { payableViews, hasMetrics } = await assignmentViewsAndMetrics(
          ctx,
          a,
        );
        const latestViews = payableViews;
        const hasSnapshot = hasMetrics;
        return {
          assignmentId: a._id,
          creatorName: creatorMap.get(a.creatorId) ?? a.creatorNameSnapshot ?? "—",
          formatName: a.formatId ? (formatMap.get(a.formatId) ?? "—") : "—",
          postCount: pubIds.length,
          latestViews: hasSnapshot ? latestViews : null,
          hasSnapshot,
          existingBonus: bonusByAssignment.get(a._id) ?? null,
        };
      }),
    );
    // Actionnables (avec snapshot) d'abord.
    return rows.sort((x, y) => Number(y.hasSnapshot) - Number(x.hasSnapshot));
  },
});

/**
 * P8 — BONUS DE VUES (manuel). Sur un assignment validé dont la publication a
 * des snapshots : montant calculé AUTORITATIVEMENT serveur depuis le
 * rateSnapshot figé (jamais un montant fourni par le client) = part liée aux
 * vues (viewBonus + bounty ; la base est déjà créditée à la validation). UN
 * seul bonus par assignment : recalculer REMPLACE la ligne (cf
 * upsertBonusLineItem), jamais d'ajout → idempotent.
 */
export const computeViewBonus = adminMutation({
  args: { id: v.id("assignments"), views: v.number() },
  handler: async (ctx, { id, views }) => {
    const a = await ctx.db.get(id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "published") {
      throw new ConvexError("Le bonus se calcule sur un assignment publié.");
    }
    if (a.pricingSnapshot !== undefined) {
      throw new ConvexError(
        "Bonus dérivé automatiquement du pricing (CPM + seuil) — non applicable manuellement.",
      );
    }
    const hasPub = (a.targets ?? []).some((t) => t.publicationId !== undefined);
    if (!hasPub) {
      throw new ConvexError(
        "Pas de publication matérialisée (format custom ?) — bonus non applicable.",
      );
    }
    if (!Number.isFinite(views) || views < 0) {
      throw new ConvexError("Nombre de vues invalide.");
    }
    const format = a.formatId ? await ctx.db.get(a.formatId) : null;
    // Chantier C — `views` = SOMME des vues des N plateformes (le bonus CPM
    // s'additionne sur les cibles). UN seul bonus par assignment (remplacement).
    const earnings = computeEarnings(a.rateSnapshot, views);
    // bonus = part liée aux vues uniquement (la base est déjà créditée par post).
    const bonusAmount =
      Math.round((earnings.viewBonus + earnings.bounty) * 100) / 100;
    await upsertBonusLineItem(ctx, {
      projectId: ctx.projectId,
      creatorId: a.creatorId,
      assignmentId: id,
      label: `${format?.name ?? "Format"} — bonus (${views} vues cumulées)`,
      amount: bonusAmount,
      now: Date.now(),
    });
    return { ok: true, bonus: bonusAmount };
  },
});

// ─── Créateur (isolé par ctx.creatorId) ──────────────────────────────────────

/**
 * Enrichit un assignment pour le CRÉATEUR. ISOLATION : on retire `scriptCombo`
 * et `comboKey` (décomposition/brick ids/tier/perf) — le créateur ne reçoit QUE
 * le script monté (`assembledScript`) et le NOM DE CAMPAGNE (via missionLabelFor),
 * jamais les briques ni le tier. Le nom de campagne est le libellé de la mission
 * côté créateur (ex. « Format 3 - POV Demo »), pour qu'elle sache quel format
 * produire ; il reste distinct de la paie, où il ne fuite pas (lineItems génériques).
 */
/** Cibles enrichies côté créateur : plateforme + handle de SON compte + URL. */
async function enrichTargets(ctx: QueryCtx, a: Doc<"assignments">) {
  return Promise.all(
    (a.targets ?? []).map(async (t) => {
      const account = t.accountId ? await ctx.db.get(t.accountId) : null;
      return {
        platform: t.platform,
        accountHandle: account?.handle ?? null,
        publishedUrl: t.publishedUrl ?? null,
        publishedAt: t.publishedAt ?? null,
      };
    }),
  );
}

/**
 * ISOLATION assets — le créateur ne voit QUE les dossiers liés à SON assignment
 * (dual-read assetFolderIds/legacy), TOUS dans son projet (chaque dossier
 * re-vérifié `projectId === a.projectId`). Résout les URLs signées, GROUPÉ par
 * dossier (ordre des liens). null si aucun dossier lié ou tous vides/introuvables.
 */
async function resolveAssignmentAssets(
  ctx: QueryCtx,
  a: Doc<"assignments">,
): Promise<{
  folders: {
    folderId: Id<"assetFolders">;
    name: string;
    items: {
      id: Id<"assets">;
      fileName: string;
      contentType: string;
      url: string | null;
    }[];
  }[];
} | null> {
  const ids = effectiveAssetFolderIds(a);
  if (ids.length === 0) return null;
  const folders: {
    folderId: Id<"assetFolders">;
    name: string;
    items: {
      id: Id<"assets">;
      fileName: string;
      contentType: string;
      url: string | null;
    }[];
  }[] = [];
  for (const fid of ids) {
    const folder = await ctx.db.get(fid);
    // ISOLATION : ignore tout dossier hors du projet de l'assignment.
    if (!folder || folder.projectId !== a.projectId) continue;
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_folder", (q) => q.eq("folderId", fid))
      .collect();
    if (assets.length === 0) continue;
    const items = await Promise.all(
      assets
        .sort((x, y) => x.createdAt - y.createdAt)
        .map(async (asset) => ({
          id: asset._id,
          fileName: asset.fileName,
          contentType: asset.contentType,
          url: await ctx.storage.getUrl(asset.storageId),
        })),
    );
    folders.push({ folderId: fid, name: folder.name, items });
  }
  if (folders.length === 0) return null;
  return { folders };
}

/** Mode d'une brique vidéo (réplique lib/script-mode.BrickMode — A6). */
type BrickMode = "dire" | "afficher" | "les_deux";
/** Un bloc de la zone 🎬 (hook / flux) + son mode d'usage PAR BRIQUE. */
type VideoBlock = { text: string; mode: BrickMode };
/** Deux zones de destination d'un script monté (rendu créateur Snytch). La zone
 *  vidéo est éclatée PAR BRIQUE (hook, flux) pour porter un mode par bloc. */
type ScriptZones = { videoBlocks: VideoBlock[]; descriptionScript: string };

/**
 * SNYTCH — découpe le script monté en deux zones de DESTINATION pour l'affichage
 * créateur : « dans la vidéo » (hook + flux) vs « en description » (cta). Lit les
 * briques FIGÉES du combo et ne renvoie le découpage QUE s'il reconstruit
 * l'assembledScript figé À L'OCTET PRÈS (même join que assembleNoLabels côté
 * write, labels:false). Sinon — brique éditée depuis l'assignation, combo legacy
 * 4-briques (corps), ou cta vide — renvoie null : la fiche retombe alors sur la
 * carte unique « Vidéo à tourner » (le texte figé RESTE la source de vérité, cf.
 * scriptAssembly). Gate Snytch : rien n'est calculé/renvoyé hors Snytch. Aucune
 * brique/id/tier/campagne n'est exposé — UNIQUEMENT le texte, comme assembledScript.
 */
async function splitScriptZones(
  ctx: QueryCtx,
  a: Doc<"assignments">,
  combo: NonNullable<Doc<"assignments">["scriptCombo"]>,
): Promise<ScriptZones | null> {
  const project = await ctx.db.get(a.projectId);
  if (!project || project.slug !== SNYTCH_SLUG) return null;
  const [hook, flux, cta] = await Promise.all([
    ctx.db.get(combo.hookBrickId),
    ctx.db.get(combo.fluxBrickId),
    ctx.db.get(combo.ctaBrickId),
  ]);
  if (!hook || !flux || !cta) return null;
  const h = hook.content.trim();
  const f = flux.content.trim();
  const c = cta.content.trim();
  if (c.length === 0) return null;
  // Garde anti-divergence : le découpage n'est fidèle que s'il reconstitue le
  // texte figé exactement (même assemblage que le write path, labels:false). Le
  // MODE est ORTHOGONAL au contenu → n'entre pas dans cette garde.
  if ([h, f, c].join("\n\n") !== combo.assembledScript) return null;
  return {
    // Zone vidéo PAR BRIQUE : chaque bloc porte son mode (défaut "les_deux" au
    // read, rétrocompat — réplique de lib/script-mode.resolveBrickMode, A6).
    videoBlocks: [
      { text: h, mode: hook.mode ?? "les_deux" },
      { text: f, mode: flux.mode ?? "les_deux" },
    ],
    descriptionScript: c,
  };
}

/**
 * Libellé de mission RÉEXPOSÉ au créateur — le SEUL élément du `scriptCombo`
 * qu'il reçoit. Script → NOM DE CAMPAGNE (ex. « Format 3 - POV Demo ») ; format
 * → nom + type du format. La décomposition (bricks/tier/comboKey) et les données
 * de perf restent STRICTEMENT côté admin : on ne lit ici que le `name` de la
 * campagne. `formatType` est null pour un script (le type de contenu est porté
 * par le nom de campagne, pas par un champ dédié). Fallback « Vidéo à tourner »
 * si la campagne a disparu → jamais de libellé vide.
 */
export async function missionLabelFor(
  ctx: QueryCtx,
  a: Doc<"assignments">,
): Promise<{
  formatName: string;
  formatType: string | null;
  origin: "script" | "format";
}> {
  if (a.scriptCombo) {
    const campaign = await ctx.db.get(a.scriptCombo.campaignId);
    return {
      formatName: campaign?.name ?? "Vidéo à tourner",
      formatType: null,
      origin: "script",
    };
  }
  const format = a.formatId ? await ctx.db.get(a.formatId) : null;
  return {
    formatName: format?.name ?? "—",
    formatType: format?.type ?? "custom",
    origin: "format",
  };
}

/** Sous-ensemble d'un assignment EXPOSÉ à la créatrice (allowlist). Le typage
 *  `Pick` fait échouer tsc si le portail lit un champ NON exposé. */
type CreatorAssignment = Pick<
  Doc<"assignments">,
  (typeof CREATOR_ASSIGNMENT_FIELDS)[number]
>;

async function enrichForCreator(ctx: QueryCtx, a: Doc<"assignments">) {
  const targets = await enrichTargets(ctx, a);
  // ALLOWLIST (cf creatorAssignmentFields) — on part de RIEN et on n'expose que les
  // champs autorisés. Un nouveau champ de schéma reste invisible tant qu'il n'est pas
  // ajouté à la liste : plus de fuite par défaut (le piège replayVerbatim/publishedBy).
  const safe = pickCreatorAssignment(a) as CreatorAssignment;
  const label = await missionLabelFor(ctx, a);
  return {
    ...safe,
    targets,
    ...label,
    assembledScript: a.scriptCombo ? a.scriptCombo.assembledScript : null,
  };
}

// ─── Ordre d'affichage : ALTERNANCE des formats (réplique de lib/assignment-order,
//     règle A6 — convex/ ne peut pas importer lib/). Toute évolution ici DOIT
//     l'être dans lib/assignment-order.ts ; les tests vivent là-bas. Voir ce
//     module pour la justification complète de l'algorithme. ────────────────────

/** Hash FNV-1a 32 bits (déterministe). */
function stableHashServer(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Axe « format » d'une mission : campagne (script) OU formatId, sinon "none". */
function assignmentGroupKeyServer(a: Doc<"assignments">): string {
  if (a.scriptCombo) return `campaign:${a.scriptCombo.campaignId}`;
  if (a.formatId) return `format:${a.formatId}`;
  return "none";
}

const ORDER_SCALE = 1_000_000;
const ORDER_MAX_ROTATIONS = 64;
const ORDER_MAX_REPAIR_PASSES = 6;

function longestRunServer(keys: string[]): number {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of keys) {
    run = k === prev ? run + 1 : 1;
    prev = k;
    best = Math.max(best, run);
  }
  return best;
}

function repairAdjacentServer<T>(seq: T[], keyOf: (item: T) => string): T[] {
  const out = [...seq];
  const keyAt = (i: number) => (i >= 0 && i < out.length ? keyOf(out[i]) : null);
  const swappable = (i: number, j: number): boolean => {
    const ki = keyAt(i);
    const kj = keyAt(j);
    if (ki === kj) return false;
    if (j !== i - 1 && kj === keyAt(i - 1)) return false;
    if (j !== i + 1 && kj === keyAt(i + 1)) return false;
    if (i !== j - 1 && ki === keyAt(j - 1)) return false;
    if (i !== j + 1 && ki === keyAt(j + 1)) return false;
    return true;
  };
  for (let pass = 0; pass < ORDER_MAX_REPAIR_PASSES; pass++) {
    let changed = false;
    for (let i = 1; i < out.length; i++) {
      if (keyAt(i) !== keyAt(i - 1)) continue;
      let partner = -1;
      for (let d = 1; d < out.length && partner === -1; d++) {
        if (i + d < out.length && swappable(i, i + d)) partner = i + d;
        else if (i - d >= 0 && swappable(i, i - d)) partner = i - d;
      }
      if (partner === -1) continue;
      const tmp = out[i];
      out[i] = out[partner];
      out[partner] = tmp;
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}

function spreadServer<T>(
  items: T[],
  keyOf: (item: T) => string,
  seed: string,
): T[] {
  if (items.length < 2) return items;
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const g = groups.get(k);
    if (g) g.push(item);
    else groups.set(k, [item]);
  }
  if (groups.size < 2) return items;

  type Placed = {
    item: T;
    num: number;
    den: number;
    size: number;
    rank: number;
    seq: number;
  };
  const placed: Placed[] = [];
  let seq = 0;
  for (const [key, group] of groups) {
    const rank = stableHashServer(`${seed}:${key}`);
    const den = group.length * ORDER_SCALE;
    group.forEach((item, i) => {
      placed.push({
        item,
        num: i * ORDER_SCALE,
        den,
        size: group.length,
        rank,
        seq: seq++,
      });
    });
  }
  placed.sort((a, b) => {
    const cross = a.num * b.den - b.num * a.den;
    if (cross !== 0) return cross;
    if (a.size !== b.size) return b.size - a.size;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.seq - b.seq;
  });
  const comb = placed.map((p) => p.item);
  const n = comb.length;

  const stride = n <= ORDER_MAX_ROTATIONS ? 1 : Math.ceil(n / ORDER_MAX_ROTATIONS);
  let minRun = Infinity;
  const distinct = new Map<string, T[]>();
  for (let o = 0; o < n; o += stride) {
    const rotated = o === 0 ? comb : [...comb.slice(o), ...comb.slice(0, o)];
    const rep = repairAdjacentServer(rotated, keyOf);
    const keys = rep.map(keyOf);
    const sig = keys.join(" ");
    const run = longestRunServer(keys);
    if (run < minRun) {
      minRun = run;
      distinct.clear();
      distinct.set(sig, rep);
    } else if (run === minRun && !distinct.has(sig)) {
      distinct.set(sig, rep);
    }
    if (minRun === 1 && stride === 1 && distinct.size >= n) break;
  }
  const cands = [...distinct.values()];
  return cands[stableHashServer(`${seed}:pick`) % cands.length];
}

// Rang d'urgence — réplique de lib/assignment-status (isActionable +
// assignmentUrgency + urgencyRank, règle A6). 0 = le plus urgent : en retard →
// < 48 h → dans les temps → non actionnable. DOIT rester aligné sur lib.
const ORDER_DAY = 86_400_000;
function isActionableServer(status: string): boolean {
  return (
    status === "todo" ||
    status === "in_progress" ||
    status === "video_rejected" ||
    status === "to_publish" ||
    status === "rejected" // legacy
  );
}
function urgencyTierServer(a: Doc<"assignments">, now: number): number {
  if (!isActionableServer(a.status)) return 3; // none
  if (a.dueDate < now) return 0; // overdue
  if (a.dueDate - now < 2 * ORDER_DAY) return 1; // soon (< 48 h)
  return 2; // ok
}

/**
 * Entrelace les formats d'une liste d'assignments PAR RANG D'URGENCE : dans un
 * rang, les formats s'alternent quelles que soient leurs échéances ; les rangs
 * (en retard → < 48 h → dans les temps → non actionnable) restent ordonnés.
 * Graine = creatorId → ordre propre à chaque créatrice, stable. Réplique de
 * lib/assignment-order.interleaveByGroup.
 */
function interleaveByGroupServer(
  items: Doc<"assignments">[],
  seed: string,
  now: number,
): Doc<"assignments">[] {
  if (items.length < 2) return [...items];
  const buckets = new Map<number, Doc<"assignments">[]>();
  for (const item of items) {
    const t = urgencyTierServer(item, now);
    const b = buckets.get(t);
    if (b) b.push(item);
    else buckets.set(t, [item]);
  }
  const tiers = [...buckets.keys()].sort((a, b) => a - b);
  const out: Doc<"assignments">[] = [];
  for (const t of tiers) {
    // Tri DOUX par échéance dans le rang (base du peigne + repli mono-format).
    const bucket = buckets
      .get(t)!
      .slice()
      .sort((x, y) => x.dueDate - y.dueDate);
    out.push(...spreadServer(bucket, assignmentGroupKeyServer, seed));
  }
  return out;
}

async function assignmentsForCreator(
  ctx: QueryCtx,
  creatorId: Id<"creators">,
) {
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  // Ordre stable par créatrice : entrelacement des FORMATS par rang d'urgence
  // (en retard → < 48 h → dans les temps → non actionnable). Le mélange des
  // formats PRIME sur l'échéance — deux formats d'échéances différentes mais de
  // même urgence s'alternent (fini les blocs par date) — sans noyer les échéances
  // proches (rangs ordonnés). `now` comme getMyPayments/videoStats (Date.now en
  // query = pratique établie). On entrelace les assignments BRUTS avant d'enrichir
  // (enrichForCreator retire scriptCombo → campagne indistinguable après). Le map
  // préserve l'ordre.
  const ordered = interleaveByGroupServer(assignments, creatorId, Date.now());
  return Promise.all(ordered.map((a) => enrichForCreator(ctx, a)));
}

/** Mes assignments UNIQUEMENT (filtre serveur par creatorId), triés deadline. */
export const listMyAssignments = creatorQuery({
  args: {},
  handler: async (ctx) => assignmentsForCreator(ctx, ctx.creatorId),
});

/** ADMIN view-as — assignments du créateur ciblé (lecture seule, scopé projet). */
export const listAssignmentsAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) => assignmentsForCreator(ctx, ctx.creatorId),
});

/**
 * Fiche assignment côté créateur. null si pas la mienne. ISOLATION : `scriptCombo`
 * et `comboKey` sont RETIRÉS de l'objet renvoyé — pour un assignment script, le
 * créateur reçoit le script monté (`assembledScript`) et la rému, JAMAIS la
 * décomposition (briques/ids/tiers/campagne).
 */
/**
 * Fiche assignment d'un créateur DONNÉ (helper de lecture partagé). MÊME corps
 * que la query créateur ET la variante admin view-as → 0 duplication. ISOLATION :
 * un assignment qui n'appartient pas à `creatorId` → null (garde vraie quel que
 * soit l'appelant : créateur authentifié OU admin scopé projet). Pour un
 * assignment de script, `scriptCombo`/`comboKey` sont RETIRÉS : le créateur (et
 * l'admin qui regarde son écran) ne reçoit que le script monté, jamais la
 * décomposition.
 */
async function assignmentDetailFor(
  ctx: QueryCtx,
  creatorId: Id<"creators">,
  id: Id<"assignments">,
) {
  const a = await ctx.db.get(id);
  // Isolation : un assignment d'un autre créateur → introuvable.
  if (!a || a.creatorId !== creatorId) return null;
  const targets = await enrichTargets(ctx, a);
  // ALLOWLIST (cf creatorAssignmentFields) — comme enrichForCreator : on n'expose
  // QUE les champs autorisés. Script / rejeu / traçabilité admin jamais renvoyés ;
  // un nouveau champ de schéma reste invisible tant qu'il n'est pas classé.
  const safe = pickCreatorAssignment(a) as CreatorAssignment;
  // ISOLATION : SA vidéo soumise, résolue côté serveur (URL signée). Le blob
  // n'est jamais lisible que par le créateur (ici) et l'admin (listVideoSubmitted).
  const submittedVideoUrl = a.submittedVideoStorageId
    ? await ctx.storage.getUrl(a.submittedVideoStorageId)
    : null;
  const submittedVideoMimeType = a.submittedVideoMimeType ?? "video/mp4";
  // Assets liés (images à télécharger) — dossier de SON assignment uniquement.
  const assets = await resolveAssignmentAssets(ctx, a);
  // Libellé de mission (nom de campagne / format) — MÊME source que la liste.
  const label = await missionLabelFor(ctx, a);
  if (a.scriptCombo) {
    const scriptZones = await splitScriptZones(ctx, a, a.scriptCombo);
    return {
      assignment: safe,
      ...label,
      format: null,
      assembledScript: a.scriptCombo.assembledScript,
      scriptZones,
      targets,
      submittedVideoUrl,
      submittedVideoMimeType,
      assets,
    };
  }
  const format = a.formatId ? await ctx.db.get(a.formatId) : null;
  const brief = format ? await withResolvedExamples(ctx, format) : null;
  return {
    assignment: safe,
    ...label,
    format: brief,
    assembledScript: null as string | null,
    scriptZones: null as ScriptZones | null,
    targets,
    submittedVideoUrl,
    submittedVideoMimeType,
    assets,
  };
}

export const getMyAssignment = creatorQuery({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => assignmentDetailFor(ctx, ctx.creatorId, id),
});

/**
 * ADMIN view-as — fiche détail d'une mission du créateur ciblé (lecture seule).
 * adminViewAsQuery garantit : appelant admin du projet (ou superadmin) ET fiche
 * créateur ∈ projet (ctx.creatorId injecté = créateur ciblé). assignmentDetailFor
 * vérifie en plus que la mission appartient à CE créateur → un assignmentId hors
 * créateur/projet renvoie null (aucune fuite).
 */
export const getAssignmentDetailAsAdmin = adminViewAsQuery({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => assignmentDetailFor(ctx, ctx.creatorId, id),
});

/** todo → in_progress (« Je commence »). */
export const startAssignment = creatorMutation({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || a.creatorId !== ctx.creatorId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "todo") {
      throw new ConvexError("Cet assignment est déjà démarré.");
    }
    await ctx.db.patch(id, { status: "in_progress" });
  },
});

/**
 * SOUMISSION VIDÉO (MP4) — le créateur upload sa vidéo NON publiée. Le client a
 * déjà poussé le blob (generateUploadUrl → storage) et fournit le storageId.
 * Autorisé depuis todo / in_progress / video_rejected (re-soumission après
 * refus). Une re-soumission PURGE l'ancien blob refusé.
 */
export const submitVideo = creatorMutation({
  args: {
    id: v.id("assignments"),
    storageId: v.id("_storage"),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, { id, storageId, mimeType }) => {
    const a = await ctx.db.get(id);
    if (!a || a.creatorId !== ctx.creatorId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (
      a.status !== "todo" &&
      a.status !== "in_progress" &&
      a.status !== "video_rejected"
    ) {
      throw new ConvexError("Soumission vidéo impossible dans cet état.");
    }
    // Remplacement : l'ancienne vidéo (refusée) est purgée du storage, et sa
    // copie Cloudflare Stream supprimée (best-effort, hygiène de coût).
    if (a.submittedVideoStorageId && a.submittedVideoStorageId !== storageId) {
      await ctx.storage.delete(a.submittedVideoStorageId);
    }
    if (a.submittedVideoStreamUid) {
      await ctx.scheduler.runAfter(
        0,
        internal.cloudflareStream.deleteStreamAsset,
        { uid: a.submittedVideoStreamUid },
      );
    }
    await ctx.db.patch(id, {
      status: "video_submitted",
      submittedVideoStorageId: storageId,
      submittedVideoMimeType: mimeType ?? "video/mp4",
      // Reset Stream : la nouvelle vidéo repart d'un transcoding neuf (l'UI
      // retombe sur le <video> Convex tant que le UID n'est pas reposé).
      submittedVideoStreamUid: undefined,
      submittedVideoStreamStatus: undefined,
      videoReviewFeedback: undefined,
    });
    // TRANSCODING HEVC (hors chemin critique) : Cloudflare Stream récupère la
    // vidéo depuis l'URL signée Convex et la transcode. Sans env Cloudflare,
    // l'action no-op proprement → fallback Convex. La soumission n'est JAMAIS
    // bloquée par Cloudflare.
    await ctx.scheduler.runAfter(
      0,
      internal.cloudflareStream.startStreamCopy,
      { assignmentId: id },
    );
    return { ok: true };
  },
});

/**
 * Cœur PUBLICATION — PARTAGÉ par confirmPublication (créatrice) et
 * confirmPublicationAsAdmin (admin, comptes gérés). `a` est déjà AUTORISÉ par
 * l'appelant. Matérialise 1 publication/cible, accrue le paiement de BASE AU
 * CRÉDIT de a.creatorId (D3 : la créatrice est payée À L'IDENTIQUE, quel que soit
 * qui colle le lien), PURGE le MP4 s'il existe. Plateforme détectée serveur.
 * IDEMPOTENT (published/paid → no-op). Garde warmup strict #98 INCHANGÉE. `ctx`
 * porte projectId (injecté par les deux wrappers). Type ANNOTÉ (matérialise via
 * ctx.runMutation(internal.*) → TS7022).
 */
async function confirmPublicationCore(
  ctx: MutationCtx & { projectId: Id<"projects"> },
  a: Doc<"assignments">,
  urls: { platform: Plateforme; url: string }[],
  opts: {
    /** Qui a saisi le lien — tracé sur l'assignment (creator vs admin en secours). */
    confirmedBy: "creator" | "admin";
    /** Date de PUBLICATION RÉELLE si l'admin la corrige (post publié avant la
     *  saisie). Absent = maintenant (chemin créatrice, inchangé). */
    publishedAt?: number;
    /** Secours ADMIN : autoriser la publication depuis N'IMPORTE QUEL statut non
     *  publié (todo/in_progress/vidéo en revue/à refaire) — le post existe déjà
     *  hors app, on rattrape et l'assignation passe DIRECTEMENT en `published`.
     *  Absent = chemin créatrice, gate `to_publish` conservé (workflow normal). */
    fromAnyStatus?: boolean;
  },
): Promise<{
  ok: true;
  alreadyPublished: boolean;
  publicationIds: Id<"publications">[];
}> {
  if (a.status === "published" || a.status === "paid") {
    const ids = (a.targets ?? [])
      .map((t) => t.publicationId)
      .filter((p): p is Id<"publications"> => p !== undefined);
    return { ok: true, alreadyPublished: true, publicationIds: ids };
  }
  // Gate workflow : la créatrice ne publie qu'après validation vidéo (to_publish).
  // L'admin en SECOURS (fromAnyStatus) court-circuite : le post existe déjà hors
  // app, coller le lien passe l'assignation directement en `published` (patch final).
  if (a.status !== "to_publish" && !opts.fromAnyStatus) {
    throw new ConvexError(
      "Publication possible seulement après validation de ta vidéo.",
    );
  }
  const targets = a.targets ?? [];
  if (targets.length === 0) {
    throw new ConvexError("Aucune cible sur cet assignment.");
  }

  // Garde warmup au moment de publier (symétrique de validateTargets) : un
  // compte cible peut être REPASSÉ en warmup (relance admin restartWarmup)
  // APRÈS la création de l'assignment. En régime STRICT (Snytch) un compte en
  // warmup — même terminé — n'est pas publiable tant que l'admin ne l'a pas
  // repassé "actif". shadowban/archived ne sont pas re-gatés ici.
  const strict = await isSnytchProject(ctx, ctx.projectId);
  for (const t of targets) {
    if (!t.accountId) continue;
    const compte = await ctx.db.get(t.accountId);
    if (
      compte &&
      compte.status === "warmup" &&
      !isAccountAvailable(compte, { strict })
    ) {
      throw new ConvexError(
        `Le compte ${compte.handle} n'est pas validé pour publier (échauffement en cours ou compte à revalider par l'admin).`,
      );
    }
  }

  // Index des URLs par plateforme + validation de chaque lien (format + plateforme).
  const urlByPlatform = new Map<Plateforme, string>();
  for (const { platform, url } of urls) {
    const trimmed = url.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      throw new ConvexError(
        `URL du post invalide pour ${platform} (lien http(s) attendu).`,
      );
    }
    if (detectPlatform(trimmed) !== platform) {
      throw new ConvexError(
        `L'URL fournie pour ${platform} ne correspond pas à cette plateforme.`,
      );
    }
    urlByPlatform.set(platform, trimmed);
  }

  // TOUTES les cibles doivent avoir une URL (publication groupée, même jour).
  const format = a.formatId ? await ctx.db.get(a.formatId) : null;
  for (const t of targets) {
    if (!urlByPlatform.has(t.platform)) {
      throw new ConvexError(
        `URL manquante pour ${t.platform} — toutes les plateformes sont obligatoires.`,
      );
    }
    if (
      format &&
      format.type !== "custom" &&
      !isFormatAllowedOnPlatform(format.type, t.platform)
    ) {
      throw new ConvexError(
        `Le format « ${format.name} » (${format.type}) ne peut pas être publié sur ${t.platform}.`,
      );
    }
  }

  const now = Date.now();
  // Date de PUBLICATION RÉELLE : l'admin peut la corriger en secours (post publié
  // il y a X jours, lien collé aujourd'hui) → datePubli + suivi des vues + ANCRE de
  // paie calés sur le vrai jour, pas sur la saisie. Créatrice : jamais d'override
  // (= now, inchangé). `now` reste l'horloge des tâches/bookkeeping (purge MP4, row
  // de paie de la période courante) pour ne pas rouvrir une période déjà close.
  const effectiveDate = opts.publishedAt ?? now;
  const dateLabel = new Date(effectiveDate).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
  const isScript = a.scriptCombo !== undefined && a.formatId === undefined;

  const publicationIds: Id<"publications">[] = [];
  const newTargets: NonNullable<Doc<"assignments">["targets"]> = [];
  for (const t of targets) {
    // Idempotence défensive : cible déjà publiée → conservée telle quelle.
    if (t.publicationId !== undefined || t.publishedUrl !== undefined) {
      newTargets.push(t);
      if (t.publicationId) publicationIds.push(t.publicationId);
      continue;
    }
    const url = urlByPlatform.get(t.platform)!;
    const publicationId = await materializeTargetPublication(
      ctx,
      a,
      ctx.projectId,
      t,
      url,
      effectiveDate,
    );
    // Modèle PRICING (pricingSnapshot présent) : AUCUNE lineItem base écrite
    // ici — la paie (fixe/CPM/bonus) est calculée à la lecture, en temps réel
    // sur les vues, et GELÉE au paiement (Guard A/B/C, 0 double paiement).
    // Modèle LEGACY (pas de snapshot) : base PAR POST inchangée.
    if (a.pricingSnapshot === undefined) {
      const label = isScript
        ? `Vidéo — ${t.platform} — ${dateLabel}`
        : `${format?.name ?? "Format"} — ${t.platform} — ${dateLabel}`;
      await accrueBaseLineItem(ctx, {
        projectId: ctx.projectId,
        creatorId: a.creatorId,
        assignmentId: a._id,
        label,
        amount: a.rateSnapshot.basePerPost,
        now,
        platform: t.platform,
      });
    }
    if (publicationId) publicationIds.push(publicationId);
    newTargets.push({
      platform: t.platform,
      accountId: t.accountId,
      publishedUrl: url,
      publishedAt: effectiveDate,
      publicationId: publicationId ?? undefined,
    });
  }

  // Modèle PRICING : pas de lineItem écrite, mais on GARANTIT une row de
  // paiement pour la période → l'admin a une période à marquer payée (le
  // montant pricing est calculé live jusqu'au gel au paiement).
  if (a.pricingSnapshot !== undefined) {
    await getOrCreatePayment(ctx, {
      projectId: ctx.projectId,
      creatorId: a.creatorId,
      period: periodOf(now),
      now,
    });
    // Nouvelle vidéo publiée → recalcule les paliers de bonus du créateur.
    await syncBonusUnlocks(ctx, ctx.projectId, a.creatorId);
  }

  // PURGE du MP4 (1 vidéo pour toutes les cibles, inutile une fois publiée) —
  // côté Convex ET côté Cloudflare Stream (best-effort, hygiène de coût).
  if (a.submittedVideoStorageId) {
    await ctx.storage.delete(a.submittedVideoStorageId);
  }
  if (a.submittedVideoStreamUid) {
    await ctx.scheduler.runAfter(
      0,
      internal.cloudflareStream.deleteStreamAsset,
      { uid: a.submittedVideoStreamUid },
    );
  }

  await ctx.db.patch(a._id, {
    status: "published",
    targets: newTargets,
    // Traçabilité : qui a saisi le lien (créatrice normalement, admin en secours).
    publishedBy: opts.confirmedBy,
    submittedVideoStorageId: undefined,
    submittedVideoMimeType: undefined,
    submittedVideoStreamUid: undefined,
    submittedVideoStreamStatus: undefined,
  });

  // ANCRE du cycle de paie J+30 : figée au TOUT PREMIER post publié du créateur,
  // JAMAIS réécrite (posée seulement si absente → idempotent, stable). Couvre
  // confirmPublication (créatrice) ET confirmPublicationAsAdmin, qui passent tous
  // deux par ce cœur. Sur `effectiveDate` (date RÉELLE) et non la saisie : un lien
  // collé en secours 3 jours après ne décale plus le cycle. N'affecte AUCUN montant.
  const creator = await ctx.db.get(a.creatorId);
  if (creator && creator.firstPostAt === undefined) {
    await ctx.db.patch(a.creatorId, { firstPostAt: effectiveDate });
  }

  return { ok: true, alreadyPublished: false, publicationIds };
}

/**
 * PUBLICATION (CRÉATRICE) — elle fournit l'URL du post publié (étape to_publish).
 * Un compte GÉRÉ par l'équipe est REFUSÉ ici (défense en profondeur, l'UI masque
 * déjà le bouton) : c'est l'admin qui publie (confirmPublicationAsAdmin). Type
 * de retour ANNOTÉ (TS7022).
 */
export const confirmPublication = creatorMutation({
  args: {
    id: v.id("assignments"),
    urls: v.array(v.object({ platform: plateformeValidator, url: v.string() })),
  },
  handler: async (
    ctx,
    { id, urls },
  ): Promise<{
    ok: true;
    alreadyPublished: boolean;
    publicationIds: Id<"publications">[];
  }> => {
    const a = await ctx.db.get(id);
    if (!a || a.creatorId !== ctx.creatorId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.managedByAdmin) {
      throw new ConvexError(
        "Compte géré par l'équipe : la publication est gérée par l'admin.",
      );
    }
    return confirmPublicationCore(ctx, a, urls, { confirmedBy: "creator" });
  },
});

/**
 * PUBLICATION (ADMIN) — l'admin colle le(s) lien(s) à la place de la créatrice.
 * DEUX usages : compte GÉRÉ par l'équipe (nominal) ET compte de CRÉATRICE en
 * SECOURS (elle a oublié de coller le lien). MÊME cœur que confirmPublication → la
 * créatrice est créditée À L'IDENTIQUE. Le flag `managedByAdmin` est REMPLACÉ (pas
 * relâché) par des contrôles EXPLICITES : projet de l'admin + chaque cible existe
 * dans ce projet → la seule différence créatrice↔admin est QUI clique, pas ce qui
 * est vérifié. `publishedAt` optionnel = date RÉELLE corrigeable (l'ancre de paie
 * ne se cale pas sur la saisie). Type de retour ANNOTÉ (TS7022).
 */
export const confirmPublicationAsAdmin = adminMutation({
  args: {
    id: v.id("assignments"),
    urls: v.array(v.object({ platform: plateformeValidator, url: v.string() })),
    // Date de publication RÉELLE (secours : lien collé après-coup). Absente = now.
    // Bornée dans le handler (ni futur, ni avant la création de l'assignment).
    publishedAt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { id, urls, publishedAt },
  ): Promise<{
    ok: true;
    alreadyPublished: boolean;
    publicationIds: Id<"publications">[];
  }> => {
    const a = await ctx.db.get(id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    // Remplace le gate managedByAdmin : chaque cible doit exister DANS le projet de
    // l'admin (ce que le flag portait implicitement) — vaut pour compte géré ET
    // compte de créatrice. L'appartenance projet de l'assignment est déjà vérifiée.
    for (const t of a.targets ?? []) {
      if (!t.accountId) continue;
      const compte = await ctx.db.get(t.accountId);
      if (!compte || compte.projectId !== ctx.projectId) {
        throw new ConvexError("Compte cible introuvable dans le projet.");
      }
    }
    // Date réelle bornée : ni dans le futur, ni avant la création de l'assignment
    // (sinon l'ancre de paie J+30 se calerait n'importe où).
    if (publishedAt !== undefined) {
      if (publishedAt > Date.now()) {
        throw new ConvexError(
          "La date de publication ne peut pas être dans le futur.",
        );
      }
      if (publishedAt < a.createdAt) {
        throw new ConvexError(
          "La date de publication ne peut pas précéder la création de l'assignment.",
        );
      }
    }
    return confirmPublicationCore(ctx, a, urls, {
      confirmedBy: "admin",
      publishedAt,
      // Secours : l'admin publie même une assignation restée en "À faire" (post
      // publié hors app) → passage direct en `published`, pas de gate to_publish.
      fromAnyStatus: true,
    });
  },
});

/** Notif in-app : nb de mes assignments « à publier » (vidéo validée). */
export const countMyToPublish = creatorQuery({
  args: {},
  handler: async (ctx) => {
    const mine = await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", ctx.creatorId))
      .collect();
    // Comptes GÉRÉS exclus : c'est l'admin qui publie, la créatrice n'a rien à
    // faire sur ces assignments (lecture seule).
    return mine.filter((a) => a.status === "to_publish" && !a.managedByAdmin)
      .length;
  },
});

/**
 * Statuts ACTIONNABLES par le créateur (= il a quelque chose à faire MAINTENANT).
 * ⚠️ Règle A6 — RÉPLIQUE de lib/assignment-status.isActionable (convex/ ne peut
 * pas importer lib/) : garder les deux EN PHASE. Ce sont EXACTEMENT les catégories
 * mises en avant par le dashboard créateur : à produire (todo / in_progress) +
 * à publier (to_publish) + à refaire (video_rejected, + legacy rejected).
 */
const ACTIONABLE_STATUSES = new Set<string>([
  "todo",
  "in_progress",
  "video_rejected",
  "to_publish",
  "rejected", // legacy
]);

/**
 * Notif in-app : nb TOTAL de mes assignments ACTIONNABLES (à produire + à publier
 * + à refaire) — alimente le badge de l'onglet « Accueil » pour qu'une NOUVELLE
 * mission ou une vidéo REFUSÉE génère bien le badge (countMyToPublish n'en couvre
 * qu'un tiers). LECTURE seule, scopée au créateur courant (ctx.creatorId, déjà
 * propre au projet) : aucune écriture, aucun statut modifié, pas de fuite
 * cross-créateur/cross-projet.
 */
async function actionableCount(ctx: QueryCtx, creatorId: Id<"creators">) {
  const mine = await ctx.db
    .query("assignments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  // Comptes GÉRÉS exclus des actionnables : la créatrice ne produit/soumet/publie
  // rien dessus (l'équipe s'en charge) → ils ne badgent jamais son Accueil.
  return mine.filter(
    (a) => ACTIONABLE_STATUSES.has(a.status) && !a.managedByAdmin,
  ).length;
}

export const countMyActionable = creatorQuery({
  args: {},
  handler: async (ctx) => actionableCount(ctx, ctx.creatorId),
});

/** ADMIN view-as — nb d'assignments actionnables du créateur ciblé (badge accueil). */
export const countActionableAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) => actionableCount(ctx, ctx.creatorId),
});

// ─── Cleanup e2e (gated E2E_SECRET) ──────────────────────────────────────────

/**
 * Force le statut (+ feedback) d'un assignment — UNIQUEMENT pour les tests
 * (la validation/rejet admin arrive au chantier suivant). Permet de tester la
 * resoumission depuis "rejected".
 */
export const e2eSetAssignmentStatus = e2eMutation({
  args: {
    id: v.id("assignments"),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("video_submitted"),
      v.literal("video_rejected"),
      v.literal("to_publish"),
      v.literal("published"),
      v.literal("paid"),
    ),
    videoReviewFeedback: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, videoReviewFeedback }) => {
    await ctx.db.patch(id, { status, videoReviewFeedback });
    return { ok: true };
  },
});

/**
 * E2E — injecte directement le UID + l'état Cloudflare Stream sur une soumission,
 * SANS appel réseau réel : c'est ainsi que la CI « mocke » Cloudflare (cf
 * apify-sync). Exerce le VRAI rendu (player si "ready", message si "processing",
 * fallback si absent) sans dépendre du transcoding réel. uid null = retire le
 * Stream (revient au fallback Convex).
 */
export const e2eSetSubmittedVideoStream = e2eMutation({
  args: {
    id: v.id("assignments"),
    uid: v.union(v.string(), v.null()),
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("ready"),
        v.literal("error"),
      ),
    ),
  },
  handler: async (ctx, { id, uid, status }) => {
    await ctx.db.patch(id, {
      submittedVideoStreamUid: uid ?? undefined,
      submittedVideoStreamStatus: uid ? (status ?? "processing") : undefined,
    });
    return { ok: true };
  },
});

/** Supprime les assignments liés à un créateur/format de test ([E2E_TEST]). */
export const cleanupTestAssignments = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("assignments").collect();
    let deleted = 0;
    for (const a of all) {
      const creator = await ctx.db.get(a.creatorId);
      const format = a.formatId ? await ctx.db.get(a.formatId) : null;
      const isTest =
        (creator && creator.name.startsWith("[E2E_TEST]")) ||
        (creator && creator.email.includes("e2e-creator")) ||
        (format && format.name.startsWith("[E2E_TEST]"));
      if (isTest) {
        // P8/Chantier C — cascade : les publications matérialisées (1 par cible,
        // + legacy a.publicationId) ont notes="" (non captées par
        // cleanupTestPublications) → on les supprime ici, avec leurs snapshots.
        const pubIds = [
          ...(a.targets ?? []).map((t) => t.publicationId),
          a.publicationId,
        ].filter((p): p is Id<"publications"> => p !== undefined);
        for (const pubId of pubIds) {
          const snaps = await ctx.db
            .query("metricSnapshots")
            .withIndex("by_publication", (q) => q.eq("publicationId", pubId))
            .collect();
          for (const s of snaps) await ctx.db.delete(s._id);
          await ctx.db.delete(pubId);
        }
        await ctx.db.delete(a._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

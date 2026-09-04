import {
  adminViewAsTalentQuery,
  e2eMutation,
  permissionMutation,
  permissionQuery,
  talentQuery,
} from "./functions";
import {
  pickTalentBrief,
  TALENT_BRIEF_FIELDS,
} from "./talentBriefFields";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * P6 Formats — bibliothèque de briefs par projet (CRUD admin). Les vidéos
 * exemples « fichier » sont stockées dans Convex storage (jamais téléchargeables,
 * jamais publiées) ; leur URL est résolue SERVEUR dans les queries (cf
 * publications → imageUrl). Les hooks sont embarqués en TEXTE (auto-suffisant).
 *
 * Ce module était 100 % adminQuery/adminMutation. Une seule exception depuis le
 * chantier talent : `getMyTalentBrief`, dont la sortie est réduite par une
 * allowlist (cf convex/talentBriefFields.ts) — un format porte des textes de
 * script et une grille de paie, il ne sort jamais entier hors de l'admin.
 * `getTalentBriefAsAdmin` (observation) passe par le MÊME cœur et donc la MÊME
 * allowlist : l'admin lit ce que le talent lit, pas davantage.
 */

const typeValidator = v.union(
  v.literal("carousel"),
  v.literal("short"),
  v.literal("screenrecorder"),
  v.literal("custom"),
);
const statusValidator = v.union(v.literal("active"), v.literal("archived"));
const guidelinesValidator = v.object({
  do: v.array(v.string()),
  dont: v.array(v.string()),
});
const exampleVideosValidator = v.array(
  v.union(
    v.object({
      kind: v.literal("file"),
      storageId: v.id("_storage"),
      title: v.string(),
      mimeType: v.string(),
    }),
    v.object({
      kind: v.literal("url"),
      url: v.string(),
      platform: v.union(
        v.literal("tiktok"),
        v.literal("youtube"),
        v.literal("instagram"),
      ),
      title: v.string(),
    }),
  ),
);
const rateModelValidator = v.object({
  basePerPost: v.number(),
  viewBonusPer1k: v.optional(v.number()),
  bounties: v.optional(
    v.array(v.object({ thresholdViews: v.number(), amount: v.number() })),
  ),
});

type ExampleVideo = Doc<"formats">["exampleVideos"][number];

function fileStorageIds(examples: ExampleVideo[]): Id<"_storage">[] {
  return examples
    .filter((e): e is Extract<ExampleVideo, { kind: "file" }> => e.kind === "file")
    .map((e) => e.storageId);
}

/**
 * Résout l'URL signée des exemples « fichier » (storage). Les exemples « url »
 * sont renvoyés tels quels. Jamais d'URL de storage stockée en DB → toujours
 * résolue à la lecture.
 */
export async function withResolvedExamples(ctx: QueryCtx, format: Doc<"formats">) {
  const exampleVideos = await Promise.all(
    format.exampleVideos.map(async (e) =>
      e.kind === "file"
        ? { ...e, url: await ctx.storage.getUrl(e.storageId) }
        : e,
    ),
  );
  return { ...format, exampleVideos };
}

/** Format ENRICHI (URLs signées résolues) — la forme que rend withResolvedExamples. */
type ResolvedFormat = Awaited<ReturnType<typeof withResolvedExamples>>;

/**
 * Brief servi au TALENT. Le type DÉRIVE de l'allowlist : ajouter un champ à
 * `TALENT_BRIEF_FIELDS` l'ouvre ici, et rien d'autre ne peut sortir sans y
 * passer — tsc refuse le reste.
 */
export type TalentBriefView = Pick<
  ResolvedFormat,
  (typeof TALENT_BRIEF_FIELDS)[number]
>;

/**
 * Un format est-il « référencé » (→ suppression interdite, archivage proposé) ?
 * P7 — branché sur les assignments : un format ayant au moins un assignment ne
 * peut pas être supprimé (le brief reste nécessaire à la fiche assignment).
 */
async function isFormatReferenced(
  ctx: QueryCtx | MutationCtx,
  formatId: Id<"formats">,
): Promise<boolean> {
  const a = await ctx.db
    .query("assignments")
    .withIndex("by_format", (q) => q.eq("formatId", formatId))
    .first();
  return a !== null;
}

/** Un storageId est-il référencé par un AUTRE format du projet ? */
async function storageUsedByOtherFormat(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  storageId: Id<"_storage">,
  excludeFormatId: Id<"formats">,
): Promise<boolean> {
  const formats = await ctx.db
    .query("formats")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return formats.some(
    (f) =>
      f._id !== excludeFormatId &&
      f.exampleVideos.some((e) => e.kind === "file" && e.storageId === storageId),
  );
}

/** Supprime les blobs des storageIds qui ne sont plus référencés ailleurs. */
async function deleteOrphanBlobs(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  storageIds: Id<"_storage">[],
  excludeFormatId: Id<"formats">,
) {
  for (const id of storageIds) {
    if (!(await storageUsedByOtherFormat(ctx, projectId, id, excludeFormatId))) {
      await ctx.storage.delete(id);
    }
  }
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const listFormats = permissionQuery("scripts.manage")({
  args: {},
  handler: async (ctx) => {
    const formats = await ctx.db
      .query("formats")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const sorted = formats.sort((a, b) => {
      const byStatus =
        (a.status === "archived" ? 1 : 0) - (b.status === "archived" ? 1 : 0);
      if (byStatus !== 0) return byStatus;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    });
    // Liste : pas besoin de résoudre les URLs (la page détail le fait).
    //
    // PROJECTION EXPLICITE, et surtout PAS le document brut : un format porte une
    // GRILLE DE RÉMUNÉRATION (`rateModel`). La servir ici la mettrait dans le
    // navigateur de tous les écrans qui listent des formats — aucun ne l'affiche.
    // Elle a sa propre lecture, `getFormatRateModel`, gardée par `pricing.manage`.
    return sorted.map((f) => ({
      _id: f._id,
      _creationTime: f._creationTime,
      projectId: f.projectId,
      name: f.name,
      type: f.type,
      brief: f.brief,
      hooks: f.hooks,
      guidelines: f.guidelines,
      exampleVideos: f.exampleVideos,
      status: f.status,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));
  },
});

export const getFormat = permissionQuery("scripts.manage")({
  args: { id: v.id("formats") },
  handler: async (ctx, { id }) => {
    const format = await ctx.db.get(id);
    if (!format || format.projectId !== ctx.projectId) return null;
    const resolved = await withResolvedExamples(ctx, format);
    // Même raison que listFormats : `rateModel` ne sort pas d'ici.
    return {
      _id: resolved._id,
      _creationTime: resolved._creationTime,
      projectId: resolved.projectId,
      name: resolved.name,
      type: resolved.type,
      brief: resolved.brief,
      hooks: resolved.hooks,
      guidelines: resolved.guidelines,
      exampleVideos: resolved.exampleVideos,
      status: resolved.status,
      createdAt: resolved.createdAt,
      updatedAt: resolved.updatedAt,
      isReferenced: await isFormatReferenced(ctx, id),
    };
  },
});

/**
 * BRIEF PERMANENT DU TALENT — cœur de lecture, partagé par la query TALENT
 * (`getMyTalentBrief`, la seule lecture non-admin de ce module) et par la query
 * d'OBSERVATION admin (`getTalentBriefAsAdmin`).
 *
 * Le talent n'a pas d'assignation : là où le partenaire découvre un brief à
 * travers une mission, lui a une consigne PERMANENTE, la même à chaque dépôt.
 * Elle pointe un `formats` du projet (projects.talentBriefFormatId) pour que
 * l'admin l'édite avec l'outil qu'il connaît déjà, exemples vidéo compris.
 *
 * ⚠️ Un format est un objet RICHE, conçu pour le partenaire : il porte aussi des
 * TEXTES DE SCRIPT (`hooks`) et une grille de RÉMUNÉRATION (`rateModel`). La
 * sortie passe donc par une allowlist (convex/talentBriefFields.ts), jamais par
 * un spread — c'est exactement le geste qui a produit deux fuites réelles côté
 * assignments (#167, #169).
 *
 * Renvoie `null` si aucun format n'est désigné, ou s'il a été supprimé : l'écran
 * affiche un état honnête plutôt qu'un cadre vide inexpliqué.
 */
async function talentBriefFor(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<TalentBriefView | null> {
  const project = await ctx.db.get(projectId);
  const formatId = project?.talentBriefFormatId;
  if (!formatId) return null;
  const format = await ctx.db.get(formatId);
  // Défense en profondeur : un format d'un AUTRE projet ne sort jamais, même
  // si le champ le désignait (édition manuelle, projet dupliqué).
  if (!format || format.projectId !== projectId) return null;
  const resolved = await withResolvedExamples(ctx, format);
  return pickTalentBrief(resolved) as TalentBriefView;
}

export const getMyTalentBrief = talentQuery({
  args: {},
  handler: async (ctx): Promise<TalentBriefView | null> =>
    talentBriefFor(ctx, ctx.projectId),
});

/**
 * ADMIN observation — le brief tel que le talent ciblé le lit.
 *
 * ⚠️ `creatorId` (exigé par le wrapper) NE FILTRE RIEN ICI, et c'est normal : le
 * brief est attaché au PROJET, pas à la personne — deux talents du même projet
 * lisent le même. L'argument sert à VÉRIFIER LA POPULATION observée : sans lui,
 * cette query rendrait le brief talent en observant un partenaire ou un clippeur,
 * c'est-à-dire un écran qui n'existe pas dans leur espace.
 *
 * NE PAS le retirer au motif qu'il est inutilisé dans le corps. C'est le wrapper
 * qui le consomme, pas le handler.
 */
export const getTalentBriefAsAdmin = adminViewAsTalentQuery({
  args: {},
  handler: async (ctx): Promise<TalentBriefView | null> =>
    talentBriefFor(ctx, ctx.projectId),
});

// ─── Mutations ─────────────────────────────────────────────────────────────

function validateRate(rate: NonNullable<Doc<"formats">["rateModel"]>) {
  if (!Number.isFinite(rate.basePerPost) || rate.basePerPost < 0) {
    throw new ConvexError("Le tarif de base doit être un nombre ≥ 0.");
  }
  if (
    rate.viewBonusPer1k !== undefined &&
    (!Number.isFinite(rate.viewBonusPer1k) || rate.viewBonusPer1k < 0)
  ) {
    throw new ConvexError("Le bonus aux vues doit être un nombre ≥ 0.");
  }
  for (const b of rate.bounties ?? []) {
    if (b.thresholdViews < 0 || b.amount < 0) {
      throw new ConvexError("Les paliers de prime doivent être ≥ 0.");
    }
  }
}

// ─── GRILLE DE RÉMUNÉRATION D'UN FORMAT — bloc `pricing.manage` ─────────────
//
// `rateModel` décide de ce que rapporte chaque vidéo produite sur ce format :
// `assignments.assignFormat` en fait une COPIE FIGÉE (`rateSnapshot`) au moment
// de l'attribution. Le modifier ne rejoue pas le passé, mais il fixe le prix de
// tout ce qui sera assigné ensuite — c'est un geste de barème, pas d'édition de
// brief. D'où sa sortie de `createFormat`/`updateFormat`.

/** La grille d'UN format. `null` si le format est introuvable ou hors projet. */
export const getFormatRateModel = permissionQuery("pricing.manage")({
  args: { id: v.id("formats") },
  handler: async (ctx, { id }) => {
    const format = await ctx.db.get(id);
    if (!format || format.projectId !== ctx.projectId) return null;
    return format.rateModel ?? null;
  },
});

/**
 * Pose la grille d'un format. Remplace l'ensemble (fixe + bonus aux vues +
 * paliers de prime) : une grille partielle n'a pas de sens, et un patch champ à
 * champ laisserait un ancien palier survivre à une refonte du barème.
 *
 * ⚠️ N'affecte QUE les attributions FUTURES. Les assignations existantes portent
 * leur `rateSnapshot`, figé à l'attribution et jamais réécrit (cf. convex/pricing
 * et la dérive de snapshot). Changer une grille ne re-tarifie rien de ce qui a
 * déjà été confié — c'est voulu, et c'est ce qui rend le geste réversible.
 */
export const setFormatRateModel = permissionMutation("pricing.manage")({
  args: { id: v.id("formats"), rateModel: rateModelValidator },
  handler: async (ctx, { id, rateModel }) => {
    const format = await ctx.db.get(id);
    if (!format || format.projectId !== ctx.projectId) {
      throw new ConvexError("Format introuvable.");
    }
    validateRate(rateModel);
    await ctx.db.patch(id, { rateModel, updatedAt: Date.now() });
  },
});

export const createFormat = permissionMutation("scripts.manage")({
  args: {
    name: v.string(),
    type: typeValidator,
    brief: v.optional(v.string()),
    hooks: v.optional(v.array(v.string())),
    guidelines: v.optional(guidelinesValidator),
    exampleVideos: v.optional(exampleVideosValidator),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0) throw new ConvexError("Le nom du format est requis.");
    // Un format NAÎT SANS GRILLE — champ absent, pas `{ basePerPost: 0 }`. La
    // nuance est ce qui protège la paie : `assignFormat` refuse d'assigner un
    // format dont la grille n'a jamais été renseignée, alors qu'un zéro EXPLICITE
    // (posé par `setFormatRateModel`) reste assignable. Sans elle, un format créé
    // puis assigné avant que quelqu'un ait décidé du tarif figerait des missions
    // à 0 € et la créatrice travaillerait gratuitement.
    const now = Date.now();
    return await ctx.db.insert("formats", {
      projectId: ctx.projectId,
      name,
      type: args.type,
      brief: args.brief ?? "",
      hooks: args.hooks ?? [],
      guidelines: args.guidelines ?? { do: [], dont: [] },
      exampleVideos: args.exampleVideos ?? [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateFormat = permissionMutation("scripts.manage")({
  args: {
    id: v.id("formats"),
    name: v.optional(v.string()),
    type: v.optional(typeValidator),
    brief: v.optional(v.string()),
    hooks: v.optional(v.array(v.string())),
    guidelines: v.optional(guidelinesValidator),
    exampleVideos: v.optional(exampleVideosValidator),
    status: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    const format = await ctx.db.get(args.id);
    if (!format || format.projectId !== ctx.projectId) {
      throw new ConvexError("Format introuvable.");
    }
    const patch: Partial<Doc<"formats">> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length === 0) throw new ConvexError("Le nom est requis.");
      patch.name = name;
    }
    if (args.type !== undefined) patch.type = args.type;
    if (args.brief !== undefined) patch.brief = args.brief;
    if (args.hooks !== undefined) patch.hooks = args.hooks;
    if (args.guidelines !== undefined) patch.guidelines = args.guidelines;
    if (args.status !== undefined) patch.status = args.status;

    if (args.exampleVideos !== undefined) {
      // Diff des fichiers : ceux retirés voient leur blob supprimé (sauf s'ils
      // sont référencés par un autre format).
      const oldIds = fileStorageIds(format.exampleVideos);
      const newIds = new Set(fileStorageIds(args.exampleVideos).map(String));
      const removed = oldIds.filter((id) => !newIds.has(String(id)));
      patch.exampleVideos = args.exampleVideos;
      await ctx.db.patch(args.id, patch);
      await deleteOrphanBlobs(ctx, ctx.projectId, removed, args.id);
      return;
    }
    await ctx.db.patch(args.id, patch);
  },
});

export const deleteFormat = permissionMutation("scripts.manage")({
  args: { id: v.id("formats") },
  handler: async (ctx, { id }) => {
    const format = await ctx.db.get(id);
    if (!format || format.projectId !== ctx.projectId) {
      throw new ConvexError("Format introuvable.");
    }
    if (await isFormatReferenced(ctx, id)) {
      throw new ConvexError(
        "Ce format est référencé. Archive-le plutôt que de le supprimer.",
      );
    }
    // Supprime les blobs des exemples fichier non partagés avec un autre format.
    await deleteOrphanBlobs(ctx, ctx.projectId, fileStorageIds(format.exampleVideos), id);
    await ctx.db.delete(id);
  },
});

// ─── Cleanup e2e (gated E2E_SECRET) ──────────────────────────────────────────

/** Supprime les formats de test (nom [E2E_TEST]) + leurs blobs fichier. */
export const cleanupTestFormats = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("formats").collect();
    let deleted = 0;
    for (const f of all) {
      if (!f.name.startsWith("[E2E_TEST]")) continue;
      for (const e of f.exampleVideos) {
        if (e.kind === "file") {
          try {
            await ctx.storage.delete(e.storageId);
          } catch {
            /* blob déjà supprimé — ignore */
          }
        }
      }
      await ctx.db.delete(f._id);
      deleted++;
    }
    return { deleted };
  },
});

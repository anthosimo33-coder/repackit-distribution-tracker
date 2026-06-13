import { adminMutation, adminQuery, e2eMutation } from "./functions";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * P6 Formats — bibliothèque de briefs par projet (CRUD admin). Les vidéos
 * exemples « fichier » sont stockées dans Convex storage (jamais téléchargeables,
 * jamais publiées) ; leur URL est résolue SERVEUR dans les queries (cf
 * publications → imageUrl). Les hooks sont embarqués en TEXTE (auto-suffisant).
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
async function withResolvedExamples(ctx: QueryCtx, format: Doc<"formats">) {
  const exampleVideos = await Promise.all(
    format.exampleVideos.map(async (e) =>
      e.kind === "file"
        ? { ...e, url: await ctx.storage.getUrl(e.storageId) }
        : e,
    ),
  );
  return { ...format, exampleVideos };
}

/**
 * Un format est-il « référencé » (→ suppression interdite, archivage proposé) ?
 * HOOK pour les futurs assignments : aucune table d'assignment n'existe encore,
 * donc retourne false aujourd'hui. Quand les assignments arriveront, brancher
 * ici la vérification (assignments.formatId === formatId).
 */
async function isFormatReferenced(
  _ctx: QueryCtx | MutationCtx,
  _formatId: Id<"formats">,
): Promise<boolean> {
  return false;
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

export const listFormats = adminQuery({
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
    return sorted;
  },
});

export const getFormat = adminQuery({
  args: { id: v.id("formats") },
  handler: async (ctx, { id }) => {
    const format = await ctx.db.get(id);
    if (!format || format.projectId !== ctx.projectId) return null;
    const resolved = await withResolvedExamples(ctx, format);
    return { ...resolved, isReferenced: await isFormatReferenced(ctx, id) };
  },
});

// ─── Mutations ─────────────────────────────────────────────────────────────

function validateRate(rate: Doc<"formats">["rateModel"]) {
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

export const createFormat = adminMutation({
  args: {
    name: v.string(),
    type: typeValidator,
    brief: v.optional(v.string()),
    hooks: v.optional(v.array(v.string())),
    guidelines: v.optional(guidelinesValidator),
    exampleVideos: v.optional(exampleVideosValidator),
    rateModel: v.optional(rateModelValidator),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0) throw new ConvexError("Le nom du format est requis.");
    const rateModel = args.rateModel ?? { basePerPost: 0 };
    validateRate(rateModel);
    const now = Date.now();
    return await ctx.db.insert("formats", {
      projectId: ctx.projectId,
      name,
      type: args.type,
      brief: args.brief ?? "",
      hooks: args.hooks ?? [],
      guidelines: args.guidelines ?? { do: [], dont: [] },
      exampleVideos: args.exampleVideos ?? [],
      rateModel,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateFormat = adminMutation({
  args: {
    id: v.id("formats"),
    name: v.optional(v.string()),
    type: v.optional(typeValidator),
    brief: v.optional(v.string()),
    hooks: v.optional(v.array(v.string())),
    guidelines: v.optional(guidelinesValidator),
    exampleVideos: v.optional(exampleVideosValidator),
    rateModel: v.optional(rateModelValidator),
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
    if (args.rateModel !== undefined) {
      validateRate(args.rateModel);
      patch.rateModel = args.rateModel;
    }
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

export const deleteFormat = adminMutation({
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

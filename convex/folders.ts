import { e2eMutation, projectMutation, projectQuery } from "./functions";
import { v, ConvexError } from "convex/values";

const MAX_NAME_LENGTH = 80;

/**
 * Dossiers d'inspirations — P2 scopé par ctx.projectId. inspirationCount ne
 * compte que les inspirations du même projet.
 */
export const listFolders = projectQuery({
  args: {},
  handler: async (ctx) => {
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const allInspirations = await ctx.db
      .query("inspirations")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const sorted = folders.sort((a, b) =>
      a.name.localeCompare(b.name, "fr", { sensitivity: "base" }),
    );
    return sorted.map((f) => ({
      ...f,
      inspirationCount: allInspirations.filter((i) => i.folderId === f._id)
        .length,
    }));
  },
});

export const createFolder = projectMutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trimmed = args.name.trim();
    if (trimmed.length === 0) {
      throw new ConvexError("Nom de dossier requis.");
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      throw new ConvexError(
        `Nom de dossier trop long (max ${MAX_NAME_LENGTH} caractères).`,
      );
    }
    // Dedupe insensible à la casse DANS le projet.
    const existing = await ctx.db
      .query("folders")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const dup = existing.find(
      (f) => f.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (dup) {
      throw new ConvexError(`Dossier "${trimmed}" existe déjà.`);
    }
    const now = Date.now();
    return await ctx.db.insert("folders", {
      projectId: ctx.projectId,
      name: trimmed,
      description: args.description,
      color: args.color,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Patch partiel d'un dossier. name vérifié (1-80 char, dedupe case-insensitive
 * DANS le projet en excluant soi-même). updatedAt bumpé toujours.
 */
export const updateFolder = projectMutation({
  args: {
    id: v.id("folders"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.projectId !== ctx.projectId) {
      throw new ConvexError("Dossier introuvable.");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const trimmed = args.name.trim();
      if (trimmed.length === 0) {
        throw new ConvexError("Nom de dossier requis.");
      }
      if (trimmed.length > MAX_NAME_LENGTH) {
        throw new ConvexError(
          `Nom de dossier trop long (max ${MAX_NAME_LENGTH} caractères).`,
        );
      }
      if (trimmed.toLowerCase() !== existing.name.toLowerCase()) {
        const all = await ctx.db
          .query("folders")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect();
        const dup = all.find(
          (f) =>
            f._id !== args.id &&
            f.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (dup) {
          throw new ConvexError(`Dossier "${trimmed}" existe déjà.`);
        }
      }
      patch.name = trimmed;
    }
    if (args.description !== undefined) patch.description = args.description;
    if (args.color !== undefined) patch.color = args.color;

    await ctx.db.patch(args.id, patch);
  },
});

/**
 * Suppression avec cascade unset (les inspirations du dossier passent à "Non
 * classé"). Scope projet : on ne touche que les inspirations du même projet.
 */
export const deleteFolder = projectMutation({
  args: { id: v.id("folders") },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.id);
    if (!folder || folder.projectId !== ctx.projectId) {
      return { unsetCount: 0 };
    }
    const affected = await ctx.db
      .query("inspirations")
      .withIndex("by_folder", (q) => q.eq("folderId", args.id))
      .collect();
    const now = Date.now();
    for (const i of affected) {
      await ctx.db.patch(i._id, { folderId: undefined, updatedAt: now });
    }
    await ctx.db.delete(args.id);
    return { unsetCount: affected.length };
  },
});

/**
 * Test-only cleanup (project-agnostic, par marker [E2E_TEST]). Inchangé P2.
 */
export const cleanupTestFolders = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("folders").collect();
    let deleted = 0;
    for (const f of all) {
      if ((f.description ?? "").startsWith("[E2E_TEST]")) {
        await ctx.db.delete(f._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

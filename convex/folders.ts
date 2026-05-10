import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

/**
 * Batch F — list folders triés par name asc. Pas de count par dossier
 * dans Batch F (vient en G via le pattern listHooksWithUsage : collect +
 * groupBy mémoire sur folderId).
 */
export const listFolders = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("folders").collect();
    return rows.sort((a, b) =>
      a.name.localeCompare(b.name, "fr", { sensitivity: "base" }),
    );
  },
});

export const createFolder = mutation({
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
    if (trimmed.length > 80) {
      throw new ConvexError("Nom de dossier trop long (max 80 caractères).");
    }
    // Dedupe insensible à la casse (pattern createCompte de convex/comptes.ts).
    const existing = await ctx.db.query("folders").collect();
    const dup = existing.find(
      (f) => f.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (dup) {
      throw new ConvexError(`Dossier "${trimmed}" existe déjà.`);
    }
    const now = Date.now();
    return await ctx.db.insert("folders", {
      name: trimmed,
      description: args.description,
      color: args.color,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Test-only cleanup. Supprime les folders dont la description commence par
 * [E2E_TEST]. Symétrique à cleanupTestInspirations. Pas de pendant
 * deleteFolder dans Batch F (vient en G avec la décision unset cascade).
 */
export const cleanupTestFolders = mutation({
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

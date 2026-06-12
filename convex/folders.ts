import { authedMutation, authedQuery, e2eMutation } from "./functions";
import { v, ConvexError } from "convex/values";

const MAX_NAME_LENGTH = 80;

/**
 * Batch F → G — list folders triés par name asc, enrichi avec
 * inspirationCount (nombre d'inspirations dont folderId === folder._id).
 *
 * Pattern N+1 mémoire : collect inspirations une fois, group côté handler
 * (parallèle listHooksWithUsage de convex/hooks.ts). À 50 dossiers / 500
 * inspirations, c'est O(F*I) ≈ 25k comparaisons → < 10ms.
 *
 * Champ inspirationCount additif : ne casse pas les callers Batch F qui
 * lisent uniquement name / _id / color.
 */
export const listFolders = authedQuery({
  args: {},
  handler: async (ctx) => {
    const folders = await ctx.db.query("folders").collect();
    const allInspirations = await ctx.db.query("inspirations").collect();
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

export const createFolder = authedMutation({
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
 * Batch G — patch partiel d'un dossier. name vérifié (1-80 char, dedupe
 * case-insensitive en excluant soi-même). updatedAt bumpé toujours.
 */
export const updateFolder = authedMutation({
  args: {
    id: v.id("folders"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
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
        const all = await ctx.db.query("folders").collect();
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
 * Batch G — suppression avec cascade unset. Décision tranchée : on ne
 * détruit pas les inspirations contenues, on les déplace vers "Non classé"
 * (folderId mis à undefined côté DB via patch). Comportement non
 * destructif = zéro perte de data.
 *
 * Idempotent : suppression d'un id inexistant est silencieuse.
 * Retourne { unsetCount } pour info UI (toast). Atomicité Convex garantit
 * que si le patch d'une inspiration échoue, le delete du folder n'a pas
 * lieu (rollback automatique de la mutation).
 */
export const deleteFolder = authedMutation({
  args: { id: v.id("folders") },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.id);
    if (!folder) return { unsetCount: 0 };
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
 * Test-only cleanup. Supprime les folders dont la description commence par
 * [E2E_TEST]. Symétrique à cleanupTestInspirations.
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

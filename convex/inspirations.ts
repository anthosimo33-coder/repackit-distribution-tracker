import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

const plateformeValidator = v.union(
  v.literal("TikTok"),
  v.literal("Instagram"),
  v.literal("YouTube"),
);

const typeValidator = v.union(v.literal("video"), v.literal("account"));

const statsValidator = v.object({
  views: v.optional(v.number()),
  likes: v.optional(v.number()),
  followers: v.optional(v.number()),
  comments: v.optional(v.number()),
  capturedAt: v.optional(v.number()),
});

/**
 * Batch F — list inspirations triées par createdAt desc, enrichies avec
 * thumbnailUrl résolu via ctx.storage.getUrl (pattern listPublications du
 * Batch D). N+1 acceptable au volume initial (< 100 rows attendus).
 *
 * Args optionnels (folderId / plateforme / type / isFavorite / search) sont
 * acceptés mais IGNORÉS dans Batch F : le filtrage côté query Convex sera
 * câblé en Batch G. La signature est posée dès maintenant pour éviter une
 * migration de callsites au moment où on activera les filtres.
 */
export const listInspirations = query({
  args: {
    folderId: v.optional(v.union(v.id("folders"), v.null())),
    plateforme: v.optional(plateformeValidator),
    type: v.optional(typeValidator),
    isFavorite: v.optional(v.boolean()),
    search: v.optional(v.string()),
  },
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("inspirations")
      .withIndex("by_createdAt")
      .order("desc")
      .collect();

    return await Promise.all(
      rows.map(async (i) => {
        const thumbnailUrl =
          i.thumbnail !== undefined && i.thumbnail !== null
            ? await ctx.storage.getUrl(i.thumbnail)
            : null;
        return { ...i, thumbnailUrl };
      }),
    );
  },
});

export const createInspiration = mutation({
  args: {
    url: v.string(),
    type: typeValidator,
    plateforme: plateformeValidator,
    thumbnail: v.optional(v.id("_storage")),
    titre: v.optional(v.string()),
    notes: v.optional(v.string()),
    stats: v.optional(statsValidator),
    folderId: v.optional(v.id("folders")),
    isFavorite: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    if (args.url.trim().length === 0) {
      throw new ConvexError("URL requise.");
    }
    const now = Date.now();
    return await ctx.db.insert("inspirations", {
      url: args.url,
      type: args.type,
      plateforme: args.plateforme,
      thumbnail: args.thumbnail,
      titre: args.titre,
      notes: args.notes,
      stats: args.stats,
      folderId: args.folderId,
      isFavorite: args.isFavorite ?? false,
      tags: args.tags ?? [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Test-only cleanup. Mirrors le pattern clearHooks de convex/hooks.ts :
 * supprime les rows dont les notes commencent par le marker [E2E_TEST]
 * (cf e2e/helpers/cleanup.ts). Pas de pendant deleteInspiration en Batch F
 * (vient en G) ; cette mutation reste utile en parallèle pour cleanup
 * bulk par marker.
 */
export const cleanupTestInspirations = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("inspirations").collect();
    let deleted = 0;
    for (const i of all) {
      if ((i.notes ?? "").startsWith("[E2E_TEST]")) {
        await ctx.db.delete(i._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

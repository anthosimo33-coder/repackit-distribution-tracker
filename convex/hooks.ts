import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const seedHooks = mutation({
  args: {
    hooks: v.array(
      v.object({
        text: v.string(),
        mecanique: v.union(
          v.literal("Erreur"),
          v.literal("Volume"),
          v.literal("Comparaison"),
          v.literal("Contradiction"),
          v.literal("Universalité"),
          v.literal("Question"),
        ),
        niveau: v.union(
          v.literal("Broad-A"),
          v.literal("Broad-B"),
          v.literal("Niché"),
        ),
        langue: v.union(v.literal("FR"), v.literal("EN")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("hooks").take(1);
    if (existing.length > 0) {
      throw new Error(
        "Table 'hooks' already seeded. Run clearHooks first if you want to re-seed.",
      );
    }

    let count = 0;
    for (const hook of args.hooks) {
      await ctx.db.insert("hooks", hook);
      count++;
    }
    return { inserted: count };
  },
});

export const clearHooks = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("hooks").collect();
    for (const h of all) {
      await ctx.db.delete(h._id);
    }
    return { deleted: all.length };
  },
});

export const listHooks = query({
  args: {
    langue: v.optional(v.union(v.literal("FR"), v.literal("EN"))),
    mecanique: v.optional(
      v.union(
        v.literal("Erreur"),
        v.literal("Volume"),
        v.literal("Comparaison"),
        v.literal("Contradiction"),
        v.literal("Universalité"),
        v.literal("Question"),
      ),
    ),
    niveau: v.optional(
      v.union(
        v.literal("Broad-A"),
        v.literal("Broad-B"),
        v.literal("Niché"),
      ),
    ),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let results = await ctx.db.query("hooks").collect();

    if (args.langue) results = results.filter((h) => h.langue === args.langue);
    if (args.mecanique)
      results = results.filter((h) => h.mecanique === args.mecanique);
    if (args.niveau)
      results = results.filter((h) => h.niveau === args.niveau);
    if (args.search && args.search.length > 0) {
      const q = args.search.toLowerCase();
      results = results.filter((h) => h.text.toLowerCase().includes(q));
    }

    return results;
  },
});

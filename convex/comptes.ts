import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listComptes = query({
  args: { actifOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    let results = await ctx.db.query("comptes").collect();
    if (args.actifOnly) results = results.filter((c) => c.actif);
    return results.sort((a, b) =>
      a.handle.localeCompare(b.handle, "fr", { sensitivity: "base" }),
    );
  },
});

export const createCompte = mutation({
  args: {
    handle: v.string(),
    plateforme: v.union(
      v.literal("TikTok"),
      v.literal("Instagram"),
      v.literal("YouTube"),
    ),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("comptes").collect();
    const dup = existing.find(
      (c) => c.handle === args.handle && c.plateforme === args.plateforme,
    );
    if (dup) {
      throw new Error(
        `Compte ${args.handle} existe déjà sur ${args.plateforme}`,
      );
    }
    return await ctx.db.insert("comptes", {
      ...args,
      actif: true,
    });
  },
});

export const updateCompte = mutation({
  args: {
    id: v.id("comptes"),
    handle: v.optional(v.string()),
    notes: v.optional(v.string()),
    actif: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const update: Record<string, unknown> = {};
    for (const [k, value] of Object.entries(rest)) {
      if (value !== undefined) update[k] = value;
    }
    await ctx.db.patch(id, update);
  },
});

export const deleteCompte = mutation({
  args: { id: v.id("comptes") },
  handler: async (ctx, args) => {
    const compte = await ctx.db.get(args.id);
    if (!compte) throw new Error("Compte not found");

    const pubs = await ctx.db.query("publications").collect();
    const used = pubs.filter((p) => p.compte === compte.handle);
    if (used.length > 0) {
      throw new Error(
        `Compte utilisé par ${used.length} publication(s). Archive-le plutôt que de le supprimer.`,
      );
    }
    await ctx.db.delete(args.id);
  },
});

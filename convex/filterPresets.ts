import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

const filtersValidator = v.object({
  search: v.string(),
  plateforme: v.string(),
  compte: v.string(),
  statut: v.string(),
  mecanique: v.string(),
  format: v.string(),
  verdict: v.string(),
});

const sortValidator = v.object({
  key: v.union(v.literal("date"), v.literal("saveRate")),
  dir: v.union(v.literal("asc"), v.literal("desc")),
});

const CURRENT_SCHEMA_VERSION = 1;

export const createPreset = mutation({
  args: {
    name: v.string(),
    filters: filtersValidator,
    sort: sortValidator,
  },
  handler: async (ctx, args) => {
    const trimmedName = args.name.trim();
    if (trimmedName.length === 0) {
      throw new ConvexError("Le nom du preset ne peut pas être vide.");
    }

    const existing = await ctx.db
      .query("filterPresets")
      .withIndex("by_name", (q) => q.eq("name", trimmedName))
      .first();
    if (existing) {
      throw new ConvexError("Un preset avec ce nom existe déjà.");
    }

    return await ctx.db.insert("filterPresets", {
      name: trimmedName,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      filters: args.filters,
      sort: args.sort,
    });
  },
});

export const deletePreset = mutation({
  args: { id: v.id("filterPresets") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const listPresets = query({
  args: {},
  handler: async (ctx) => {
    // Tri par _creationTime desc (le plus récent d'abord). Le filtrage
    // schemaVersion === 1 se fait côté client (cf décision MVP : strip
    // silencieux). On retourne tout, sans filtre serveur, pour permettre
    // au client d'éventuellement loguer/compter les presets obsolètes.
    return await ctx.db.query("filterPresets").order("desc").collect();
  },
});

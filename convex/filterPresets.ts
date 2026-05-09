import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

const filtersValidator = v.object({
  search: v.string(),
  plateforme: v.string(),
  statut: v.string(),
  // Multi-select v2 : compte/mecanique/format/verdict deviennent des arrays.
  // Set vide = "tous" (pas de filtre). cf bump schemaVersion 1→2.
  compte: v.array(v.string()),
  mecanique: v.array(v.string()),
  format: v.array(v.string()),
  verdict: v.array(v.string()),
  // Batch 2 Modif 7 (v3) — filtre top-level mediaType (single-select).
  // "all" = aucun filtre, "carousel" / "short" = restriction. Cohérent
  // avec plateforme/statut qui sont aussi des single-select strings.
  mediaType: v.string(),
});

// Batch 2 Modif 7 (v3) — sort.key étendu aux 6 axes de tri du tracker
// (cf SortKey dans app/tracker/page.tsx). Les presets v2 stockaient
// uniquement "date"|"saveRate" et restent valides en v3 (sous-ensemble
// strict). La garde transitoire dans handleSavePreset (étape 3) peut
// être retirée maintenant.
const sortValidator = v.object({
  key: v.union(
    v.literal("date"),
    v.literal("saveRate"),
    v.literal("vues"),
    v.literal("likes"),
    v.literal("comments"),
    v.literal("subsGained"),
  ),
  dir: v.union(v.literal("asc"), v.literal("desc")),
});

const CURRENT_SCHEMA_VERSION = 3;

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

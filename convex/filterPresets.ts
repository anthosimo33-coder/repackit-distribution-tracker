import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

const filtersValidator = v.object({
  search: v.string(),
  plateforme: v.string(),
  statut: v.string(),
  // Multi-select v2 : compte/mecanique/format/verdict en arrays.
  // Set vide = "tous" (pas de filtre).
  compte: v.array(v.string()),
  mecanique: v.array(v.string()),
  format: v.array(v.string()),
  verdict: v.array(v.string()),
});

// Sort.key étendu aux 6 axes (Batch 2 Modif 7). Inchangé en v4.
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

const mediaTypeScopeValidator = v.union(
  v.literal("carousel"),
  v.literal("short"),
  v.literal("screenrecorder"),
);

// Batch B — bump v4 : split tracker en pages /carrousels et /shorts.
// Les presets sont désormais scopés par mediaType (mediaTypeScope au top du
// document, plus dans filters). Les v3 sont stripés silencieusement côté
// client par TrackerListSection avant filtrage.
const CURRENT_SCHEMA_VERSION = 4;

export const createPreset = mutation({
  args: {
    name: v.string(),
    mediaTypeScope: mediaTypeScopeValidator,
    filters: filtersValidator,
    sort: sortValidator,
  },
  handler: async (ctx, args) => {
    const trimmedName = args.name.trim();
    if (trimmedName.length === 0) {
      throw new ConvexError("Le nom du preset ne peut pas être vide.");
    }

    // Unicité du nom : globale (pas par scope). Décision tranchée : un preset
    // "Top winners FR" n'a de sens que dans un seul format à la fois ; refuser
    // la collision force le user à préfixer/distinguer s'il en veut un par
    // format (ex: "Top winners FR — carousel").
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
      mediaTypeScope: args.mediaTypeScope,
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
  args: {
    // mediaTypeScope optional : si fourni, filtre serveur via index
    // by_mediaTypeScope ; sinon retourne tous (utile pour un futur dashboard
    // global ou un audit). Le strip schemaVersion v3 reste côté client.
    mediaTypeScope: v.optional(mediaTypeScopeValidator),
  },
  handler: async (ctx, args) => {
    if (args.mediaTypeScope) {
      return await ctx.db
        .query("filterPresets")
        .withIndex("by_mediaTypeScope", (q) =>
          q.eq("mediaTypeScope", args.mediaTypeScope!),
        )
        .order("desc")
        .collect();
    }
    return await ctx.db.query("filterPresets").order("desc").collect();
  },
});

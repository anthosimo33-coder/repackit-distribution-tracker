import { e2eMutation, projectMutation, projectQuery } from "./functions";
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

export const createPreset = projectMutation({
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

    // Unicité du nom DANS le projet (by_project_name).
    const existing = await ctx.db
      .query("filterPresets")
      .withIndex("by_project_name", (q) =>
        q.eq("projectId", ctx.projectId).eq("name", trimmedName),
      )
      .first();
    if (existing) {
      throw new ConvexError("Un preset avec ce nom existe déjà.");
    }

    return await ctx.db.insert("filterPresets", {
      projectId: ctx.projectId,
      name: trimmedName,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      mediaTypeScope: args.mediaTypeScope,
      filters: args.filters,
      sort: args.sort,
    });
  },
});

export const deletePreset = projectMutation({
  args: { id: v.id("filterPresets") },
  handler: async (ctx, args) => {
    const preset = await ctx.db.get(args.id);
    if (!preset || preset.projectId !== ctx.projectId) return;
    await ctx.db.delete(args.id);
  },
});

export const listPresets = projectQuery({
  args: {
    // mediaTypeScope optional : si fourni, filtre serveur via
    // by_project_mediaTypeScope ; sinon tous les presets du projet.
    mediaTypeScope: v.optional(mediaTypeScopeValidator),
  },
  handler: async (ctx, args) => {
    if (args.mediaTypeScope) {
      return await ctx.db
        .query("filterPresets")
        .withIndex("by_project_mediaTypeScope", (q) =>
          q
            .eq("projectId", ctx.projectId)
            .eq("mediaTypeScope", args.mediaTypeScope!),
        )
        .order("desc")
        .collect();
    }
    return await ctx.db
      .query("filterPresets")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .order("desc")
      .collect();
  },
});

/**
 * Remédiation sécurité — cleanup e2e server-side (cf cleanupTestPublications
 * dans publications.ts). Supprime les presets nommés [E2E_TEST]*. Gated
 * E2E_SECRET.
 */
export const cleanupTestPresets = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const presets = await ctx.db.query("filterPresets").collect();
    let deleted = 0;
    for (const p of presets) {
      if (p.name.startsWith("[E2E_TEST]")) {
        await ctx.db.delete(p._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

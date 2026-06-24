import {
  adminMutation,
  adminQuery,
  adminViewAsQuery,
  creatorQuery,
  e2eMutation,
} from "./functions";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * « Comment ça marche » v2 — système de MODULES markdown par projet (remplace le
 * guide mono-bloc projectGuide, désormais simple fallback). Liste plate de
 * modules : titre + contenu markdown + order + status (published|draft).
 *
 * Scoping STRICT (cf functions.ts) : adminQuery/adminMutation exigent le rôle
 * admin du projet ; chaque mutation re-vérifie `module.projectId === ctx.projectId`
 * (un moduleId d'un autre projet est introuvable → rejet, aucune fuite). Le
 * créateur (creatorQuery) ne voit que les modules `published`. La variante
 * view-as (adminViewAsQuery) sert EXACTEMENT le même contenu que le créateur.
 */

const TITLE_MAX = 120;
const CONTENT_MAX = 50_000;

/** Tri stable : par order croissant, puis createdAt (départage les ex æquo). */
function byOrder<T extends { order: number; createdAt: number }>(a: T, b: T) {
  return a.order - b.order || a.createdAt - b.createdAt;
}

/** Modules `published` d'un projet, triés — shape PARTAGÉE créateur ↔ view-as. */
async function readPublishedModules(ctx: QueryCtx, projectId: Id<"projects">) {
  const modules = await ctx.db
    .query("guideModules")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return modules
    .filter((m) => m.status === "published")
    .sort(byOrder)
    .map((m) => ({
      _id: m._id,
      title: m.title,
      contentMarkdown: m.contentMarkdown,
      order: m.order,
    }));
}

// ─── Lecture admin ──────────────────────────────────────────────────────────

/** Tous les modules du projet (published + draft), triés par order (édition). */
export const listModulesForAdmin = adminQuery({
  args: {},
  handler: async (ctx) => {
    const modules = await ctx.db
      .query("guideModules")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return modules.sort(byOrder);
  },
});

// ─── Lecture créateur + view-as ───────────────────────────────────────────────

/** Modules `published` du projet du créateur courant (lecture seule, triés). */
export const listMyModules = creatorQuery({
  args: {},
  handler: async (ctx) => readPublishedModules(ctx, ctx.projectId),
});

/**
 * Variante « voir l'espace d'un créateur » — MÊME contenu que listMyModules
 * (modules published du projet). Le guide est per-projet : creatorId est
 * seulement utilisé par le wrapper pour gater l'accès (creator ∈ projet).
 */
export const listModulesAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) => readPublishedModules(ctx, ctx.projectId),
});

// ─── Mutations admin (CRUD + reorder), scopées projet ─────────────────────────

function normalizeTitle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ConvexError("Titre du module requis.");
  }
  if (trimmed.length > TITLE_MAX) {
    throw new ConvexError(`Titre trop long (max ${TITLE_MAX} caractères).`);
  }
  return trimmed;
}

function checkContent(content: string): string {
  if (content.length > CONTENT_MAX) {
    throw new ConvexError(`Contenu trop long (max ${CONTENT_MAX} caractères).`);
  }
  return content;
}

/** Crée un module en fin de liste (order = max + 1). */
export const createModule = adminMutation({
  args: {
    title: v.string(),
    contentMarkdown: v.string(),
    status: v.union(v.literal("published"), v.literal("draft")),
  },
  handler: async (ctx, args) => {
    const title = normalizeTitle(args.title);
    const contentMarkdown = checkContent(args.contentMarkdown);
    const existing = await ctx.db
      .query("guideModules")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const nextOrder =
      existing.length === 0
        ? 0
        : Math.max(...existing.map((m) => m.order)) + 1;
    const now = Date.now();
    return await ctx.db.insert("guideModules", {
      projectId: ctx.projectId,
      title,
      contentMarkdown,
      order: nextOrder,
      status: args.status,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Patch partiel (titre / contenu / statut). Scope projet vérifié. */
export const updateModule = adminMutation({
  args: {
    id: v.id("guideModules"),
    title: v.optional(v.string()),
    contentMarkdown: v.optional(v.string()),
    status: v.optional(v.union(v.literal("published"), v.literal("draft"))),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.projectId !== ctx.projectId) {
      throw new ConvexError("Module introuvable.");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = normalizeTitle(args.title);
    if (args.contentMarkdown !== undefined) {
      patch.contentMarkdown = checkContent(args.contentMarkdown);
    }
    if (args.status !== undefined) patch.status = args.status;
    await ctx.db.patch(args.id, patch);
  },
});

/** Suppression (scope projet vérifié). */
export const deleteModule = adminMutation({
  args: { id: v.id("guideModules") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.projectId !== ctx.projectId) {
      throw new ConvexError("Module introuvable.");
    }
    await ctx.db.delete(args.id);
  },
});

/**
 * Réordonne par échange d'`order` avec le voisin (haut/bas) dans la liste triée
 * du projet. Aux bornes (déjà en tête/fin) : no-op. Robuste et simple (pas de
 * drag-and-drop) — suffisant pour qq dizaines de modules.
 */
export const moveModule = adminMutation({
  args: {
    id: v.id("guideModules"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, args) => {
    const current = await ctx.db.get(args.id);
    if (!current || current.projectId !== ctx.projectId) {
      throw new ConvexError("Module introuvable.");
    }
    const siblings = (
      await ctx.db
        .query("guideModules")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).sort(byOrder);
    const idx = siblings.findIndex((m) => m._id === args.id);
    const neighborIdx = args.direction === "up" ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= siblings.length) return; // borne
    const neighbor = siblings[neighborIdx];
    const now = Date.now();
    // Échange des order (départage identique garanti car order distincts).
    await ctx.db.patch(current._id, { order: neighbor.order, updatedAt: now });
    await ctx.db.patch(neighbor._id, { order: current.order, updatedAt: now });
  },
});

// ─── Cleanup e2e (par marqueur [E2E_TEST] dans le titre) ──────────────────────

export const cleanupTestGuideModules = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("guideModules").collect();
    let deleted = 0;
    for (const m of all) {
      if (m.title.startsWith("[E2E_TEST]")) {
        await ctx.db.delete(m._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

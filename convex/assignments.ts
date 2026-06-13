import {
  adminMutation,
  adminQuery,
  creatorMutation,
  creatorQuery,
  e2eMutation,
} from "./functions";
import { withResolvedExamples } from "./formats";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * P7 Portail créateur — assignments. ISOLATION serveur non négociable : toutes
 * les fonctions creator (creatorQuery/creatorMutation) ne renvoient/touchent
 * QUE les rows du creator courant (ctx.creatorId). Les fonctions admin
 * (adminQuery/adminMutation) sont inaccessibles au rôle creator.
 */

type Plateforme = "TikTok" | "Instagram" | "YouTube";

/** Détection plateforme depuis l'URL (réplique serveur minimale, règle A6 —
 *  lib/inspiration-url ne peut pas être importée dans convex/). */
function detectPlatform(url: string): Plateforme | undefined {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com")) return "TikTok";
  if (u.includes("instagram.com")) return "Instagram";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "YouTube";
  return undefined;
}

// ─── Admin ─────────────────────────────────────────────────────────────────

/**
 * Créateurs assignables : onboardés (userId posé) et au travail (status
 * active ou onboarding). Exclut invited (pas de compte), paused, churned.
 */
export const listAssignableCreators = adminQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return creators
      .filter(
        (c) =>
          c.userId !== undefined &&
          (c.status === "active" || c.status === "onboarding"),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map((c) => ({ _id: c._id, name: c.name, status: c.status }));
  },
});

/**
 * Assignation en masse : 1 assignment = 1 livrable. N créateurs × P posts =
 * N×P rows en "todo". rateSnapshot = copie figée du rateModel du format.
 */
export const assignFormat = adminMutation({
  args: {
    formatId: v.id("formats"),
    creatorIds: v.array(v.id("creators")),
    postsPerCreator: v.number(),
    dueDate: v.number(),
    accountId: v.optional(v.id("comptes")),
  },
  handler: async (ctx, args) => {
    const format = await ctx.db.get(args.formatId);
    if (!format || format.projectId !== ctx.projectId) {
      throw new ConvexError("Format introuvable.");
    }
    if (format.status === "archived") {
      throw new ConvexError("Format archivé : réactive-le pour l'assigner.");
    }
    if (
      !Number.isInteger(args.postsPerCreator) ||
      args.postsPerCreator < 1 ||
      args.postsPerCreator > 50
    ) {
      throw new ConvexError("Nombre de posts par créateur invalide (1–50).");
    }
    if (args.creatorIds.length === 0) {
      throw new ConvexError("Sélectionne au moins un créateur.");
    }
    if (args.accountId) {
      const account = await ctx.db.get(args.accountId);
      if (!account || account.projectId !== ctx.projectId) {
        throw new ConvexError("Compte cible introuvable.");
      }
    }
    const now = Date.now();
    let created = 0;
    for (const creatorId of args.creatorIds) {
      const creator = await ctx.db.get(creatorId);
      if (!creator || creator.projectId !== ctx.projectId) {
        throw new ConvexError("Créateur introuvable dans le projet.");
      }
      // Règle d'assignabilité imposée SERVEUR (pas seulement dans
      // listAssignableCreators) : onboardé (userId) + au travail.
      if (
        creator.userId === undefined ||
        (creator.status !== "active" && creator.status !== "onboarding")
      ) {
        throw new ConvexError(
          `Créateur non assignable (${creator.name} : non onboardé ou inactif).`,
        );
      }
      for (let i = 0; i < args.postsPerCreator; i++) {
        await ctx.db.insert("assignments", {
          projectId: ctx.projectId,
          creatorId,
          formatId: args.formatId,
          accountId: args.accountId,
          dueDate: args.dueDate,
          status: "todo",
          rateSnapshot: format.rateModel,
          createdAt: now,
        });
        created++;
      }
    }
    return { created };
  },
});

/** Table admin : tous les assignments du projet, enrichis. */
export const listAssignments = adminQuery({
  args: {},
  handler: async (ctx) => {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const [creators, formats, comptes] = await Promise.all([
      ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("comptes")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    const compteMap = new Map(comptes.map((c) => [c._id, c.handle]));
    return assignments
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((a) => ({
        ...a,
        creatorName: creatorMap.get(a.creatorId) ?? "—",
        formatName: formatMap.get(a.formatId) ?? "—",
        accountHandle: a.accountId
          ? (compteMap.get(a.accountId) ?? null)
          : null,
      }));
  },
});

// ─── Créateur (isolé par ctx.creatorId) ──────────────────────────────────────

async function enrichForCreator(ctx: QueryCtx, a: Doc<"assignments">) {
  const format = await ctx.db.get(a.formatId);
  const account = a.accountId ? await ctx.db.get(a.accountId) : null;
  return {
    ...a,
    formatName: format?.name ?? "—",
    formatType: format?.type ?? "custom",
    accountHandle: account?.handle ?? null,
  };
}

/** Mes assignments UNIQUEMENT (filtre serveur par creatorId), triés deadline. */
export const listMyAssignments = creatorQuery({
  args: {},
  handler: async (ctx) => {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", ctx.creatorId))
      .collect();
    const enriched = await Promise.all(
      assignments.map((a) => enrichForCreator(ctx, a)),
    );
    return enriched.sort((a, b) => a.dueDate - b.dueDate);
  },
});

/** Une fiche assignment (brief complet + rateSnapshot). null si pas la mienne. */
export const getMyAssignment = creatorQuery({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    // Isolation : un assignment d'un autre créateur → introuvable.
    if (!a || a.creatorId !== ctx.creatorId) return null;
    const format = await ctx.db.get(a.formatId);
    const account = a.accountId ? await ctx.db.get(a.accountId) : null;
    const brief = format ? await withResolvedExamples(ctx, format) : null;
    return {
      assignment: a,
      format: brief,
      accountHandle: account?.handle ?? null,
    };
  },
});

/** todo → in_progress (« Je commence »). */
export const startAssignment = creatorMutation({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || a.creatorId !== ctx.creatorId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "todo") {
      throw new ConvexError("Cet assignment est déjà démarré.");
    }
    await ctx.db.patch(id, { status: "in_progress" });
  },
});

/**
 * Soumission par URL. Autorisée depuis "in_progress" (1re soumission) ou
 * "rejected" (resoumission UNIQUEMENT). Plateforme détectée serveur.
 */
export const submitAssignment = creatorMutation({
  args: { id: v.id("assignments"), url: v.string() },
  handler: async (ctx, { id, url }) => {
    const a = await ctx.db.get(id);
    if (!a || a.creatorId !== ctx.creatorId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "in_progress" && a.status !== "rejected") {
      throw new ConvexError(
        "Soumission impossible dans cet état (resoumission autorisée seulement après un rejet).",
      );
    }
    const trimmed = url.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      throw new ConvexError("URL du post invalide (lien http(s) attendu).");
    }
    await ctx.db.patch(id, {
      status: "submitted",
      submittedUrl: trimmed,
      submittedAt: Date.now(),
      submittedPlatform: detectPlatform(trimmed),
      // Purge le motif de rejet précédent lors d'une (re)soumission.
      adminFeedback: undefined,
    });
  },
});

// ─── Cleanup e2e (gated E2E_SECRET) ──────────────────────────────────────────

/**
 * Force le statut (+ feedback) d'un assignment — UNIQUEMENT pour les tests
 * (la validation/rejet admin arrive au chantier suivant). Permet de tester la
 * resoumission depuis "rejected".
 */
export const e2eSetAssignmentStatus = e2eMutation({
  args: {
    id: v.id("assignments"),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("submitted"),
      v.literal("validated"),
      v.literal("rejected"),
      v.literal("paid"),
    ),
    adminFeedback: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, adminFeedback }) => {
    await ctx.db.patch(id, { status, adminFeedback });
    return { ok: true };
  },
});

/** Supprime les assignments liés à un créateur/format de test ([E2E_TEST]). */
export const cleanupTestAssignments = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("assignments").collect();
    let deleted = 0;
    for (const a of all) {
      const creator = await ctx.db.get(a.creatorId);
      const format = await ctx.db.get(a.formatId);
      const isTest =
        (creator && creator.name.startsWith("[E2E_TEST]")) ||
        (creator && creator.email.includes("e2e-creator")) ||
        (format && format.name.startsWith("[E2E_TEST]"));
      if (isTest) {
        await ctx.db.delete(a._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

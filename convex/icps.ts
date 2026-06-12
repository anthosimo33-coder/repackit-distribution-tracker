import { e2eMutation, projectMutation, projectQuery } from "./functions";
import { v, ConvexError } from "convex/values";

const MAX_NAME_LENGTH = 80;

/**
 * ICPs (Ideal Customer Profiles) — calque convex/personnes.ts + folders.ts.
 * P2 — tout est scopé par ctx.projectId (by_project). shortsCount ne compte
 * que les publications du même projet.
 */
export const listIcps = projectQuery({
  args: {},
  handler: async (ctx) => {
    const icps = await ctx.db
      .query("icps")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const sorted = icps.sort((a, b) =>
      a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }),
    );
    return sorted.map((i) => ({
      ...i,
      shortsCount: publications.filter((p) => p.icpId === i._id).length,
    }));
  },
});

export const createIcp = projectMutation({
  args: {
    nom: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const nom = args.nom.trim();
    if (nom.length === 0) {
      throw new ConvexError("Nom d'ICP requis.");
    }
    if (nom.length > MAX_NAME_LENGTH) {
      throw new ConvexError(
        `Nom d'ICP trop long (max ${MAX_NAME_LENGTH} caractères).`,
      );
    }
    // Dedupe insensible à la casse sur le nom, DANS le projet.
    const existing = await ctx.db
      .query("icps")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const dup = existing.find((i) => i.nom.toLowerCase() === nom.toLowerCase());
    if (dup) {
      throw new ConvexError(`ICP "${nom}" existe déjà.`);
    }
    const now = Date.now();
    return await ctx.db.insert("icps", {
      projectId: ctx.projectId,
      nom,
      description: args.description,
      color: args.color,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Patch partiel (nom / description / color). Dedupe case-insensitive sur le
 * nom DANS le projet, en excluant soi-même. updatedAt bumpé toujours.
 */
export const updateIcp = projectMutation({
  args: {
    id: v.id("icps"),
    nom: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.projectId !== ctx.projectId) {
      throw new ConvexError("ICP introuvable.");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.nom !== undefined) {
      const nom = args.nom.trim();
      if (nom.length === 0) {
        throw new ConvexError("Nom d'ICP requis.");
      }
      if (nom.length > MAX_NAME_LENGTH) {
        throw new ConvexError(
          `Nom d'ICP trop long (max ${MAX_NAME_LENGTH} caractères).`,
        );
      }
      if (nom.toLowerCase() !== existing.nom.toLowerCase()) {
        const all = await ctx.db
          .query("icps")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect();
        const dup = all.find(
          (i) => i._id !== args.id && i.nom.toLowerCase() === nom.toLowerCase(),
        );
        if (dup) {
          throw new ConvexError(`ICP "${nom}" existe déjà.`);
        }
      }
      patch.nom = nom;
    }
    if (args.description !== undefined) patch.description = args.description;
    if (args.color !== undefined) patch.color = args.color;

    await ctx.db.patch(args.id, patch);
  },
});

/**
 * Suppression avec cascade unset : les Shorts du projet assignés à cet ICP
 * sont désassignés (icpId → undefined), puis l'ICP est supprimé.
 */
export const deleteIcp = projectMutation({
  args: { id: v.id("icps") },
  handler: async (ctx, args) => {
    const icp = await ctx.db.get(args.id);
    if (!icp || icp.projectId !== ctx.projectId) return { unsetCount: 0 };
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const assigned = publications.filter((p) => p.icpId === args.id);
    for (const p of assigned) {
      await ctx.db.patch(p._id, { icpId: undefined });
    }
    await ctx.db.delete(args.id);
    return { unsetCount: assigned.length };
  },
});

/**
 * Test-only cleanup (project-agnostic, par marker [E2E_TEST]). Inchangé P2.
 */
export const cleanupTestIcps = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("icps").collect();
    let deleted = 0;
    for (const i of all) {
      if (i.nom.startsWith("[E2E_TEST]")) {
        await ctx.db.delete(i._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

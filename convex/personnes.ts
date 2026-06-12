import { e2eMutation, adminMutation, adminQuery } from "./functions";
import { v, ConvexError } from "convex/values";

const MAX_NAME_LENGTH = 80;

/**
 * Personnes (gestionnaires de comptes) — P2 scopé par ctx.projectId.
 * compteCount ne compte que les comptes du même projet.
 */
export const listPersonnes = adminQuery({
  args: {},
  handler: async (ctx) => {
    const personnes = await ctx.db
      .query("personnes")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const comptes = await ctx.db
      .query("comptes")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const sorted = personnes.sort((a, b) => {
      const byNom = a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" });
      if (byNom !== 0) return byNom;
      return a.prenom.localeCompare(b.prenom, "fr", { sensitivity: "base" });
    });
    return sorted.map((p) => ({
      ...p,
      compteCount: comptes.filter((c) => c.personneId === p._id).length,
    }));
  },
});

function validateNames(prenom: string, nom: string) {
  if (prenom.length === 0 || nom.length === 0) {
    throw new ConvexError("Prénom et nom requis.");
  }
  if (prenom.length > MAX_NAME_LENGTH || nom.length > MAX_NAME_LENGTH) {
    throw new ConvexError(
      `Prénom et nom limités à ${MAX_NAME_LENGTH} caractères.`,
    );
  }
}

export const createPersonne = adminMutation({
  args: { prenom: v.string(), nom: v.string() },
  handler: async (ctx, args) => {
    const prenom = args.prenom.trim();
    const nom = args.nom.trim();
    validateNames(prenom, nom);

    // Dedupe insensible à la casse sur le couple (prenom, nom) DANS le projet.
    const existing = await ctx.db
      .query("personnes")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const dup = existing.find(
      (p) =>
        p.prenom.toLowerCase() === prenom.toLowerCase() &&
        p.nom.toLowerCase() === nom.toLowerCase(),
    );
    if (dup) {
      throw new ConvexError("Personne déjà existante.");
    }

    const now = Date.now();
    return await ctx.db.insert("personnes", {
      projectId: ctx.projectId,
      prenom,
      nom,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Patch partiel (prenom et/ou nom). Dedupe case-insensitive DANS le projet,
 * en excluant soi-même. updatedAt bumpé toujours.
 */
export const updatePersonne = adminMutation({
  args: {
    id: v.id("personnes"),
    prenom: v.optional(v.string()),
    nom: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.projectId !== ctx.projectId) {
      throw new ConvexError("Personne introuvable.");
    }

    const nextPrenom =
      args.prenom !== undefined ? args.prenom.trim() : existing.prenom;
    const nextNom = args.nom !== undefined ? args.nom.trim() : existing.nom;
    validateNames(nextPrenom, nextNom);

    const changed =
      nextPrenom.toLowerCase() !== existing.prenom.toLowerCase() ||
      nextNom.toLowerCase() !== existing.nom.toLowerCase();
    if (changed) {
      const all = await ctx.db
        .query("personnes")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect();
      const dup = all.find(
        (p) =>
          p._id !== args.id &&
          p.prenom.toLowerCase() === nextPrenom.toLowerCase() &&
          p.nom.toLowerCase() === nextNom.toLowerCase(),
      );
      if (dup) {
        throw new ConvexError("Personne déjà existante.");
      }
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.prenom !== undefined) patch.prenom = nextPrenom;
    if (args.nom !== undefined) patch.nom = nextNom;
    await ctx.db.patch(args.id, patch);
  },
});

/**
 * Suppression avec cascade unset : les comptes du projet assignés à cette
 * personne sont désassignés (personneId → undefined), puis suppression.
 */
export const deletePersonne = adminMutation({
  args: { id: v.id("personnes") },
  handler: async (ctx, args) => {
    const personne = await ctx.db.get(args.id);
    if (!personne || personne.projectId !== ctx.projectId) {
      return { unsetCount: 0 };
    }
    const comptes = await ctx.db
      .query("comptes")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const assigned = comptes.filter((c) => c.personneId === args.id);
    for (const c of assigned) {
      await ctx.db.patch(c._id, { personneId: undefined });
    }
    await ctx.db.delete(args.id);
    return { unsetCount: assigned.length };
  },
});

/**
 * Test-only cleanup (project-agnostic, par marker [E2E_TEST]). Inchangé P2.
 */
export const cleanupTestPersonnes = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("personnes").collect();
    let deleted = 0;
    for (const p of all) {
      if (p.nom.startsWith("[E2E_TEST]") || p.prenom.startsWith("[E2E_TEST]")) {
        await ctx.db.delete(p._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

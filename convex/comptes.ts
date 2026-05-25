import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listComptes = query({
  args: { actifOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    let results = await ctx.db.query("comptes").collect();
    if (args.actifOnly) results = results.filter((c) => c.actif);
    const sorted = results.sort((a, b) =>
      a.handle.localeCompare(b.handle, "fr", { sensitivity: "base" }),
    );
    // Enrichissement gestionnaire côté serveur (décision : lookup serveur
    // plutôt que client → l'UI tableau lit directement c.personne sans
    // re-query). N+1 mémoire acceptable au volume (< 100 comptes / < 50
    // personnes). Champ additif `personne` : ne casse aucun caller existant.
    const personnes = await ctx.db.query("personnes").collect();
    const personneMap = new Map(personnes.map((p) => [p._id, p]));
    return sorted.map((c) => {
      const p = c.personneId ? personneMap.get(c.personneId) : null;
      return {
        ...c,
        personne: p ? { prenom: p.prenom, nom: p.nom } : null,
      };
    });
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
    personneId: v.optional(v.id("personnes")),
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
    // null = désassigner le gestionnaire (unset), Id = assigner, absent =
    // ne pas toucher. Pattern folderId/thumbnail d'updateInspiration.
    personneId: v.optional(v.union(v.id("personnes"), v.null())),
  },
  handler: async (ctx, args) => {
    const { id, personneId, ...rest } = args;
    const update: Record<string, unknown> = {};
    for (const [k, value] of Object.entries(rest)) {
      if (value !== undefined) update[k] = value;
    }
    if (personneId !== undefined) {
      update.personneId = personneId === null ? undefined : personneId;
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

import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

const plateformeValidator = v.union(
  v.literal("TikTok"),
  v.literal("Instagram"),
  v.literal("YouTube"),
);

const typeValidator = v.union(v.literal("video"), v.literal("account"));

const statsValidator = v.object({
  views: v.optional(v.number()),
  likes: v.optional(v.number()),
  followers: v.optional(v.number()),
  comments: v.optional(v.number()),
  capturedAt: v.optional(v.number()),
});

/**
 * Batch G — normalise une liste de tags utilisateur en : trim + lowercase
 * + dedupe (Set préservant l'ordre d'apparition). Strings vides filtrées.
 * Appliqué côté serveur dans create + update pour garantir cohérence.
 */
function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const normalized = t.trim().toLowerCase();
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Batch F → G — list inspirations triées par createdAt desc, enrichies
 * avec thumbnailUrl résolu via ctx.storage.getUrl. Filter chain Batch G
 * (folderIds / plateformes / types / isFavorite / search / tags), tous
 * args optionnels (backward compat avec appel sans args). Filtrage en
 * mémoire après le collect — N+1 acceptable au volume cible (< 200 rows).
 */
export const listInspirations = query({
  args: {
    folderIds: v.optional(v.array(v.id("folders"))),
    plateformes: v.optional(v.array(plateformeValidator)),
    types: v.optional(v.array(typeValidator)),
    isFavorite: v.optional(v.boolean()),
    search: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    let rows = await ctx.db
      .query("inspirations")
      .withIndex("by_createdAt")
      .order("desc")
      .collect();

    if (args.folderIds && args.folderIds.length > 0) {
      const allowed = new Set<string>(args.folderIds);
      rows = rows.filter(
        (i) => i.folderId !== undefined && allowed.has(i.folderId),
      );
    }
    if (args.plateformes && args.plateformes.length > 0) {
      const allowed = new Set<string>(args.plateformes);
      rows = rows.filter((i) => allowed.has(i.plateforme));
    }
    if (args.types && args.types.length > 0) {
      const allowed = new Set<string>(args.types);
      rows = rows.filter((i) => allowed.has(i.type));
    }
    if (args.isFavorite === true) {
      rows = rows.filter((i) => i.isFavorite === true);
    }
    if (args.search !== undefined) {
      const q = args.search.trim().toLowerCase();
      if (q.length > 0) {
        rows = rows.filter(
          (i) =>
            (i.titre ?? "").toLowerCase().includes(q) ||
            (i.notes ?? "").toLowerCase().includes(q) ||
            i.url.toLowerCase().includes(q),
        );
      }
    }
    if (args.tags && args.tags.length > 0) {
      const wanted = args.tags.map((t) => t.toLowerCase());
      rows = rows.filter((i) => wanted.some((t) => i.tags.includes(t)));
    }

    return await Promise.all(
      rows.map(async (i) => {
        const thumbnailUrl =
          i.thumbnail !== undefined && i.thumbnail !== null
            ? await ctx.storage.getUrl(i.thumbnail)
            : null;
        return { ...i, thumbnailUrl };
      }),
    );
  },
});

/**
 * Batch G — fetch d'une inspiration par id pour le mode edit du dialog.
 * Retourne null si non trouvée (idempotent côté UI). Enrichi thumbnailUrl
 * de la même façon que listInspirations.
 */
export const getInspirationById = query({
  args: { id: v.id("inspirations") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const thumbnailUrl =
      row.thumbnail !== undefined && row.thumbnail !== null
        ? await ctx.storage.getUrl(row.thumbnail)
        : null;
    return { ...row, thumbnailUrl };
  },
});

export const createInspiration = mutation({
  args: {
    url: v.string(),
    type: typeValidator,
    plateforme: plateformeValidator,
    thumbnail: v.optional(v.id("_storage")),
    titre: v.optional(v.string()),
    notes: v.optional(v.string()),
    stats: v.optional(statsValidator),
    folderId: v.optional(v.id("folders")),
    isFavorite: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    if (args.url.trim().length === 0) {
      throw new ConvexError("URL requise.");
    }
    const now = Date.now();
    return await ctx.db.insert("inspirations", {
      url: args.url,
      type: args.type,
      plateforme: args.plateforme,
      thumbnail: args.thumbnail,
      titre: args.titre,
      notes: args.notes,
      stats: args.stats,
      folderId: args.folderId,
      isFavorite: args.isFavorite ?? false,
      tags: normalizeTags(args.tags ?? []),
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Batch G — patch partiel d'une inspiration. Chaque champ optional ; seuls
 * les champs fournis sont patchés (les autres restent inchangés).
 *
 * folderId accepte null pour signifier "désaffecter du dossier" : converti
 * en undefined côté patch (le schéma `v.optional(v.id)` n'accepte pas null,
 * mais accepte l'absence de champ via patch undefined).
 *
 * tags : normalisés serveur (trim + lowercase + dedupe). Le client peut
 * envoyer ce qu'il veut, on garantit la cohérence en base.
 */
export const updateInspiration = mutation({
  args: {
    id: v.id("inspirations"),
    url: v.optional(v.string()),
    type: v.optional(typeValidator),
    plateforme: v.optional(plateformeValidator),
    thumbnail: v.optional(v.union(v.id("_storage"), v.null())),
    titre: v.optional(v.string()),
    notes: v.optional(v.string()),
    stats: v.optional(statsValidator),
    folderId: v.optional(v.union(v.id("folders"), v.null())),
    isFavorite: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    if (args.url !== undefined && args.url.trim().length === 0) {
      throw new ConvexError("URL ne peut pas être vide.");
    }
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError("Inspiration introuvable.");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.url !== undefined) patch.url = args.url;
    if (args.type !== undefined) patch.type = args.type;
    if (args.plateforme !== undefined) patch.plateforme = args.plateforme;
    if (args.thumbnail !== undefined) {
      patch.thumbnail = args.thumbnail === null ? undefined : args.thumbnail;
    }
    if (args.titre !== undefined) patch.titre = args.titre;
    if (args.notes !== undefined) patch.notes = args.notes;
    if (args.stats !== undefined) patch.stats = args.stats;
    if (args.folderId !== undefined) {
      patch.folderId = args.folderId === null ? undefined : args.folderId;
    }
    if (args.isFavorite !== undefined) patch.isFavorite = args.isFavorite;
    if (args.tags !== undefined) patch.tags = normalizeTags(args.tags);

    await ctx.db.patch(args.id, patch);
  },
});

/**
 * Batch G — suppression dure. Pas de cleanup du blob storage associé
 * (parallèle au tracker, cf TD-011 à traiter séparément). Idempotent :
 * suppression d'un id inexistant est silencieuse.
 */
export const deleteInspiration = mutation({
  args: { id: v.id("inspirations") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) return;
    await ctx.db.delete(args.id);
  },
});

/**
 * Test-only cleanup. Mirrors le pattern clearHooks de convex/hooks.ts :
 * supprime les rows dont les notes commencent par le marker [E2E_TEST]
 * (cf e2e/helpers/cleanup.ts).
 */
export const cleanupTestInspirations = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("inspirations").collect();
    let deleted = 0;
    for (const i of all) {
      if ((i.notes ?? "").startsWith("[E2E_TEST]")) {
        await ctx.db.delete(i._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

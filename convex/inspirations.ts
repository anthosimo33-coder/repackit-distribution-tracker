import { e2eMutation, adminMutation, adminQuery } from "./functions";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { deleteStorageBestEffort } from "./storageCleanup";

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
  // Provenance RADAR Outliers (cf. schema) — ratio de surperformance + handle
  // du compte source. Optionnels, ne concernent que les ajouts depuis Radar.
  outlierRatio: v.optional(v.number()),
  authorHandle: v.optional(v.string()),
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
export const listInspirations = adminQuery({
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
      .withIndex("by_project_createdAt", (q) =>
        q.eq("projectId", ctx.projectId),
      )
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
        // Upload manuel (storage) prioritaire ; sinon vignette auto en cache.
        const storageUrl =
          i.thumbnail !== undefined && i.thumbnail !== null
            ? await ctx.storage.getUrl(i.thumbnail)
            : null;
        const thumbnailUrl = storageUrl ?? i.autoThumbnailUrl ?? null;
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
export const getInspirationById = adminQuery({
  args: { id: v.id("inspirations") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.projectId !== ctx.projectId) return null;
    const storageUrl =
      row.thumbnail !== undefined && row.thumbnail !== null
        ? await ctx.storage.getUrl(row.thumbnail)
        : null;
    const thumbnailUrl = storageUrl ?? row.autoThumbnailUrl ?? null;
    return { ...row, thumbnailUrl };
  },
});

export const createInspiration = adminMutation({
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
    const id = await ctx.db.insert("inspirations", {
      projectId: ctx.projectId,
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

    // Vignette AUTO : on déclenche la récupération hors du chemin critique
    // (scheduler.runAfter → la création reste instantanée, la vignette se
    // remplit juste après). Uniquement pour les vidéos sans vignette manuelle
    // (un compte n'a pas de vignette source ; un upload manuel prime déjà).
    if (args.type === "video" && args.thumbnail === undefined) {
      await ctx.scheduler.runAfter(
        0,
        internal.inspirationThumbnails.resolveThumbnail,
        { inspirationId: id, url: args.url, platform: args.plateforme },
      );
    }

    return id;
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
export const updateInspiration = adminMutation({
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
    if (!existing || existing.projectId !== ctx.projectId) {
      throw new ConvexError("Inspiration introuvable.");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.url !== undefined) patch.url = args.url;
    if (args.type !== undefined) patch.type = args.type;
    if (args.plateforme !== undefined) patch.plateforme = args.plateforme;
    if (args.thumbnail !== undefined) {
      patch.thumbnail = args.thumbnail === null ? undefined : args.thumbnail;
      // TD-011 — remplacement/retrait : l'ancienne vignette n'est plus
      // référencée nulle part (aucune duplication d'inspiration n'existe).
      if (existing.thumbnail && existing.thumbnail !== args.thumbnail) {
        await deleteStorageBestEffort(ctx, existing.thumbnail);
      }
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
 * Batch G — suppression dure. TD-011 traité : la vignette uploadée part avec la
 * row (best-effort — un blob déjà absent ne doit pas bloquer la suppression).
 * `autoThumbnailUrl` n'est pas concerné (URL externe, pas un blob). Idempotent :
 * suppression d'un id inexistant est silencieuse.
 */
export const deleteInspiration = adminMutation({
  args: { id: v.id("inspirations") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.projectId !== ctx.projectId) return;
    await deleteStorageBestEffort(ctx, existing.thumbnail);
    await ctx.db.delete(args.id);
  },
});

/**
 * Test-only cleanup. Supprime les rows de test : marker [E2E_TEST] dans les
 * notes OU le titre (les deux voies de marquage des specs). Inclut un nettoyage
 * one-shot des inspirations modèles laissées par assignment-script-and-inspiration
 * (titre « Insp Modèle » sans marker, url @insp/video) sur le deployment de test
 * PARTAGÉ — retirable une fois la prod de test purgée. Cf e2e/helpers/cleanup.ts.
 */
export const cleanupTestInspirations = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("inspirations").collect();
    let deleted = 0;
    for (const i of all) {
      const isTest =
        (i.notes ?? "").startsWith("[E2E_TEST]") ||
        (i.titre ?? "").startsWith("[E2E_TEST]") ||
        i.url.includes("tiktok.com/@insp/video");
      if (isTest) {
        await deleteStorageBestEffort(ctx, i.thumbnail);
        await ctx.db.delete(i._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

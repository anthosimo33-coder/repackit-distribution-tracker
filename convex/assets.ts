import { adminMutation, adminQuery, e2eMutation } from "./functions";
import { ConvexError, v } from "convex/values";

/**
 * Assets — bibliothèque de FICHIERS en dossiers (matériel à télécharger par le
 * créateur) : IMAGES (jpg/png/webp ≤ 10 Mo) ET VIDÉOS courtes (mp4/mov/webm ≤
 * 100 Mo), en Convex file storage. TOUT passe par adminQuery/adminMutation (le
 * créateur lit via assignments.getMyAssignment). Scopé projet.
 *
 * ⚠️ A6 — la validation type/taille est RÉPLIQUÉE de lib/asset-file.ts (où
 * vivent les tests Vitest). Toute évolution doit l'être des deux côtés.
 */

const MAX_NAME_LENGTH = 80;
// Réplique de lib/asset-file (règle A6) : images + vidéos, limite PAR type.
const ASSET_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ASSET_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const ASSET_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const ASSET_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
function maxBytesForAssetType(contentType: string): number | null {
  if (ASSET_IMAGE_TYPES.includes(contentType)) return ASSET_IMAGE_MAX_BYTES;
  if (ASSET_VIDEO_TYPES.includes(contentType)) return ASSET_VIDEO_MAX_BYTES;
  return null;
}

// ─── Dossiers ─────────────────────────────────────────────────────────────────

/** Dossiers d'assets du projet + nombre d'images. */
export const listAssetFolders = adminQuery({
  args: {},
  handler: async (ctx) => {
    const folders = await ctx.db
      .query("assetFolders")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return folders
      .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }))
      .map((f) => ({
        ...f,
        assetCount: assets.filter((a) => a.folderId === f._id).length,
      }));
  },
});

export const createAssetFolder = adminMutation({
  args: { name: v.string(), postprocessImages: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0) throw new ConvexError("Nom de dossier requis.");
    if (name.length > MAX_NAME_LENGTH) {
      throw new ConvexError(`Nom trop long (max ${MAX_NAME_LENGTH}).`);
    }
    const existing = await ctx.db
      .query("assetFolders")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    if (existing.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      throw new ConvexError(`Dossier « ${name} » existe déjà.`);
    }
    return await ctx.db.insert("assetFolders", {
      projectId: ctx.projectId,
      name,
      createdAt: Date.now(),
      postprocessImages: args.postprocessImages === true,
    });
  },
});

/**
 * Bascule « contenu à publier » d'un dossier (cf. schema.assetFolders).
 * N'AFFECTE QUE LES UPLOADS À VENIR : les fichiers déjà stockés ne sont pas
 * retraités — c'est le rôle du script scripts/postprocess-existing-assets.ts.
 */
export const setAssetFolderPostprocess = adminMutation({
  args: { id: v.id("assetFolders"), postprocessImages: v.boolean() },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.id);
    if (!folder || folder.projectId !== ctx.projectId) {
      throw new ConvexError("Dossier introuvable.");
    }
    await ctx.db.patch(args.id, {
      postprocessImages: args.postprocessImages,
    });
    return { ok: true };
  },
});

export const renameAssetFolder = adminMutation({
  args: { id: v.id("assetFolders"), name: v.string() },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.id);
    if (!folder || folder.projectId !== ctx.projectId) {
      throw new ConvexError("Dossier introuvable.");
    }
    const name = args.name.trim();
    if (name.length === 0) throw new ConvexError("Nom de dossier requis.");
    if (name.length > MAX_NAME_LENGTH) {
      throw new ConvexError(`Nom trop long (max ${MAX_NAME_LENGTH}).`);
    }
    const all = await ctx.db
      .query("assetFolders")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    if (
      all.some(
        (f) => f._id !== args.id && f.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new ConvexError(`Dossier « ${name} » existe déjà.`);
    }
    await ctx.db.patch(args.id, { name });
    return { ok: true };
  },
});

/**
 * Supprime un dossier : cascade ses fichiers (blobs storage + rows) et DÉLIE les
 * assignments qui le référençaient (retiré de assetFolderIds + legacy). Scopé
 * projet.
 */
export const deleteAssetFolder = adminMutation({
  args: { id: v.id("assetFolders") },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.id);
    if (!folder || folder.projectId !== ctx.projectId) {
      throw new ConvexError("Dossier introuvable.");
    }
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_folder", (q) => q.eq("folderId", args.id))
      .collect();
    for (const a of assets) {
      await ctx.storage.delete(a.storageId);
      await ctx.db.delete(a._id);
    }
    // Délie les assignments du projet qui pointaient ce dossier — dans le array
    // assetFolderIds (multi) ET le legacy single assetFolderId.
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    for (const asg of assignments) {
      const patch: Record<string, unknown> = {};
      if (asg.assetFolderIds?.includes(args.id)) {
        patch.assetFolderIds = asg.assetFolderIds.filter((f) => f !== args.id);
      }
      if (asg.assetFolderId === args.id) patch.assetFolderId = undefined;
      if (Object.keys(patch).length > 0) await ctx.db.patch(asg._id, patch);
    }
    await ctx.db.delete(args.id);
    return { deletedAssets: assets.length };
  },
});

// ─── Images ───────────────────────────────────────────────────────────────────

/** Images d'un dossier (du projet) + URL signée de téléchargement. */
export const listAssets = adminQuery({
  args: { folderId: v.id("assetFolders") },
  handler: async (ctx, { folderId }) => {
    const folder = await ctx.db.get(folderId);
    if (!folder || folder.projectId !== ctx.projectId) return [];
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_folder", (q) => q.eq("folderId", folderId))
      .collect();
    return await Promise.all(
      assets
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(async (a) => ({ ...a, url: await ctx.storage.getUrl(a.storageId) })),
    );
  },
});

/**
 * Enregistre un fichier uploadé (storageId obtenu via generateUploadUrl). VALIDE
 * SERVEUR le type (image jpg/png/webp OU vidéo mp4/mov/webm) + la taille ≤ max
 * SELON le type (image 10 Mo / vidéo 100 Mo) ; rejette sinon en supprimant le
 * blob orphelin. Le créateur n'uploade jamais — admin only.
 *
 * `replacedStorageId` : blob SUPPLANTÉ par sa version post-traitée (métadonnées
 * de provenance retirées, cf. app/api/assets/postprocess/route.ts). Il n'est
 * référencé par aucune row → on le purge, y compris sur les chemins de rejet,
 * pour ne jamais laisser derrière soi l'original porteur d'EXIF/C2PA.
 */
export const createAsset = adminMutation({
  args: {
    folderId: v.id("assetFolders"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    replacedStorageId: v.optional(v.id("_storage")),
    /** Le fichier a traversé le pipeline → horodaté SERVEUR (idempotence). */
    postprocessed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const superseded =
      args.replacedStorageId && args.replacedStorageId !== args.storageId
        ? args.replacedStorageId
        : null;
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.projectId !== ctx.projectId) {
      // Blob orphelin (uploadé mais dossier invalide) → purge.
      await ctx.storage.delete(args.storageId);
      if (superseded) await ctx.storage.delete(superseded);
      throw new ConvexError("Dossier introuvable.");
    }
    const max = maxBytesForAssetType(args.contentType);
    const invalid =
      max === null ||
      !Number.isFinite(args.size) ||
      args.size <= 0 ||
      args.size > max;
    if (invalid) {
      await ctx.storage.delete(args.storageId);
      if (superseded) await ctx.storage.delete(superseded);
      throw new ConvexError(
        "Fichier refusé : images JPG/PNG/WebP (10 Mo) ou vidéos MP4/MOV/WebM (100 Mo).",
      );
    }
    // L'original n'a plus de raison d'exister une fois sa version nettoyée validée.
    if (superseded) await ctx.storage.delete(superseded);
    const fileName = args.fileName.trim() || "fichier";
    return await ctx.db.insert("assets", {
      projectId: ctx.projectId,
      folderId: args.folderId,
      storageId: args.storageId,
      fileName,
      contentType: args.contentType,
      size: args.size,
      createdAt: Date.now(),
      postprocessedAt: args.postprocessed === true ? Date.now() : undefined,
    });
  },
});

export const deleteAsset = adminMutation({
  args: { id: v.id("assets") },
  handler: async (ctx, { id }) => {
    const asset = await ctx.db.get(id);
    if (!asset || asset.projectId !== ctx.projectId) return { ok: true };
    await ctx.storage.delete(asset.storageId);
    await ctx.db.delete(id);
    return { ok: true };
  },
});

// ─── Cleanup e2e ──────────────────────────────────────────────────────────────

/** Supprime les dossiers de test ([E2E_TEST]) + leurs images (blobs + rows). */
export const cleanupTestAssets = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const folders = await ctx.db.query("assetFolders").collect();
    let deleted = 0;
    for (const f of folders) {
      if (!f.name.startsWith("[E2E_TEST]")) continue;
      const assets = await ctx.db
        .query("assets")
        .withIndex("by_folder", (q) => q.eq("folderId", f._id))
        .collect();
      for (const a of assets) {
        await ctx.storage.delete(a.storageId);
        await ctx.db.delete(a._id);
      }
      await ctx.db.delete(f._id);
      deleted++;
    }
    return { deleted };
  },
});

import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Surface SERVEUR du rattrapage du stock Assets — post-traitement des images
 * déposées AVANT l'existence du pipeline (cf. scripts/postprocess-existing-assets.ts).
 *
 * Fonctions INTERNES : appelées uniquement par le script manuel via
 * `npx convex run`, jamais depuis l'app. Aucun cron, aucune route.
 *
 * POURQUOI CE DÉCOUPAGE EN TROIS APPELS : sharp est un binaire natif, il ne
 * tourne pas dans le runtime Convex. Les octets doivent donc être traités en
 * LOCAL par le script. Convex fournit ce qu'il est seul à pouvoir fournir — la
 * liste des candidats + les URL signées (lecture et écriture) — et encaisse le
 * résultat. Aucune logique d'image ici.
 *
 * ⚠️ A6 — la liste des types images est RÉPLIQUÉE de lib/image-postprocess.ts
 * (convex/ ne peut pas importer lib/). Toute évolution doit l'être des deux côtés.
 */

const POSTPROCESS_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Motif pour lequel un asset d'un dossier marqué n'est PAS retraité. */
const SKIP_ALREADY = "deja-traite";
const SKIP_FORMAT = "format-non-supporte";

/**
 * Candidats au rattrapage : images NON ENCORE TRAITÉES d'un dossier marqué
 * « contenu à publier ». Lecture seule — c'est la source du dry-run.
 *
 * Renvoie aussi les écartés AVEC leur motif, pour que le script puisse les
 * logguer, et le total hors périmètre (dossiers non marqués) pour vérifier d'un
 * coup d'œil que le flag est bien positionné avant d'appliquer.
 */
export const listPostprocessCandidates = internalQuery({
  args: { limit: v.optional(v.number()), folder: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const folders = await ctx.db.query("assetFolders").collect();
    const needle = args.folder?.trim().toLowerCase();
    const flagged = folders.filter(
      (f) =>
        f.postprocessImages === true &&
        // Ciblage d'un dossier : identifiant exact, ou fragment de nom (les
        // noms réels portent des emojis, peu commodes à retaper en entier).
        (needle === undefined ||
          f._id === args.folder ||
          f.name.toLowerCase().includes(needle)),
    );

    const candidates: Array<{
      assetId: string;
      folderName: string;
      fileName: string;
      contentType: string;
      size: number;
      url: string | null;
    }> = [];
    const skipped: Array<{
      assetId: string;
      folderName: string;
      fileName: string;
      reason: string;
    }> = [];

    for (const folder of flagged) {
      const assets = await ctx.db
        .query("assets")
        .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
        .collect();
      for (const asset of assets) {
        const entry = {
          assetId: asset._id as string,
          folderName: folder.name,
          fileName: asset.fileName,
        };
        if (!POSTPROCESS_INPUT_TYPES.includes(asset.contentType)) {
          skipped.push({ ...entry, reason: SKIP_FORMAT });
          continue;
        }
        if (asset.postprocessedAt !== undefined) {
          skipped.push({ ...entry, reason: SKIP_ALREADY });
          continue;
        }
        candidates.push({
          ...entry,
          contentType: asset.contentType,
          size: asset.size,
          url: await ctx.storage.getUrl(asset.storageId),
        });
      }
    }

    // Hors périmètre : tout ce qui vit dans un dossier NON marqué.
    const flaggedIds = new Set(flagged.map((f) => f._id));
    const outOfScope = (await ctx.db.query("assets").collect()).filter(
      (a) => !flaggedIds.has(a.folderId),
    ).length;

    const limit = args.limit ?? candidates.length;
    return {
      candidates: candidates.slice(0, limit),
      totalCandidates: candidates.length,
      skipped,
      outOfScope,
      flaggedFolders: flagged.map((f) => f.name),
    };
  },
});

/** URL d'upload signées pour le lot en cours (le script POST les blobs traités). */
export const prepareUploadUrls = internalMutation({
  args: { count: v.number() },
  handler: async (ctx, args) => {
    const urls: string[] = [];
    for (let i = 0; i < args.count; i++) {
      urls.push(await ctx.storage.generateUploadUrl());
    }
    return urls;
  },
});

/**
 * Encaisse les images retraitées : bascule la row sur le nouveau blob, MET
 * L'ORIGINAL DE CÔTÉ (postprocessBackup) et pose `postprocessedAt`.
 *
 * L'ancien blob n'est PAS purgé — le rattrapage est irréversible et sans copie
 * de secours ailleurs, on garde de quoi revenir en arrière (`restoreOriginals`)
 * jusqu'à validation du rendu, puis on purge (`purgeBackups`).
 *
 * Re-vérifie `postprocessedAt` côté serveur : si un autre passage a traité
 * l'asset entre-temps, on ne l'écrase pas et on supprime le blob fraîchement
 * uploadé plutôt que de le laisser orphelin.
 */
export const commitPostprocessed = internalMutation({
  args: {
    results: v.array(
      v.object({
        assetId: v.id("assets"),
        storageId: v.id("_storage"),
        fileName: v.string(),
        contentType: v.string(),
        size: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let committed = 0;
    const conflicts: string[] = [];

    for (const r of args.results) {
      const asset = await ctx.db.get(r.assetId);
      if (!asset || asset.postprocessedAt !== undefined) {
        conflicts.push(r.assetId);
        await ctx.storage.delete(r.storageId);
        continue;
      }
      await ctx.db.patch(r.assetId, {
        storageId: r.storageId,
        fileName: r.fileName,
        contentType: r.contentType,
        size: r.size,
        postprocessedAt: Date.now(),
        postprocessBackup: {
          storageId: asset.storageId,
          fileName: asset.fileName,
          contentType: asset.contentType,
          size: asset.size,
        },
      });
      committed++;
    }

    return { committed, conflicts };
  },
});

/** Assets porteurs d'une sauvegarde restaurable, filtrables par dossier. */
export const listBackups = internalQuery({
  args: { folder: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const folders = await ctx.db.query("assetFolders").collect();
    const byId = new Map(folders.map((f) => [f._id, f.name]));
    const needle = args.folder?.trim().toLowerCase();

    const rows = (await ctx.db.query("assets").collect()).filter((a) => {
      if (a.postprocessBackup === undefined) return false;
      if (needle === undefined) return true;
      const name = byId.get(a.folderId) ?? "";
      return a.folderId === args.folder || name.toLowerCase().includes(needle);
    });

    return rows.map((a) => ({
      assetId: a._id as string,
      folderName: byId.get(a.folderId) ?? "?",
      current: { fileName: a.fileName, size: a.size },
      backup: {
        fileName: a.postprocessBackup!.fileName,
        size: a.postprocessBackup!.size,
      },
    }));
  },
});

/**
 * RETOUR ARRIÈRE : remet la row sur le blob d'origine (nom, type et taille
 * compris), supprime le blob traité et efface `postprocessedAt` — l'asset
 * redevient donc candidat à un futur passage.
 */
export const restoreOriginals = internalMutation({
  args: { assetIds: v.array(v.id("assets")) },
  handler: async (ctx, args) => {
    let restored = 0;
    const missing: string[] = [];

    for (const assetId of args.assetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset || asset.postprocessBackup === undefined) {
        missing.push(assetId);
        continue;
      }
      const backup = asset.postprocessBackup;
      const processed = asset.storageId;
      await ctx.db.patch(assetId, {
        storageId: backup.storageId,
        fileName: backup.fileName,
        contentType: backup.contentType,
        size: backup.size,
        postprocessedAt: undefined,
        postprocessBackup: undefined,
      });
      if (processed !== backup.storageId) await ctx.storage.delete(processed);
      restored++;
    }

    return { restored, missing };
  },
});

/**
 * Purge DÉFINITIVE des sauvegardes (une fois le rendu validé) : supprime les
 * blobs d'origine et le champ. `postprocessedAt` est CONSERVÉ — l'idempotence
 * ne doit pas dépendre de la présence d'une sauvegarde.
 */
export const purgeBackups = internalMutation({
  args: { assetIds: v.array(v.id("assets")) },
  handler: async (ctx, args) => {
    let purged = 0;

    for (const assetId of args.assetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset || asset.postprocessBackup === undefined) continue;
      await ctx.storage.delete(asset.postprocessBackup.storageId);
      await ctx.db.patch(assetId, { postprocessBackup: undefined });
      purged++;
    }

    return { purged };
  },
});

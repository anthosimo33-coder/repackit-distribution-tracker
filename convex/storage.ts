import { authedMutation, authedQuery } from "./functions";
import { v } from "convex/values";

/**
 * Batch D — File storage greenfield. Génère une URL d'upload signée
 * éphémère pour que le client puisse POST directement le blob image
 * (pattern documenté : https://docs.convex.dev/file-storage/upload-files).
 *
 * Pas d'auth dans ce repo (cohérent avec les autres mutations) ; si un
 * jour on ajoute une couche auth, gating à insérer ici (rejet si pas de
 * session active).
 *
 * Côté client (ImageUploader) :
 *   1. const uploadUrl = await generateUploadUrl();
 *   2. const res = await fetch(uploadUrl, { method: "POST", body: file,
 *        headers: { "Content-Type": file.type } });
 *   3. const { storageId } = await res.json();
 *   4. dispatch({ type: "SET_FIELD", field: "image", value: storageId });
 *
 * La résolution de l'URL publique se fait côté serveur dans
 * listPublications via ctx.storage.getUrl. Le client ne touche jamais
 * directement le storageId pour l'affichage.
 */
export const generateUploadUrl = authedMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Résolution lazy d'un storageId vers une URL signée. Utilisé par
 * ImageUploader pendant le flow modal Nouveau (l'image est uploadée mais
 * pas encore liée à une publication, donc pas dans listPublications).
 * Retourne null si le blob n'existe pas (storageId invalide ou supprimé).
 */
export const getPreviewUrl = authedQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

import {
  adminViewAsQuery,
  creatorQuery,
  permissionMutation,
  permissionQuery,
} from "./functions";
import { ConvexError, v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * CONTRATS créateur — le PDF signé, déposé par l'admin sur une fiche, relu par
 * la créatrice depuis son profil. Blob en Convex file storage, métadonnées dans
 * `creatorContracts`.
 *
 * DEUX PORTES, DEUX GARDES (cf. la règle « une fonction, une garde » de
 * functions.ts) :
 *   - admin  → `creators.pay_terms` (un contrat énonce le tarif négocié) ;
 *   - créatrice → `creatorQuery`, scopée `ctx.creatorId` : elle ne peut lire
 *     que les siens, l'id d'une autre fiche n'est même pas un argument.
 * Plus la porte d'OBSERVATION (`adminViewAsQuery`) pour « voir son espace »,
 * en lecture seule par construction.
 *
 * ⚠️ A6 — la validation type/taille est RÉPLIQUÉE de lib/contract-file.ts (où
 * vivent les tests Vitest). Toute évolution doit l'être des deux côtés.
 */

// Réplique de lib/contract-file (règle A6) : PDF uniquement, ≤ 20 Mo.
const CONTRACT_CONTENT_TYPE = "application/pdf";
const CONTRACT_MAX_BYTES = 20 * 1024 * 1024;
const MAX_NAME_LENGTH = 120;

/**
 * Lecture PARTAGÉE par les trois portes → l'admin, la créatrice et l'admin en
 * observation lisent EXACTEMENT la même chose. Un écart entre ces vues serait
 * invisible à l'œil et se paierait le jour d'un litige.
 *
 * `url` est une URL signée résolue serveur ; le storageId ne sort jamais.
 * Le plus RÉCENT en tête : c'est l'avenant en vigueur qu'on vient chercher.
 */
async function contractsFor(ctx: QueryCtx, creatorId: Id<"creators">) {
  const rows = await ctx.db
    .query("creatorContracts")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  rows.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return await Promise.all(
    rows.map(async (r) => ({
      _id: r._id,
      fileName: r.fileName,
      size: r.size,
      uploadedAt: r.uploadedAt,
      url: await ctx.storage.getUrl(r.storageId),
    })),
  );
}

export type CreatorContract = Awaited<
  ReturnType<typeof contractsFor>
>[number];

/** ADMIN — les contrats d'une fiche. Gaté `creators.pay_terms`, scopé projet. */
export const listCreatorContracts = permissionQuery("creators.pay_terms")({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, { creatorId }) => {
    const creator = await ctx.db.get(creatorId);
    if (!creator || creator.projectId !== ctx.projectId) {
      throw new ConvexError("Créateur introuvable dans le projet.");
    }
    return await contractsFor(ctx, creatorId);
  },
});

/** CRÉATRICE — SES contrats sur CE projet. Aucun id en argument, donc rien à filtrer. */
export const listMyContracts = creatorQuery({
  args: {},
  handler: async (ctx) => contractsFor(ctx, ctx.creatorId),
});

/** ADMIN view-as — mêmes contrats que ci-dessus, pour l'écran observé. */
export const listContractsAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) => contractsFor(ctx, ctx.creatorId),
});

/**
 * Dépôt d'un contrat : le blob est DÉJÀ dans le storage (generateUploadUrl +
 * POST côté client), on enregistre ses métadonnées après re-validation SERVEUR.
 *
 * Tout chemin de rejet purge le blob : un fichier uploadé qu'aucune row ne
 * référence n'est plus atteignable par personne, il ne resterait là qu'à
 * occuper de l'espace et à porter le contenu d'un contrat.
 */
export const addCreatorContract = permissionMutation("creators.pay_terms")({
  args: {
    creatorId: v.id("creators"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator || creator.projectId !== ctx.projectId) {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError("Créateur introuvable dans le projet.");
    }
    if (
      args.contentType !== CONTRACT_CONTENT_TYPE ||
      !Number.isFinite(args.size) ||
      args.size <= 0 ||
      args.size > CONTRACT_MAX_BYTES
    ) {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError("Fichier refusé : PDF de 20 Mo maximum.");
    }
    const fileName =
      args.fileName.trim().slice(0, MAX_NAME_LENGTH) || "contrat.pdf";
    return await ctx.db.insert("creatorContracts", {
      projectId: ctx.projectId,
      creatorId: args.creatorId,
      storageId: args.storageId,
      fileName,
      size: args.size,
      uploadedAt: Date.now(),
      uploadedBy: ctx.userId,
    });
  },
});

/**
 * Retrait d'un contrat — row ET blob. Il n'y a pas de corbeille : un PDF déposé
 * sur la mauvaise fiche doit pouvoir disparaître pour de bon, y compris du
 * storage, sinon « supprimé » ne voudrait rien dire pour un document contractuel.
 */
export const deleteCreatorContract = permissionMutation("creators.pay_terms")({
  args: { id: v.id("creatorContracts") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.projectId !== ctx.projectId) {
      throw new ConvexError("Contrat introuvable dans le projet.");
    }
    await ctx.db.delete(id);
    await ctx.storage.delete(row.storageId);
  },
});

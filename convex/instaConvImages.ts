/**
 * IMAGES DES CONVERSATIONS INSTAGRAM — photo/vidéo envoyée, reel, publication,
 * story partagée, miniature de story. Le fichier vit dans le storage ; la
 * conversation ne porte que l'id d'une ligne `instaConvImages` du MÊME projet.
 *
 * Deux chemins d'arrivée, une seule validation (`enregistrerImageCore`) :
 *  - l'écran : le navigateur réduit l'image, la pousse (generateUploadUrl), puis
 *    l'enregistre ;
 *  - le MCP : l'action récupère la couverture d'un TikTok et la range elle-même
 *    (convex/mcpConversations.ts).
 *
 * Une image n'est PAS effacée avec sa conversation : « défaire » une suppression
 * (MCP, 30 jours) doit la retrouver. Le ramassage quotidien efface celles que
 * plus rien ne référence — ni une conversation, ni le journal MCP récent.
 */
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { e2eMutation, permissionMutation, permissionQuery, type ProjectMutationCtx } from "./functions";
import { ERR, err } from "./errorCodes";
import { deleteStorageBestEffort } from "./storageCleanup";

export const TYPES_IMAGE = ["image/jpeg", "image/png", "image/webp"] as const;
export const POIDS_IMAGE_MAX = 8_000_000;
/** Une page résout au plus ce nombre d'images (une conversation en porte quelques-unes). */
const MAX_IDS = 200;
/** Au-delà de la fenêtre de « défaire » (30 jours), une image orpheline peut partir. */
export const GARDE_ORPHELINE_MS = 31 * 86_400_000;
const LOT_RAMASSAGE = 100;

const dimension = (n: number) => (Number.isFinite(n) ? Math.min(20_000, Math.max(1, Math.round(n))) : 1);

/**
 * Enregistre un fichier DÉJÀ dans le storage comme image du projet. Type et poids
 * relus dans la table système (pas sur parole) ; tout refus efface le fichier,
 * qu'aucune ligne ne référencerait plus.
 */
export async function enregistrerImageCore(
  ctx: ProjectMutationCtx,
  a: { storageId: Id<"_storage">; w: number; h: number },
): Promise<Id<"instaConvImages">> {
  const meta = await ctx.db.system.get(a.storageId);
  const deja = await ctx.db
    .query("instaConvImages")
    .withIndex("by_storage", (q) => q.eq("storageId", a.storageId))
    .first();
  if (deja) throw err(ERR.INSTA_CONV_IMAGE_REJECTED, "Image déjà enregistrée.");
  if (!meta || !(TYPES_IMAGE as readonly string[]).includes(meta.contentType ?? "") || meta.size > POIDS_IMAGE_MAX) {
    await deleteStorageBestEffort(ctx, a.storageId);
    throw err(ERR.INSTA_CONV_IMAGE_REJECTED, "Image refusée : JPEG, PNG ou WebP de 8 Mo au plus.");
  }
  const maintenant = Date.now();
  return ctx.db.insert("instaConvImages", {
    projectId: ctx.projectId,
    storageId: a.storageId,
    w: dimension(a.w),
    h: dimension(a.h),
    createdBy: ctx.userId,
    createdAt: maintenant,
    checkedAt: maintenant,
  });
}

// ─── Écran ──────────────────────────────────────────────────────────────────

export const generateInstaConvUploadUrl = permissionMutation("conversations.use")({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const registerInstaConvImage = permissionMutation("conversations.use")({
  args: { storageId: v.id("_storage"), w: v.number(), h: v.number() },
  handler: async (ctx, a) => {
    const id = await enregistrerImageCore(ctx, a);
    return { id, url: await ctx.storage.getUrl(a.storageId), w: dimension(a.w), h: dimension(a.h) };
  },
});

/** id → { url, w, h } pour les images du projet ; un id inconnu ou d'un autre projet est ignoré. */
export const getInstaConvImages = permissionQuery("conversations.use")({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    const out: Record<string, { url: string; w: number; h: number }> = {};
    for (const brut of ids.slice(0, MAX_IDS)) {
      const id = ctx.db.normalizeId("instaConvImages", brut);
      const img = id ? await ctx.db.get(id) : null;
      if (!img || img.projectId !== ctx.projectId) continue;
      const url = await ctx.storage.getUrl(img.storageId);
      if (url) out[brut] = { url, w: img.w, h: img.h };
    }
    return out;
  },
});

// ─── Ramassage des orphelines ───────────────────────────────────────────────

const OUTILS_CONVERSATIONS = new Set(["creer_conversation", "modifier_conversation", "supprimer_conversation"]);

/**
 * Chaque jour : les images vérifiées il y a plus de 31 jours sont relues ; celles
 * que ni une conversation du projet ni le journal MCP des 31 derniers jours ne
 * citent partent (fichier compris). Les autres repassent en fin de file.
 */
export const purgerImagesOrphelines = internalMutation({
  args: {},
  handler: async (ctx) => ramasser(ctx, Date.now()),
});

/** E2E — le même ramassage, « maintenant » avancé (une image vieille d'un mois sans attendre un mois). */
export const e2eRamasserImages = e2eMutation({
  args: { maintenant: v.number() },
  handler: async (ctx, { maintenant }) => ramasser(ctx, maintenant),
});

async function ramasser(ctx: MutationCtx, maintenant: number): Promise<{ relues: number; effacees: Id<"instaConvImages">[] }> {
  const limite = maintenant - GARDE_ORPHELINE_MS;
  const lot = await ctx.db
    .query("instaConvImages")
    .withIndex("by_checked", (q) => q.lt("checkedAt", limite))
    .take(LOT_RAMASSAGE);
  const textesParProjet = new Map<Id<"projects">, string[]>();
  const effacees: Id<"instaConvImages">[] = [];
  for (const img of lot) {
    let textes = textesParProjet.get(img.projectId);
    if (!textes) {
      textes = [];
      const convs = await ctx.db
        .query("instaConversations")
        .withIndex("by_project", (q) => q.eq("projectId", img.projectId))
        .collect();
      for (const c of convs) textes.push(c.data);
      for await (const l of ctx.db
        .query("mcpWriteLog")
        .withIndex("by_project", (q) => q.eq("projectId", img.projectId))
        .order("desc")) {
        if (l._creationTime < limite) break;
        if (OUTILS_CONVERSATIONS.has(l.tool)) textes.push(JSON.stringify([l.annulation ?? null, l.etats ?? null]));
      }
      textesParProjet.set(img.projectId, textes);
    }
    if (textes.some((t) => t.includes(img._id))) {
      await ctx.db.patch(img._id, { checkedAt: maintenant });
    } else {
      await deleteStorageBestEffort(ctx, img.storageId);
      await ctx.db.delete(img._id);
      effacees.push(img._id);
    }
  }
  return { relues: lot.length, effacees };
}

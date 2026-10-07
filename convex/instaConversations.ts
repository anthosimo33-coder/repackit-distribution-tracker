/**
 * BIBLIOTHÈQUE DE CONVERSATIONS INSTAGRAM — brouillons de captures, par projet.
 *
 * Les CŒURS (`…Core`) servent l'écran ET les outils MCP (convex/mcpConversations) :
 * une seule implémentation des règles (titre unique dans le projet, taille
 * bornée, forme relue par `parseConversation`). Bloc `conversations.use`.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { permissionMutation, permissionQuery, type ProjectMutationCtx, type ProjectQueryCtx } from "./functions";
import { ERR, err } from "./errorCodes";
import { MAX_TITRE, parseConversation } from "./instaConvModel";

/**
 * Une conversation pèse quelques Ko, la photo du contact ~30 Ko. Plafond bas : le
 * journal MCP garde avant ET après (annulation + états) dans UN document (≤ 1 Mo).
 */
export const MAX_DATA = 200_000;

const plier = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

export async function conversationsDuProjet(ctx: ProjectQueryCtx | ProjectMutationCtx): Promise<Doc<"instaConversations">[]> {
  return ctx.db
    .query("instaConversations")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .order("desc")
    .collect();
}

function verifierTitre(titre: string): string {
  const t = titre.trim().replace(/\s+/g, " ");
  if (!t) throw err(ERR.INSTA_CONV_INVALID, "Donne un titre à la conversation.");
  if (t.length > MAX_TITRE) throw err(ERR.INSTA_CONV_INVALID, `Titre trop long (${MAX_TITRE} caractères au plus).`);
  return t;
}

function verifierData(data: string): void {
  if (data.length > MAX_DATA) throw err(ERR.INSTA_CONV_INVALID, "Conversation trop lourde (photo trop grande ?).");
  let ok = false;
  try {
    ok = parseConversation(JSON.parse(data)) !== null;
  } catch {
    ok = false;
  }
  if (!ok) throw err(ERR.INSTA_CONV_INVALID, "Conversation illisible.");
}

async function titreLibre(ctx: ProjectMutationCtx, titre: string, sauf?: Id<"instaConversations">) {
  const pris = (await conversationsDuProjet(ctx)).find((c) => c._id !== sauf && plier(c.titre) === plier(titre));
  if (pris) throw err(ERR.INSTA_CONV_TITLE_TAKEN, `Une conversation s'appelle déjà « ${pris.titre} ».`, { titre: pris.titre });
}

export async function conversationDuProjet(
  ctx: ProjectQueryCtx | ProjectMutationCtx,
  id: Id<"instaConversations">,
): Promise<Doc<"instaConversations">> {
  const c = await ctx.db.get(id);
  if (!c || c.projectId !== ctx.projectId) throw err(ERR.INSTA_CONV_NOT_FOUND, "Conversation introuvable.");
  return c;
}

export async function createConversationCore(
  ctx: ProjectMutationCtx,
  a: { titre: string; data: string },
): Promise<Id<"instaConversations">> {
  const titre = verifierTitre(a.titre);
  verifierData(a.data);
  await titreLibre(ctx, titre);
  const maintenant = Date.now();
  return ctx.db.insert("instaConversations", {
    projectId: ctx.projectId,
    titre,
    data: a.data,
    createdBy: ctx.userId,
    createdAt: maintenant,
    updatedAt: maintenant,
  });
}

export async function updateConversationCore(
  ctx: ProjectMutationCtx,
  id: Id<"instaConversations">,
  a: { titre?: string; data?: string },
): Promise<void> {
  await conversationDuProjet(ctx, id);
  const patch: Partial<Doc<"instaConversations">> = { updatedAt: Date.now() };
  if (a.titre !== undefined) {
    patch.titre = verifierTitre(a.titre);
    await titreLibre(ctx, patch.titre, id);
  }
  if (a.data !== undefined) {
    verifierData(a.data);
    patch.data = a.data;
  }
  await ctx.db.patch(id, patch);
}

export async function deleteConversationCore(ctx: ProjectMutationCtx, id: Id<"instaConversations">): Promise<void> {
  await conversationDuProjet(ctx, id);
  await ctx.db.delete(id);
}

/** Recrée une conversation supprimée (Défaire), avec son titre s'il est encore libre. */
export async function restoreConversationCore(
  ctx: ProjectMutationCtx,
  a: { titre: string; data: string },
): Promise<Id<"instaConversations">> {
  const pris = (await conversationsDuProjet(ctx)).some((c) => plier(c.titre) === plier(a.titre));
  return createConversationCore(ctx, { titre: pris ? `${a.titre} (restaurée)`.slice(0, MAX_TITRE) : a.titre, data: a.data });
}

// ─── Écran ──────────────────────────────────────────────────────────────────

/** La bibliothèque : titres et dates, sans le contenu (la photo pèse). */
export const listInstaConversations = permissionQuery("conversations.use")({
  args: {},
  handler: async (ctx) =>
    (await conversationsDuProjet(ctx)).map((c) => ({ _id: c._id, titre: c.titre, updatedAt: c.updatedAt })),
});

export const getInstaConversation = permissionQuery("conversations.use")({
  args: { id: v.id("instaConversations") },
  handler: async (ctx, { id }) => {
    const c = await ctx.db.get(id);
    if (!c || c.projectId !== ctx.projectId) return null;
    return { _id: c._id, titre: c.titre, data: c.data, updatedAt: c.updatedAt };
  },
});

export const createInstaConversation = permissionMutation("conversations.use")({
  args: { titre: v.string(), data: v.string() },
  handler: async (ctx, a) => createConversationCore(ctx, a),
});

export const saveInstaConversation = permissionMutation("conversations.use")({
  args: { id: v.id("instaConversations"), titre: v.optional(v.string()), data: v.optional(v.string()) },
  handler: async (ctx, { id, ...a }) => updateConversationCore(ctx, id, a),
});

export const deleteInstaConversation = permissionMutation("conversations.use")({
  args: { id: v.id("instaConversations") },
  handler: async (ctx, { id }) => deleteConversationCore(ctx, id),
});

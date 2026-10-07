/**
 * CONVERSATIONS INSTAGRAM PAR CLAUDE — Claude est le « cerveau » du générateur :
 * il LIT une capture (envoyée dans la discussion, ou les images d'un TikTok via
 * `images_tiktok`) et ÉCRIT la conversation ; l'app la DESSINE et l'exporte.
 * Aucun appel à un modèle payant côté serveur.
 *
 *  - lecture (droit `conversations.use`) : `conversations`, `lire_conversation`,
 *    `images_tiktok` (rend des IMAGES, comme `regarder_video`) ;
 *  - écriture (interrupteur « Conversations », même droit) : `creer_conversation`,
 *    `modifier_conversation`, `supprimer_conversation` — toutes défaisables.
 *
 * L'image finale ne sort PAS du serveur : elle se dessine dans un navigateur
 * (SF Pro et emojis Apple, absents d'un serveur et non redistribuables). Chaque
 * réponse donne donc le LIEN de l'écran, où « Exporter en PNG » la produit.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mcpPermissionQuery, mcpWriteMutation } from "./functions";
import { ERR, err } from "./errorCodes";
import { textResult, ToolError, type McpTool, type ToolContent, type ToolResult } from "./mcpProtocol";
import {
  AJOUTE,
  ARG_PROJET,
  ECRIT,
  EFFACE,
  designerOuRefuser,
  ecrire,
  etatsApres,
  etatsCrees,
  journaliser,
  photographier,
  resultatEcriture,
  texteArg,
  type CibleEcriture,
  type DomaineEcriture,
} from "./mcpWriteCommon";
import { base64 } from "./mcpVideo";
import { conversationDeData, defaultConversation, MAX_ITEMS, MAX_TITRE, THEME_IDS } from "./instaConvModel";
import { appliquerChampsMcp, conversationPourMcp, THEME_MCP, type ChampsMcp } from "./mcpConversationsArgs";
import {
  conversationDuProjet,
  conversationsDuProjet,
  createConversationCore,
  deleteConversationCore,
  updateConversationCore,
} from "./instaConversations";
import { extractTikTokMedia, isTikTokCdnUrl, isTikTokPostUrl } from "./tiktokMedia";

// ─── Lien vers l'écran ──────────────────────────────────────────────────────

/** Lien absolu quand le déploiement connaît son adresse (comme les emails), relatif sinon. */
export function lienConversation(projet: string, id: string): string {
  const base = (process.env.APP_BASE_URL || process.env.SITE_URL || "").replace(/\/+$/, "");
  return `${base}/admin/${projet}/conversations?c=${id}`;
}

const OUVRIR =
  "Ouvre le lien : la capture est dessinée par l'app ; « Exporter en PNG » la télécharge (828×1792), « Exporter la série » télécharge un ZIP d'une capture par slide quand il y a des coupures. La photo du contact se pose à l'écran.";

// ─── Arguments partagés ─────────────────────────────────────────────────────

const ARG_MESSAGES = {
  type: "array",
  description:
    `Le fil, de haut en bas (${MAX_ITEMS} éléments au plus). Chaque bulle est UN message : quelqu'un qui écrit trois lignes envoie trois messages. Recopie le texte d'une capture EXACTEMENT (fautes, abréviations, apostrophes ’ ou ', emojis).`,
  items: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["message", "date"], description: "« date » = séparateur centré (ex. « AUJOURD'HUI 21:43 », « 25 AUG AT 22:14 »). Défaut : message." },
      cote: { type: "string", enum: ["recu", "envoye"], description: "recu = bulle à gauche (l'autre personne) ; envoye = à droite (le propriétaire du téléphone). Obligatoire pour un message." },
      texte: { type: "string", description: "Le texte de la bulle, ou du séparateur." },
      modifie: { type: "boolean", description: "Label « Modifié » au-dessus de la bulle." },
      reaction: { type: "string", description: "Un emoji de réaction posé sous la bulle (ex. « 😂 »)." },
      coupure: { type: "boolean", description: "Fin de slide APRÈS cet élément : l'écran exporte alors une SÉRIE de captures (carrousel), chacune montrant la conversation jusqu'à sa coupure, la plus récente en bas." },
    },
    required: ["texte"],
    additionalProperties: false,
  },
} as const;

const ARGS_APPARENCE = {
  theme: { type: "string", enum: THEME_IDS.map((t) => THEME_MCP[t]), description: "sombre = le thème par défaut d'Instagram (mesuré) ; coeurs, ocean = thèmes inventés." },
  langue: { type: "string", enum: ["fr", "en"], description: "Langue de l'interface dessinée (« Message... », « Modifié »/« Edited »)." },
  contact_nom: { type: "string", description: "Nom affiché en haut de l'écran." },
  contact_pseudo: { type: "string", description: "Nom d'utilisateur sous le nom (sans @)." },
  heure: { type: "string", description: "Heure de la barre d'état, ex. « 23:47 »." },
  batterie: { type: "integer", minimum: 0, maximum: 100, description: "Pourcentage de batterie." },
  economie_energie: { type: "boolean", description: "Batterie jaune (mode économie d'énergie)." },
  reseau: { type: "integer", minimum: 0, maximum: 4, description: "Barres de réseau allumées." },
  defilement: { type: "integer", minimum: -200, maximum: 1200, description: "Décalage en points : 0 = le dernier message juste au-dessus de la saisie ; plus grand = on voit des messages plus anciens." },
} as const;

// ─── Lecture ────────────────────────────────────────────────────────────────

export const OUTILS_CONVERSATIONS_LECTURE: readonly McpTool[] = [
  {
    name: "conversations",
    title: "Conversations Instagram",
    description:
      "Les brouillons de captures de conversations Instagram du projet (générateur de l'app) : titre, nombre de messages, dernière modification et lien pour l'ouvrir et exporter le PNG.",
    inputSchema: { type: "object", properties: { projet: ARG_PROJET }, additionalProperties: false },
  },
  {
    name: "lire_conversation",
    title: "Lire une conversation Instagram",
    description:
      "Le contenu d'UN brouillon (désigné par son titre) : messages numérotés, contact, barre d'état, thème. À lire avant `modifier_conversation`, qui remplace la liste ENTIÈRE des messages quand on la lui donne.",
    inputSchema: {
      type: "object",
      properties: { projet: ARG_PROJET, conversation: { type: "string", description: "Titre de la conversation (outil `conversations`)." } },
      required: ["conversation"],
      additionalProperties: false,
    },
  },
  {
    name: "images_tiktok",
    title: "Images d'un TikTok",
    description:
      "Les IMAGES d'un post TikTok public, pour les lire toi-même : les photos d'un carrousel, ou la seule couverture d'une vidéo (pour une autre image d'une vidéo, demande une capture). Sert à reproduire une conversation vue sur TikTok avec `creer_conversation`.",
    inputSchema: {
      type: "object",
      properties: { projet: ARG_PROJET, lien: { type: "string", description: "Lien du post (tiktok.com/@compte/photo/… ou /video/…)." } },
      required: ["lien"],
      additionalProperties: false,
    },
  },
];

export const NOMS_CONVERSATIONS_LECTURE = new Set(OUTILS_CONVERSATIONS_LECTURE.map((t) => t.name));

export const lireConversations = mcpPermissionQuery("conversations.use")({
  args: {},
  handler: async (ctx) =>
    (await conversationsDuProjet(ctx)).map((c) => ({
      id: c._id,
      titre: c.titre,
      messages: conversationDeData(c.data).items.filter((it) => it.kind === "message").length,
      modifieeLe: c.updatedAt,
    })),
});

export const lireConversation = mcpPermissionQuery("conversations.use")({
  args: { conversation: v.string() },
  handler: async (ctx, { conversation }) => {
    const c = designerOuRefuser(await conversationsDuProjet(ctx), (x) => x.titre, conversation, "conversations");
    return { id: c._id, titre: c.titre, modifieeLe: c.updatedAt, contenu: conversationPourMcp(conversationDeData(c.data)) };
  },
});

/** `images_tiktok` ne lit pas la base : il vérifie seulement le droit. */
export const verifierDroitConversations = mcpPermissionQuery("conversations.use")({
  args: {},
  handler: async () => true,
});

const NAVIGATEUR = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml",
};
const IMAGES_TIKTOK_MAX = 10;
const POIDS_IMAGE_MAX = 1_500_000;

async function imagesTiktok(lien: string): Promise<ToolResult> {
  if (!isTikTokPostUrl(lien)) throw new ToolError("« lien » : un lien tiktok.com (https).");
  let html: string;
  try {
    const res = await fetch(lien.trim().split("?")[0], { headers: NAVIGATEUR, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    throw new ToolError(`Page TikTok injoignable (${String(e).slice(0, 80)}).`);
  }
  const media = extractTikTokMedia(html);
  if (media.kind === "unreadable") throw new ToolError(`TikTok illisible : ${media.reason}.`);
  const urls = media.images.filter(isTikTokCdnUrl).slice(0, IMAGES_TIKTOK_MAX);
  const lues = await Promise.all(
    urls.map(async (url, i) => {
      try {
        const r = await fetch(url, { headers: { "User-Agent": NAVIGATEUR["User-Agent"] }, signal: AbortSignal.timeout(15_000) });
        const type = (r.headers.get("content-type") ?? "").split(";")[0];
        if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return { rang: i + 1, echec: `HTTP ${r.status} ${type}` };
        const octets = new Uint8Array(await r.arrayBuffer());
        if (octets.length > POIDS_IMAGE_MAX) return { rang: i + 1, echec: "image trop lourde" };
        return { rang: i + 1, data: base64(octets), mimeType: type };
      } catch (e) {
        return { rang: i + 1, echec: String(e).slice(0, 60) };
      }
    }),
  );
  const entete = {
    nature: media.kind === "photos" ? `carrousel de ${media.images.length} photo(s)` : "vidéo : seule la couverture est disponible",
    images: lues.filter((x) => "data" in x).length,
    ...(lues.some((x) => "echec" in x) ? { imagesManquantes: lues.filter((x) => "echec" in x) } : {}),
    lecture: [
      "Repère l'image qui montre la conversation, recopie chaque bulle EXACTEMENT (côté gauche = recu, droite = envoye), puis appelle `creer_conversation`.",
      "Une image recadrée n'a ni en-tête ni barre d'état : demande le nom à afficher, ou garde ceux par défaut.",
    ],
  };
  const contenu: ToolContent[] = [{ type: "text", text: JSON.stringify(entete, null, 1) }];
  for (const x of lues) {
    if (!("data" in x) || x.data === undefined) continue;
    contenu.push({ type: "text", text: `Image ${x.rang}` }, { type: "image", data: x.data, mimeType: x.mimeType });
  }
  return { content: contenu };
}

export async function appelerConversationsLecture(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  ids: { userId: Id<"users">; projectId: Id<"projects"> },
  projet: string,
  lire: <T>(f: () => Promise<T>) => Promise<T>,
): Promise<ToolResult> {
  if (name === "conversations") {
    const liste = await lire(() => ctx.runQuery(internal.mcpConversations.lireConversations, ids));
    return textResult(
      JSON.stringify(
        {
          projet,
          conversations: liste.map((c) => ({ titre: c.titre, messages: c.messages, modifieeLe: new Date(c.modifieeLe).toISOString().slice(0, 16), lien: lienConversation(projet, c.id) })),
          lecture: liste.length === 0 ? ["Aucune conversation : `creer_conversation` en crée une."] : [OUVRIR],
        },
        null,
        1,
      ),
    );
  }
  if (name === "lire_conversation") {
    const conversation = texteArg(args, "conversation");
    if (!conversation) throw new ToolError("« conversation » : son titre.");
    const c = await lire(() => ctx.runQuery(internal.mcpConversations.lireConversation, { ...ids, conversation }));
    return textResult(
      JSON.stringify(
        {
          projet,
          titre: c.titre,
          lien: lienConversation(projet, c.id),
          ...c.contenu,
          messages: c.contenu.messages.map((m, i) => ({ n: i + 1, ...m })),
          lecture: ["`modifier_conversation` avec « messages » REMPLACE toute la liste : renvoie-la entière, corrigée (sans le champ n)."],
        },
        null,
        1,
      ),
    );
  }
  if (name === "images_tiktok") {
    await lire(() => ctx.runQuery(internal.mcpConversations.verifierDroitConversations, ids));
    return imagesTiktok(texteArg(args, "lien"));
  }
  throw new ToolError(`Outil inconnu : ${name}.`);
}

// ─── Écriture ───────────────────────────────────────────────────────────────

const OUTILS_ECRITURE: readonly McpTool[] = [
  {
    name: "creer_conversation",
    title: "Créer une conversation Instagram",
    description:
      "Crée un brouillon de capture de conversation Instagram (DM iOS) que l'app dessine à l'identique ; la réponse donne le lien pour l'ouvrir et exporter le PNG. Pour reproduire une capture : recopie chaque bulle exactement. Pour inventer : écris comme de vrais messages (courts, minuscules si le ton s'y prête, une bulle par phrase). Les champs absents prennent les valeurs de l'exemple (contact, heure, batterie…).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        titre: { type: "string", description: `Nom du brouillon, unique dans le projet (${MAX_TITRE} caractères au plus).` },
        messages: ARG_MESSAGES,
        ...ARGS_APPARENCE,
      },
      required: ["titre", "messages"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "modifier_conversation",
    title: "Modifier une conversation Instagram",
    description:
      "Modifie un brouillon (désigné par son titre) : seuls les champs donnés changent. « messages » REMPLACE la liste entière — lis-la d'abord (`lire_conversation`), puis renvoie-la complète avec tes changements (« remplace le message 3… », « ajoute deux réponses… »).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        conversation: { type: "string", description: "Titre actuel de la conversation." },
        nouveau_titre: { type: "string", description: "Pour la renommer." },
        messages: ARG_MESSAGES,
        ...ARGS_APPARENCE,
      },
      required: ["conversation"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "supprimer_conversation",
    title: "Supprimer une conversation Instagram",
    description: "Supprime un brouillon (désigné par son titre). Défaisable : `defaire` le recrée.",
    inputSchema: {
      type: "object",
      properties: { projet: ARG_PROJET, conversation: { type: "string", description: "Titre de la conversation." } },
      required: ["conversation"],
      additionalProperties: false,
    },
    annotations: EFFACE,
  },
];

const CHAMPS = ["messages", "theme", "langue", "contact_nom", "contact_pseudo", "heure", "batterie", "economie_energie", "reseau", "defilement"] as const;

function champsDe(args: Record<string, unknown>): ChampsMcp {
  const c: Record<string, unknown> = {};
  for (const k of CHAMPS) if (args[k] !== undefined) c[k] = args[k];
  return c as ChampsMcp;
}

const resume = (titre: string, n: number) => `« ${titre} » — ${n} message${n > 1 ? "s" : ""}`;

export const ecrireCreation = mcpWriteMutation("conversations.use", "conversations")({
  args: { titre: v.string(), champs: v.string() },
  handler: async (ctx, a) => {
    const r = appliquerChampsMcp({ ...defaultConversation(), items: [] }, JSON.parse(a.champs) as ChampsMcp);
    if ("refus" in r) throw err(ERR.INSTA_CONV_INVALID, r.refus);
    const data = JSON.stringify(r.conversation);
    const id = await createConversationCore(ctx, { titre: a.titre, data });
    const doc = await ctx.db.get(id);
    const summary = `Créée : ${resume(doc!.titre, r.conversation.items.length)}`;
    await journaliser(ctx, {
      tool: "creer_conversation",
      summary,
      section: "conversations",
      path: `conversations?c=${id}`,
      annulation: { type: "conversationCreee", conversationId: id, apres: data },
      etats: await etatsCrees(ctx, "instaConversations", [id]),
    });
    return { summary, id };
  },
});

export const ecrireModification = mcpWriteMutation("conversations.use", "conversations")({
  args: { conversation: v.string(), nouveauTitre: v.optional(v.string()), champs: v.string() },
  handler: async (ctx, a) => {
    const c = designerOuRefuser(await conversationsDuProjet(ctx), (x) => x.titre, a.conversation, "conversations");
    const r = appliquerChampsMcp(conversationDeData(c.data), JSON.parse(a.champs) as ChampsMcp);
    if ("refus" in r) throw err(ERR.INSTA_CONV_INVALID, r.refus);
    const photos = await photographier(ctx, "instaConversations", [c._id]);
    const data = JSON.stringify(r.conversation);
    await updateConversationCore(ctx, c._id, { data, ...(a.nouveauTitre ? { titre: a.nouveauTitre } : {}) });
    const apres = await conversationDuProjet(ctx, c._id);
    const summary = `Modifiée : ${resume(apres.titre, r.conversation.items.length)}`;
    await journaliser(ctx, {
      tool: "modifier_conversation",
      summary,
      section: "conversations",
      path: `conversations?c=${c._id}`,
      annulation: {
        type: "conversationModifiee",
        conversationId: c._id,
        avant: { titre: c.titre, data: c.data },
        apres: { titre: apres.titre, data: apres.data },
      },
      etats: await etatsApres(ctx, photos),
    });
    return { summary, id: c._id };
  },
});

export const ecrireSuppression = mcpWriteMutation("conversations.use", "conversations")({
  args: { conversation: v.string() },
  handler: async (ctx, a) => {
    const c = designerOuRefuser(await conversationsDuProjet(ctx), (x) => x.titre, a.conversation, "conversations");
    const photos = await photographier(ctx, "instaConversations", [c._id]);
    await deleteConversationCore(ctx, c._id);
    const summary = `Supprimée : « ${c.titre} »`;
    await journaliser(ctx, {
      tool: "supprimer_conversation",
      summary,
      section: "conversations",
      path: "conversations",
      annulation: { type: "conversationSupprimee", titre: c.titre, data: c.data },
      etats: await etatsApres(ctx, photos),
    });
    return { summary };
  },
});

async function appelerEcriture(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  const champs = JSON.stringify(champsDe(args));
  if (name === "creer_conversation") {
    const titre = texteArg(args, "titre");
    if (!titre) throw new ToolError("« titre » : le nom du brouillon.");
    if (!Array.isArray(args.messages) || args.messages.length === 0) throw new ToolError("« messages » : au moins un élément.");
    const r = await ecrire(() => ctx.runMutation(internal.mcpConversations.ecrireCreation, { ...cible, titre, champs }));
    return resultatEcriture(projet, r.summary, "`defaire` la supprime (tant qu'elle n'a pas été modifiée depuis).", { lien: lienConversation(projet, r.id), ouvrir: OUVRIR });
  }
  if (name === "modifier_conversation") {
    const conversation = texteArg(args, "conversation");
    if (!conversation) throw new ToolError("« conversation » : son titre.");
    const nouveauTitre = texteArg(args, "nouveau_titre");
    const r = await ecrire(() =>
      ctx.runMutation(internal.mcpConversations.ecrireModification, { ...cible, conversation, champs, ...(nouveauTitre ? { nouveauTitre } : {}) }),
    );
    return resultatEcriture(projet, r.summary, "`defaire` remet la version d'avant (si personne ne l'a modifiée depuis).", { lien: lienConversation(projet, r.id), ouvrir: OUVRIR });
  }
  if (name === "supprimer_conversation") {
    const conversation = texteArg(args, "conversation");
    if (!conversation) throw new ToolError("« conversation » : son titre.");
    const r = await ecrire(() => ctx.runMutation(internal.mcpConversations.ecrireSuppression, { ...cible, conversation }));
    return resultatEcriture(projet, r.summary, "`defaire` la recrée (nouveau lien).");
  }
  throw new ToolError(`Outil inconnu : ${name}.`);
}

/** Le domaine « conversations » : interrupteur « Conversations Instagram ». */
export const DOMAINE_CONVERSATIONS: DomaineEcriture = {
  scope: "conversations",
  outils: OUTILS_ECRITURE,
  droits: {
    creer_conversation: "conversations.use",
    modifier_conversation: "conversations.use",
    supprimer_conversation: "conversations.use",
  },
  appeler: appelerEcriture,
};

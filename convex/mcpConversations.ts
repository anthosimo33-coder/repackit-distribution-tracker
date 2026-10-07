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
import { conversationDeData, defaultConversation, MAX_ITEMS, MAX_TITRE, PARAM_EXPORT, THEME_IDS, type Conversation } from "./instaConvModel";
import {
  appliquerChampsMcp,
  conversationPourMcp,
  lienImagePublic,
  octetsDataUrl,
  PREFIXE_FICHIER,
  THEME_MCP,
  type ChampsMcp,
} from "./mcpConversationsArgs";
import { enregistrerImageCore, POIDS_IMAGE_MAX } from "./instaConvImages";
import { imageSize } from "./imageSize";
import type { ProjectMutationCtx } from "./functions";
import {
  conversationDuProjet,
  conversationsDuProjet,
  createConversationCore,
  deleteConversationCore,
  updateConversationCore,
} from "./instaConversations";
import {
  extractTikTokMedia,
  extractTikTokProfile,
  isTikTokCdnUrl,
  isTikTokPostUrl,
  isTikTokProfileUrl,
  type TikTokAuthor,
  type TikTokMedia,
} from "./tiktokMedia";

// ─── Lien vers l'écran ──────────────────────────────────────────────────────

/** Lien absolu quand le déploiement connaît son adresse (comme les emails), relatif sinon. */
export function lienConversation(projet: string, id: string, exporter = false): string {
  const base = (process.env.APP_BASE_URL || process.env.SITE_URL || "").replace(/\/+$/, "");
  return `${base}/admin/${projet}/conversations?c=${id}${exporter ? `&${PARAM_EXPORT}=1` : ""}`;
}

/** Les deux liens d'une conversation : l'écran, et le téléchargement direct des captures. */
const liens = (projet: string, id: string) => ({ telecharger: lienConversation(projet, id, true), lien: lienConversation(projet, id) });

const OUVRIR =
  "Donne « telecharger » à la personne : l'ouvrir (connectée à Jarvia) dessine la conversation et télécharge AUSSITÔT les captures — un PNG 828×1792, ou un ZIP d'une capture par slide quand il y a des coupures. « lien » ouvre l'écran pour retoucher (photo du contact, images à déposer) puis exporter à la main. Les captures ne peuvent pas t'être rendues en image : elles se dessinent dans le navigateur (polices et emojis Apple).";

// ─── Arguments partagés ─────────────────────────────────────────────────────

const ARG_MESSAGES = {
  type: "array",
  description:
    `Le fil, de haut en bas (${MAX_ITEMS} éléments au plus). Chaque bulle est UN message : quelqu'un qui écrit trois lignes envoie trois messages. Recopie le texte d'une capture EXACTEMENT (fautes, abréviations, apostrophes ’ ou ', emojis).`,
  items: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["message", "date", "vocal", "photo_ephemere", "video_ephemere", "photo", "video", "reel", "publication", "story_partagee"],
        description:
          "message (défaut) ; date = séparateur centré, au format d'Instagram : l'heure seule pour aujourd'hui (« 21:43 »), « YESTERDAY AT 19:21 », « MON 10:48 », « 27 JUL AT 06:29 » ; vocal = message vocal (« duree ») ; photo_ephemere / video_ephemere = pastille « ▶ Photo » / « ▶ Video » d'un média éphémère déjà vu ; photo / video = photo ou vidéo envoyée dans la conversation (« image ») ; reel / publication = reel ou post partagé (« image », « compte », « legende ») ; story_partagee = « Sent @compte's story » (« image », « compte »). Aucun de ces médias n'a de texte.",
      },
      cote: { type: "string", enum: ["recu", "envoye"], description: "recu = bulle à gauche (l'autre personne) ; envoye = à droite (le propriétaire du téléphone). Obligatoire sauf pour une date." },
      texte: { type: "string", description: "Le texte de la bulle, ou du séparateur (inutile pour vocal et éphémères)." },
      modifie: { type: "boolean", description: "Label « Modifié » au-dessus de la bulle." },
      reaction: {
        type: "string",
        description:
          "Un emoji de RÉACTION, dans une pastille sous la bulle (ex. « 😂 »). « Il répond X avec 😂 » sans autre précision veut le plus souvent dire une réaction ; un emoji écrit DANS le message va dans « texte ».",
      },
      coupure: { type: "boolean", description: "Fin de slide APRÈS cet élément : l'écran exporte alors une SÉRIE de captures (carrousel), chacune montrant la conversation jusqu'à sa coupure, la plus récente en bas." },
      duree: { type: "integer", minimum: 1, maximum: 600, description: "Vocal : durée en secondes (défaut 3)." },
      reponse: {
        type: "object",
        description:
          "Réponse CITÉE au-dessus de la bulle (« Replied to you » / « You replied ») : { cote: recu|envoye (qui avait écrit le message cité), texte: le message cité (coupé à 3 lignes), type?: texte|photo|video|vocal, duree?: secondes si vocal }.",
      },
      story: {
        type: "object",
        description:
          "Réponse à une story (libellé au-dessus) : { amis_proches?: true (étoile verte, message reçu), indisponible?: true (« Story unavailable »), image?: miniature de la story (mêmes formes que « image ») }.",
      },
      image: {
        type: "string",
        description:
          "L'image d'une photo, vidéo, reel, publication ou story partagée. Formes : un lien de post TikTok (sa couverture, ou la photo « image_rang » d'un carrousel ; pour une carte, aussi le compte, sa photo et son badge) ; un lien de profil TikTok (tiktok.com/@compte : sa photo) ; un lien direct vers une image (https…, JPEG/PNG/WebP) ; une image en data URL (data:image/jpeg;base64,… — une photo envoyée dans la discussion : si tu peux exécuter du code, réduis-la à 1080 px au plus et encode-la ; sinon demande un lien) ; « img:<id> » (lu dans lire_conversation) GARDE une image déjà posée. Sans image, un cadre gris attend qu'on en dépose une à l'écran.",
      },
      image_rang: { type: "integer", minimum: 1, maximum: 35, description: "Lien TikTok d'un carrousel : quelle photo (1 = la première)." },
      compte: { type: "string", description: "Reel, publication, story partagée : le compte qui a publié (sans @). Avec un lien TikTok, celui de l'auteur par défaut." },
      photo_compte: { type: "string", description: "Photo de ce compte (mêmes formes que « image » ; un lien de post TikTok donne la photo de son AUTEUR) ; avec une image TikTok, celle de l'auteur par défaut." },
      certifie: { type: "boolean", description: "Badge certifié à côté du compte." },
      legende: { type: "string", description: "Reel, publication : légende sous l'image (2 lignes, coupée par « … »)." },
      appui_long: { type: "boolean", description: "L'écran montre l'APPUI LONG sur ce message : fil flouté, barre de réactions, menu (Répondre, Transférer…). Un seul par conversation." },
      heure: { type: "string", description: "Heure du message, affichée en tête du menu d'appui long (ex. « 14:35 »)." },
    },
    additionalProperties: false,
  },
} as const;

const ARGS_APPARENCE = {
  theme: { type: "string", enum: THEME_IDS.map((t) => THEME_MCP[t]), description: "sombre = le thème par défaut d'Instagram (mesuré) ; coeurs, ocean = thèmes inventés." },
  langue: { type: "string", enum: ["fr", "en"], description: "Langue de l'interface dessinée (« Message... », « Modifié »/« Edited »)." },
  contact_nom: { type: "string", description: "Nom affiché en haut de l'écran." },
  contact_pseudo: { type: "string", description: "Nom d'utilisateur sous le nom (sans @)." },
  photo_contact: {
    type: "string",
    description:
      "Photo de profil du contact (en-tête, bulles, fiche). Mêmes formes que « image » d'un message : lien de profil TikTok (tiktok.com/@compte), lien de post TikTok (photo de son auteur), lien direct vers une image, data URL d'une photo envoyée dans la discussion (réduite à ~400 px), ou « img:<id> ». \"\" la retire (photo par défaut d'Instagram).",
  },
  debut_du_fil: {
    type: "boolean",
    description:
      "true (défaut d'une conversation créée) : le fil commence au premier élément — Instagram montre au-dessus la fiche du contact (grande photo, nom, « View profile »), visible quand le fil est court. false pour reproduire une capture prise au milieu d'un fil.",
  },
  heure: { type: "string", description: "Heure de la barre d'état, ex. « 23:47 ». Varie-la d'une conversation à l'autre (même heure partout = repérable), cohérente avec les séparateurs de date." },
  batterie: { type: "integer", minimum: 0, maximum: 100, description: "Pourcentage de batterie. Varie-le d'une conversation à l'autre ; dans une même série, il ne remonte pas." },
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
/** Images RENDUES à Claude (base64 dans la réponse) : plus bas que celles qu'on range. */
const POIDS_IMAGE_LUE_MAX = 1_500_000;

/** La page publique d'un post TikTok → ses images et son auteur (refus en clair sinon). */
async function lirePageTiktok(lien: string): Promise<Exclude<TikTokMedia, { kind: "unreadable" }>> {
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
  return media;
}

/** Une image du CDN de TikTok (et de lui seul) → ses octets, ou la raison de l'échec. */
async function telechargerImage(url: string, max: number): Promise<{ octets: Uint8Array; type: string } | { echec: string }> {
  if (!isTikTokCdnUrl(url)) return { echec: "hôte refusé" };
  try {
    const r = await fetch(url, { headers: { "User-Agent": NAVIGATEUR["User-Agent"] }, signal: AbortSignal.timeout(15_000) });
    const type = (r.headers.get("content-type") ?? "").split(";")[0];
    if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return { echec: `HTTP ${r.status} ${type}` };
    const octets = new Uint8Array(await r.arrayBuffer());
    if (octets.length > max) return { echec: "image trop lourde" };
    return { octets, type };
  } catch (e) {
    return { echec: String(e).slice(0, 60) };
  }
}

async function imagesTiktok(lien: string): Promise<ToolResult> {
  const media = await lirePageTiktok(lien);
  const urls = media.images.filter(isTikTokCdnUrl).slice(0, IMAGES_TIKTOK_MAX);
  const lues = await Promise.all(
    urls.map(async (url, i) => {
      const r = await telechargerImage(url, POIDS_IMAGE_LUE_MAX);
      return "echec" in r ? { rang: i + 1, echec: r.echec } : { rang: i + 1, data: base64(r.octets), mimeType: r.type };
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
          conversations: liste.map((c) => ({ titre: c.titre, messages: c.messages, modifieeLe: new Date(c.modifieeLe).toISOString().slice(0, 16), ...liens(projet, c.id) })),
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
          ...liens(projet, c.id),
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
      "Crée un brouillon de capture de conversation Instagram (DM iOS) que l'app dessine à l'identique ; la réponse donne « telecharger » (l'ouvrir télécharge les captures : PNG, ou ZIP par slide) et « lien » (l'écran, pour retoucher). Pour reproduire une capture : recopie chaque bulle exactement (debut_du_fil: false si la capture est prise au milieu du fil). Pour inventer : écris comme de vrais messages (courts, minuscules si le ton s'y prête, une bulle par phrase), COMMENCE par un séparateur de date (un vrai fil en a toujours un au-dessus du premier message), et choisis une heure et une batterie à toi plutôt que celles de l'exemple. Photo du contact : « photo_contact ». Donne à la personne le lien « telecharger » de la réponse.",
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

const CHAMPS = [
  "messages",
  "theme",
  "langue",
  "contact_nom",
  "contact_pseudo",
  "heure",
  "batterie",
  "economie_energie",
  "reseau",
  "defilement",
  "photo_contact",
  "debut_du_fil",
] as const;

function champsDe(args: Record<string, unknown>): ChampsMcp {
  const c: Record<string, unknown> = {};
  for (const k of CHAMPS) if (args[k] !== undefined) c[k] = args[k];
  return c as ChampsMcp;
}

const resume = (titre: string, n: number) => `« ${titre} » — ${n} message${n > 1 ? "s" : ""}`;

// ─── Images (photo, vidéo, reel, story partagée) ────────────────────────────

const fichierValidator = v.object({ storageId: v.id("_storage"), w: v.number(), h: v.number() });
type Fichier = { storageId: Id<"_storage">; w: number; h: number };
const CARTES_MCP = ["reel", "publication", "story_partagee"];

/** Une image d'un lien direct (hors TikTok) → ses octets, ou la raison de l'échec. */
async function telechargerLienImage(url: string): Promise<{ octets: Uint8Array; type: string } | { echec: string }> {
  try {
    const r = await fetch(url.trim(), { headers: { "User-Agent": NAVIGATEUR["User-Agent"] }, signal: AbortSignal.timeout(15_000) });
    const type = (r.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return { echec: `HTTP ${r.status} ${type || "sans type"}` };
    const octets = new Uint8Array(await r.arrayBuffer());
    if (octets.length > POIDS_IMAGE_MAX) return { echec: "image trop lourde" };
    return { octets, type };
  } catch (e) {
    return { echec: String(e).slice(0, 60) };
  }
}

/**
 * ACTION : chaque image donnée par Claude sous une forme que la conversation ne
 * peut pas porter telle quelle — lien TikTok (post : sa couverture ou la photo
 * « image_rang » d'un carrousel ; profil : sa photo), lien direct vers une image,
 * data URL — est récupérée, vérifiée (vraie image JPEG/PNG/WebP), rangée dans le
 * storage, et remplacée par un jeton « fichier:<n> » que la mutation résout après
 * avoir enregistré le fichier. Une carte (reel, publication, story) prend le
 * compte, la photo et le badge de l'auteur du TikTok quand Claude ne les donne
 * pas ; « photo_contact » ou « photo_compte » sur un lien de post prennent la
 * photo de son AUTEUR. Un échec efface ce qui a déjà été rangé.
 */
async function rangerImages(
  ctx: ActionCtx,
  args: Record<string, unknown>,
): Promise<{ messages: unknown; photoContact: unknown; fichiers: Fichier[] }> {
  const fichiers: Fichier[] = [];
  const posts = new Map<string, Promise<Awaited<ReturnType<typeof lirePageTiktok>>>>();
  const post = (lien: string) => {
    const cle = lien.trim().split("?")[0];
    if (!posts.has(cle)) posts.set(cle, lirePageTiktok(lien));
    return posts.get(cle)!;
  };
  const profils = new Map<string, Promise<TikTokAuthor>>();
  const profil = (lien: string) => {
    const cle = lien.trim().split("?")[0];
    if (!profils.has(cle)) profils.set(cle, lireProfilTiktok(lien));
    return profils.get(cle)!;
  };
  const deja = new Map<string, string>();
  const ranger = async (source: string, octets: Uint8Array, type: string, quoi: string): Promise<string> => {
    const dims = imageSize(octets);
    if (!dims) throw new ToolError(`${quoi} : ce n'est pas une image JPEG, PNG ou WebP lisible.`);
    if (octets.length > POIDS_IMAGE_MAX) throw new ToolError(`${quoi} : image trop lourde (8 Mo au plus).`);
    const storageId = await ctx.storage.store(new Blob([octets as BlobPart], { type }));
    fichiers.push({ storageId, ...dims });
    const jeton = PREFIXE_FICHIER + (fichiers.length - 1);
    deja.set(source, jeton);
    return jeton;
  };
  const depuisUrl = async (url: string, quoi: string): Promise<string> => {
    const vu = deja.get(url);
    if (vu) return vu;
    const r = isTikTokCdnUrl(url) ? await telechargerImage(url, POIDS_IMAGE_MAX) : await telechargerLienImage(url);
    if ("echec" in r) throw new ToolError(`${quoi} : image illisible (${r.echec}).`);
    return ranger(url, r.octets, r.type, quoi);
  };
  /**
   * Une référence → jeton, ou telle quelle si elle n'est pas à ranger (« img:… »,
   * ou une forme fausse que le vocabulaire refusera en clair). `photo` : on veut
   * la photo d'un COMPTE (auteur d'un post, profil).
   */
  const resoudre = async (v: unknown, quoi: string, opts: { photo?: boolean; rang?: unknown } = {}): Promise<unknown> => {
    if (typeof v !== "string") return v;
    const t = v.trim();
    if (t.startsWith("data:")) {
      const d = octetsDataUrl(t);
      if (!d) throw new ToolError(`${quoi} : data URL illisible (data:image/jpeg|png|webp;base64,…).`);
      return ranger(t.slice(0, 120) + t.length, d.octets, d.type, quoi);
    }
    if (isTikTokProfileUrl(t)) {
      const a = await profil(t);
      if (!a.avatar) throw new ToolError(`${quoi} : ce profil TikTok ne montre pas de photo.`);
      return depuisUrl(a.avatar, quoi);
    }
    if (isTikTokPostUrl(t)) {
      const media = await post(t);
      if (opts.photo) {
        if (!media.author?.avatar) throw new ToolError(`${quoi} : ce TikTok ne montre pas la photo de son auteur.`);
        return depuisUrl(media.author.avatar, quoi);
      }
      const rang = Math.min(media.images.length, Math.max(1, Math.round(Number(opts.rang) || 1)));
      return depuisUrl(media.images[rang - 1], quoi);
    }
    if (lienImagePublic(t)) return depuisUrl(t, quoi);
    return v;
  };
  try {
    const photoContact = await resoudre(args.photo_contact, "« photo_contact »", { photo: true });
    const messages: unknown[] | unknown = Array.isArray(args.messages) ? [] : args.messages;
    if (Array.isArray(args.messages)) {
      for (const [i, brut] of args.messages.entries()) {
        if (!brut || typeof brut !== "object") {
          (messages as unknown[]).push(brut);
          continue;
        }
        const o: Record<string, unknown> = { ...(brut as Record<string, unknown>) };
        const quoi = `Élément ${i + 1}`;
        const lienCarte = typeof o.image === "string" && isTikTokPostUrl(o.image) && !isTikTokProfileUrl(o.image) ? o.image : null;
        if (lienCarte && CARTES_MCP.includes(String(o.type))) {
          const auteur = (await post(lienCarte)).author;
          if (auteur) {
            if (o.compte === undefined) o.compte = auteur.username;
            if (o.certifie === undefined && auteur.verified) o.certifie = true;
            if (o.photo_compte === undefined && auteur.avatar) o.photo_compte = auteur.avatar;
          }
        }
        o.image = await resoudre(o.image, quoi, { rang: o.image_rang });
        o.photo_compte = await resoudre(o.photo_compte, `${quoi} (photo du compte)`, { photo: true });
        if (o.photo_compte === undefined) delete o.photo_compte;
        if (o.image === undefined) delete o.image;
        const story = o.story as Record<string, unknown> | undefined;
        if (story && typeof story === "object" && story.image !== undefined) {
          o.story = { ...story, image: await resoudre(story.image, `${quoi} (miniature de la story)`) };
        }
        (messages as unknown[]).push(o);
      }
    }
    return { messages, photoContact, fichiers };
  } catch (e) {
    await effacerFichiers(ctx, fichiers);
    throw e;
  }
}

/** La page publique d'un PROFIL TikTok → le compte (refus en clair sinon). */
async function lireProfilTiktok(lien: string): Promise<TikTokAuthor> {
  let html: string;
  try {
    const res = await fetch(lien.trim().split("?")[0], { headers: NAVIGATEUR, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    throw new ToolError(`Profil TikTok injoignable (${String(e).slice(0, 80)}).`);
  }
  const a = extractTikTokProfile(html);
  if (!a) throw new ToolError("Profil TikTok illisible (compte privé, supprimé, ou page changée).");
  return a;
}

async function effacerFichiers(ctx: ActionCtx, fichiers: Fichier[]): Promise<void> {
  await Promise.all(fichiers.map((f) => ctx.storage.delete(f.storageId).catch(() => undefined)));
}

/**
 * MUTATION : enregistre les fichiers rangés par l'action, remplace les jetons
 * « fichier:<n> » par leurs ids, et vérifie que chaque autre image citée est bien
 * une image de CE projet (un id inventé ou venu d'ailleurs est refusé). La photo
 * du contact posée à l'écran (data URL) reste telle quelle.
 */
async function resoudreImages(ctx: ProjectMutationCtx, c: Conversation, fichiers: Fichier[]): Promise<void> {
  const ids: string[] = [];
  for (const f of fichiers) ids.push(await enregistrerImageCore(ctx, f));
  const verifiees = new Set<string>();
  const resoudre = async (ref: string): Promise<string> => {
    if (ref.startsWith(PREFIXE_FICHIER)) {
      const id = ids[Number(ref.slice(PREFIXE_FICHIER.length))];
      if (!id) throw err(ERR.INSTA_CONV_IMAGE_REJECTED, `Image « ${ref} » inconnue : donne le lien ou l'image.`);
      return id;
    }
    if (!verifiees.has(ref)) {
      const id = ctx.db.normalizeId("instaConvImages", ref);
      const img = id ? await ctx.db.get(id) : null;
      if (!img || img.projectId !== ctx.projectId) {
        throw err(ERR.INSTA_CONV_IMAGE_REJECTED, `Image « img:${ref} » inconnue dans ce projet : relis lire_conversation.`);
      }
      verifiees.add(ref);
    }
    return ref;
  };
  if (c.contact.avatar && !c.contact.avatar.startsWith("data:")) c.contact.avatar = await resoudre(c.contact.avatar);
  for (const it of c.items) {
    if (it.kind !== "message") continue;
    if (it.story?.image) it.story.image = await resoudre(it.story.image);
    const md = it.media;
    if (md && "image" in md && md.image) md.image = await resoudre(md.image);
    if (md && "avatar" in md && md.avatar) md.avatar = await resoudre(md.avatar);
  }
}

export const ecrireCreation = mcpWriteMutation("conversations.use", "conversations")({
  args: { titre: v.string(), champs: v.string(), fichiers: v.optional(v.array(fichierValidator)) },
  handler: async (ctx, a) => {
    const r = appliquerChampsMcp({ ...defaultConversation(), items: [] }, JSON.parse(a.champs) as ChampsMcp);
    if ("refus" in r) throw err(ERR.INSTA_CONV_INVALID, r.refus);
    await resoudreImages(ctx, r.conversation, a.fichiers ?? []);
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
  args: { conversation: v.string(), nouveauTitre: v.optional(v.string()), champs: v.string(), fichiers: v.optional(v.array(fichierValidator)) },
  handler: async (ctx, a) => {
    const c = designerOuRefuser(await conversationsDuProjet(ctx), (x) => x.titre, a.conversation, "conversations");
    const r = appliquerChampsMcp(conversationDeData(c.data), JSON.parse(a.champs) as ChampsMcp);
    if ("refus" in r) throw err(ERR.INSTA_CONV_INVALID, r.refus);
    await resoudreImages(ctx, r.conversation, a.fichiers ?? []);
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

/** Les champs pour la mutation, liens TikTok d'images déjà rangés dans le storage. */
async function champsEtImages(ctx: ActionCtx, args: Record<string, unknown>): Promise<{ champs: string; fichiers: Fichier[] }> {
  const { messages, photoContact, fichiers } = await rangerImages(ctx, args);
  return {
    champs: JSON.stringify(
      champsDe({ ...args, ...(args.messages !== undefined ? { messages } : {}), ...(args.photo_contact !== undefined ? { photo_contact: photoContact } : {}) }),
    ),
    fichiers,
  };
}

/** Si l'écriture échoue, les fichiers rangés pour elle ne servent à personne : effacés. */
async function avecFichiers<T>(ctx: ActionCtx, fichiers: Fichier[], f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    await effacerFichiers(ctx, fichiers);
    throw e;
  }
}

async function appelerEcriture(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  if (name === "creer_conversation") {
    const titre = texteArg(args, "titre");
    if (!titre) throw new ToolError("« titre » : le nom du brouillon.");
    if (!Array.isArray(args.messages) || args.messages.length === 0) throw new ToolError("« messages » : au moins un élément.");
    const { champs, fichiers } = await champsEtImages(ctx, args);
    const r = await avecFichiers(ctx, fichiers, () => ecrire(() => ctx.runMutation(internal.mcpConversations.ecrireCreation, { ...cible, titre, champs, fichiers })));
    return resultatEcriture(projet, r.summary, "`defaire` la supprime (tant qu'elle n'a pas été modifiée depuis).", { ...liens(projet, r.id), ouvrir: OUVRIR });
  }
  if (name === "modifier_conversation") {
    const conversation = texteArg(args, "conversation");
    if (!conversation) throw new ToolError("« conversation » : son titre.");
    const nouveauTitre = texteArg(args, "nouveau_titre");
    const { champs, fichiers } = await champsEtImages(ctx, args);
    const r = await avecFichiers(ctx, fichiers, () =>
      ecrire(() =>
        ctx.runMutation(internal.mcpConversations.ecrireModification, { ...cible, conversation, champs, fichiers, ...(nouveauTitre ? { nouveauTitre } : {}) }),
      ),
    );
    return resultatEcriture(projet, r.summary, "`defaire` remet la version d'avant (si personne ne l'a modifiée depuis).", { ...liens(projet, r.id), ouvrir: OUVRIR });
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

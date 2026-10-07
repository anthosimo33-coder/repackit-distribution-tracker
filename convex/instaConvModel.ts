/**
 * GÉNÉRATEUR DE CONVERSATIONS INSTAGRAM — le MODÈLE (données seules, sans DOM).
 *
 * Vit dans `convex/` (règle A6) : l'écran (via `lib/insta-conv.ts`), la table
 * `instaConversations` et le serveur MCP lisent et écrivent la MÊME forme. Le
 * rendu (cotes, thèmes, groupes) reste dans `lib/insta-conv.ts`.
 */

export type Side = "in" | "out";

export type ConvMessage = {
  id: string;
  kind: "message";
  side: Side;
  text: string;
  /** Label « Modifié » au-dessus de la bulle (casse le groupe). */
  edited?: boolean;
  /** Emoji de réaction posé sous la bulle (termine le groupe). */
  reaction?: string;
  /** Fin de slide après ce message (export en série). */
  cut?: boolean;
  /** Réponse citée : le message auquel celui-ci répond, qui l'avait écrit, et sa nature. */
  reply?: ConvReply;
  /** Réponse à une story (en-tête au-dessus du message, miniature de la story si `image`). */
  story?: { closeFriends?: boolean; unavailable?: boolean; image?: string };
  /** Contenu à la place du texte : vocal, éphémère déjà vu, photo/vidéo, reel, publication, story partagée. */
  media?: ConvMedia;
  /** L'écran montre l'APPUI LONG sur ce message (réactions et menu) — un seul par écran. */
  longPress?: boolean;
  /** Heure du message, affichée en tête du menu d'appui long (à défaut : l'heure de la barre d'état). */
  time?: string;
};

export type ConvReply = { side: Side; text: string; kind?: "photo" | "video" | "voice"; seconds?: number };

/**
 * Les images (`image`, `avatar`) sont des IDENTIFIANTS de la table
 * `instaConvImages` (fichier dans le storage du projet), jamais des URL : la
 * conversation reste légère (le journal MCP en garde plusieurs copies) et une
 * image d'un autre projet ne se résout pas.
 */
export type ConvMedia =
  | { type: "voice"; seconds: number }
  | { type: "photoOnce" }
  | { type: "videoOnce" }
  /** Photo ou vidéo envoyée dans la conversation (▶ en haut à droite pour une vidéo). */
  | { type: "photo" | "video"; image?: string }
  /** Reel ou publication partagés : carte avec le compte en tête, légende facultative. */
  | { type: "reel" | "post"; image?: string; avatar?: string; account: string; verified?: boolean; caption?: string }
  /** Story partagée (« Sent @compte's story ») : carte 9:16 derrière une barre. */
  | { type: "storyShare"; image?: string; avatar?: string; account: string; verified?: boolean };

export type ConvMediaType = ConvMedia["type"];

/** Médias à carte : ni groupés avec les messages voisins, ni « jumbo ». */
export const CARD_MEDIA: readonly ConvMediaType[] = ["reel", "post", "storyShare"];
export const MAX_CAPTION = 300;

export type ConvDate = { id: string; kind: "date"; text: string; cut?: boolean };

export type ConvItem = ConvMessage | ConvDate;

export type ConvLocale = "fr" | "en";

export const THEME_IDS = ["dark", "hearts", "ocean"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export type Conversation = {
  themeId: ThemeId;
  locale: ConvLocale;
  contact: { name: string; username: string; avatar: string | null };
  status: { time: string; battery: number; lowPower: boolean; signal: number };
  /** Décalage de défilement, en pt : 0 = dernier message posé au-dessus de la saisie. */
  scroll: number;
  items: ConvItem[];
};

/**
 * Paramètre du lien « télécharger » que rend le MCP (`…/conversations?c=<id>&exporter=1`) :
 * l'écran dessine la conversation et lance l'export tout seul (PNG, ou ZIP pour une série).
 */
export const PARAM_EXPORT = "exporter";

/** Bornes : un fil de capture tient en quelques dizaines de bulles. */
export const MAX_ITEMS = 120;
export const MAX_TEXT = 1_000;
export const MAX_TITRE = 80;

let seq = 0;
export function newItemId(): string {
  seq += 1;
  return `i${Date.now().toString(36)}${seq}`;
}

export function defaultConversation(): Conversation {
  const m = (side: Side, text: string, extra: Partial<ConvMessage> = {}): ConvMessage => ({
    id: newItemId(),
    kind: "message",
    side,
    text,
    ...extra,
  });
  return {
    themeId: "dark",
    locale: "fr",
    contact: { name: "Lucas", username: "lucas.mrtn", avatar: null },
    status: { time: "23:47", battery: 62, lowPower: false, signal: 3 },
    scroll: 0,
    items: [
      { id: newItemId(), kind: "date", text: "AUJOURD'HUI 23:12" }, // i18n-exempt: donnée de la capture, pas de l'interface
      m("out", "tu peux m'expliquer pk t'étais en ligne à 3h ?"), // i18n-exempt: donnée de la capture, pas de l'interface
      m("in", "jdormais"),
      m("out", "arrête de mentir je l'ai vu"), // i18n-exempt: donnée de la capture, pas de l'interface
      m("out", "t'avais dit que c'était fini avec elle"), // i18n-exempt: donnée de la capture, pas de l'interface
      m("in", "c'est pas ce que tu crois", { reaction: "😂" }),
      m("in", "laisse moi t'expliquer stp"),
      m("out", "c'est trop tard", { edited: true }),
    ],
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Un identifiant d'image (table `instaConvImages`) plausible, ou rien. */
function idImage(v: unknown): string | undefined {
  return typeof v === "string" && /^[a-z0-9]{8,64}$/i.test(v) ? v : undefined;
}

/** Nom de compte Instagram : sans @, lettres, chiffres, points et soulignés, 30 caractères. */
export function nettoyerCompte(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/^@+/, "").replace(/[^A-Za-z0-9._]/g, "").slice(0, 30) : "";
}

/** Toutes les images qu'une conversation référence (sans doublon). */
export function imagesDeConversation(c: Pick<Conversation, "items">): string[] {
  const ids = new Set<string>();
  for (const it of c.items) {
    if (it.kind !== "message") continue;
    if (it.story?.image) ids.add(it.story.image);
    const md = it.media;
    if (md && "image" in md && md.image) ids.add(md.image);
    if (md && "avatar" in md && md.avatar) ids.add(md.avatar);
  }
  return [...ids];
}

/** Les champs facultatifs d'un message, relus sans faire confiance au stockage. */
function nettoyerMessage(it: ConvMessage): ConvMessage {
  const m: ConvMessage = { id: it.id, kind: "message", side: it.side, text: it.text };
  if (it.edited === true) m.edited = true;
  if (typeof it.reaction === "string" && it.reaction) m.reaction = it.reaction;
  if (it.cut === true) m.cut = true;
  if (it.longPress === true) m.longPress = true;
  if (typeof it.time === "string" && it.time.trim()) m.time = it.time.trim().slice(0, 8);
  const r = it.reply;
  if (r && (r.side === "in" || r.side === "out")) {
    const kind = r.kind === "photo" || r.kind === "video" || r.kind === "voice" ? r.kind : undefined;
    const text = typeof r.text === "string" ? r.text : "";
    if (kind || text.trim()) {
      m.reply = { side: r.side, text, ...(kind ? { kind } : {}), ...(kind === "voice" ? { seconds: clamp(Math.round(Number(r.seconds) || 1), 1, 600) } : {}) };
    }
  }
  if (it.story && typeof it.story === "object") {
    const image = idImage(it.story.image);
    m.story = {
      ...(it.story.closeFriends === true ? { closeFriends: true } : {}),
      ...(it.story.unavailable === true ? { unavailable: true } : {}),
      ...(image ? { image } : {}),
    };
  }
  const md = it.media as (Partial<Record<string, unknown>> & { type?: unknown }) | undefined;
  const image = idImage(md?.image);
  const avatar = idImage(md?.avatar);
  if (md?.type === "voice") m.media = { type: "voice", seconds: clamp(Math.round(Number(md.seconds) || 1), 1, 600) };
  else if (md?.type === "photoOnce" || md?.type === "videoOnce") m.media = { type: md.type };
  else if (md?.type === "photo" || md?.type === "video") m.media = { type: md.type, ...(image ? { image } : {}) };
  else if (md?.type === "reel" || md?.type === "post" || md?.type === "storyShare") {
    const caption = typeof md.caption === "string" ? md.caption.trim().slice(0, MAX_CAPTION) : "";
    const commun = {
      ...(image ? { image } : {}),
      ...(avatar ? { avatar } : {}),
      account: nettoyerCompte(md.account),
      ...(md.verified === true ? { verified: true } : {}),
    };
    m.media = md.type === "storyShare" ? { type: "storyShare", ...commun } : { type: md.type, ...commun, ...(caption ? { caption } : {}) };
  }
  return m;
}

/** Relit une conversation stockée ; null si elle est illisible ou d'une autre forme. */
export function parseConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<Conversation>;
  if (!c.themeId || !(THEME_IDS as readonly string[]).includes(c.themeId)) return null;
  if (c.locale !== "fr" && c.locale !== "en") return null;
  if (!c.contact || !c.status || !Array.isArray(c.items)) return null;
  const items = c.items
    .filter(
      (it): it is ConvItem =>
        !!it &&
        typeof it.id === "string" &&
        typeof it.text === "string" &&
        (it.kind === "date" || (it.kind === "message" && (it.side === "in" || it.side === "out"))),
    )
    .slice(0, MAX_ITEMS)
    .map((it) => (it.kind === "message" ? nettoyerMessage(it) : { id: it.id, kind: "date" as const, text: it.text, ...(it.cut === true ? { cut: true } : {}) }));
  return {
    themeId: c.themeId,
    locale: c.locale,
    contact: {
      name: String(c.contact.name ?? ""),
      username: String(c.contact.username ?? ""),
      avatar: typeof c.contact.avatar === "string" ? c.contact.avatar : null,
    },
    status: {
      time: String(c.status.time ?? ""),
      battery: clamp(Number(c.status.battery) || 0, 0, 100),
      lowPower: !!c.status.lowPower,
      signal: clamp(Math.round(Number(c.status.signal) || 0), 0, 4),
    },
    scroll: Number(c.scroll) || 0,
    items,
  };
}

/** `data` d'une ligne de `instaConversations` → conversation (repli : l'exemple). */
export function conversationDeData(data: string): Conversation {
  try {
    return parseConversation(JSON.parse(data)) ?? defaultConversation();
  } catch {
    return defaultConversation();
  }
}

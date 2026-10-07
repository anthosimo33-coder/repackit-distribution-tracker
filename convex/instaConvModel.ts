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
  /** Réponse à une story (en-tête au-dessus du message). */
  story?: { closeFriends?: boolean; unavailable?: boolean };
  /** Contenu à la place du texte : message vocal, ou photo/vidéo éphémère déjà vue. */
  media?: ConvMedia;
  /** L'écran montre l'APPUI LONG sur ce message (réactions et menu) — un seul par écran. */
  longPress?: boolean;
  /** Heure du message, affichée en tête du menu d'appui long (à défaut : l'heure de la barre d'état). */
  time?: string;
};

export type ConvReply = { side: Side; text: string; kind?: "photo" | "video" | "voice"; seconds?: number };

export type ConvMedia = { type: "voice"; seconds: number } | { type: "photoOnce" } | { type: "videoOnce" };

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
    m.story = { ...(it.story.closeFriends === true ? { closeFriends: true } : {}), ...(it.story.unavailable === true ? { unavailable: true } : {}) };
  }
  const md = it.media;
  if (md?.type === "voice") m.media = { type: "voice", seconds: clamp(Math.round(Number(md.seconds) || 1), 1, 600) };
  else if (md?.type === "photoOnce" || md?.type === "videoOnce") m.media = { type: md.type };
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

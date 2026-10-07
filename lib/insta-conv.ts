/**
 * GÉNÉRATEUR DE CONVERSATIONS INSTAGRAM — le modèle et ses règles, sans DOM.
 *
 * La capture est REDESSINÉE par le code (components/admin/insta-conv), jamais
 * générée par un modèle d'image : un rendu HTML garde le texte exact et ne porte
 * ni C2PA ni SynthID (que `lib/image-postprocess.ts` ne sait pas retirer).
 *
 * Toutes les cotes sont en POINTS iOS (1 pt = 1 px CSS dans le rendu, ×2 à
 * l'export : 414×896 pt → 828×1792 px, la taille d'une capture d'iPhone 11).
 * Elles ont été MESURÉES au pixel sur de vraies captures du thème sombre par
 * défaut (oct. 2026) — un écart ici se voit sur la capture.
 */

import type { LlmItem, ScreenshotReading } from "@/convex/instaConvTypes";

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
};

export type ConvDate = { id: string; kind: "date"; text: string };

export type ConvItem = ConvMessage | ConvDate;

export type ConvLocale = "fr" | "en";

export type Conversation = {
  themeId: ThemeId;
  locale: ConvLocale;
  contact: { name: string; username: string; avatar: string | null };
  status: { time: string; battery: number; lowPower: boolean; signal: number };
  /** Décalage de défilement, en pt : 0 = dernier message posé au-dessus de la saisie. */
  scroll: number;
  items: ConvItem[];
};

// ── Cotes mesurées ────────────────────────────────────────────────────────────

export const SCREEN = { width: 414, height: 896, exportScale: 2 } as const;

export const METRICS = {
  /** Bas de l'en-tête (filet de 0,5 pt compris). */
  headerBottom: 104,
  /** Haut de la bande opaque de la barre de saisie. */
  composerTop: 808,
  /** Écart entre le dernier élément et la barre de saisie, au repos. */
  bottomGap: 14,
  bubble: {
    fontSize: 17,
    letterSpacing: -0.37,
    lineHeight: 20,
    padY: 10,
    padX: 13,
    radius: 19.5,
    /** Coin côté groupe : 4 pt, du côté où deux bulles du même auteur se touchent. */
    groupedRadius: 4,
    /** Largeur max, padding compris. */
    maxWidth: 300,
    /** Emojis dans le texte : agrandis pour retrouver la taille iOS. */
    emojiScale: 1.17,
  },
  /** Bulles reçues : décalées pour l'avatar (28 pt à x = 16, aligné en bas). */
  inIndent: 56,
  outMargin: 8,
  avatar: { size: 28, left: 16 },
  gap: { sameSender: 2, senderChange: 12, afterReaction: 14 },
  edited: { fontSize: 12.3, lineHeight: 16, marginTop: 13.15, marginBottom: 4.5, inset: 12.4 },
  reaction: { width: 29, height: 24, inset: 5, overlap: 7, ring: 1.5, emojiSize: 15.2 },
  date: { fontSize: 12, lineHeight: 16, marginTop: 21, marginBottom: 16 },
  jumbo: { fontSize: 52, letterSpacing: 4, lineHeight: 59, maxCount: 5 },
} as const;

// ── Emojis en grand ───────────────────────────────────────────────────────────

const EMOJI_PART = /^(\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|‍|️|⃣|[#*0-9])+$/u;

/**
 * Nombre d'emojis si le texte n'est QUE des emojis, sinon 0. Instagram les
 * affiche alors en grand, sans bulle (vu jusqu'à 5 d'affilée sur les captures ;
 * au-delà, le comportement n'est pas observé : on retombe sur une bulle).
 */
export function emojiOnlyCount(text: string): number {
  const trimmed = text.replace(/\s+/g, "");
  if (!trimmed) return 0;
  const segments = [...new Intl.Segmenter("fr", { granularity: "grapheme" }).segment(trimmed)];
  for (const { segment } of segments) {
    if (!EMOJI_PART.test(segment) || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(segment)) return 0;
  }
  return segments.length;
}

export function isJumbo(text: string): boolean {
  const n = emojiOnlyCount(text);
  return n > 0 && n <= METRICS.jumbo.maxCount;
}

// ── Plan de rendu : groupes, avatars, écarts ─────────────────────────────────

export type PlannedMessage = {
  kind: "message";
  item: ConvMessage;
  jumbo: boolean;
  /** Collée au message précédent du même auteur (petit coin en haut). */
  joinedTop: boolean;
  /** Collée au message suivant du même auteur (petit coin en bas). */
  joinedBottom: boolean;
  showAvatar: boolean;
  /** Espace au-dessus, en pt (hors label « Modifié », qui porte le sien). */
  gapBefore: number;
};

export type PlannedDate = { kind: "date"; item: ConvDate; gapBefore: number };

export type PlannedItem = PlannedMessage | PlannedDate;

/**
 * Deux messages consécutifs du même auteur forment un groupe, SAUF si : le
 * second porte « Modifié » (le label s'intercale), le premier porte une réaction
 * (elle pend sous la bulle), ou l'un des deux est un emoji en grand (vu sur
 * capture : chacun garde alors son avatar). L'avatar va au DERNIER message d'un
 * groupe reçu.
 */
export function planConversation(items: ConvItem[]): PlannedItem[] {
  const joins = (a: ConvItem | undefined, b: ConvItem | undefined): boolean =>
    !!a &&
    !!b &&
    a.kind === "message" &&
    b.kind === "message" &&
    a.side === b.side &&
    !b.edited &&
    !a.reaction &&
    !isJumbo(a.text) &&
    !isJumbo(b.text);

  return items.map((item, i): PlannedItem => {
    const prev = items[i - 1];
    if (item.kind === "date") {
      return { kind: "date", item, gapBefore: i === 0 ? 0 : METRICS.date.marginTop };
    }
    const joinedTop = joins(prev, item);
    const joinedBottom = joins(item, items[i + 1]);
    let gapBefore: number = METRICS.gap.senderChange;
    if (i === 0 || prev?.kind === "date") gapBefore = 0;
    else if (prev?.kind === "message" && prev.reaction) gapBefore = METRICS.gap.afterReaction;
    else if (joinedTop) gapBefore = METRICS.gap.sameSender;
    if (item.edited && i > 0) gapBefore = 0;
    return {
      kind: "message",
      item,
      jumbo: isJumbo(item.text),
      joinedTop,
      joinedBottom,
      showAvatar: item.side === "in" && !joinedBottom,
      gapBefore,
    };
  });
}

// ── Thèmes ────────────────────────────────────────────────────────────────────

export type ThemeId = "dark" | "hearts" | "ocean";

export type ConvTheme = {
  id: ThemeId;
  /** Fond de l'écran (CSS `background`). */
  background: string;
  /** Cœurs flous dessinés par-dessus le fond (thème inventé). */
  hearts?: boolean;
  /** Fond de l'en-tête et de la bande de saisie ; « transparent » laisse voir le thème. */
  chrome: string;
  hairline: string | null;
  text: string;
  subtext: string;
  inBubble: string;
  inText: string;
  /**
   * Bulles envoyées : arrêts de couleur le long de la HAUTEUR DE L'ÉCRAN (pt).
   * Instagram fixe le dégradé à l'écran, pas à la bulle : deux bulles à la même
   * hauteur ont la même couleur, sur deux captures différentes.
   */
  outStops: ReadonlyArray<readonly [number, string]>;
  outText: string;
  composer: string;
  cameraButton: string;
  placeholder: string;
  edited: string;
};

const DARK_OUT_STOPS = [
  // 104 et 805 : EXTRAPOLÉS (aucune bulle mesurée si haut ni si bas).
  [104, "rgb(186,48,216)"],
  [325, "rgb(148,52,234)"],
  [381, "rgb(137,53,239)"],
  [423, "rgb(131,54,242)"],
  [457, "rgb(125,56,245)"],
  [514.5, "rgb(116,57,249)"],
  [586, "rgb(110,62,250)"],
  [646.5, "rgb(105,65,250)"],
  [716.5, "rgb(99,70,249)"],
  [805, "rgb(91,78,246)"],
] as const;

export const THEMES: Record<ThemeId, ConvTheme> = {
  // Mesuré sur capture (thème sombre par défaut).
  dark: {
    id: "dark",
    background: "#0B1014",
    chrome: "#0B1014",
    hairline: "#24292E",
    text: "#F8F9F9",
    subtext: "#A0A9B5",
    inBubble: "#24292E",
    inText: "#F8F9F9",
    outStops: DARK_OUT_STOPS,
    outText: "#FFFFFF",
    composer: "#1C1E20",
    cameraButton: "#5A4EF9",
    placeholder: "#A0A9B5",
    edited: "#4A5DF9",
  },
  // Inventé : violet profond à cœurs, bulles roses.
  hearts: {
    id: "hearts",
    background: "linear-gradient(180deg, #62135E 0%, #4F1355 45%, #2F0538 100%)", // i18n-exempt: donnée de la capture, pas de l'interface
    hearts: true,
    chrome: "transparent",
    hairline: null,
    text: "#FFFFFF",
    subtext: "#E3C6E6",
    inBubble: "rgba(94,46,100,0.85)",
    inText: "#FFFFFF",
    outStops: [[0, "#EF2A8A"], [896, "#EF2A8A"]],
    outText: "#FFFFFF",
    composer: "rgba(255,255,255,0.12)",
    cameraButton: "#EF2A8A",
    placeholder: "#E3C6E6",
    edited: "#FF8FC4",
  },
  // Inventé : nuit marine, dégradé turquoise → bleu.
  ocean: {
    id: "ocean",
    background: "linear-gradient(180deg, #06243A 0%, #031523 60%, #010A12 100%)", // i18n-exempt: donnée de la capture, pas de l'interface
    chrome: "transparent",
    hairline: null,
    text: "#F2FAFF",
    subtext: "#8FB3C9",
    inBubble: "#16303F",
    inText: "#F2FAFF",
    outStops: [[104, "#19C3D6"], [805, "#2F6BFF"]],
    outText: "#FFFFFF",
    composer: "rgba(255,255,255,0.10)",
    cameraButton: "#19A7D6",
    placeholder: "#8FB3C9",
    edited: "#5FD3F3",
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

/** Dégradé CSS des bulles envoyées, à poser avec `background-size: 414px 896px`. */
export function outGradientCss(theme: ConvTheme): string {
  return `linear-gradient(180deg, ${theme.outStops.map(([y, c]) => `${c} ${y}px`).join(", ")})`;
}

// ── Textes de l'écran Instagram (donnée de la capture, pas de l'interface) ────

export const SCREEN_STRINGS: Record<ConvLocale, { placeholder: string; edited: string }> = {
  en: { placeholder: "Message...", edited: "Edited" }, // i18n-exempt: donnée de la capture, pas de l'interface
  // Libellés FR non relevés sur capture : à corriger si Instagram dit autre chose.
  fr: { placeholder: "Message...", edited: "Modifié" }, // i18n-exempt: donnée de la capture, pas de l'interface
};

// ── Conversation de départ ────────────────────────────────────────────────────

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

// ── Échanges avec l'IA (lecture de capture, réécriture) ──────────────────────

/** Éléments au format du modèle (sans id). */
export function toLlmItems(items: ConvItem[]): LlmItem[] {
  return items.map((it) =>
    it.kind === "date"
      ? { kind: "date", side: "none", text: it.text, edited: false, reaction: null }
      : { kind: "message", side: it.side, text: it.text, edited: !!it.edited, reaction: it.reaction ?? null },
  );
}

/** Éléments rendus par le modèle → éléments de l'éditeur (ids neufs). */
export function fromLlmItems(items: LlmItem[]): ConvItem[] {
  return items.map((it): ConvItem =>
    it.kind === "date" || it.side === "none"
      ? { id: newItemId(), kind: "date", text: it.text }
      : {
          id: newItemId(),
          kind: "message",
          side: it.side,
          text: it.text,
          ...(it.edited ? { edited: true } : {}),
          ...(it.reaction ? { reaction: it.reaction } : {}),
        },
  );
}

/**
 * Applique la lecture d'une capture : messages remplacés, en-tête et barre
 * d'état repris QUAND la capture les montre (une capture recadrée n'en a pas,
 * on garde alors les réglages en place). Un thème coloré n'est pas reconnu :
 * on garde le thème choisi.
 */
export function applyReading(conv: Conversation, r: ScreenshotReading): Conversation {
  return {
    ...conv,
    themeId: r.theme === "dark" ? "dark" : conv.themeId,
    locale: r.locale,
    contact: {
      ...conv.contact,
      name: r.contact.name || conv.contact.name,
      username: r.contact.username || conv.contact.username,
    },
    status: {
      time: r.status.time ?? conv.status.time,
      battery: r.status.battery ?? conv.status.battery,
      lowPower: r.status.time !== null ? r.status.lowPower : conv.status.lowPower,
      signal: r.status.signal ?? conv.status.signal,
    },
    scroll: 0,
    items: fromLlmItems(r.items),
  };
}

/** Relit un brouillon sauvegardé ; null s'il est illisible ou d'une autre forme. */
export function parseConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<Conversation>;
  if (!c.themeId || !(c.themeId in THEMES)) return null;
  if (c.locale !== "fr" && c.locale !== "en") return null;
  if (!c.contact || !c.status || !Array.isArray(c.items)) return null;
  const items = c.items.filter(
    (it): it is ConvItem =>
      !!it &&
      typeof it.id === "string" &&
      typeof it.text === "string" &&
      (it.kind === "date" || (it.kind === "message" && (it.side === "in" || it.side === "out"))),
  );
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

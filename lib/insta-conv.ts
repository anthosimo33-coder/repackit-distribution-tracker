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

// Le MODÈLE (types, lecture d'une conversation stockée, exemple) vit dans
// `convex/instaConvModel` (règle A6) : l'écran, la table et le MCP partagent la
// même forme. Ce module garde le RENDU.
export * from "../convex/instaConvModel";
import type { ConvDate, ConvItem, ConvLocale, ConvMessage, ThemeId } from "../convex/instaConvModel";

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
    maxWidth: 304,
  },
  /** Bulles reçues : décalées pour l'avatar (28 pt à x = 16, aligné en bas). */
  inIndent: 56,
  outMargin: 8,
  avatar: { size: 28, left: 16 },
  gap: { sameSender: 2, senderChange: 12, afterReaction: 14 },
  edited: { fontSize: 12.3, lineHeight: 16, marginTop: 13.15, marginBottom: 4.5, inset: 12.4 },
  reaction: { width: 29, height: 24, inset: 5, overlap: 7, ring: 1.5 },
  date: { fontSize: 12, lineHeight: 16, marginTop: 21, marginBottom: 16 },
  /** Libellés gris au-dessus d'une citation ou d'une réponse à une story (« Replied to you »…). */
  label: { fontSize: 12, lineHeight: 16, marginTop: 14, color: "#A0A9B5" },
  /**
   * Réponse citée : barre de 4 pt + 12 pt + bulle citée (texte 14,7 pt sur 20,
   * 3 lignes au plus, « … more »), puis 8 pt jusqu'à la réponse. La bulle citée est celle de son
   * auteur ASSOMBRIE : dégradé ×0,5 pour un message envoyé, gris à 50 % sinon.
   */
  quote: { labelGap: 10.8, toBubble: 8, bar: 4, barGap: 12, maxWidth: 288, maxLines: 3, fontSize: 14.7, letterSpacing: -0.3, inBg: "#171C21", outShade: "rgba(0,0,0,0.5)", inText: "#929598", outText: "rgba(255,255,255,0.82)" },
  /** « Story unavailable » : texte gris sur une ligne, barre à côté. */
  storyUnavailable: { gap: 4, lineHeight: 20, toBubble: 9 },
  /** Message vocal : lecture à 15 pt du bord, barres de 3 pt tous les 6 pt (40 pt de haut au plus). */
  voice: { height: 98, playLeft: 15, playCenterY: 31.75, firstBar: 48, barWidth: 3, barPitch: 6, maxBarHeight: 40, minBarHeight: 3, durationGap: 16.5, durationWidth: 24, padRight: 16, transcriptionTop: 66.5 },
  /** Photo ou vidéo éphémère déjà vue : pastille 86 pt ; bouton appareil photo 32 pt à côté (reçue). */
  viewOnce: { width: 86, cameraSize: 32, cameraGap: 8.5 },
  mention: "#85A1F9",
  jumbo: { fontSize: 52, lineHeight: 59, maxCount: 5 },
} as const;

// ── Série de captures (carrousel) ─────────────────────────────────────────────

/** Bas de la zone des messages (dernier élément posé au-dessus de la saisie). */
export const MESSAGES_BOTTOM = METRICS.composerTop + 2 - METRICS.bottomGap;
/** Hauteur visible entre l'en-tête et la saisie. */
export const VISIBLE_HEIGHT = MESSAGES_BOTTOM - METRICS.headerBottom;

/**
 * Dernier élément de chaque slide : chaque coupure clôt une slide, le dernier
 * élément clôt toujours la dernière. Une slide montre la conversation JUSQU'À
 * sa fin, la plus récente en bas — comme une capture prise à ce moment-là.
 */
export function slideEnds(items: ReadonlyArray<{ cut?: boolean }>): number[] {
  const ends = items.flatMap((it, i) => (it.cut && i < items.length - 1 ? [i] : []));
  if (items.length > 0) ends.push(items.length - 1);
  return ends;
}

/**
 * Découpe automatique : chaque slide ajoute autant d'éléments NOUVEAUX que
 * l'écran en montre (`visible`, en pt), au-dessus restent les plus anciens.
 * `spans` = haut et bas de chaque élément dans le fil complet. Un élément plus
 * haut que l'écran fait une slide à lui seul. Rend les indices des coupures.
 */
export function autoCuts(spans: ReadonlyArray<{ top: number; bottom: number }>, visible: number): number[] {
  const cuts: number[] = [];
  let start = 0;
  while (start < spans.length) {
    let end = start;
    while (end + 1 < spans.length && spans[end + 1].bottom - spans[start].top <= visible) end++;
    if (end < spans.length - 1) cuts.push(end);
    start = end + 1;
  }
  return cuts;
}

// ── Réglages PAR MOTEUR (texte et emojis) ─────────────────────────────────────

/**
 * Chromium et WebKit (Safari, et TOUT navigateur sur iPhone) donnent au TEXTE
 * les mêmes largeurs (à 0,1 % près), mais WebKit le pose 1 pt plus bas, et les
 * EMOJIS diffèrent : à corps égal, WebKit les fait plus grands et plus espacés.
 * Chaque moteur a donc ses réglages, calés au pixel sur capture (oct. 2026).
 */
export type EngineTuning = {
  /** Décalage vertical du TEXTE (pt) : WebKit le pose 1 pt plus bas qu'iOS. */
  textShiftY: number;
  /** Emoji dans une bulle : agrandi (em) pour retrouver la taille iOS (17 pt de large). */
  inlineScale: number;
  inlineSpacing: number;
  /** Emojis seuls en grand : espacement (avance mesurée 56 pt) et calage horizontal. */
  jumboSpacing: number;
  jumboShiftX: number;
  /** Emoji d'une réaction (12,5 pt de large sur capture) et son centrage. */
  reactionSize: number;
  reactionShiftX: number;
};

export const ENGINE_TUNING: Record<"blink" | "webkit", EngineTuning> = {
  blink: { textShiftY: 0, inlineScale: 1.17, inlineSpacing: 0.9, jumboSpacing: 4, jumboShiftX: 0.75, reactionSize: 15.2, reactionShiftX: 2.5 },
  webkit: { textShiftY: -1, inlineScale: 1, inlineSpacing: 0, jumboSpacing: 0, jumboShiftX: -0.25, reactionSize: 11.9, reactionShiftX: 0.25 },
};

/** Le moteur de rendu d'après l'agent : sur iPhone/iPad, tout navigateur est WebKit. */
export function renderEngine(userAgent: string): "blink" | "webkit" {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "webkit";
  return /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|Edg\/|OPR\//.test(userAgent) ? "webkit" : "blink";
}

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
    !b.reply &&
    !b.story &&
    !a.reaction &&
    // Vocal, photo ou vidéo éphémère : chacun garde sa propre place (vu sur capture).
    !a.media &&
    !b.media &&
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
    // « Modifié », citation, story : l'en-tête porte son propre écart.
    if ((item.edited || item.reply || item.story) && i > 0) gapBefore = 0;
    return {
      kind: "message",
      item,
      jumbo: !item.media && isJumbo(item.text),
      joinedTop,
      joinedBottom,
      showAvatar: item.side === "in" && !joinedBottom,
      gapBefore,
    };
  });
}

// ── Thèmes ────────────────────────────────────────────────────────────────────

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
  /** Fond d'une bulle REÇUE citée (la bulle de l'autre, assombrie). */
  quoteIn: string;
};

// Relevé sur 11 vraies captures (médiane par tranche de 20 pt, 120 → 800 pt) ;
// seuls 104 et 805 sont prolongés.
const DARK_OUT_STOPS = [
  [104, "rgb(188,49,212)"],
  [120, "rgb(183,50,214)"],
  [140, "rgb(178,50,216)"],
  [180, "rgb(173,51,221)"],
  [220, "rgb(166,51,224)"],
  [300, "rgb(150,52,233)"],
  [340, "rgb(143,52,236)"],
  [380, "rgb(136,53,240)"],
  [420, "rgb(129,55,242)"],
  [440, "rgb(125,56,244)"],
  [500, "rgb(116,57,249)"],
  [540, "rgb(112,60,250)"],
  [580, "rgb(110,62,250)"],
  [620, "rgb(106,64,250)"],
  [660, "rgb(103,67,250)"],
  [700, "rgb(99,70,250)"],
  [740, "rgb(96,72,249)"],
  [780, "rgb(92,75,249)"],
  [805, "rgb(91,77,249)"],
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
    // Mesuré : #24292E à 50 % sur le fond.
    quoteIn: "#171C21",
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
    quoteIn: "rgba(60,25,65,0.85)",
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
    quoteIn: "#0E1E28",
  },
};

/** Dégradé CSS des bulles envoyées, à poser avec `background-size: 414px 896px`. */
export function outGradientCss(theme: ConvTheme): string {
  return `linear-gradient(180deg, ${theme.outStops.map(([y, c]) => `${c} ${y}px`).join(", ")})`;
}

// ── Textes de l'écran Instagram (donnée de la capture, pas de l'interface) ────

export type ScreenStrings = {
  placeholder: string;
  edited: string;
  repliedToYou: string;
  youReplied: string;
  repliedToYourStory: string;
  /** Avant / mot en gras / après : « Replied to your **close friends** story ». */
  repliedToCloseFriends: [string, string, string];
  youRepliedToStory: string;
  storyUnavailable: string;
  viewTranscription: string;
  photo: string;
  video: string;
  menu: { reply: string; addSticker: string; forward: string; deleteForYou: string; report: string; more: string; edit: string; unsend: string };
};

export const SCREEN_STRINGS: Record<ConvLocale, ScreenStrings> = {
  // Relevés sur capture (oct. 2026).
  en: {
    placeholder: "Message...", // i18n-exempt: donnée de la capture, pas de l'interface
    edited: "Edited", // i18n-exempt: donnée de la capture, pas de l'interface
    repliedToYou: "Replied to you", // i18n-exempt: donnée de la capture, pas de l'interface
    youReplied: "You replied", // i18n-exempt: donnée de la capture, pas de l'interface
    repliedToYourStory: "Replied to your story", // i18n-exempt: donnée de la capture, pas de l'interface
    repliedToCloseFriends: ["Replied to your ", "close friends", " story"], // i18n-exempt: donnée de la capture, pas de l'interface
    youRepliedToStory: "You replied to their story", // i18n-exempt: donnée de la capture, pas de l'interface
    storyUnavailable: "Story unavailable", // i18n-exempt: donnée de la capture, pas de l'interface
    viewTranscription: "View transcription", // i18n-exempt: donnée de la capture, pas de l'interface
    photo: "Photo", // i18n-exempt: donnée de la capture, pas de l'interface
    video: "Video", // i18n-exempt: donnée de la capture, pas de l'interface
    menu: { reply: "Reply", addSticker: "Add sticker", forward: "Forward", deleteForYou: "Delete for you", report: "Report", more: "More", edit: "Edit", unsend: "Unsend" }, // i18n-exempt: donnée de la capture, pas de l'interface
  },
  // Menu relevé sur une capture FR (Répondre, Ajouter un sticker, Transférer,
  // Supprimer pour vous, Signaler) ; le reste n'est PAS relevé : à corriger si
  // Instagram dit autre chose.
  fr: {
    placeholder: "Message...", // i18n-exempt: donnée de la capture, pas de l'interface
    edited: "Modifié", // i18n-exempt: donnée de la capture, pas de l'interface
    repliedToYou: "Vous a répondu", // i18n-exempt: donnée de la capture, pas de l'interface
    youReplied: "Vous avez répondu", // i18n-exempt: donnée de la capture, pas de l'interface
    repliedToYourStory: "A répondu à votre story", // i18n-exempt: donnée de la capture, pas de l'interface
    repliedToCloseFriends: ["A répondu à votre story ", "Ami(e)s proches", ""], // i18n-exempt: donnée de la capture, pas de l'interface
    youRepliedToStory: "Vous avez répondu à sa story", // i18n-exempt: donnée de la capture, pas de l'interface
    storyUnavailable: "Story indisponible", // i18n-exempt: donnée de la capture, pas de l'interface
    viewTranscription: "Voir la transcription", // i18n-exempt: donnée de la capture, pas de l'interface
    photo: "Photo", // i18n-exempt: donnée de la capture, pas de l'interface
    video: "Vidéo", // i18n-exempt: donnée de la capture, pas de l'interface
    menu: { reply: "Répondre", addSticker: "Ajouter un sticker", forward: "Transférer", deleteForYou: "Supprimer pour vous", report: "Signaler", more: "Plus", edit: "Modifier", unsend: "Annuler l'envoi" }, // i18n-exempt: donnée de la capture, pas de l'interface
  },
};

// ── Messages vocaux ───────────────────────────────────────────────────────────

/** Nombre de barres : ~10 par seconde, plafonné à 33 (vu : 3 s → 26 à 31, 4 s et plus → 33). */
export function voiceBars(seconds: number): number {
  return Math.max(10, Math.min(33, Math.round(seconds * 10)));
}

/** Largeur de la bulle vocale (pt) : la forme d'onde, la durée, les marges mesurées. */
export function voiceWidth(seconds: number): number {
  const V = METRICS.voice;
  return V.firstBar + voiceBars(seconds) * V.barPitch - (V.barPitch - V.barWidth) + V.durationGap + V.durationWidth + V.padRight;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Hauteurs des barres (pt), DÉTERMINISTES : même message → même forme d'onde
 * à chaque rendu et à chaque export. Une voix monte et descend par paquets,
 * avec des creux, et finit souvent sur quelques points de silence.
 */
export function waveform(seed: string, count: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const { maxBarHeight: max, minBarHeight: min } = METRICS.voice;
  const silence = Math.floor(rand() * 5);
  let prev = 0.6;
  return Array.from({ length: count }, (_, i) => {
    if (i >= count - silence) return min;
    let v = rand() < 0.1 ? 0.05 : 0.3 + 0.7 * rand();
    v = 0.65 * v + 0.35 * prev;
    prev = v;
    return Math.round(min + v * (max - min));
  });
}

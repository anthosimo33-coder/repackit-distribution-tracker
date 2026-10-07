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
    maxWidth: 300,
  },
  /** Bulles reçues : décalées pour l'avatar (28 pt à x = 16, aligné en bas). */
  inIndent: 56,
  outMargin: 8,
  avatar: { size: 28, left: 16 },
  gap: { sameSender: 2, senderChange: 12, afterReaction: 14 },
  edited: { fontSize: 12.3, lineHeight: 16, marginTop: 13.15, marginBottom: 4.5, inset: 12.4 },
  reaction: { width: 29, height: 24, inset: 5, overlap: 7, ring: 1.5 },
  date: { fontSize: 12, lineHeight: 16, marginTop: 21, marginBottom: 16 },
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

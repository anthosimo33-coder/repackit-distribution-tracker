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

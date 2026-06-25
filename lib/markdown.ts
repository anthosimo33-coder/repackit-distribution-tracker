/**
 * Rendu markdown SÛR, sans dépendance ni `dangerouslySetInnerHTML` (convention
 * du repo, cf SimpleMarkdown / WarmupGuideAccordion). Ce module est PUR (aucun
 * React) : il parse le markdown en une liste de blocs typés que le composant
 * GuideMarkdown rend en éléments React. Le HTML inline n'est JAMAIS interprété
 * (le texte brut est échappé par React), et les URLs de liens sont assainies
 * (`sanitizeHref`) → pas d'injection (`javascript:`, `data:`…).
 *
 * Sous-ensemble supporté : titres (1 à 3 dièses), listes à puces et numérotées,
 * paragraphes (lignes consécutives regroupées, séparées par une ligne vide),
 * inline gras, italique, code et liens [label](url).
 */

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; label: string; href: string | null };

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; content: InlineToken[] }
  | { type: "ul"; items: InlineToken[][] }
  | { type: "ol"; items: InlineToken[][] }
  | { type: "paragraph"; content: InlineToken[] };

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

// Espaces + caractères de contrôle (U+0000–U+0020, U+007F–U+00A0) : les
// navigateurs les ignorent dans `javascript:` → vecteur d'obfuscation. On les
// retire AVANT la détection de schéma.
const CONTROL_AND_SPACE_RE = /[\u0000-\u0020\u007F-\u00A0]/g;
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * Assainit une URL de lien. Retourne l'URL si sûre, sinon `null` (le lien est
 * alors rendu en texte simple, jamais en `<a href>` dangereux).
 *
 * - schéma autorisé (http/https/mailto/tel) → OK ;
 * - lien relatif / ancre (#, /, chemin sans schéma) → OK ;
 * - schéma dangereux (`javascript:`, `data:`, `vbscript:`, `file:`…) → bloqué,
 *   y compris obfusqué par des caractères de contrôle/espaces ou par la casse.
 */
export function sanitizeHref(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const collapsed = trimmed.replace(CONTROL_AND_SPACE_RE, "");
  const scheme = collapsed.match(SCHEME_RE)?.[1]?.toLowerCase();
  if (scheme) {
    return ALLOWED_SCHEMES.has(scheme) ? trimmed : null;
  }
  // Pas de schéma → relatif / ancre : sûr.
  return trimmed;
}

const INLINE_RE =
  /(`[^`]+`|\[[^\]]+\]\([^)]*\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
const LINK_RE = /^\[([^\]]+)\]\(([^)]*)\)$/;

/** Parse une ligne en tokens inline (gras/italique/code/lien/texte). */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  for (const part of text.split(INLINE_RE)) {
    if (part === "") continue;
    if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
      tokens.push({ type: "code", value: part.slice(1, -1) });
      continue;
    }
    const link = part.match(LINK_RE);
    if (link) {
      tokens.push({ type: "link", label: link[1], href: sanitizeHref(link[2]) });
      continue;
    }
    if (
      part.length >= 4 &&
      ((part.startsWith("**") && part.endsWith("**")) ||
        (part.startsWith("__") && part.endsWith("__")))
    ) {
      tokens.push({ type: "bold", value: part.slice(2, -2) });
      continue;
    }
    if (
      part.length >= 2 &&
      ((part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_")))
    ) {
      tokens.push({ type: "italic", value: part.slice(1, -1) });
      continue;
    }
    tokens.push({ type: "text", value: part });
  }
  return tokens;
}

/** Parse un document markdown en blocs typés (titres, listes, paragraphes). */
export function parseMarkdown(input: string): MarkdownBlock[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let paraLines: string[] = [];

  const flushList = () => {
    if (listType && listItems.length) {
      blocks.push({
        type: listType,
        items: listItems.map((it) => parseInline(it)),
      });
    }
    listItems = [];
    listType = null;
  };
  const flushPara = () => {
    if (paraLines.length) {
      blocks.push({
        type: "paragraph",
        content: parseInline(paraLines.join(" ")),
      });
    }
    paraLines = [];
  };
  const flushAll = () => {
    flushList();
    flushPara();
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushAll();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        content: parseInline(heading[2].trim()),
      });
      continue;
    }

    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ol[1]);
      continue;
    }

    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(ul[1]);
      continue;
    }

    flushList();
    paraLines.push(line);
  }
  flushAll();
  return blocks;
}

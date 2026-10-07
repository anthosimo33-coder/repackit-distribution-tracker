/**
 * GÉNÉRATEUR DE CONVERSATIONS — la partie IA, sans I/O (testée via
 * `lib/insta-conv-llm.ts`, règle A6 : Convex n'importe rien hors de `convex/`).
 *
 * Deux usages d'un modèle de langage, et AUCUN ne produit de pixels :
 *   1. LIRE une capture (screen ou image TikTok) → la conversation en données ;
 *   2. RÉÉCRIRE la conversation selon une consigne (« remplace le message 3… »).
 * L'image finale reste dessinée par le code (components/admin/insta-conv) : le
 * modèle ne voit que du texte en sortie, donc rien à filigraner.
 *
 * API : OpenAI Responses (`POST /v1/responses`), sortie STRUCTURÉE par schéma
 * JSON strict — le modèle ne peut pas répondre autre chose que la forme
 * attendue, et `sanitizeItems` borne quand même chaque champ à l'arrivée.
 */

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
/** Surchargé par la variable `OPENAI_MODEL` du déploiement. */
export const DEFAULT_OPENAI_MODEL = "gpt-5";
export const LLM_TIMEOUT_MS = 120_000;

/** Bornes d'entrée : une capture réduite côté client pèse ~300 Ko. */
export const MAX_IMAGE_DATA_URL_CHARS = 6_000_000;
export const MAX_INSTRUCTION_CHARS = 2_000;
export const MAX_ITEMS = 80;
export const MAX_TEXT_CHARS = 1_000;

// ── Forme échangée avec le modèle (types : `convex/instaConvTypes.ts`) ───────

import type { LlmItem, ScreenshotReading, TikTokMedia } from "./instaConvTypes";
export type { LlmItem, ScreenshotReading, TikTokMedia } from "./instaConvTypes";

const ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "side", "text", "edited", "reaction"],
  properties: {
    kind: { type: "string", enum: ["message", "date"] },
    side: { type: "string", enum: ["in", "out", "none"] },
    text: { type: "string" },
    edited: { type: "boolean" },
    reaction: { type: ["string", "null"] },
  },
} as const;

export const READING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["theme", "locale", "contact", "status", "items"],
  properties: {
    theme: { type: "string", enum: ["dark", "light", "custom"] },
    locale: { type: "string", enum: ["fr", "en"] },
    contact: {
      type: "object",
      additionalProperties: false,
      required: ["name", "username"],
      properties: { name: { type: "string" }, username: { type: "string" } },
    },
    status: {
      type: "object",
      additionalProperties: false,
      required: ["time", "battery", "lowPower", "signal"],
      properties: {
        time: { type: ["string", "null"] },
        battery: { type: ["integer", "null"] },
        lowPower: { type: "boolean" },
        signal: { type: ["integer", "null"] },
      },
    },
    items: { type: "array", items: ITEM_SCHEMA },
  },
} as const;

export const REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: { items: { type: "array", items: ITEM_SCHEMA } },
} as const;

// ── Consignes ─────────────────────────────────────────────────────────────────

export const READING_INSTRUCTIONS = `You transcribe a screenshot of an Instagram direct-message conversation (iOS) into structured data. Be a faithful OCR, never an editor.

Messages, top to bottom, in reading order:
- "out" = bubbles aligned to the RIGHT (sent by the phone's owner, usually colored/gradient). "in" = bubbles aligned to the LEFT (received, usually gray, often with a small round avatar).
- Copy each bubble's text EXACTLY as displayed: same spelling mistakes, abbreviations, capitalization, punctuation, apostrophe style (’ vs '), emojis, line breaks only where the sender typed them (a bubble wrapping on several lines is ONE message with spaces, not line breaks).
- A message made only of large emojis without a bubble is still a message (text = the emojis).
- A small "Edited"/"Modifié" label just above a bubble → edited = true on that bubble.
- A small emoji pill hanging under a bubble is a REACTION → reaction = that emoji on that bubble (do not create a message for it).
- Centered gray text between messages (a date/time like "25 AUG AT 22:14", "Aujourd'hui 21:43") → kind "date", side "none", text copied exactly.
- Skip what is not a plain text message: shared posts/reels, photos, voice notes, story replies headers ("You replied to their story"), "Seen"/"Vu", typing indicators. Skip a bubble cut by the screen edge whose text is not fully legible.
- Some screenshots are cropped (no header, no status bar): then contact fields are empty strings and status fields null/false.

Header and status bar, only if visible: contact.name = bold name at the top, contact.username = the smaller line below it (without @). status.time = clock at top-left, status.battery = battery percentage if a number is shown, status.lowPower = true if the battery icon is yellow, status.signal = number of highlighted cellular bars (0-4).

theme: "dark" for the default black background, "light" for a white background, "custom" for any colored/illustrated chat theme. locale: "fr" if the interface or the messages are mainly French, else "en".`;

export const REWRITE_INSTRUCTIONS = `You edit an Instagram DM conversation given as JSON items (index, kind, side, text, edited, reaction). "out" = messages sent by the phone's owner (right side), "in" = messages received (left side), kind "date" = a centered date/time separator (side "none").

Apply the user's instruction and return the COMPLETE resulting list of items, in order:
- Change only what the instruction asks; copy every other item unchanged (same text, side, edited, reaction).
- Message numbers in the instruction refer to the "index" field (1 = first item), counting date separators too only if the user clearly does so; otherwise count messages.
- New or rewritten messages must sound like real texting in the conversation's language and tone: short, informal, lowercase if the others are, same level of typos/abbreviations, no hashtags, no quotation marks around the message.
- Each bubble is one message: split long lines into several consecutive messages like people actually text.
- Never add explanations, only the items.`;

// ── Requêtes ──────────────────────────────────────────────────────────────────

type JsonSchema = typeof READING_SCHEMA | typeof REWRITE_SCHEMA;

function requestBody(
  model: string,
  instructions: string,
  content: Array<Record<string, unknown>>,
  name: string,
  schema: JsonSchema,
): Record<string, unknown> {
  return {
    model,
    instructions,
    reasoning: { effort: "low" },
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name, schema, strict: true } },
  };
}

export function readingRequest(model: string, imageDataUrl: string): Record<string, unknown> {
  return requestBody(
    model,
    READING_INSTRUCTIONS,
    [
      { type: "input_text", text: "Transcribe this Instagram DM screenshot." },
      { type: "input_image", image_url: imageDataUrl, detail: "high" },
    ],
    "instagram_dm_reading",
    READING_SCHEMA,
  );
}

export function rewriteRequest(
  model: string,
  instruction: string,
  conversation: { locale: string; contactName: string; items: LlmItem[] },
): Record<string, unknown> {
  const numbered = conversation.items.map((it, i) => ({ index: i + 1, ...it }));
  return requestBody(
    model,
    REWRITE_INSTRUCTIONS,
    [
      {
        type: "input_text",
        text:
          `Conversation (language: ${conversation.locale}, contact: ${conversation.contactName || "unknown"}):\n` +
          JSON.stringify(numbered) +
          `\n\nInstruction:\n${instruction}`,
      },
    ],
    "instagram_dm_rewrite",
    REWRITE_SCHEMA,
  );
}

// ── Réponse ───────────────────────────────────────────────────────────────────

export type LlmOutcome = { ok: true; json: unknown } | { ok: false; reason: string };

/**
 * Extrait le JSON d'une réponse `/v1/responses`. La réponse brute n'a pas de
 * champ `output_text` (c'est un raccourci des SDK) : le texte est dans
 * `output[]` → message → content[] de type `output_text`. Un refus du modèle
 * arrive en content de type `refusal` ; une réponse tronquée a le statut
 * `incomplete`.
 */
export function parseResponsesOutput(body: unknown): LlmOutcome {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.error && typeof b.error === "object") {
    const msg = (b.error as Record<string, unknown>).message;
    return { ok: false, reason: typeof msg === "string" ? msg.slice(0, 200) : "erreur API" };
  }
  if (b.status === "incomplete") {
    const why = (b.incomplete_details as Record<string, unknown> | undefined)?.reason;
    return { ok: false, reason: `réponse incomplète (${typeof why === "string" ? why : "?"})` };
  }
  const output = Array.isArray(b.output) ? b.output : [];
  for (const item of output) {
    const it = item as Record<string, unknown>;
    if (it.type !== "message" || !Array.isArray(it.content)) continue;
    for (const c of it.content as Array<Record<string, unknown>>) {
      if (c.type === "refusal") return { ok: false, reason: `refus du modèle : ${String(c.refusal ?? "").slice(0, 160)}` };
      if (c.type === "output_text" && typeof c.text === "string") {
        try {
          return { ok: true, json: JSON.parse(c.text) };
        } catch {
          return { ok: false, reason: "JSON illisible" };
        }
      }
    }
  }
  return { ok: false, reason: "aucun texte dans la réponse" };
}

// ── Garde-fous à l'arrivée ────────────────────────────────────────────────────

export function sanitizeItems(raw: unknown): LlmItem[] {
  if (!Array.isArray(raw)) return [];
  const out: LlmItem[] = [];
  for (const r of raw.slice(0, MAX_ITEMS)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.slice(0, MAX_TEXT_CHARS).trim() : "";
    if (!text) continue;
    if (o.kind === "date") {
      out.push({ kind: "date", side: "none", text, edited: false, reaction: null });
      continue;
    }
    const side = o.side === "out" ? "out" : o.side === "in" ? "in" : null;
    if (side === null) continue;
    // Par points de code (pas d'unités UTF-16) : jamais un emoji coupé en deux.
    const reaction =
      typeof o.reaction === "string" && o.reaction.trim() ? Array.from(o.reaction.trim()).slice(0, 4).join("") : null;
    out.push({ kind: "message", side, text, edited: o.edited === true, reaction });
  }
  return out;
}

export function sanitizeReading(raw: unknown): ScreenshotReading {
  const o = (raw ?? {}) as Record<string, unknown>;
  const contact = (o.contact ?? {}) as Record<string, unknown>;
  const status = (o.status ?? {}) as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number): number | null =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null;
  const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return {
    theme: o.theme === "light" || o.theme === "custom" ? o.theme : "dark",
    locale: o.locale === "en" ? "en" : "fr",
    contact: { name: str(contact.name, 60), username: str(contact.username, 60).replace(/^@/, "") },
    status: {
      time: str(status.time, 8) || null,
      battery: int(status.battery, 0, 100),
      lowPower: status.lowPower === true,
      signal: int(status.signal, 0, 4),
    },
    items: sanitizeItems(o.items),
  };
}

// ── TikTok : images d'un post ─────────────────────────────────────────────────

/** Hôtes autorisés pour le proxy d'image : les CDN de TikTok, rien d'autre. */
const TIKTOK_CDN = /(^|\.)(tiktokcdn(-[a-z]{2})?\.com|tiktokcdn-us\.com|ibyteimg\.com|muscdn\.com|byteimg\.com)$/;

export function isTikTokCdnUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && TIKTOK_CDN.test(u.hostname);
  } catch {
    return false;
  }
}

export function isTikTokPostUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && /(^|\.)tiktok\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

const UNIVERSAL_DATA_RE = /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;

function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function firstUrl(v: unknown): string | null {
  if (typeof v === "string") return v;
  const list = rec(v).urlList;
  if (Array.isArray(list)) {
    // Le JPEG d'abord : tous les lecteurs le prennent ; le webp reste en repli.
    const urls = list.filter((u): u is string => typeof u === "string");
    return urls.find((u) => /\.jpe?g/i.test(u)) ?? urls[0] ?? null;
  }
  return null;
}

/**
 * Images d'un post TikTok lues dans le payload public de sa page (même balise
 * que le relevé, `convex/tiktokPublicPage.ts`). Carrousel photo →
 * `itemStruct.imagePost.images[].imageURL.urlList` (forme NON relevée sur un
 * vrai post photo au moment d'écrire : lue défensivement). Vidéo → sa
 * couverture (`originCover`, à défaut `cover`), seule image disponible sans
 * décoder la vidéo.
 */
export function extractTikTokMedia(html: string): TikTokMedia {
  const m = UNIVERSAL_DATA_RE.exec(html);
  if (!m) return { kind: "unreadable", reason: "balise de réhydratation absente" };
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return { kind: "unreadable", reason: "payload JSON illisible" };
  }
  const detail = rec(rec(rec(data).__DEFAULT_SCOPE__)["webapp.video-detail"]);
  if (typeof detail.statusCode === "number" && detail.statusCode !== 0) {
    return { kind: "unreadable", reason: `TikTok refuse de servir ce post (${detail.statusCode})` };
  }
  const item = rec(rec(detail.itemInfo).itemStruct);
  if (Object.keys(item).length === 0) return { kind: "unreadable", reason: "post introuvable dans la page" };
  const photos = rec(item.imagePost).images;
  if (Array.isArray(photos) && photos.length > 0) {
    const images = photos
      .map((p) => firstUrl(rec(p).imageURL) ?? firstUrl(rec(p).displayImage))
      .filter((u): u is string => u !== null && isTikTokCdnUrl(u))
      .slice(0, 35);
    if (images.length > 0) return { kind: "photos", images };
  }
  const video = rec(item.video);
  const cover = [video.originCover, video.cover].find((u) => typeof u === "string" && isTikTokCdnUrl(u));
  if (typeof cover === "string") return { kind: "video", images: [cover] };
  return { kind: "unreadable", reason: "ni photos ni couverture dans la page" };
}

/** Octets → data URL, par morceaux (`btoa` n'accepte pas un tableau géant d'un coup). */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

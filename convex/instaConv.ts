/**
 * GÉNÉRATEUR DE CONVERSATIONS — actions serveur (I/O : OpenAI, pages TikTok).
 * La logique pure (consignes, schémas, garde-fous, lecture TikTok) vit dans
 * `convex/instaConvLlm.ts`.
 *
 * ADMIN UNIQUEMENT, comme l'écran : wrapper d'action LOCAL au module (même
 * arrangement que le Radar — une action n'a pas d'accès `db`, la garde passe
 * par une internalQuery). Rien n'est stocké : chaque action rend sa réponse et
 * oublie l'image.
 *
 * Clé requise sur le déploiement : `OPENAI_API_KEY` (et, en option,
 * `OPENAI_MODEL`). Absente → rejet explicite `ERR_INSTA_LLM_NOT_CONFIGURED`.
 */
import { v } from "convex/values";
import { customAction } from "convex-helpers/server/customFunctions";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";
import { ERR, err } from "./errorCodes";
import { hasRole } from "./roles";
import {
  DEFAULT_OPENAI_MODEL,
  LLM_TIMEOUT_MS,
  MAX_IMAGE_DATA_URL_CHARS,
  MAX_INSTRUCTION_CHARS,
  MAX_ITEMS,
  OPENAI_RESPONSES_URL,
  bytesToDataUrl,
  extractTikTokMedia,
  isTikTokCdnUrl,
  isTikTokPostUrl,
  parseResponsesOutput,
  readingRequest,
  rewriteRequest,
  sanitizeItems,
  sanitizeReading,
  type LlmItem,
  type ScreenshotReading,
  type TikTokMedia,
} from "./instaConvLlm";

export const requireInstaConvAdmin = internalQuery({
  args: { userId: v.id("users"), projectId: v.id("projects") },
  handler: async (ctx, { userId, projectId }): Promise<boolean> => {
    if ((await ctx.db.get(projectId)) === null) return false;
    const user = await ctx.db.get(userId);
    if (user?.role === "superadmin") return true;
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
      .first();
    return hasRole(membership, "admin");
  },
});

const adminAction = customAction(action, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw err(ERR.NOT_AUTHENTICATED, "Non authentifié.");
    const ok: boolean = await ctx.runQuery(internal.instaConv.requireInstaConvAdmin, { userId, projectId });
    if (!ok) throw err(ERR.ADMIN_ONLY, "Réservé aux administrateurs du projet.");
    return { ctx: {}, args: {} };
  },
});

async function callOpenAi(body: Record<string, unknown>): Promise<unknown> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw err(ERR.INSTA_LLM_NOT_CONFIGURED, "La clé OpenAI (OPENAI_API_KEY) n'est pas configurée sur le serveur.");
  }
  let res: Response;
  try {
    res = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (e) {
    throw err(ERR.INSTA_LLM_FAILED, "L'IA n'a pas répondu.", { reason: String(e).slice(0, 120) });
  }
  const json: unknown = await res.json().catch(() => null);
  const outcome = parseResponsesOutput(json);
  if (!res.ok || !outcome.ok) {
    const reason = outcome.ok ? `HTTP ${res.status}` : `HTTP ${res.status} — ${outcome.reason}`;
    throw err(ERR.INSTA_LLM_FAILED, `L'IA a échoué (${reason}).`, { reason });
  }
  return outcome.json;
}

const model = () => process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

/** Lit une capture de DM (data URL, réduite côté client) et rend la conversation. */
export const analyzeScreenshot = adminAction({
  args: { image: v.string() },
  handler: async (_ctx, { image }): Promise<ScreenshotReading> => {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(image) || image.length > MAX_IMAGE_DATA_URL_CHARS) {
      throw err(ERR.INSTA_IMAGE_INVALID, "Image illisible ou trop lourde.");
    }
    return sanitizeReading(await callOpenAi(readingRequest(model(), image)));
  },
});

const itemValidator = v.object({
  kind: v.union(v.literal("message"), v.literal("date")),
  side: v.union(v.literal("in"), v.literal("out"), v.literal("none")),
  text: v.string(),
  edited: v.boolean(),
  reaction: v.union(v.string(), v.null()),
});

/** Réécrit la conversation selon une consigne libre ; rend la liste complète. */
export const rewriteConversation = adminAction({
  args: {
    instruction: v.string(),
    locale: v.string(),
    contactName: v.string(),
    items: v.array(itemValidator),
  },
  handler: async (_ctx, { instruction, locale, contactName, items }): Promise<LlmItem[]> => {
    const consigne = instruction.trim().slice(0, MAX_INSTRUCTION_CHARS);
    if (!consigne) throw err(ERR.INSTA_INSTRUCTION_EMPTY, "Écris une consigne.");
    const json = await callOpenAi(
      rewriteRequest(model(), consigne, {
        locale: locale.slice(0, 5),
        contactName: contactName.slice(0, 60),
        items: sanitizeItems(items).slice(0, MAX_ITEMS),
      }),
    );
    return sanitizeItems((json as { items?: unknown })?.items);
  },
});

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml",
};

/** Liste les images d'un post TikTok (photos d'un carrousel, ou couverture d'une vidéo). */
export const fetchTikTokPost = adminAction({
  args: { url: v.string() },
  handler: async (_ctx, { url }): Promise<TikTokMedia> => {
    if (!isTikTokPostUrl(url)) throw err(ERR.TIKTOK_POST_UNREADABLE, "Lien TikTok invalide.", { reason: "lien" });
    let html: string;
    try {
      const res = await fetch(url.trim().split("?")[0], {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (e) {
      throw err(ERR.TIKTOK_POST_UNREADABLE, "Page TikTok injoignable.", { reason: String(e).slice(0, 80) });
    }
    const media = extractTikTokMedia(html);
    if (media.kind === "unreadable") {
      throw err(ERR.TIKTOK_POST_UNREADABLE, `TikTok illisible (${media.reason}).`, { reason: media.reason });
    }
    return media;
  },
});

/**
 * Proxy d'UNE image TikTok → data URL. Le navigateur ne peut ni lire les
 * pixels d'une image d'un autre domaine (CORS), ni toujours l'afficher (le CDN
 * filtre). Hôtes bornés aux CDN TikTok : ce n'est pas un proxy ouvert.
 */
export const fetchTikTokImage = adminAction({
  args: { url: v.string() },
  handler: async (_ctx, { url }): Promise<string> => {
    if (!isTikTokCdnUrl(url)) throw err(ERR.TIKTOK_POST_UNREADABLE, "Image hors TikTok.", { reason: "hôte" });
    try {
      const res = await fetch(url, { headers: { "User-Agent": BROWSER_HEADERS["User-Agent"] }, signal: AbortSignal.timeout(20_000) });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !/^image\/(jpeg|png|webp)/.test(type)) throw new Error(`HTTP ${res.status} ${type}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > 4_000_000) throw new Error("image trop lourde");
      return bytesToDataUrl(bytes, type.split(";")[0]);
    } catch (e) {
      throw err(ERR.TIKTOK_POST_UNREADABLE, "Image TikTok illisible.", { reason: String(e).slice(0, 80) });
    }
  },
});

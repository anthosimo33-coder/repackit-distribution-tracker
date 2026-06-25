import { internalMutation, internalQuery } from "./_generated/server";
import { authedAction } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

/**
 * Embed des « vidéos à reproduire » (assignments.modelVideos = des LIENS) en
 * lecteur intégré sur la fiche mission. Deux I/O réseau (donc une ACTION) :
 *   1. RÉSOLUTION des shortlinks TikTok (vm./vt.tiktok.com → URL canonique
 *      /@user/video/ID, requise par l'oEmbed) en suivant le redirect HTTP ;
 *   2. VIGNETTE (oEmbed TikTok public ; Instagram via Graph API + token).
 * Résultat mis en CACHE read-through (table modelVideoEmbeds, keyé par l'URL
 * d'origine) → on ne re-résout jamais le même lien à chaque affichage.
 *
 * YouTube n'a PAS besoin de cette action : vignette directe + embed iframe,
 * résolus côté client (lib/embed + lib/thumbnail). L'action ne traite donc que
 * TikTok / Instagram.
 *
 * SÉCURITÉ : action AUTHENTIFIÉE (authedAction). La résolution de shortlink ne
 * suit un redirect QUE pour un shortlink TikTok ET n'accepte comme cible finale
 * qu'un host tiktok.com (garde anti-SSRF — pas d'open redirect-follower). URL
 * publique, aucune donnée sensible, aucune écriture sur modelVideos.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. isTikTokShortlink / isTikTokHost
 * répliquent lib/model-video-embed.ts ; parseOEmbedThumbnail / buildTikTokOEmbedUrl
 * répliquent lib/thumbnail.ts (tests Vitest là-bas). Évolution des DEUX côtés.
 * ⚠️ TS7022 — les handlers appelés via runQuery/runMutation et l'action ont leur
 * type de retour ANNOTÉ (cycle d'inférence).
 */

const FETCH_TIMEOUT_MS = 5000;

type EmbedResult = {
  canonicalUrl: string;
  thumbnailUrl: string | null;
  status: "ok" | "failed";
};

// ─── Répliques pures (lib/model-video-embed.ts + lib/thumbnail.ts) ───────────

/** Réplique de lib/model-video-embed.isTikTokShortlink. Exportée : réutilisée
 *  par la résolution de postUrl du tracking (convex/postUrlResolution.ts). */
export function isTikTokShortlink(url: string): boolean {
  return /^https?:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9]+/i.test(url.trim());
}

/** Réplique de lib/model-video-embed.isTikTokHost (garde anti-SSRF). */
function isTikTokHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "tiktok.com" || h.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

/** Réplique de lib/thumbnail.buildTikTokOEmbedUrl. */
function buildTikTokOEmbedUrl(videoUrl: string): string {
  return `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
}

/** Réplique de lib/thumbnail.parseOEmbedThumbnail. */
function parseOEmbedThumbnail(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const raw = (json as { thumbnail_url?: unknown }).thumbnail_url;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ─── I/O réseau (isolé, robuste : toute erreur → null, jamais d'exception) ────

async function fetchJsonSafe(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Suit le redirect d'un shortlink TikTok → URL canonique. N'agit QUE sur un
 * shortlink TikTok et n'accepte qu'une cible finale sur un host tiktok.com
 * (anti-SSRF). Le corps n'est pas téléchargé (res.url suffit). Échec → null.
 */
export async function resolveTikTokShortlink(url: string): Promise<string | null> {
  if (!isTikTokShortlink(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    // On ne lit pas la page : seule l'URL finale (après redirects) nous intéresse.
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    const finalUrl = res.url;
    return finalUrl && isTikTokHost(finalUrl) ? finalUrl : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Vignette via oEmbed : TikTok public ; Instagram via Graph API + token. */
async function fetchThumbnail(
  url: string,
  platform: "TikTok" | "Instagram",
): Promise<string | null> {
  if (platform === "TikTok") {
    return parseOEmbedThumbnail(await fetchJsonSafe(buildTikTokOEmbedUrl(url)));
  }
  // Instagram — oEmbed nécessite un token Facebook (INSTAGRAM_OEMBED_TOKEN).
  // Absent ou erreur → null (fallback placeholder côté UI), jamais de crash.
  const token = process.env.INSTAGRAM_OEMBED_TOKEN;
  if (!token) return null;
  const endpoint = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(
    url,
  )}&access_token=${encodeURIComponent(token)}&fields=thumbnail_url`;
  return parseOEmbedThumbnail(await fetchJsonSafe(endpoint));
}

// ─── Cache (interne) ─────────────────────────────────────────────────────────

export const getCachedEmbed = internalQuery({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<Doc<"modelVideoEmbeds"> | null> => {
    return await ctx.db
      .query("modelVideoEmbeds")
      .withIndex("by_url", (q) => q.eq("url", url))
      .first();
  },
});

export const storeEmbed = internalMutation({
  args: {
    url: v.string(),
    canonicalUrl: v.string(),
    thumbnailUrl: v.optional(v.string()),
    status: v.union(v.literal("ok"), v.literal("failed")),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query("modelVideoEmbeds")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .first();
    const row = {
      url: args.url,
      canonicalUrl: args.canonicalUrl,
      thumbnailUrl: args.thumbnailUrl,
      status: args.status,
      fetchedAt: args.fetchedAt,
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("modelVideoEmbeds", row);
    return null;
  },
});

// ─── Action publique (authentifiée) ──────────────────────────────────────────

/**
 * Résout l'embed d'une vidéo modèle TikTok/Instagram : URL canonique (shortlink
 * TikTok résolu) + vignette. Cache read-through par URL d'origine. Échec réseau
 * → status "failed" + canonicalUrl = au mieux résolu sinon l'URL d'origine
 * (l'UI retombe sur un placeholder/carte cliquable, jamais cassé).
 */
export const resolveModelVideoEmbed = authedAction({
  args: {
    url: v.string(),
    platform: v.union(v.literal("TikTok"), v.literal("Instagram")),
  },
  handler: async (ctx, { url, platform }): Promise<EmbedResult> => {
    const cached = await ctx.runQuery(
      internal.modelVideoEmbeds.getCachedEmbed,
      { url },
    );
    if (cached) {
      return {
        canonicalUrl: cached.canonicalUrl ?? cached.url,
        thumbnailUrl: cached.thumbnailUrl ?? null,
        status: cached.status,
      };
    }

    let canonicalUrl = url;
    if (platform === "TikTok" && isTikTokShortlink(url)) {
      const resolved = await resolveTikTokShortlink(url);
      if (resolved) canonicalUrl = resolved;
    }
    const thumbnailUrl = await fetchThumbnail(canonicalUrl, platform);
    const status: "ok" | "failed" = thumbnailUrl ? "ok" : "failed";

    await ctx.runMutation(internal.modelVideoEmbeds.storeEmbed, {
      url,
      canonicalUrl,
      thumbnailUrl: thumbnailUrl ?? undefined,
      status,
      fetchedAt: Date.now(),
    });
    return { canonicalUrl, thumbnailUrl, status };
  },
});

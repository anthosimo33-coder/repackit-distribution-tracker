import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * Vignettes AUTO des inspirations — récupération + cache.
 *
 * Une vignette se récupère par appel réseau externe (oEmbed TikTok/Insta) →
 * runtime ACTION obligatoire (`fetch` indispo en query/mutation). À la création
 * d'une inspiration vidéo, createInspiration planifie `resolveThumbnail`
 * (scheduler.runAfter, non bloquant) ; le backfill rejoue la même résolution
 * sur l'existant. Le résultat (URL ou échec) est mis en cache sur la row via
 * storeThumbnail → on ne re-fetch jamais un ok, ni en boucle un failed.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. extractYouTubeId /
 * buildYouTubeThumbnailUrl / parseOEmbedThumbnail / buildTikTokOEmbedUrl sont
 * des RÉPLIQUES de lib/youtubeId.ts + lib/thumbnail.ts (tests Vitest là-bas).
 * Toute évolution doit être faite des DEUX côtés.
 *
 * ⚠️ TS7022 — les handlers appelés via ctx.runQuery/runMutation(internal.*) ont
 * leur type de retour ANNOTÉ pour casser le cycle d'inférence.
 *
 * DIFFICULTÉ PAR PLATEFORME :
 *   - YouTube : URL prévisible (img.youtube.com/vi/<id>/hqdefault.jpg), aucun
 *     appel réseau ni clé.
 *   - TikTok : oEmbed PUBLIC (pas de clé) → thumbnail_url.
 *   - Instagram : oEmbed nécessite un token Facebook (INSTAGRAM_OEMBED_TOKEN).
 *     Tenté proprement si le token est posé ; sinon (ou erreur) → status
 *     "failed", JAMAIS de crash. La création d'une inspiration Insta n'est
 *     jamais bloquée par l'indisponibilité de la vignette.
 */

const FETCH_TIMEOUT_MS = 5000;
const BACKFILL_BATCH = 20;
const BACKFILL_CONCURRENCY = 5;
const BACKFILL_MAX_ROWS = 1000;

type Plateforme = "TikTok" | "Instagram" | "YouTube";
type ThumbnailStatus = "ok" | "failed";

interface ThumbnailResult {
  thumbnailUrl: string | null;
  status: ThumbnailStatus;
}

// ─── Répliques pures (lib/youtubeId.ts + lib/thumbnail.ts) ───────────────────

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PATH_ID_RE = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/;

/** Réplique de lib/youtubeId.extractYouTubeId — cf tests Vitest là-bas. */
function extractYouTubeId(input: string | null | undefined): string | null {
  if (typeof input !== "string" || input.trim() === "") return null;
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    try {
      url = new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.|music\.)/, "");
  const isYouTube =
    host === "youtube.com" ||
    host === "youtu.be" ||
    host.endsWith(".youtube.com");
  if (!isYouTube) return null;

  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (url.pathname === "/watch" || url.pathname === "/watch/") {
    id = url.searchParams.get("v");
  } else {
    const m = PATH_ID_RE.exec(url.pathname);
    if (m) id = m[1];
  }
  return id !== null && VIDEO_ID_RE.test(id) ? id : null;
}

/** Réplique de lib/thumbnail.buildYouTubeThumbnailUrl. */
function buildYouTubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
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

// ─── I/O réseau (isolé, robuste) ─────────────────────────────────────────────

/** GET JSON avec timeout court. Toute erreur (réseau, timeout, !ok, JSON) → null. */
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
 * Résout la vignette d'une URL selon sa plateforme. Un échec = { null,
 * "failed" }, jamais d'exception non gérée.
 */
async function fetchThumbnail(
  url: string,
  platform: Plateforme,
): Promise<ThumbnailResult> {
  if (platform === "YouTube") {
    const id = extractYouTubeId(url);
    if (!id) return { thumbnailUrl: null, status: "failed" };
    // hqdefault est quasi toujours présent → URL directe, pas d'appel réseau.
    return { thumbnailUrl: buildYouTubeThumbnailUrl(id), status: "ok" };
  }

  if (platform === "TikTok") {
    const json = await fetchJsonSafe(buildTikTokOEmbedUrl(url));
    const thumb = parseOEmbedThumbnail(json);
    return thumb
      ? { thumbnailUrl: thumb, status: "ok" }
      : { thumbnailUrl: null, status: "failed" };
  }

  // Instagram — oEmbed via Graph API, requiert un token Facebook. Sans token,
  // on n'essaie même pas (échec propre) ; avec token, un échec reste propre.
  const token = process.env.INSTAGRAM_OEMBED_TOKEN;
  if (!token) {
    console.info(
      "[inspiration-thumbnail] Instagram oEmbed ignoré (INSTAGRAM_OEMBED_TOKEN absent) — fallback.",
    );
    return { thumbnailUrl: null, status: "failed" };
  }
  const endpoint = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(
    url,
  )}&access_token=${encodeURIComponent(token)}&fields=thumbnail_url`;
  const json = await fetchJsonSafe(endpoint);
  const thumb = parseOEmbedThumbnail(json);
  return thumb
    ? { thumbnailUrl: thumb, status: "ok" }
    : { thumbnailUrl: null, status: "failed" };
}

// ─── Persistance (interne) ───────────────────────────────────────────────────

/**
 * Met en cache le résultat sur l'inspiration. Idempotent : ne touche que les
 * 3 champs vignette. Silencieux si la row a disparu entre-temps.
 */
export const storeThumbnail = internalMutation({
  args: {
    inspirationId: v.id("inspirations"),
    thumbnailUrl: v.union(v.string(), v.null()),
    status: v.union(v.literal("ok"), v.literal("failed")),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db.get(args.inspirationId);
    if (!row) return null;
    await ctx.db.patch(args.inspirationId, {
      autoThumbnailUrl: args.thumbnailUrl ?? undefined,
      thumbnailStatus: args.status,
      thumbnailFetchedAt: args.fetchedAt,
    });
    return null;
  },
});

/**
 * Résout + met en cache la vignette d'une inspiration. Planifié par
 * createInspiration (runAfter) et rejoué par le backfill. `now` est passé par
 * l'appelant (une action peut appeler Date.now() ; on garde la signature
 * explicite pour le backfill).
 */
export const resolveThumbnail = internalAction({
  args: {
    inspirationId: v.id("inspirations"),
    url: v.string(),
    platform: v.union(
      v.literal("TikTok"),
      v.literal("Instagram"),
      v.literal("YouTube"),
    ),
  },
  handler: async (ctx, args): Promise<ThumbnailResult> => {
    const result = await fetchThumbnail(args.url, args.platform);
    await ctx.runMutation(internal.inspirationThumbnails.storeThumbnail, {
      inspirationId: args.inspirationId,
      thumbnailUrl: result.thumbnailUrl,
      status: result.status,
      fetchedAt: Date.now(),
    });
    return result;
  },
});

/**
 * Candidats backfill : inspirations VIDÉO sans vignette manuelle (thumbnail),
 * sans vignette auto (autoThumbnailUrl) et jamais marquées "failed" (pour ne
 * pas réessayer indéfiniment les échecs). Tous projets confondus (admin one-shot).
 */
export const listInspirationsNeedingThumbnail = internalQuery({
  args: { limit: v.number() },
  handler: async (
    ctx,
    { limit },
  ): Promise<
    { _id: Id<"inspirations">; url: string; plateforme: Plateforme }[]
  > => {
    const rows = await ctx.db.query("inspirations").collect();
    const out: {
      _id: Id<"inspirations">;
      url: string;
      plateforme: Plateforme;
    }[] = [];
    for (const r of rows) {
      if (r.type !== "video") continue;
      if (r.thumbnail !== undefined) continue;
      if (r.autoThumbnailUrl !== undefined) continue;
      if (r.thumbnailStatus === "failed") continue;
      out.push({ _id: r._id, url: r.url, plateforme: r.plateforme });
      if (out.length >= limit) break;
    }
    return out;
  },
});

/**
 * BACKFILL idempotent — remplit les vignettes des inspirations existantes.
 * Traite par lots (BACKFILL_BATCH) avec une concurrence bornée
 * (BACKFILL_CONCURRENCY) pour ne pas marteler les endpoints oEmbed. Comme
 * chaque row traitée devient "ok" ou "failed", elle sort de la query au tour
 * suivant → terminaison garantie (pas de boucle infinie sur les échecs).
 *
 * Lancement prod :
 *   npx convex run inspirationThumbnails:backfillInspirationThumbnails --prod
 */
export const backfillInspirationThumbnails = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ processed: number; ok: number; failed: number }> => {
    let processed = 0;
    let ok = 0;
    let failed = 0;

    while (processed < BACKFILL_MAX_ROWS) {
      const batch = await ctx.runQuery(
        internal.inspirationThumbnails.listInspirationsNeedingThumbnail,
        { limit: BACKFILL_BATCH },
      );
      if (batch.length === 0) break;

      for (let i = 0; i < batch.length; i += BACKFILL_CONCURRENCY) {
        const slice = batch.slice(i, i + BACKFILL_CONCURRENCY);
        const results = await Promise.all(
          slice.map((row) =>
            ctx.runAction(internal.inspirationThumbnails.resolveThumbnail, {
              inspirationId: row._id,
              url: row.url,
              platform: row.plateforme,
            }),
          ),
        );
        for (const r of results) {
          processed += 1;
          if (r.status === "ok") ok += 1;
          else failed += 1;
        }
      }
    }

    console.info(
      `[inspiration-thumbnail] Backfill terminé — ${processed} traitée(s), ${ok} ok, ${failed} échec(s).`,
    );
    return { processed, ok, failed };
  },
});

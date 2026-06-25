"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import { detectInspirationType } from "@/lib/inspiration-url";
import { videoExamplePlatform } from "@/lib/model-video-embed";
import { extractYouTubeId } from "@/lib/embed";
import { buildYouTubeThumbnailUrl } from "@/lib/thumbnail";
import { VideoExample } from "@/components/formats/VideoExample";

/**
 * Vidéo « à reproduire » (assignment.modelVideos = un LIEN) rendue en LECTEUR
 * INTÉGRÉ, en réutilisant <VideoExample> (embed officiel YouTube/TikTok/Instagram
 * + fallback carte). LAZY : on affiche d'abord une miniature/placeholder cliquable
 * et on ne MONTE l'embed (iframe/scripts tiers) qu'au CLIC → pas N iframes chargés
 * d'un coup quand une mission a plusieurs vidéos.
 *
 * Vignette + URL canonique :
 *   - YouTube → vignette directe (lib/thumbnail) + URL telle quelle, 0 réseau ;
 *   - TikTok / Instagram → action serveur resolveModelVideoEmbed : résout le
 *     shortlink TikTok (vm.tiktok.com → URL canonique, requise par l'oEmbed) et
 *     récupère la vignette (oEmbed). Échec → placeholder + embed sur l'URL d'origine.
 * Plateforme non reconnue → carte lien cliquable (comportement historique).
 *
 * Robuste : tout chemin d'échec retombe sur un placeholder/carte cliquable —
 * jamais d'embed vide ni d'écran cassé. Identique en mode admin view-as (même
 * écran ; getAssignmentDetailAsAdmin renvoie déjà modelVideos).
 */
type ModelVideo = { url: string; title?: string; note?: string };

export function ModelVideoEmbed({ video }: { video: ModelVideo }) {
  const detected = detectInspirationType(video.url);
  const platform = detected?.plateforme ?? null; // TikTok | Instagram | YouTube | null
  const needsServer = platform === "TikTok" || platform === "Instagram";

  const resolveEmbed = useAction(api.modelVideoEmbeds.resolveModelVideoEmbed);
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<{
    canonicalUrl: string;
    thumbnailUrl: string | null;
  } | null>(null);

  useEffect(() => {
    if (!needsServer) return;
    let cancelled = false;
    resolveEmbed({ url: video.url, platform: platform as "TikTok" | "Instagram" })
      .then((r) => {
        if (!cancelled) {
          setResolved({ canonicalUrl: r.canonicalUrl, thumbnailUrl: r.thumbnailUrl });
        }
      })
      .catch(() => {
        /* échec serveur → placeholder ; au clic, embed sur l'URL d'origine */
      });
    return () => {
      cancelled = true;
    };
  }, [video.url, platform, needsServer, resolveEmbed]);

  // Plateforme inconnue → carte lien brute (fallback historique).
  if (!platform) {
    return <PlainLinkCard video={video} badge="Lien" />;
  }

  const ytId = platform === "YouTube" ? extractYouTubeId(video.url) : null;
  const thumbnailUrl =
    platform === "YouTube"
      ? ytId
        ? buildYouTubeThumbnailUrl(ytId)
        : null
      : (resolved?.thumbnailUrl ?? null);
  const canonicalUrl =
    platform === "YouTube" ? video.url : (resolved?.canonicalUrl ?? video.url);

  // Vertical (TikTok/IG) vs paysage (YouTube) — lisible et borné sur mobile.
  const isVertical = platform !== "YouTube";
  const frameClass = isVertical
    ? "mx-auto aspect-[9/16] w-full max-w-[260px]"
    : "aspect-video w-full";

  if (open) {
    return (
      <figure className="space-y-1.5">
        <div className={isVertical ? "mx-auto w-full max-w-[260px]" : undefined}>
          <VideoExample
            example={{
              kind: "url",
              url: canonicalUrl,
              platform: videoExamplePlatform(platform),
              title: video.title ?? "",
            }}
          />
        </div>
        {video.note && (
          <figcaption className="text-sm text-slate-500">{video.note}</figcaption>
        )}
      </figure>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Lire la vidéo ${video.title ?? ""}`.trim()}
        className={`group relative block overflow-hidden rounded-lg border border-slate-200 bg-slate-900 ${frameClass}`}
      >
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={video.title ?? "Vidéo à reproduire"}
            className="size-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-slate-800 to-slate-900 text-slate-300">
            <PlayIcon className="size-8" />
            <span className="text-xs font-medium uppercase tracking-wide">
              {platform}
            </span>
          </div>
        )}
        {/* Pastille play + badge plateforme par-dessus la vignette. */}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-transform group-hover:scale-110">
            <PlayIcon className="size-6" />
          </span>
        </span>
        <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-xs font-medium text-white">
          {platform}
        </span>
      </button>
      {(video.title || video.note) && (
        <div className="min-w-0">
          {video.title && (
            <p className="truncate text-sm font-medium text-slate-900">
              {video.title}
            </p>
          )}
          {video.note && (
            <p className="text-sm text-slate-500">{video.note}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Carte lien cliquable (plateforme non reconnue ou repli) — jamais cassé. */
function PlainLinkCard({
  video,
  badge,
}: {
  video: ModelVideo;
  badge: string;
}) {
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:border-primary hover:bg-primary/5"
    >
      <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
        {badge}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm font-medium text-slate-900">
          <span className="truncate">{video.title ?? video.url}</span>
          <ExternalLinkIcon className="size-3.5 shrink-0 text-slate-400" />
        </div>
        {video.note && (
          <p className="mt-0.5 text-sm text-slate-500">{video.note}</p>
        )}
      </div>
    </a>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { ExternalLinkIcon, FilmIcon } from "lucide-react";
import {
  extractYouTubeId,
  youTubeEmbedUrl,
  tiktokPlayerEmbedUrl,
} from "@/lib/embed";
import { tiktokPostId } from "@/lib/apifyPosts";
import { handleFromPostUrl } from "@/lib/post-url-account";

/**
 * P6 — <VideoExample> : rend un exemple vidéo REGARDABLE in-app, JAMAIS
 * téléchargeable (aucun lien de download nulle part).
 *  - kind "file" : <video controls controlsList="nodownload"> sur l'URL signée
 *    résolue SERVEUR (range requests Convex → le seek fonctionne).
 *  - kind "url"  : YouTube → iframe nocookie ; TikTok → iframe LECTEUR officiel
 *    (player/v1, autonome, sans embed.js) ; Instagram → embed officiel ; dans
 *    tous les cas, embed impossible → carte cliquable propre (miniature si
 *    dispo + compte + « Voir la vidéo »), JAMAIS de texte brut.
 *
 * Composant partagé admin (aperçu) ET portail créateur (brief). Toute
 * correction du rendu vaut donc partout, sans duplication.
 */
export type FormatExample =
  | {
      kind: "file";
      storageId: Id<"_storage">;
      title: string;
      mimeType: string;
      url?: string | null;
    }
  | {
      kind: "url";
      url: string;
      platform: "tiktok" | "youtube" | "instagram";
      title: string;
      /** Miniature (optionnelle) pour la carte de repli si l'embed échoue. */
      posterUrl?: string | null;
    };

export function VideoExample({
  example,
  onUnreadable,
}: {
  example: FormatExample;
  /**
   * Notifié quand un fichier kind="file" ne peut pas être lu inline (typique
   * .mov HEVC iPhone). Le parent (ex. file de validation admin) s'en sert pour
   * proposer le téléchargement. Ce composant reste SANS lien de download.
   */
  onUnreadable?: () => void;
}) {
  // TikTok = format vertical (9/16) : on borne la largeur du cadre pour éviter
  // un lecteur géant (ex. grille d'exemples de format en pleine largeur).
  const frameWidthClass =
    example.kind === "url" && example.platform === "tiktok"
      ? "mx-auto w-full max-w-[280px]"
      : "";
  return (
    <figure className="space-y-1.5">
      <div
        className={`overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${frameWidthClass}`}
      >
        {example.kind === "file" ? (
          <FileVideo
            url={example.url ?? null}
            mimeType={example.mimeType}
            onUnreadable={onUnreadable}
          />
        ) : example.platform === "youtube" ? (
          <YouTubeEmbed url={example.url} title={example.title} />
        ) : example.platform === "tiktok" ? (
          <TikTokEmbed
            url={example.url}
            title={example.title}
            posterUrl={example.posterUrl ?? null}
          />
        ) : (
          <InstagramEmbed url={example.url} title={example.title} />
        )}
      </div>
      {example.title && (
        <figcaption className="text-xs text-slate-500">
          {example.title}
        </figcaption>
      )}
    </figure>
  );
}

function FileVideo({
  url,
  mimeType,
  onUnreadable,
}: {
  url: string | null;
  mimeType: string;
  onUnreadable?: () => void;
}) {
  const [error, setError] = useState(false);
  if (!url) return <FallbackCard label="Vidéo indisponible" />;
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 p-6 text-center text-sm text-slate-500">
        <FilmIcon className="size-6 text-slate-300" />
        <p>
          Format non lisible par ce navigateur (probable .mov HEVC iPhone) —
          réencoder en mp4 H.264.
        </p>
      </div>
    );
  }
  return (
    <video
      controls
      controlsList="nodownload"
      preload="metadata"
      playsInline
      onContextMenu={(e) => e.preventDefault()}
      onError={() => {
        setError(true);
        onUnreadable?.();
      }}
      className="aspect-video w-full bg-black"
    >
      <source src={url} type={mimeType} />
    </video>
  );
}

function YouTubeEmbed({ url, title }: { url: string; title: string }) {
  const id = extractYouTubeId(url);
  if (!id) return <FallbackCard label="Voir sur YouTube" href={url} />;
  return (
    <iframe
      src={youTubeEmbedUrl(id)}
      title={title || "Exemple YouTube"}
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      className="aspect-video w-full"
      data-testid="youtube-embed"
    />
  );
}

/** Charge un script externe une seule fois (idempotent par src). */
function useExternalScript(src: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (document.querySelector(`script[src="${src}"]`)) return;
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    document.body.appendChild(s);
  }, [src, enabled]);
}

function TikTokEmbed({
  url,
  title,
  posterUrl,
}: {
  url: string;
  title: string;
  posterUrl?: string | null;
}) {
  // Lecteur officiel `player/v1` en iframe AUTONOME : joue la vidéo en place,
  // sans oEmbed ni embed.js. L'ancienne approche (blockquote hydraté par
  // embed.js) ne se ré-hydratait PAS après le 1er montage — or ici le montage
  // est lazy (au clic), embed.js déjà chargé → le blockquote restait brut et
  // dégénérait en LÉGENDE illisible dans le brief (« @compte / son original… »).
  // Cf lib/embed.ts (helper partagé, éprouvé dans le Radar admin).
  const videoId = tiktokPostId(url);
  if (!videoId) {
    // Pas d'id numérique exploitable (shortlink non résolu, URL inhabituelle) →
    // carte cliquable propre, jamais de bloc de texte brut.
    return (
      <FallbackCard
        label={title || "Voir la vidéo"}
        href={url}
        posterUrl={posterUrl}
        handle={handleFromPostUrl(url, "TikTok")}
      />
    );
  }
  return (
    <iframe
      src={tiktokPlayerEmbedUrl(videoId)}
      title={title || "Exemple TikTok"}
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
      className="aspect-[9/16] w-full"
      data-testid="tiktok-embed"
    />
  );
}

function InstagramEmbed({ url, title }: { url: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useExternalScript("https://www.instagram.com/embed.js", true);
  useEffect(() => {
    // Re-process après montage (si le script est déjà chargé).
    const w = window as unknown as { instgrm?: { Embeds: { process: () => void } } };
    w.instgrm?.Embeds.process();
  }, [url]);
  return (
    <div ref={ref} data-testid="instagram-embed" className="bg-white p-2">
      {/* Le blockquote officiel ; si embed.js est bloqué, le lien interne
          ci-dessous reste la carte cliquable de secours. */}
      <blockquote
        className="instagram-media"
        data-instgrm-permalink={url}
        data-instgrm-version="14"
        style={{ margin: 0, width: "100%" }}
      >
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 p-4 text-sm font-medium text-slate-700 hover:text-slate-900"
        >
          <ExternalLinkIcon className="size-4" />
          {title || "Voir sur Instagram"}
        </a>
      </blockquote>
    </div>
  );
}

/**
 * Carte de repli quand l'embed est impossible : miniature si disponible + nom
 * du compte (si extractible de l'URL) + « Voir la vidéo » ouvrant le post dans
 * un nouvel onglet. JAMAIS de bloc de texte brut. Sans href → carte non
 * cliquable (ex. fichier illisible).
 */
function FallbackCard({
  label,
  href,
  posterUrl,
  handle,
}: {
  label: string;
  href?: string;
  posterUrl?: string | null;
  handle?: string | null;
}) {
  const content = (
    <div className="flex items-center gap-3 p-3 text-left">
      {posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterUrl}
          alt=""
          className="h-16 w-12 shrink-0 rounded object-cover"
        />
      ) : (
        <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded bg-slate-200 text-slate-400">
          <FilmIcon className="size-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {handle && (
          <p className="truncate text-sm font-medium text-slate-900">
            @{handle}
          </p>
        )}
        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
          <ExternalLinkIcon className="size-4" />
          {label}
        </span>
      </div>
    </div>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block hover:bg-slate-50"
    >
      {content}
    </a>
  ) : (
    content
  );
}

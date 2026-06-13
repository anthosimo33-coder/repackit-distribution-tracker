"use client";

import { useEffect, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { ExternalLinkIcon, FilmIcon } from "lucide-react";
import { extractYouTubeId, youTubeEmbedUrl, tiktokOembedUrl } from "@/lib/embed";

/**
 * P6 — <VideoExample> : rend un exemple vidéo REGARDABLE in-app, JAMAIS
 * téléchargeable (aucun lien de download nulle part).
 *  - kind "file" : <video controls controlsList="nodownload"> sur l'URL signée
 *    résolue SERVEUR (range requests Convex → le seek fonctionne).
 *  - kind "url"  : YouTube → iframe ; TikTok → oEmbed officiel ; Instagram →
 *    embed officiel ; fallback carte cliquable si l'embed est bloqué.
 *
 * Composant partagé admin (aperçu) ET portail créateur (chantier suivant).
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
    };

export function VideoExample({ example }: { example: FormatExample }) {
  return (
    <figure className="space-y-1.5">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        {example.kind === "file" ? (
          <FileVideo url={example.url ?? null} mimeType={example.mimeType} />
        ) : example.platform === "youtube" ? (
          <YouTubeEmbed url={example.url} title={example.title} />
        ) : example.platform === "tiktok" ? (
          <TikTokEmbed url={example.url} title={example.title} />
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

function FileVideo({ url, mimeType }: { url: string | null; mimeType: string }) {
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
      onError={() => setError(true)}
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

function TikTokEmbed({ url, title }: { url: string; title: string }) {
  // oEmbed officiel : on récupère le HTML d'embed (blockquote.tiktok-embed) et
  // on laisse embed.js l'hydrater. Fallback carte si CORS/erreur réseau.
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(tiktokOembedUrl(url))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("oembed"))))
      .then((data: { html?: string }) => {
        if (cancelled) return;
        if (data.html) setHtml(data.html);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [url]);

  useExternalScript("https://www.tiktok.com/embed.js", html !== null);

  if (failed)
    return <FallbackCard label={title || "Voir sur TikTok"} href={url} />;
  if (html === null) return <EmbedLoading />;
  return (
    // dangerouslySetInnerHTML : seul cas du repo — HTML d'embed TIERS renvoyé
    // par l'oEmbed officiel TikTok (pas de contenu utilisateur). embed.js
    // hydrate ensuite le blockquote en lecteur.
    <div
      ref={ref}
      className="tiktok-embed-container [&_iframe]:!w-full"
      data-testid="tiktok-embed"
      dangerouslySetInnerHTML={{ __html: html }}
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

function EmbedLoading() {
  return (
    <div className="flex aspect-video w-full items-center justify-center text-sm text-slate-400">
      Chargement de l&apos;aperçu…
    </div>
  );
}

function FallbackCard({ label, href }: { label: string; href?: string }) {
  const content = (
    <div className="flex items-center justify-center gap-2 p-6 text-sm font-medium text-slate-700">
      <ExternalLinkIcon className="size-4" />
      {label}
    </div>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block hover:bg-slate-100">
      {content}
    </a>
  ) : (
    content
  );
}

"use client";

import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { useMyPublishedVideos } from "@/components/portal/creator-data";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatEuros, formatViews } from "@/lib/format-rate";
import { publishedAgo } from "@/lib/video-tracking";
import { isSnytchProject } from "@/lib/snytch-drive";
import { FilmIcon, CircleCheckIcon, ClockIcon, InfoIcon } from "lucide-react";

/**
 * « Mes vidéos » — suivi créatrice SNYTCH des vidéos PUBLIÉES : plateforme,
 * ancienneté, STATUT DE SUIVI (actif / en cours de calcul), vues, gain par vidéo
 * (plafonné 150 €, source unique = moteur paie). PUREMENT en lecture → réutilisé
 * tel quel en mode admin « voir l'espace d'un créateur » (données scopées serveur
 * via useMyPublishedVideos). Gate Snytch par slug (défense en profondeur ; la nav
 * ne pointe ici que pour Snytch).
 */

type Video = FunctionReturnType<
  typeof api.creatorVideos.listMyPublishedVideos
>[number];

const PLATFORM_STYLE: Record<string, string> = {
  TikTok: "bg-slate-900 text-white",
  Instagram: "bg-fuchsia-600 text-white",
  YouTube: "bg-red-600 text-white",
};

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide",
        PLATFORM_STYLE[platform] ?? "bg-slate-200 text-slate-700",
      )}
    >
      {platform}
    </span>
  );
}

function TrackingChip({ status }: { status: Video["trackingStatus"] }) {
  if (status === "active") {
    return (
      <span
        data-testid="tracking-active"
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"
      >
        <CircleCheckIcon className="size-3.5" />
        Suivi actif
      </span>
    );
  }
  return (
    <span
      data-testid="tracking-pending"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"
    >
      <ClockIcon className="size-3.5" />
      Vues en cours de calcul
    </span>
  );
}

function VideoRow({ v, now }: { v: Video; now: number }) {
  return (
    <Card data-testid="video-row">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {v.platforms.map((p) => (
              <PlatformBadge key={p} platform={p} />
            ))}
            <span className="text-xs text-slate-400">
              Publié {publishedAgo(v.publishedAt, now)}
            </span>
          </div>
          <TrackingChip status={v.trackingStatus} />
        </div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">Vues</p>
            <p className="text-lg font-semibold tabular-nums text-slate-900">
              {v.views === null ? "—" : formatViews(v.views)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Gain</p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                v.capped ? "text-emerald-600" : "text-slate-900",
              )}
            >
              {formatEuros(v.gain)}
            </p>
            {v.capped && (
              <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-600">
                gain max
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Notice({ body }: { body: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Mes vidéos
      </h1>
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-500">
          {body}
        </CardContent>
      </Card>
    </div>
  );
}

export default function VideosScreen() {
  const { current } = useCreatorProject();
  const videos = useMyPublishedVideos(current.projectId);
  // Ancre temporelle figée au montage (relative time stable, pas d'appel impur
  // au render — cf react-hooks/purity).
  const [now] = useState(() => Date.now());

  // Défense en profondeur : la nav ne pointe ici que pour Snytch.
  if (!isSnytchProject(current.slug)) {
    return <Notice body="Le suivi des vidéos n'est pas disponible pour ce projet." />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Mes vidéos
        </h1>
        <p className="text-sm text-slate-500">
          Le suivi de tes vidéos publiées : vues et gain par vidéo.
        </p>
      </header>

      {/* Décalage vues (limite scraper) — jamais présenté comme temps réel exact. */}
      <p className="flex items-start gap-1.5 text-xs text-slate-400">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
        Vues mises à jour régulièrement — un léger décalage avec la plateforme est
        normal (ce n&apos;est pas du temps réel exact).
      </p>

      {videos === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : videos.length === 0 ? (
        <Card data-testid="videos-empty">
          <CardContent className="space-y-2 py-10 text-center">
            <FilmIcon className="mx-auto size-8 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm font-medium text-slate-600">
              Aucune vidéo publiée pour l&apos;instant
            </p>
            <p className="text-sm text-slate-400">
              Dès que tu publies une vidéo, elle apparaît ici avec son suivi
              (vues + gain).
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {videos.map((v) => (
            <VideoRow key={v.id} v={v} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

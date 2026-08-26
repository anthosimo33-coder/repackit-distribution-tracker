"use client";

import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { useMyPublishedVideos } from "@/components/portal/creator-data";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatMoney, formatViews } from "@/lib/format-rate";
import { publishedAgo } from "@/lib/video-tracking";
import { isSnytchProject } from "@/lib/snytch-drive";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useLabel } from "@/lib/use-label";
import { useTranslations } from "next-intl";
import {
  CREATOR_VIDEO_FILTERS,
  countCreatorVideosByFilter,
  matchesCreatorVideoFilter,
  type CreatorVideoFilterKey,
} from "@/lib/creator-video-filters";
import {
  FilmIcon,
  CircleCheckIcon,
  ClockIcon,
  InfoIcon,
  CircleXIcon,
  RocketIcon,
  BadgeCheckIcon,
  VideoIcon,
  UsersIcon,
} from "lucide-react";

/**
 * « Mes vidéos » — suivi créatrice SNYTCH de TOUT le cycle de vie depuis la
 * soumission : en attente de validation, rejet (+ feedback), approuvé-à-publier,
 * en ligne (vues + gain plafonné 150 $, source unique = moteur paie). Filtre par
 * statut en tête (Toutes / En attente / Approuvé et en ligne / Rejeté), défaut
 * Toutes. PUREMENT en lecture → réutilisé tel quel en mode admin « voir l'espace
 * d'un créateur » (données scopées serveur via useMyPublishedVideos). Gate Snytch
 * par slug (défense en profondeur ; la nav ne pointe ici que pour Snytch).
 */

type Video = FunctionReturnType<
  typeof api.creatorVideos.listMyPublishedVideos
>[number];

const PLATFORM_STYLE: Record<string, string> = {
  TikTok: "bg-slate-900 text-white",
  Instagram: "bg-fuchsia-600 text-white",
  YouTube: "bg-red-600 text-white",
};

// Types de FORMAT lisibles (aligné sur le tableau de bord). Script → formatType
// null (pas de badge, le nom de campagne porte déjà le type).
const TYPE_LABELS: Record<string, string> = {
  carousel: "Carrousel",
  short: "Short",
  screenrecorder: "ScreenRecorder",
  custom: "Custom",
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

const CHIP_BASE =
  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold";

/** Suivi vues des vidéos EN LIGNE (published/paid). */
function TrackingChip({ status }: { status: "active" | "pending" }) {
  const tv = useTranslations("portal.videos");
  if (status === "active") {
    return (
      <span
        data-testid="tracking-active"
        className={cn(CHIP_BASE, "border-emerald-200 bg-emerald-50 text-emerald-700")}
      >
        <CircleCheckIcon className="size-3.5" />{tv("trackingActive")}</span>
    );
  }
  return (
    <span
      data-testid="tracking-pending"
      className={cn(CHIP_BASE, "border-amber-200 bg-amber-50 text-amber-700")}
    >
      <ClockIcon className="size-3.5" />{tv("viewsComputing")}</span>
  );
}

/** Badge de cycle de vie AVANT « en ligne réellement suivie » (attente/rejet/à publier). */
function StatusChip({ status }: { status: Video["status"] }) {
  const tv = useTranslations("portal.videos");
  if (status === "video_submitted") {
    return (
      <span
        data-testid="status-pending"
        className={cn(CHIP_BASE, "border-amber-200 bg-amber-50 text-amber-700")}
      >
        <ClockIcon className="size-3.5" />{tv("awaitingApproval")}</span>
    );
  }
  if (status === "video_rejected") {
    return (
      <span
        data-testid="status-rejected"
        className={cn(CHIP_BASE, "border-red-200 bg-red-50 text-red-700")}
      >
        <CircleXIcon className="size-3.5" />{tv("rejected")}</span>
    );
  }
  // to_publish
  return (
    <span
      data-testid="status-to-publish"
      className={cn(CHIP_BASE, "border-sky-200 bg-sky-50 text-sky-700")}
    >
      <RocketIcon className="size-3.5" />{tv("approvedToPublish")}</span>
  );
}

/** Bloc Vues + Gain — vidéos EN LIGNE uniquement (published/paid). */
function OnlineMetrics({ v, currency }: { v: Video; currency?: string | null }) {
  const tv = useTranslations("portal.videos");
  const loc = useIntlLocale();
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <p className="text-xs text-slate-400">{tv("views")}</p>
        <p className="text-lg font-semibold tabular-nums text-slate-900">
          {v.views === null ? "—" : formatViews(v.views, loc)}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs text-slate-400">{tv("gain")}</p>
        <p
          className={cn(
            "text-lg font-semibold tabular-nums",
            v.capped ? "text-emerald-600" : "text-slate-900",
          )}
        >
          {v.gain === null ? "—" : formatMoney(v.gain, currency, loc)}
        </p>
        {v.capped && (
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-600">{tv("maxGain")}</span>
        )}
      </div>
    </div>
  );
}

function VideoRow({
  v,
  now,
  currency,
}: {
  v: Video;
  now: number;
  currency?: string | null;
}) {
  const tv = useTranslations("portal.videos");
  const isOnline = v.status === "published" || v.status === "paid";
  return (
    <Card data-testid="video-row" data-status={v.status}>
      <CardContent className="space-y-3 py-4">
        {/* NOM DE CAMPAGNE / FORMAT — pour distinguer ses vidéos d'un coup d'œil
            (quel type de contenu était produit). Script → pas de badge de type. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-slate-900">
            {v.formatName}
          </span>
          {v.formatType && v.formatType !== "custom" && (
            <Badge variant="secondary" className="shrink-0">
              {TYPE_LABELS[v.formatType] ?? v.formatType}
            </Badge>
          )}
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {v.platforms.map((p) => (
              <PlatformBadge key={p} platform={p} />
            ))}
            {v.publishedAt !== null && (
              <span className="text-xs text-slate-400">
                Publié {publishedAgo(v.publishedAt, now)}
              </span>
            )}
            {v.status === "paid" && (
              <span
                className={cn(
                  CHIP_BASE,
                  "border-emerald-200 bg-emerald-50 text-emerald-700",
                )}
              >
                <BadgeCheckIcon className="size-3.5" />{tv("paid")}</span>
            )}
            {v.managedByAdmin && (
              <span
                data-testid="managed-video-chip"
                className={cn(
                  CHIP_BASE,
                  "border-slate-300 bg-slate-100 text-slate-600",
                )}
              >
                <UsersIcon className="size-3.5" />{tv("managedByTeam")}</span>
            )}
          </div>
          {isOnline && v.trackingStatus !== null ? (
            <TrackingChip status={v.trackingStatus} />
          ) : (
            <StatusChip status={v.status} />
          )}
        </div>

        {isOnline ? (
          <OnlineMetrics v={v} currency={currency} />
        ) : v.status === "video_rejected" ? (
          v.rejectionReason ? (
            <div className="rounded-md border border-red-100 bg-red-50/60 px-3 py-2">
              <p className="text-xs font-semibold text-red-700">{tv("rejectionReason")}</p>
              <p className="mt-0.5 text-sm text-slate-700">{v.rejectionReason}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{tv("rejectedHint")}</p>
          )
        ) : v.status === "to_publish" ? (
          v.managedByAdmin ? (
            <p className="text-sm text-slate-500">{tv("teamPublishes")}</p>
          ) : (
            <p className="text-sm text-slate-500">{tv("approvedHint")}</p>
          )
        ) : (
          // video_submitted
          <p className="flex items-center gap-1.5 text-sm text-slate-500">
            {v.hasSubmittedVideo && (
              <VideoIcon className="size-4 shrink-0 text-slate-400" />
            )}
            Vidéo soumise — en attente de la validation de l&apos;équipe.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Notice({ body }: { body: string }) {
  const tv = useTranslations("portal.videos");
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tv("title")}</h1>
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-500">
          {body}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterChips({
  active,
  counts,
  onChange,
}: {
  active: CreatorVideoFilterKey;
  counts: Record<CreatorVideoFilterKey, number>;
  onChange: (key: CreatorVideoFilterKey) => void;
}) {
  const tv = useTranslations("portal.videos");
  const tLabel = useLabel();
  return (
    <div
      role="tablist"
      aria-label={tv("filterAria")}
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
    >
      {CREATOR_VIDEO_FILTERS.map((f) => {
        const selected = f.key === active;
        return (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`videos-filter-${f.key}`}
            onClick={() => onChange(f.key)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {tLabel(f.labelKey)}
            <span
              className={cn(
                "ml-1.5 tabular-nums",
                selected ? "text-slate-300" : "text-slate-400",
              )}
            >
              {counts[f.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function VideosScreen() {
  const tv = useTranslations("portal.videos");
  const { current } = useCreatorProject();
  // Devise de la paie créatrices ($ Snytch ; null → sans symbole), threadée à la
  // ligne vidéo qui rend le gain.
  const payCurrency = current.payCurrency;
  const videos = useMyPublishedVideos(current.projectId);
  const [filter, setFilter] = useState<CreatorVideoFilterKey>("all");
  // Ancre temporelle figée au montage (relative time stable, pas d'appel impur
  // au render — cf react-hooks/purity).
  const [now] = useState(() => Date.now());

  const counts = useMemo(
    () => countCreatorVideosByFilter(videos ?? []),
    [videos],
  );
  const filtered = useMemo(
    () => (videos ?? []).filter((v) => matchesCreatorVideoFilter(v.status, filter)),
    [videos, filter],
  );

  // Défense en profondeur : la nav ne pointe ici que pour Snytch.
  if (!isSnytchProject(current.slug)) {
    return <Notice body={tv("unavailable")} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tv("title")}</h1>
        <p className="text-sm text-slate-500">{tv("subtitle")}</p>
      </header>

      {/* Décalage vues (limite scraper) — jamais présenté comme temps réel exact. */}
      <p className="flex items-start gap-1.5 text-xs text-slate-400">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" />{tv("viewsDelayHint")}</p>

      {videos === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : videos.length === 0 ? (
        <Card data-testid="videos-empty">
          <CardContent className="space-y-2 py-10 text-center">
            <FilmIcon className="mx-auto size-8 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm font-medium text-slate-600">{tv("emptyTitle")}</p>
            <p className="text-sm text-slate-400">{tv("emptyBody")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <FilterChips active={filter} counts={counts} onChange={setFilter} />
          {filtered.length === 0 ? (
            <Card data-testid="videos-filter-empty">
              <CardContent className="py-8 text-center text-sm text-slate-400">{tv("emptyFilter")}</CardContent>
            </Card>
          ) : (
            filtered.map((v) => (
              <VideoRow key={v.id} v={v} now={now} currency={payCurrency} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import {
  useArgentObservable,
  useMyAssignment,
} from "@/components/portal/creator-data";
import { useReadOnly, usePortalBase } from "@/components/portal/ViewAsContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeftIcon,
  CalendarIcon,
  ClipboardListIcon,
  ClockIcon,
  DownloadIcon,
} from "lucide-react";
import { ModelVideoEmbed } from "@/components/portal/ModelVideoEmbed";
import { FormatBriefPreview } from "@/components/formats/FormatBriefPreview";
import { EarningsCalculator } from "@/components/portal/EarningsCalculator";
import { PricingEstimator } from "@/components/portal/PricingEstimator";
import { AssignmentActions } from "@/components/portal/AssignmentActions";
import { MissionStepper } from "@/components/portal/MissionStepper";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import {
  ScriptDestinationZones,
  ScriptInstructionList,
} from "@/components/scripts/ScriptDestinationZones";
import { formatPlannedDay } from "@/lib/calendar-status";
import { formatMissionDate } from "@/components/portal/MissionListItem";
import { estimateMissionEarnings } from "@/lib/pricing-engine";
import { formatMoney } from "@/lib/format-rate";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useTranslations } from "next-intl";

/**
 * Fiche détail d'une mission — écran RÉUTILISÉ par le portail créateur normal ET
 * le mode admin « voir l'espace d'un créateur » (lecture seule).
 *
 * ── LA MISE EN PAGE ─────────────────────────────────────────────────────────
 * En tête : ce qu'on tourne, sur quel compte, pour quand, et combien ça paie.
 * Puis OÙ EN EST la mission (MissionStepper) et CE QU'IL FAUT FAIRE maintenant
 * (AssignmentActions) — les deux blocs qu'on vient chercher. Le script, les
 * consignes, les exemples et les assets suivent.
 *
 * Sur desktop, l'avancement, les actions, les vidéos modèles et la paie passent
 * dans une colonne de droite qui reste visible pendant qu'on lit le script. Sur
 * mobile, tout se lit dans une seule colonne, actions en haut.
 *
 * ⚠️ Deux colonnes, UNE seule instance de chaque bloc : les colonnes sont en
 * `display: contents` sur mobile, et l'ordre y est posé par `order-*`. Rendre
 * `AssignmentActions` deux fois (une par breakpoint) doublerait son état, ses
 * dialogues d'envoi et ses boutons.
 *
 * Données via useMyAssignment (getMyAssignment en normal, getAssignmentDetailAsAdmin
 * scopé serveur en view-as). En lecture seule, AssignmentActions ne montre que
 * l'ÉTAT du workflow.
 */
export default function AssignmentDetailScreen({
  assignmentId,
}: {
  assignmentId: Id<"assignments">;
}) {
  const ta = useTranslations("portal.assignmentDetail");
  const tm = useTranslations("portal.mission");
  const loc = useIntlLocale();
  const projectId = useCreatorProjectId();
  const payCurrency = useCreatorProject().current.payCurrency;
  const argent = useArgentObservable();
  const readOnly = useReadOnly();
  const base = usePortalBase();
  const data = useMyAssignment(projectId, assignmentId);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href={base}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />{ta("backToDashboard")}</Link>

      {data === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : data === null ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">{ta("notFound")}</CardContent>
        </Card>
      ) : (
        (() => {
          const a = data.assignment;
          const perVideo =
            argent && a.pricingSnapshot
              ? estimateMissionEarnings(a.pricingSnapshot, 0).fixed
              : 0;
          return (
            <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
              {/* ── Colonne gauche : ce qu'il faut produire. ── */}
              <div className="contents lg:block lg:space-y-6">
                <header className="order-1 space-y-3">
                  {/* Mission SCRIPT : NOM DE CAMPAGNE en titre — il dit le type de
                      contenu. Pour un FORMAT, nom + type sont déjà en tête du
                      brief (FormatBriefPreview) : pas de doublon. */}
                  {data.origin === "script" && (
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                      {data.formatName}
                    </h1>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {data.targets.map((t) => (
                      <span
                        key={t.platform}
                        className="inline-flex h-7 items-center rounded-full border border-slate-200 bg-white px-2.5 font-mono text-xs text-slate-700"
                      >
                        {t.platform}
                        {t.accountHandle ? ` ${t.accountHandle}` : ""}
                      </span>
                    ))}
                    {a.postDate != null && (
                      <span className="inline-flex h-7 items-center gap-1 rounded-full bg-slate-100 px-2.5 text-xs font-medium text-slate-700">
                        <CalendarIcon className="size-3.5" />
                        {tm("plannedOn", {
                          date: formatPlannedDay(a.postDate, loc, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          }),
                        })}
                      </span>
                    )}
                    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-slate-100 px-2.5 text-xs font-medium text-slate-700">
                      <ClockIcon className="size-3.5" />
                      {tm("dueBefore", { date: formatMissionDate(a.dueDate, loc) })}
                    </span>
                  </div>
                  {perVideo > 0 && (
                    <p className="text-sm text-slate-600">
                      {tm("earn", { amount: formatMoney(perVideo, payCurrency, loc) })}
                    </p>
                  )}
                </header>

                {/* Texte OVERLAY à incruster en haut de la vidéo — consigne
                    VISUELLE, distincte du texte à dire. Masqué si vide. */}
                {a.overlayText && (
                  <div className="order-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
                      <span aria-hidden>📌</span>{ta("overlayTop")}</div>
                    <p className="mt-1.5 text-base font-medium break-words text-amber-950">
                      « {a.overlayText} »
                    </p>
                    <p className="mt-1 text-xs text-amber-700/90">{ta("overlayHint")}</p>
                  </div>
                )}

                {/* Script monté OU brief de format. SNYTCH : deux zones de
                    destination (dans la vidéo / en description). */}
                <div className="order-5">
                  {data.assembledScript ? (
                    data.scriptZones ? (
                      <ScriptDestinationZones
                        videoBlocks={data.scriptZones.videoBlocks}
                        descriptionScript={data.scriptZones.descriptionScript}
                        instructions={data.scriptInstructions}
                      />
                    ) : (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">{ta("videoToShoot")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <SimpleMarkdown content={data.assembledScript} />
                          <ScriptInstructionList items={data.scriptInstructions} />
                        </CardContent>
                      </Card>
                    )
                  ) : data.format ? (
                    <FormatBriefPreview
                      format={data.format}
                      showRate={false}
                      currency={payCurrency}
                    />
                  ) : (
                    <Card>
                      <CardContent className="py-8 text-center text-sm text-slate-500">{ta("briefGone")}</CardContent>
                    </Card>
                  )}
                </div>

                {/* INSTRUCTIONS de l'équipe POUR la créatrice — consigne de
                    tournage/montage, distincte du script et de l'overlay. */}
                {a.instructions && (
                  <Card className="order-6 border-indigo-200 bg-indigo-50/50">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base text-indigo-900">
                        <ClipboardListIcon className="size-4 text-indigo-500" />{ta("instructions")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="whitespace-pre-wrap break-words text-sm text-indigo-950">
                        {a.instructions}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Assets de TOUS les dossiers liés (groupés si plusieurs). */}
                {data.assets && data.assets.folders.length > 0 && (
                  <Card className="order-8">
                    <CardHeader>
                      <CardTitle className="text-base">{ta("assets")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {data.assets.folders.map((folder) => (
                        <div key={folder.folderId} className="space-y-2">
                          {data.assets!.folders.length > 1 && (
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                              {folder.name}
                            </p>
                          )}
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {folder.items.map((asset) => (
                              <div key={asset.id} className="space-y-1.5">
                                <div className="aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                                  {asset.url &&
                                    (asset.contentType.startsWith("video/") ? (
                                      <video
                                        src={asset.url}
                                        controls
                                        preload="metadata"
                                        className="size-full object-cover"
                                      />
                                    ) : (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={asset.url}
                                        alt={asset.fileName}
                                        className="size-full object-cover"
                                      />
                                    ))}
                                </div>
                                {asset.url && (
                                  <a
                                    href={asset.url}
                                    download={asset.fileName}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                                  >
                                    <DownloadIcon className="size-3.5" />{ta("download")}</a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* ── Colonne droite : où on en est, quoi faire, les exemples. ── */}
              <div className="contents lg:sticky lg:top-6 lg:block lg:space-y-6">
                <Card className="order-2">
                  <CardHeader>
                    <CardTitle className="text-base">
                      {readOnly ? "Avancement" : ta("mySubmission")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <MissionStepper status={a.status} />
                    <AssignmentActions
                      assignment={a}
                      targets={data.targets}
                      projectId={projectId}
                      submittedVideoUrl={data.submittedVideoUrl}
                      submittedVideoMimeType={data.submittedVideoMimeType}
                      readOnly={readOnly}
                    />
                  </CardContent>
                </Card>

                {/* Vidéos à reproduire (liens modèles attachés par l'équipe). */}
                {a.modelVideos && a.modelVideos.length > 0 && (
                  <Card className="order-7">
                    <CardHeader>
                      <CardTitle className="text-base">{ta("modelVideos")}</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                      {a.modelVideos.map((mv) => (
                        <ModelVideoEmbed
                          key={mv.id}
                          video={{ url: mv.url, title: mv.title, note: mv.note }}
                        />
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Rémunération figée + calculateur. Masquée à l'observateur sans
                    le droit « Paiements » (une seule frontière argent). */}
                {argent && (
                  <Card className="order-9">
                    <CardHeader>
                      <CardTitle className="text-base">{ta("pay")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {a.pricingSnapshot ? (
                        <PricingEstimator snapshot={a.pricingSnapshot} currency={payCurrency} />
                      ) : (
                        <EarningsCalculator rate={a.rateSnapshot} currency={payCurrency} />
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

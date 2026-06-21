"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { detectInspirationType } from "@/lib/inspiration-url";
import { FormatBriefPreview } from "@/components/formats/FormatBriefPreview";
import { EarningsCalculator } from "@/components/portal/EarningsCalculator";
import { AssignmentActions } from "@/components/portal/AssignmentActions";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";

/**
 * P7 — fiche assignment côté créateur : brief complet (FormatBriefPreview,
 * showRate=false), rémunération depuis le rateSnapshot FIGÉ + calculateur, et
 * les actions (Je commence / soumission / resoumission). Isolé serveur :
 * getMyAssignment renvoie null si l'assignment n'est pas le mien.
 */
export default function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const projectId = useCreatorProjectId();
  const data = useQuery(
    api.assignments.getMyAssignment,
    projectId ? { projectId, id: id as Id<"assignments"> } : "skip",
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/app"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        Retour au tableau de bord
      </Link>

      {data === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : data === null ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            Cet assignment est introuvable.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {data.targets.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              <span>{data.targets.length > 1 ? "Cibles :" : "Cible :"}</span>
              {data.targets.map((t) => (
                <span key={t.platform} className="font-mono text-slate-700">
                  {t.platform}
                  {t.accountHandle ? ` ${t.accountHandle}` : ""}
                </span>
              ))}
            </div>
          )}

          {/* Actions (en haut : c'est l'action attendue du créateur) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ta soumission</CardTitle>
            </CardHeader>
            <CardContent>
              <AssignmentActions
                assignment={data.assignment}
                targets={data.targets}
                projectId={projectId!}
                submittedVideoUrl={data.submittedVideoUrl}
                submittedVideoMimeType={data.submittedVideoMimeType}
              />
            </CardContent>
          </Card>

          {/* Script monté (assignment de script) OU brief de format. Pour un
              script, le créateur ne voit que le texte fini — aucune brique,
              aucun tier, aucune campagne. */}
          {data.assembledScript ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vidéo à tourner</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleMarkdown content={data.assembledScript} />
              </CardContent>
            </Card>
          ) : data.format ? (
            <FormatBriefPreview format={data.format} showRate={false} />
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-slate-500">
                Le brief de ce format n&apos;est plus disponible.
              </CardContent>
            </Card>
          )}

          {/* Vidéos à reproduire (liens modèles attachés par l'admin). Masqué
              si aucune. Mobile-first : cartes pleine largeur, lien nouvel onglet. */}
          {data.assignment.modelVideos &&
            data.assignment.modelVideos.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Vidéos à reproduire
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {data.assignment.modelVideos.map((mv) => {
                    const platform =
                      detectInspirationType(mv.url)?.plateforme ?? "Lien";
                    return (
                      <a
                        key={mv.id}
                        href={mv.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:border-primary hover:bg-primary/5"
                      >
                        <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                          {platform}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 text-sm font-medium text-slate-900">
                            <span className="truncate">
                              {mv.title ?? mv.url}
                            </span>
                            <ExternalLinkIcon className="size-3.5 shrink-0 text-slate-400" />
                          </div>
                          {mv.note && (
                            <p className="mt-0.5 text-sm text-slate-500">
                              {mv.note}
                            </p>
                          )}
                        </div>
                      </a>
                    );
                  })}
                </CardContent>
              </Card>
            )}

          {/* Rémunération figée (rateSnapshot) + calculateur */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rémunération</CardTitle>
            </CardHeader>
            <CardContent>
              <EarningsCalculator rate={data.assignment.rateSnapshot} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

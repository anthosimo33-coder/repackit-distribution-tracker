"use client";

import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { useMyAssignment } from "@/components/portal/creator-data";
import { useReadOnly, usePortalBase } from "@/components/portal/ViewAsContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeftIcon, DownloadIcon, ExternalLinkIcon } from "lucide-react";
import { detectInspirationType } from "@/lib/inspiration-url";
import { FormatBriefPreview } from "@/components/formats/FormatBriefPreview";
import { EarningsCalculator } from "@/components/portal/EarningsCalculator";
import { PricingEstimator } from "@/components/portal/PricingEstimator";
import { AssignmentActions } from "@/components/portal/AssignmentActions";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";

/**
 * Fiche détail d'une mission — écran RÉUTILISÉ par le portail créateur normal ET
 * le mode admin « voir l'espace d'un créateur » (lecture seule). Brief complet
 * (FormatBriefPreview, showRate=false) ou script monté reçu par le créateur,
 * vidéos modèles, assets, rémunération figée. Données via useMyAssignment
 * (getMyAssignment en normal, getAssignmentDetailAsAdmin scopé serveur en
 * view-as). En lecture seule, AssignmentActions ne montre que l'ÉTAT du workflow
 * (aucune soumission/confirmation). Le lien retour pointe vers la base courante
 * ("/app" ou base view-as).
 */
export default function AssignmentDetailScreen({
  assignmentId,
}: {
  assignmentId: Id<"assignments">;
}) {
  const projectId = useCreatorProjectId();
  const readOnly = useReadOnly();
  const base = usePortalBase();
  const data = useMyAssignment(projectId, assignmentId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={base}
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

          {/* Soumission — en lecture seule, AssignmentActions ne rend que l'état
              du workflow (pas d'action mutatrice). */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {readOnly ? "Avancement" : "Ta soumission"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AssignmentActions
                assignment={data.assignment}
                targets={data.targets}
                projectId={projectId}
                submittedVideoUrl={data.submittedVideoUrl}
                submittedVideoMimeType={data.submittedVideoMimeType}
                readOnly={readOnly}
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

          {/* Assets à utiliser : fichiers de TOUS les dossiers liés par l'admin
              (groupés par dossier si plusieurs). Le créateur ne voit QUE les
              dossiers de SON assignment. Masqué si aucun/vides. */}
          {data.assets && data.assets.folders.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Assets à utiliser</CardTitle>
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
                              <DownloadIcon className="size-3.5" />
                              Télécharger
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Rémunération figée + calculateur. Populations DISJOINTES :
              - mission de campagne de script → pricingSnapshot (modèle v2 :
                fixe/vidéo + CPM) ; rateSnapshot y est un placeholder {basePerPost:0} ;
              - mission de format → rateSnapshot réel (modèle legacy, inchangé). */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rémunération</CardTitle>
            </CardHeader>
            <CardContent>
              {data.assignment.pricingSnapshot ? (
                <PricingEstimator snapshot={data.assignment.pricingSnapshot} />
              ) : (
                <EarningsCalculator rate={data.assignment.rateSnapshot} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

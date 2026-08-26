"use client";

import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { useMyAssignment } from "@/components/portal/creator-data";
import { useReadOnly, usePortalBase } from "@/components/portal/ViewAsContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeftIcon, ClipboardListIcon, DownloadIcon } from "lucide-react";
import { ModelVideoEmbed } from "@/components/portal/ModelVideoEmbed";
import { FormatBriefPreview } from "@/components/formats/FormatBriefPreview";
import { EarningsCalculator } from "@/components/portal/EarningsCalculator";
import { PricingEstimator } from "@/components/portal/PricingEstimator";
import { AssignmentActions } from "@/components/portal/AssignmentActions";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { ScriptDestinationZones } from "@/components/scripts/ScriptDestinationZones";
import { useTranslations } from "next-intl";

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
  const ta = useTranslations("portal.assignmentDetail");
  const projectId = useCreatorProjectId();
  // Devise de la paie créatrices ($ Snytch ; null → sans symbole), passée aux
  // estimateurs de rému (feuilles sans contexte).
  const payCurrency = useCreatorProject().current.payCurrency;
  const readOnly = useReadOnly();
  const base = usePortalBase();
  const data = useMyAssignment(projectId, assignmentId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
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
        <div className="space-y-6">
          {/* En-tête de mission SCRIPT : NOM DE CAMPAGNE (ex. « Format 3 - POV
              Demo ») — la première chose que la créatrice voit, pour savoir quel
              type de contenu produire (un carrousel, un POV et une pensée
              relatable ne se tournent pas pareil). Le nom de campagne porte déjà
              le type (pas de champ dédié). Pour un FORMAT, le nom + type sont déjà
              affichés en tête du brief (FormatBriefPreview) → pas de doublon ici. */}
          {data.origin === "script" && (
            <header>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                {data.formatName}
              </h1>
            </header>
          )}

          {data.targets.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              <span>{data.targets.length > 1 ? ta("targets") : ta("target")}</span>
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
                {readOnly ? "Avancement" : ta("mySubmission")}
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

          {/* Texte OVERLAY à incruster en haut de la vidéo (consigne admin au
              niveau de l'assignment). AU-DESSUS du hook, encart distinct : c'est
              une consigne VISUELLE (à afficher à l'écran), pas un texte à lire.
              Masqué si vide. Mobile : pleine largeur, texte qui passe à la ligne. */}
          {data.assignment.overlayText && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
                <span aria-hidden>📌</span>{ta("overlayTop")}</div>
              <p className="mt-1.5 text-base font-medium break-words text-amber-950">
                « {data.assignment.overlayText} »
              </p>
              <p className="mt-1 text-xs text-amber-700/90">{ta("overlayHint")}</p>
            </div>
          )}

          {/* Script monté (assignment de script) OU brief de format. Pour un
              script, le créateur ne voit que le texte fini — aucune brique,
              aucun tier, aucune campagne. SNYTCH : le script est éclaté en DEUX
              zones de destination (🎬 dans la vidéo = hook+flux / 📝 en
              description = cta) pour lever la confusion « qu'est-ce qui va où ».
              Hors Snytch (scriptZones absent) : carte unique inchangée. */}
          {data.assembledScript ? (
            data.scriptZones ? (
              <ScriptDestinationZones
                videoBlocks={data.scriptZones.videoBlocks}
                descriptionScript={data.scriptZones.descriptionScript}
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{ta("videoToShoot")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleMarkdown content={data.assembledScript} />
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

          {/* INSTRUCTIONS libres de l'admin POUR la créatrice — consigne de
              tournage/montage, DISTINCTE du script (texte à publier) et de
              l'overlay (texte à incruster). Encart accentué, entre le script et
              les vidéos modèles. Masqué si vide (comme overlay/assets). Retours à
              la ligne préservés (whitespace-pre-wrap). */}
          {data.assignment.instructions && (
            <Card className="border-indigo-200 bg-indigo-50/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-indigo-900">
                  <ClipboardListIcon className="size-4 text-indigo-500" />{ta("instructions")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap break-words text-sm text-indigo-950">
                  {data.assignment.instructions}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Vidéos à reproduire (liens modèles attachés par l'admin). Masqué
              si aucune. Mobile-first : cartes pleine largeur, lien nouvel onglet. */}
          {data.assignment.modelVideos &&
            data.assignment.modelVideos.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{ta("modelVideos")}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  {data.assignment.modelVideos.map((mv) => (
                    <ModelVideoEmbed
                      key={mv.id}
                      video={{ url: mv.url, title: mv.title, note: mv.note }}
                    />
                  ))}
                </CardContent>
              </Card>
            )}

          {/* Assets à utiliser : fichiers de TOUS les dossiers liés par l'admin
              (groupés par dossier si plusieurs). Le créateur ne voit QUE les
              dossiers de SON assignment. Masqué si aucun/vides. */}
          {data.assets && data.assets.folders.length > 0 && (
            <Card>
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

          {/* Rémunération figée + calculateur. Populations DISJOINTES :
              - mission de campagne de script → pricingSnapshot (modèle v2 :
                fixe/vidéo + CPM) ; rateSnapshot y est un placeholder {basePerPost:0} ;
              - mission de format → rateSnapshot réel (modèle legacy, inchangé). */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{ta("pay")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.assignment.pricingSnapshot ? (
                <PricingEstimator
                  snapshot={data.assignment.pricingSnapshot}
                  currency={payCurrency}
                />
              ) : (
                <EarningsCalculator
                  rate={data.assignment.rateSnapshot}
                  currency={payCurrency}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

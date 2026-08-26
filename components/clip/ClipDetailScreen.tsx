"use client";

import Link from "next/link";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { ArrowLeftIcon, ClipboardListIcon, TypeIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useClipperProject } from "@/components/clip/ClipperProjectProvider";
import { useClipperBase, useMyClip } from "@/components/clip/clipper-data";
import { useReadOnly } from "@/components/portal/ViewAsContext";
import { ScriptDestinationZones } from "@/components/scripts/ScriptDestinationZones";
import { ModelVideoEmbed } from "@/components/portal/ModelVideoEmbed";
import { ClipPublishForm } from "@/components/clip/ClipPublishForm";
import { VideoUploader, type UploadedVideo } from "@/components/VideoUploader";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { convexErrorMessage } from "@/lib/convex-error";
import { ASSIGNMENT_STATUS, type AssignmentStatus } from "@/lib/assignment-status";
import { formatDate } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useLabel } from "@/lib/use-label";

/**
 * FICHE D'UN CLIP — le script à monter, les consignes, le dépôt du montage, et
 * (quand la vidéo est validée) la publication.
 *
 * Écran DÉDIÉ plutôt que réutilisation d'`AssignmentDetailScreen` : ce dernier
 * est câblé sur les queries créatrice et sur son allowlist. Le réutiliser
 * demanderait la couche d'indirection du mode « voir comme » pour un écran qui
 * ne montre ni rému ni estimation de gains. On réutilise les FEUILLES —
 * `ScriptDestinationZones`, `VideoExample`, `VideoUploader` — qui sont
 * exactement ce qui a de la valeur.
 */
export function ClipDetailScreen({ clipId }: { clipId: Id<"assignments"> }) {
  const label = useLabel();
  const loc = useIntlLocale();
  const { projectId } = useClipperProject();
  const readOnly = useReadOnly();
  const base = useClipperBase();
  const clip = useMyClip(projectId, clipId);
  const start = useMutation(api.assignments.startClip);
  const submit = useMutation(api.assignments.submitClipVideo);

  if (clip === undefined) return <Skeleton className="h-64 w-full" />;
  if (clip === null) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <p className="text-sm text-slate-500">Ce clip est introuvable.</p>
          <Link
            href={base}
            className="inline-flex h-8 items-center rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"
          >
            Retour à mes clips
          </Link>
        </CardContent>
      </Card>
    );
  }

  const statut = clip.status as AssignmentStatus;
  const badge = ASSIGNMENT_STATUS[statut];
  // En OBSERVATION, aucun des trois gestes du clippeur n'est rendu (démarrer,
  // envoyer le montage, publier). Le serveur les refuse déjà à une session
  // admin ; ne pas les rendre évite d'annoncer une action qui échouerait.
  const peutDeposer =
    !readOnly &&
    (statut === "todo" ||
      statut === "in_progress" ||
      statut === "video_rejected");

  async function handleStart() {
    try {
      await start({ projectId, id: clipId });
    } catch (e) {
      toast.error(convexErrorMessage(e, "Impossible de démarrer ce clip"));
    }
  }

  async function handleUploaded(v: UploadedVideo) {
    try {
      await submit({
        projectId,
        id: clipId,
        storageId: v.storageId,
        mimeType: v.mimeType,
      });
      toast.success("Montage envoyé — un admin le relit avant publication.");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de l'envoi"));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href={base}
          className="-ml-2 inline-flex items-center rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeftIcon className="mr-1 size-4" />
          Mes clips
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={badge?.className}>
          {badge ? label(badge.labelKey) : statut}
        </Badge>
        {clip.dueDate !== undefined && (
          <span className="text-xs text-slate-500">
            à rendre le {formatDate(clip.dueDate, loc)}
          </span>
        )}
      </div>

      {/* Dit UNE fois ce qui manque, plutôt que trois emplacements vides. */}
      {readOnly && (
        <p className="text-xs text-slate-500">
          Observation — les gestes du clippeur (démarrer, envoyer le montage,
          publier) ne sont pas rendus ici.
        </p>
      )}

      {/* Cibles. Le clip ne sort PUBLIÉ que quand TOUTES ont un lien (B5) :
          l'écran les nomme donc dès maintenant, pas seulement au moment de
          coller. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Où ça sort</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {clip.targets.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune cible.</p>
          ) : (
            clip.targets.map((t) => (
              <div
                key={`${t.platform}-${t.accountHandle ?? ""}`}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="text-slate-600">
                  {t.platform}
                  {t.accountHandle ? (
                    <span className="ml-1 font-mono text-slate-400">
                      {t.accountHandle}
                    </span>
                  ) : null}
                </span>
                {t.publishedUrl ? (
                  <a
                    href={t.publishedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary underline"
                  >
                    Voir le post
                  </a>
                ) : (
                  <span className="text-xs text-slate-400">pas encore publié</span>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* TEXTE À INCRUSTER — distinct du script (à dire/écrire) : le confondre
          fait rater le montage. */}
      {clip.overlayText && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-900">
              <TypeIcon className="size-4 text-amber-500" />
              Texte à incruster
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-amber-900">
              {clip.overlayText}
            </p>
          </CardContent>
        </Card>
      )}

      {/* SCRIPT MONTÉ. Le clippeur reçoit le TEXTE, jamais la décomposition
          (briques, tier, campagne) : elle sert à l'anti-coordination. */}
      {clip.scriptZones ? (
        <ScriptDestinationZones
          videoBlocks={clip.scriptZones.videoBlocks}
          descriptionScript={clip.scriptZones.descriptionScript}
        />
      ) : clip.assembledScript ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Script à monter</CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleMarkdown content={clip.assembledScript} />
          </CardContent>
        </Card>
      ) : null}

      {clip.instructions && (
        <Card className="border-indigo-200 bg-indigo-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-indigo-900">
              <ClipboardListIcon className="size-4 text-indigo-500" />
              Consignes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-indigo-900">
              {clip.instructions}
            </p>
          </CardContent>
        </Card>
      )}

      {clip.modelVideos && clip.modelVideos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vidéos à reproduire</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {clip.modelVideos.map((mv) => (
              <ModelVideoEmbed
                key={mv.id}
                video={{ url: mv.url, title: mv.title, note: mv.note }}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* RETOUR DE REVUE — rendu EN ENTIER, c'est le seul contenu utile d'un
          refus. */}
      {statut === "video_rejected" && clip.videoReviewFeedback && (
        <Card className="border-rose-200 bg-rose-50/60">
          <CardHeader>
            <CardTitle className="text-base text-rose-900">
              Montage à refaire
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-rose-900">
              {clip.videoReviewFeedback}
            </p>
          </CardContent>
        </Card>
      )}

      {statut === "todo" && !readOnly && (
        <Button onClick={handleStart} className="w-full">
          Je commence
        </Button>
      )}

      {peutDeposer && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {statut === "video_rejected"
                ? "Renvoyer le montage"
                : "Envoyer le montage"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <VideoUploader
              onUploaded={handleUploaded}
              title="Glisse ton montage ici"
            />
            <p className="text-xs text-slate-500">
              Ta vidéo NON publiée. Un admin la relit ; une fois validée, tu
              pourras coller le lien du post.
            </p>
          </CardContent>
        </Card>
      )}

      {statut === "to_publish" && !readOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publier</CardTitle>
          </CardHeader>
          <CardContent>
            <ClipPublishForm
              clipId={clipId}
              targets={clip.targets.map((t) => ({
                platform: t.platform,
                accountHandle: t.accountHandle,
              }))}
            />
          </CardContent>
        </Card>
      )}

      {statut === "video_submitted" && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-slate-500">
            Montage envoyé — en attente de relecture.
          </CardContent>
        </Card>
      )}

      {clip.submittedVideoUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mon montage</CardTitle>
          </CardHeader>
          <CardContent>
            <video
              src={clip.submittedVideoUrl}
              controls
              className="w-full rounded-md"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

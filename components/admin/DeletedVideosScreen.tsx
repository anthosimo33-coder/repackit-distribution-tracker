"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FunctionReturnType } from "convex/server";
import { DownloadIcon, Link2Icon, Loader2Icon, TrashIcon } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StreamPlayer } from "@/components/formats/StreamPlayer";
import { VideoExample } from "@/components/formats/VideoExample";
import { useVideoDownload } from "@/components/admin/use-video-download";
import { ASSIGNMENT_STATUS, type AssignmentStatus } from "@/lib/assignment-status";
import { DELETED_VIDEO_RETENTION_DAYS, joursAvantEffacement } from "@/lib/assignment-video";
import { submittedVideoFilename } from "@/lib/video-download";
import { useLabel } from "@/lib/use-label";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";
import { cn } from "@/lib/utils";

type DeletedVideo = FunctionReturnType<typeof api.deletedVideos.listDeletedVideos>[number];

/** Effacement imminent : la carte le signale en ambre. */
const JOURS_ALERTE = 3;

/**
 * ÉCRAN « VIDÉOS SUPPRIMÉES » (Production) — les vidéos des missions supprimées,
 * gardées DELETED_VIDEO_RETENTION_DAYS jours (convex/deletedVideos). Pour
 * chacune : télécharger, ou la RATTACHER à une mission de la même créatrice qui
 * n'a encore rien envoyé — elle reprend alors le circuit normal (Validation).
 *
 * Réservé à qui peut supprimer une mission (bloc `assignments.manage`, garde de
 * la page + du serveur), dans son périmètre de créatrices.
 */
export function DeletedVideosScreen() {
  const tr = useTranslations("admin.assignments.DeletedVideosPage");
  const rows = useProjectQuery(api.deletedVideos.listDeletedVideos, {});
  const [now] = useState(() => Date.now());
  const [attach, setAttach] = useState<DeletedVideo | null>(null);

  return (
    <div className="space-y-4 sm:space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{tr("titre")}</h1>
        <p className="max-w-2xl text-sm text-slate-500">{tr("intro", { jours: DELETED_VIDEO_RETENTION_DAYS })}</p>
      </header>

      {rows === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-slate-500" data-testid="deleted-videos-empty">
            <TrashIcon className="mx-auto mb-2 size-6 text-slate-300" />
            {tr("aucune", { jours: DELETED_VIDEO_RETENTION_DAYS })}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <DeletedVideoCard key={r._id} row={r} now={now} onAttach={() => setAttach(r)} />
          ))}
        </div>
      )}

      <AttachVideoDialog row={attach} onClose={() => setAttach(null)} />
    </div>
  );
}

function DeletedVideoCard({ row, now, onAttach }: { row: DeletedVideo; now: number; onAttach: () => void }) {
  const tr = useTranslations("admin.assignments.DeletedVideosPage");
  const tLabel = useLabel();
  const loc = useIntlLocale();
  const [unreadable, setUnreadable] = useState(false);
  const jours = joursAvantEffacement(row.purgeAfter, now);
  const creatorName = row.creatorName ?? tr("createatriceInconnue");
  const filename = submittedVideoFilename({
    creatorName,
    label: row.campaignName ?? "",
    mimeType: row.mimeType,
  });
  const { downloading, onDownload } = useVideoDownload(row.url, filename, tr("telechargementOuvertDansOnglet"));
  const statut = tLabel(
    (ASSIGNMENT_STATUS[row.statusAtDeletion as AssignmentStatus] ?? ASSIGNMENT_STATUS.todo).labelKey,
  );
  const quand = new Date(row.deletedAt).toLocaleString(loc, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Card data-testid={`deleted-video-${row.assignmentId}`}>
      <CardContent className="space-y-3 p-4">
        <div>
          {row.streamUid && (row.streamStatus === "ready" || row.streamStatus === "processing") ? (
            <StreamPlayer uid={row.streamUid} status={row.streamStatus} />
          ) : row.url && row.storageId ? (
            <VideoExample
              example={{ kind: "file", storageId: row.storageId, title: "", mimeType: row.mimeType ?? "video/mp4", url: row.url }}
              onUnreadable={() => setUnreadable(true)}
            />
          ) : (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-400">
              {tr("apercuIndisponible")}
            </div>
          )}
        </div>

        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-slate-400">{tr("createatrice")}</dt>
          <dd className="min-w-0 break-words font-medium text-slate-900">{creatorName}</dd>
          <dt className="text-slate-400">{tr("compte")}</dt>
          <dd className="min-w-0 break-all font-mono text-xs leading-5 text-slate-600">
            {row.comptes.length === 0 ? "—" : row.comptes.map((c) => `${c.handle} (${c.platform})`).join(", ")}
          </dd>
          <dt className="text-slate-400">{tr("campagne")}</dt>
          <dd className="min-w-0 break-words text-slate-700">{row.campaignName ?? "—"}</dd>
          <dt className="text-slate-400">{tr("supprimeeLe")}</dt>
          <dd className="min-w-0 text-slate-700" data-testid="deleted-video-when">
            {quand}
            <span className="block text-xs text-slate-500">
              {tr("par", { qui: row.deletedByName ?? tr("auteurInconnu") })} · {tr("statutAlors", { statut })}
            </span>
          </dd>
        </dl>

        <p
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs font-medium",
            jours <= JOURS_ALERTE ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600",
          )}
          data-testid="deleted-video-days-left"
        >
          {jours === 0 ? tr("effaceeAujourdhui") : tr("joursRestants", { count: jours })}
        </p>

        {unreadable && <p className="text-xs text-amber-800">{tr("illisibleIci")}</p>}

        <div className="flex flex-col gap-2 sm:flex-row">
          {row.url ? (
            <a
              href={row.url}
              download={filename}
              onClick={onDownload}
              aria-disabled={downloading}
              data-testid="deleted-video-download"
              className={cn(buttonVariants({ variant: "outline" }), "min-h-11 flex-1 sm:min-h-0")}
            >
              {downloading ? <Loader2Icon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
              {tr("telecharger")}
            </a>
          ) : null}
          <Button className="min-h-11 flex-1 sm:min-h-0" onClick={onAttach} data-testid="deleted-video-attach">
            <Link2Icon className="size-4" />
            {tr("rattacher")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * RATTACHER À UNE MISSION — les missions de la même créatrice qui n'ont encore
 * rien envoyé. S'il n'y en a pas, la fenêtre dit pourquoi (fichier d'origine
 * absent, créatrice supprimée, missions toutes déjà envoyées ou terminées).
 */
function AttachVideoDialog({ row, onClose }: { row: DeletedVideo | null; onClose: () => void }) {
  const tr = useTranslations("admin.assignments.DeletedVideosPage");
  const tLabel = useLabel();
  const loc = useIntlLocale();
  const showError = useConvexError();
  const router = useRouter();
  const projectPath = useProjectPath();
  const options = useProjectQuery(api.deletedVideos.attachOptions, row ? { id: row._id } : "skip");
  const attachToMission = useProjectMutation(api.deletedVideos.attachToMission);
  const [choix, setChoix] = useState<Id<"assignments"> | null>(null);
  const [busy, setBusy] = useState(false);

  function fermer() {
    setChoix(null);
    onClose();
  }

  async function confirmer() {
    if (!row || !choix) return;
    setBusy(true);
    try {
      await attachToMission({ id: row._id, assignmentId: choix });
      toast.success(tr("rattachee"), {
        action: { label: tr("ouvrirValidation"), onClick: () => router.push(projectPath("/validation")) },
      });
      fermer();
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setBusy(false);
    }
  }

  const jour = (ms: number) => new Date(ms).toLocaleDateString(loc, { weekday: "short", day: "2-digit", month: "2-digit" });

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(o) => {
        if (!o && !busy) fermer();
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="attach-dialog">
        <DialogHeader>
          <DialogTitle>{tr("rattacherTitre")}</DialogTitle>
          <DialogDescription>
            {tr("rattacherIntro", { createatrice: row?.creatorName ?? tr("createatriceInconnue") })}
          </DialogDescription>
        </DialogHeader>

        {options === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : options.blocage !== null || options.missions.length === 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="attach-impossible">
            {options.blocage === "fichier_absent"
              ? tr("impossibleFichierAbsent")
              : options.blocage === "createatrice_absente"
                ? tr("impossibleCreatriceSupprimee")
                : tr("impossibleAucuneMission", { envoyees: options.dejaUneVideo, terminees: options.terminees })}
          </p>
        ) : (
          <fieldset className="max-h-80 space-y-2 overflow-y-auto">
            <legend className="sr-only">{tr("choisirUneMission")}</legend>
            {options.missions.map((m) => {
              const statut = tLabel((ASSIGNMENT_STATUS[m.status as AssignmentStatus] ?? ASSIGNMENT_STATUS.todo).labelKey);
              return (
                <label
                  key={m._id}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-sm",
                    choix === m._id ? "border-primary bg-primary/5" : "border-slate-200",
                  )}
                >
                  <input
                    type="radio"
                    name="mission"
                    className="mt-1"
                    checked={choix === m._id}
                    onChange={() => setChoix(m._id)}
                  />
                  <span className="min-w-0">
                    <span className="block break-words font-medium text-slate-900">
                      {m.postDate ? tr("missionDu", { jour: jour(m.postDate) }) : tr("missionSansDate")} ·{" "}
                      {m.campaignName ?? "—"}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {statut} · {tr("echeance", { jour: jour(m.dueDate) })}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        <p className="text-xs text-slate-500">{tr("rattacherSuite")}</p>

        <DialogFooter>
          <Button variant="outline" onClick={fermer} disabled={busy}>
            {tr("annuler")}
          </Button>
          <Button onClick={() => void confirmer()} disabled={busy || choix === null} data-testid="attach-confirm">
            {busy && <Loader2Icon className="size-4 animate-spin" />}
            {tr("rattacherConfirmer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

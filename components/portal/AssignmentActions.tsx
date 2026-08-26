"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VideoUploader, type UploadedVideo } from "@/components/VideoUploader";
import { VideoExample } from "@/components/formats/VideoExample";
import { StreamPlayer } from "@/components/formats/StreamPlayer";
import {
  Loader2Icon,
  PlayIcon,
  UploadIcon,
  SendIcon,
  ClockIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useConvexError } from "@/lib/use-convex-error";
import { detectInspirationType } from "@/lib/inspiration-url";
import { useTranslations } from "next-intl";

/**
 * Workflow EN DEUX TEMPS côté créateur :
 *   todo → « Je commence » → in_progress
 *   → « Soumettre ma vidéo » (upload MP4 modal) → video_submitted (en revue)
 *   → [refus] video_rejected (feedback) → re-upload → video_submitted
 *   → [validée] to_publish → publie sur CHAQUE plateforme + colle les URLs → published.
 * Le PAIEMENT se déclenche à `published` (confirmPublication), 1 base PAR POST.
 */

type Platform = "TikTok" | "Instagram" | "YouTube";
type Target = {
  platform: Platform;
  accountHandle: string | null;
  publishedUrl: string | null;
  publishedAt: number | null;
};

/** Bouton d'action TACTILE : pleine largeur + 44px sur mobile, normal en desktop. */
const ACTION_BTN = "h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm";

function placeholderFor(p: Platform): string {
  if (p === "TikTok") return "https://www.tiktok.com/@toi/video/…";
  if (p === "YouTube") return "https://www.youtube.com/watch?v=…";
  return "https://www.instagram.com/p/…";
}

export function AssignmentActions({
  assignment,
  targets,
  projectId,
  submittedVideoUrl,
  submittedVideoMimeType,
  readOnly = false,
}: {
  assignment: Doc<"assignments">;
  targets: Target[];
  projectId: Id<"projects">;
  submittedVideoUrl?: string | null;
  submittedVideoMimeType?: string | null;
  /** Admin view-as : aucune action ; l'état du workflow est rendu en lecture. */
  readOnly?: boolean;
}) {
  const showError = useConvexError();
  const t = useTranslations("portal");
  const start = useMutation(api.assignments.startAssignment);
  const submitVideo = useMutation(api.assignments.submitVideo);
  const confirmPublication = useMutation(api.assignments.confirmPublication);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const s = assignment.status;
  // Compte GÉRÉ par l'équipe : la créatrice ne soumet ni ne publie rien (l'admin
  // le fait). Rendu en LECTURE seule + marqueur, quel que soit readOnly.
  const managed = assignment.managedByAdmin === true;

  async function handleStart() {
    setBusy(true);
    try {
      await start({ projectId, id: assignment._id });
      toast.success(t("assignment.started"));
    } catch (e) {
      toast.error(showError(e, t("assignment.startFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function handleUploaded(v: UploadedVideo) {
    setBusy(true);
    try {
      await submitVideo({
        projectId,
        id: assignment._id,
        storageId: v.storageId,
        mimeType: v.mimeType,
      });
      setUploadOpen(false);
      toast.success(t("assignment.videoSent"));
    } catch (e) {
      toast.error(showError(e, t("assignment.videoSendFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    // Garde client : chaque URL doit correspondre à SA plateforme (le serveur
    // revalide de toute façon).
    for (const t of targets) {
      const val = (urls[t.platform] ?? "").trim();
      const detected = val ? detectInspirationType(val) : null;
      if (!detected || detected.plateforme !== t.platform) {
        toast.error(`L'URL pour ${t.platform} ne correspond pas à cette plateforme.`);
        return;
      }
    }
    setBusy(true);
    try {
      await confirmPublication({
        projectId,
        id: assignment._id,
        urls: targets.map((t) => ({
          platform: t.platform,
          url: (urls[t.platform] ?? "").trim(),
        })),
      });
      toast.success(t("assignment.published"));
      setUrls({});
    } catch (err) {
      toast.error(showError(err, t("assignment.publishFailed")));
    } finally {
      setBusy(false);
    }
  }

  const streamUid = assignment.submittedVideoStreamUid;
  const streamStatus = assignment.submittedVideoStreamStatus;
  const myVideoPreview =
    streamUid && (streamStatus === "ready" || streamStatus === "processing") ? (
      // Cloudflare Stream a transcodé ta vidéo → tu la revois lisible (HEVC
      // inclus), même si ton .mov ne s'ouvrait pas dans le navigateur.
      <StreamPlayer
        uid={streamUid}
        status={streamStatus}
        title={t("assignment.myVideo")}
      />
    ) : assignment.submittedVideoStorageId && submittedVideoUrl !== undefined ? (
      <VideoExample
        example={{
          kind: "file",
          storageId: assignment.submittedVideoStorageId,
          title: t("assignment.myVideo"),
          mimeType: submittedVideoMimeType ?? "video/mp4",
          url: submittedVideoUrl ?? null,
        }}
      />
    ) : null;

  // ── Compte GÉRÉ par l'équipe (LECTURE SEULE + marqueur) ─────────────────────
  // La créatrice SUIT sa vidéo (script au-dessus, post + perfs dans « Mes
  // vidéos ») mais ne soumet ni ne publie RIEN : l'équipe s'en charge. Aucune
  // action mutatrice ; on montre le marqueur « géré par l'équipe » + les liens
  // publiés le cas échéant. Branche AVANT readOnly et le rendu normal → le
  // chemin créateur classique reste strictement inchangé.
  if (managed) {
    const publishedTargets = targets.filter((t) => t.publishedUrl);
    const isOnline = s === "published" || s === "paid";
    return (
      <div className="space-y-3" data-testid="managed-assignment-actions">
        <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
          <UsersIcon className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <span>
            <span className="font-medium text-slate-800">{t("assignment.managedBadge2")}</span>{" "}
            — l&apos;équipe publie ce contenu. Tu n&apos;as rien à soumettre ni à
            publier ; le post et ses performances apparaîtront dans « Mes
            vidéos ».
          </span>
        </div>
        {isOnline && publishedTargets.length > 0 && (
          <div className="space-y-1">
            {publishedTargets.map((t) => (
              <a
                key={t.platform}
                href={t.publishedUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                Voir le post {t.platform}
                <ExternalLinkIcon className="size-3.5" />
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Admin view-as (LECTURE SEULE) ──────────────────────────────────────────
  // Aucune action : on montre l'ÉTAT du workflow (où en est le créateur) +, le
  // cas échéant, la vidéo soumise et les liens publiés. Les boutons/formulaires
  // mutateurs (commencer, soumettre, confirmer) sont absents. Branche placée
  // AVANT le rendu normal → le chemin créateur reste strictement inchangé.
  if (readOnly) {
    const publishedTargets = targets.filter((t) => t.publishedUrl);
    return (
      <div className="space-y-3">
        {s === "todo" && (
          <ReadOnlyState tone="slate" label={t("assignment.ro.todo")} />
        )}
        {s === "in_progress" && (
          <ReadOnlyState tone="slate" label={t("assignment.ro.inProgress")} />
        )}
        {s === "video_submitted" && (
          <>
            <ReadOnlyState tone="amber" label={t("assignment.ro.submitted")} />
            {myVideoPreview}
          </>
        )}
        {s === "video_rejected" && (
          <>
            {assignment.videoReviewFeedback && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <p className="font-semibold">{t("assignment.redoTitle")}</p>
                <p>{assignment.videoReviewFeedback}</p>
              </div>
            )}
            {myVideoPreview}
            <ReadOnlyState tone="slate" label={t("assignment.ro.resubmit")} />
          </>
        )}
        {s === "to_publish" && (
          <ReadOnlyState
            tone="emerald"
            label={t("assignment.ro.toPublish")}
          />
        )}
        {(s === "published" || s === "paid") && (
          <>
            <ReadOnlyState
              tone="emerald"
              label={s === "paid" ? t("assignment.publishedPaid") : t("assignment.publishedOnly")}
            />
            {publishedTargets.map((t) => (
              <a
                key={t.platform}
                href={t.publishedUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                Voir le post {t.platform}
                <ExternalLinkIcon className="size-3.5" />
              </a>
            ))}
          </>
        )}
      </div>
    );
  }

  const uploadModal = (
    <Dialog open={uploadOpen} onOpenChange={(o) => !busy && setUploadOpen(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("assignment.uploadTitle")}</DialogTitle>
          <DialogDescription>
            {t("assignment.uploadHint", { count: targets.length })}
          </DialogDescription>
        </DialogHeader>
        <VideoUploader
          onUploaded={handleUploaded}
          disabled={busy}
          title={t("assignment.dropHere")}
        />
      </DialogContent>
    </Dialog>
  );

  // ── todo ───────────────────────────────────────────────────────────────────
  if (s === "todo") {
    return (
      <Button onClick={handleStart} disabled={busy} className={ACTION_BTN}>
        {busy ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <PlayIcon className="mr-2 size-4" />
        )}
        Je commence
      </Button>
    );
  }

  // ── in_progress → soumettre la vidéo ───────────────────────────────────────
  if (s === "in_progress") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">{t("assignment.shootHint")}</p>
        <Button
          onClick={() => setUploadOpen(true)}
          disabled={busy}
          className={ACTION_BTN}
        >
          <UploadIcon className="mr-2 size-4" />{t("assignment.submitMine")}</Button>
        {uploadModal}
      </div>
    );
  }

  // ── video_submitted → en attente ───────────────────────────────────────────
  if (s === "video_submitted") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          <ClockIcon className="size-4 shrink-0" />{t("assignment.sentAwaiting")}</div>
        {myVideoPreview}
      </div>
    );
  }

  // ── video_rejected → feedback + re-upload ──────────────────────────────────
  if (s === "video_rejected") {
    return (
      <div className="space-y-3">
        {assignment.videoReviewFeedback && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <p className="font-semibold">{t("assignment.redoTitle")}</p>
            <p>{assignment.videoReviewFeedback}</p>
          </div>
        )}
        {myVideoPreview}
        <Button
          onClick={() => setUploadOpen(true)}
          disabled={busy}
          className={ACTION_BTN}
        >
          <UploadIcon className="mr-2 size-4" />{t("assignment.resubmit")}</Button>
        {uploadModal}
      </div>
    );
  }

  // ── to_publish → publie sur CHAQUE plateforme + colle 1 URL par plateforme ──
  if (s === "to_publish") {
    const allFilled = targets.every(
      (t) => (urls[t.platform] ?? "").trim().length > 0,
    );
    return (
      <form onSubmit={handleConfirm} className="space-y-4">
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2Icon className="size-4 shrink-0" />
          {t("assignment.validatedPublish", { count: targets.length })}
        </div>
        {targets.map((target) => {
          const val = urls[target.platform] ?? "";
          const detected = val.trim() ? detectInspirationType(val) : null;
          const mismatch = detected && detected.plateforme !== target.platform;
          return (
            <div key={target.platform} className="space-y-1.5">
              <Label htmlFor={`url-${target.platform}`}>
                {t("assignment.publishOn", { platform: target.platform })}
                {target.accountHandle ? (
                  <span className="font-mono text-slate-500">
                    {" "}
                    {target.accountHandle}
                  </span>
                ) : null}
              </Label>
              <Input
                id={`url-${target.platform}`}
                type="url"
                inputMode="url"
                placeholder={placeholderFor(target.platform)}
                value={val}
                onChange={(e) =>
                  setUrls((prev) => ({ ...prev, [target.platform]: e.target.value }))
                }
                required
                className="h-11 sm:h-9"
              />
              {mismatch && (
                <p className="text-xs text-rose-600">
                  {t("assignment.wrongLink", { platform: target.platform })}
                </p>
              )}
            </div>
          );
        })}
        <Button
          type="submit"
          disabled={busy || !allFilled}
          className="h-11 w-full text-base sm:h-9 sm:text-sm"
        >
          {busy ? (
            <Loader2Icon className="mr-2 size-4 animate-spin" />
          ) : (
            <SendIcon className="mr-2 size-4" />
          )}
          Confirmer la publication
        </Button>
      </form>
    );
  }

  // ── published | paid ───────────────────────────────────────────────────────
  const publishedTargets = targets.filter((t) => t.publishedUrl);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
        <CheckCircle2Icon className="size-4 shrink-0" />
        {s === "paid" ? t("assignment.publishedPaid") : t("assignment.publishedOnly")}
      </div>
      {publishedTargets.map((t) => (
        <a
          key={t.platform}
          href={t.publishedUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          Voir le post {t.platform}
          <ExternalLinkIcon className="size-3.5" />
        </a>
      ))}
    </div>
  );
}

const READONLY_TONE: Record<string, string> = {
  slate: "border-slate-200 bg-slate-50 text-slate-600",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

/** Encart d'état (admin view-as) : montre où en est le créateur, sans action. */
function ReadOnlyState({
  tone,
  label,
}: {
  tone: "slate" | "amber" | "emerald";
  label: string;
}) {
  const t = useTranslations("portal.assignment");
  return (
    <div
      data-testid="assignment-readonly-state"
      className={`flex items-center gap-2 rounded-md border p-3 text-sm ${READONLY_TONE[tone]}`}
    >
      <ClockIcon className="size-4 shrink-0" />
      {label}
    </div>
  );
}

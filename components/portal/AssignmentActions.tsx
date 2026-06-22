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
} from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { detectInspirationType } from "@/lib/inspiration-url";

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
}: {
  assignment: Doc<"assignments">;
  targets: Target[];
  projectId: Id<"projects">;
  submittedVideoUrl?: string | null;
  submittedVideoMimeType?: string | null;
}) {
  const start = useMutation(api.assignments.startAssignment);
  const submitVideo = useMutation(api.assignments.submitVideo);
  const confirmPublication = useMutation(api.assignments.confirmPublication);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const s = assignment.status;

  async function handleStart() {
    setBusy(true);
    try {
      await start({ projectId, id: assignment._id });
      toast.success("C'est parti — bon tournage !");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Impossible de démarrer la mission"));
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
      toast.success("Vidéo envoyée — en attente de validation");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de l'envoi de la vidéo"));
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
      toast.success("Publication confirmée — paiement en route 🎉");
      setUrls({});
    } catch (err) {
      toast.error(convexErrorMessage(err, "Échec de la confirmation de publication"));
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
        title="Ta vidéo soumise"
      />
    ) : assignment.submittedVideoStorageId && submittedVideoUrl !== undefined ? (
      <VideoExample
        example={{
          kind: "file",
          storageId: assignment.submittedVideoStorageId,
          title: "Ta vidéo soumise",
          mimeType: submittedVideoMimeType ?? "video/mp4",
          url: submittedVideoUrl ?? null,
        }}
      />
    ) : null;

  const uploadModal = (
    <Dialog open={uploadOpen} onOpenChange={(o) => !busy && setUploadOpen(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Soumettre ta vidéo</DialogTitle>
          <DialogDescription>
            Envoie ton MP4 (non publié). L&apos;admin la valide avant que tu la
            publies sur {targets.length > 1 ? "tes comptes" : "ton compte"}.
          </DialogDescription>
        </DialogHeader>
        <VideoUploader
          onUploaded={handleUploaded}
          disabled={busy}
          title="Glisse ta vidéo ici"
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
        <p className="text-sm text-slate-600">
          Tourne ta vidéo selon le brief, puis envoie-la pour validation.
        </p>
        <Button
          onClick={() => setUploadOpen(true)}
          disabled={busy}
          className={ACTION_BTN}
        >
          <UploadIcon className="mr-2 size-4" />
          Soumettre ma vidéo
        </Button>
        {uploadModal}
      </div>
    );
  }

  // ── video_submitted → en attente ───────────────────────────────────────────
  if (s === "video_submitted") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          <ClockIcon className="size-4 shrink-0" />
          Vidéo envoyée — en attente de validation par l&apos;admin.
        </div>
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
            <p className="font-semibold">Vidéo à refaire</p>
            <p>{assignment.videoReviewFeedback}</p>
          </div>
        )}
        {myVideoPreview}
        <Button
          onClick={() => setUploadOpen(true)}
          disabled={busy}
          className={ACTION_BTN}
        >
          <UploadIcon className="mr-2 size-4" />
          Re-soumettre une vidéo
        </Button>
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
          Ta vidéo est validée — publie-la sur {targets.length > 1
            ? "chaque plateforme"
            : "ton compte"}, puis colle {targets.length > 1
            ? "les URLs"
            : "l'URL"} ci-dessous.
        </div>
        {targets.map((t) => {
          const val = urls[t.platform] ?? "";
          const detected = val.trim() ? detectInspirationType(val) : null;
          const mismatch = detected && detected.plateforme !== t.platform;
          return (
            <div key={t.platform} className="space-y-1.5">
              <Label htmlFor={`url-${t.platform}`}>
                Publie sur {t.platform}
                {t.accountHandle ? (
                  <span className="font-mono text-slate-500">
                    {" "}
                    {t.accountHandle}
                  </span>
                ) : null}
              </Label>
              <Input
                id={`url-${t.platform}`}
                type="url"
                inputMode="url"
                placeholder={placeholderFor(t.platform)}
                value={val}
                onChange={(e) =>
                  setUrls((prev) => ({ ...prev, [t.platform]: e.target.value }))
                }
                required
                className="h-11 sm:h-9"
              />
              {mismatch && (
                <p className="text-xs text-rose-600">
                  Ce lien n&apos;est pas un lien {t.platform}.
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
        {s === "paid" ? "Publié et payé ✓" : "Publié ✓"}
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

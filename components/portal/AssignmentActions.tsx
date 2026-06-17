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
import { detectInspirationType } from "@/lib/inspiration-url";

/**
 * Workflow EN DEUX TEMPS côté créateur :
 *   todo → « Je commence » → in_progress
 *   → « Soumettre ma vidéo » (upload MP4 modal) → video_submitted (en revue)
 *   → [refus] video_rejected (feedback) → re-upload → video_submitted
 *   → [validée] to_publish → « publie + colle l'URL » → published.
 * Le PAIEMENT se déclenche à `published` (confirmPublication), pas à la revue.
 */
export function AssignmentActions({
  assignment,
  projectId,
  submittedVideoUrl,
  submittedVideoMimeType,
}: {
  assignment: Doc<"assignments">;
  projectId: Id<"projects">;
  submittedVideoUrl?: string | null;
  submittedVideoMimeType?: string | null;
}) {
  const start = useMutation(api.assignments.startAssignment);
  const submitVideo = useMutation(api.assignments.submitVideo);
  const confirmPublication = useMutation(api.assignments.confirmPublication);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const s = assignment.status;
  const detected = url.trim() ? detectInspirationType(url) : null;

  async function handleStart() {
    setBusy(true);
    try {
      await start({ projectId, id: assignment._id });
      toast.success("C'est parti — bon tournage !");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
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
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await confirmPublication({ projectId, id: assignment._id, url: url.trim() });
      toast.success("Publication confirmée — paiement en route 🎉");
      setUrl("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  const myVideoPreview =
    assignment.submittedVideoStorageId && submittedVideoUrl !== undefined ? (
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
            publies sur ton compte.
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
      <Button onClick={handleStart} disabled={busy}>
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
        <Button onClick={() => setUploadOpen(true)} disabled={busy}>
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
        <Button onClick={() => setUploadOpen(true)} disabled={busy}>
          <UploadIcon className="mr-2 size-4" />
          Re-soumettre une vidéo
        </Button>
        {uploadModal}
      </div>
    );
  }

  // ── to_publish → publie + colle l'URL ──────────────────────────────────────
  if (s === "to_publish") {
    return (
      <form onSubmit={handleConfirm} className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2Icon className="size-4 shrink-0" />
          Ta vidéo est validée — publie-la sur ton compte, puis colle l&apos;URL
          du post ci-dessous.
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="post-url">URL du post publié</Label>
          <div className="flex gap-2">
            <Input
              id="post-url"
              type="url"
              placeholder="https://www.tiktok.com/@toi/video/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <Button type="submit" disabled={busy || url.trim().length === 0}>
              {busy ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <SendIcon className="mr-2 size-4" />
              )}
              Confirmer la publication
            </Button>
          </div>
          {detected && (
            <p className="text-xs text-slate-500">
              Plateforme détectée : {detected.plateforme}
            </p>
          )}
        </div>
      </form>
    );
  }

  // ── published | paid ───────────────────────────────────────────────────────
  const publishedUrl = assignment.publishedUrl ?? assignment.submittedUrl;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
        <CheckCircle2Icon className="size-4 shrink-0" />
        {s === "paid" ? "Publié et payé ✓" : "Publié ✓"}
      </div>
      {publishedUrl && (
        <a
          href={publishedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          Voir le post publié
          <ExternalLinkIcon className="size-3.5" />
        </a>
      )}
    </div>
  );
}

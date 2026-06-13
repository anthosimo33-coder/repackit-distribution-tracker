"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2Icon, PlayIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { detectInspirationType } from "@/lib/inspiration-url";

/**
 * P7 — actions de la fiche assignment (créateur) : « Je commence » (todo →
 * in_progress) puis soumission par URL. Resoumission UNIQUEMENT depuis
 * "rejected" (le serveur le garantit aussi). Statuts terminaux = lecture seule.
 */
export function AssignmentActions({
  assignment,
  projectId,
}: {
  assignment: Doc<"assignments">;
  projectId: Id<"projects">;
}) {
  const start = useMutation(api.assignments.startAssignment);
  const submit = useMutation(api.assignments.submitAssignment);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await submit({ projectId, id: assignment._id, url: url.trim() });
      toast.success("Post soumis — en attente de validation");
      setUrl("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  const s = assignment.status;

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

  if (s === "in_progress" || s === "rejected") {
    return (
      <form onSubmit={handleSubmit} className="space-y-2">
        {s === "rejected" && assignment.adminFeedback && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <p className="font-semibold">Post rejeté</p>
            <p>{assignment.adminFeedback}</p>
          </div>
        )}
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
            {s === "rejected" ? "Resoumettre" : "Soumettre"}
          </Button>
        </div>
        {detected && (
          <p className="text-xs text-slate-500">
            Plateforme détectée : {detected.plateforme}
          </p>
        )}
      </form>
    );
  }

  if (s === "submitted") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
        Post soumis
        {assignment.submittedAt
          ? ` le ${new Date(assignment.submittedAt).toLocaleDateString("fr-FR")}`
          : ""}
        {assignment.submittedPlatform ? ` (${assignment.submittedPlatform})` : ""} —
        en attente de validation par l&apos;admin.
      </div>
    );
  }

  // validated | paid
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
      {s === "paid" ? "Post validé et payé ✓" : "Post validé ✓"}
    </div>
  );
}

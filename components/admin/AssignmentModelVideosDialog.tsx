"use client";

import { useState } from "react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { detectInspirationType } from "@/lib/inspiration-url";
import type { ModelVideo } from "@/lib/model-videos";
import type { FunctionReturnType } from "convex/server";
import {
  ExternalLinkIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  VideoIcon,
} from "lucide-react";

type VideoInspiration = FunctionReturnType<
  typeof api.inspirations.listInspirations
>[number];

/**
 * Gère les VIDÉOS MODÈLES (liens à reproduire) d'un assignment, à chaud APRÈS
 * l'assignation : liste (plateforme dérivée de l'URL + titre + note + lien +
 * suppression) et formulaire d'ajout (URL requise, titre/note optionnels). Ce
 * sont des LIENS, pas des fichiers.
 */
export function AssignmentModelVideosDialog({
  open,
  onOpenChange,
  assignmentId,
  creatorName,
  modelVideos,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignmentId: Id<"assignments">;
  creatorName: string;
  modelVideos: ModelVideo[];
}) {
  const add = useProjectMutation(api.assignments.addModelVideoToAssignment);
  const remove = useProjectMutation(
    api.assignments.removeModelVideoFromAssignment,
  );
  // Inspirations VIDÉO du projet (scopées projet côté serveur) — 2e voie d'ajout.
  const inspirations = useProjectQuery(
    api.inspirations.listInspirations,
    open ? { types: ["video"] } : "skip",
  );
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Masque les inspirations déjà attachées (dédoublonnage par URL côté serveur).
  const addedUrls = new Set(modelVideos.map((mv) => mv.url));
  const pickableInspirations = (inspirations ?? []).filter(
    (i) => !addedUrls.has(i.url),
  );

  async function onAdd() {
    if (url.trim().length === 0) {
      toast.error("L'URL est requise.");
      return;
    }
    setBusy(true);
    try {
      const res = await add({
        id: assignmentId,
        url,
        title: title.trim() || undefined,
        note: note.trim() || undefined,
      });
      setUrl("");
      setTitle("");
      setNote("");
      toast.success(
        res.duplicate ? "Déjà dans les modèles." : "Vidéo modèle ajoutée.",
      );
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAddFromInspiration(insp: VideoInspiration) {
    setBusy(true);
    try {
      const res = await add({
        id: assignmentId,
        url: insp.url,
        title: insp.titre || undefined,
      });
      toast.success(
        res.duplicate ? "Déjà dans les modèles." : "Vidéo modèle ajoutée.",
      );
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(videoId: string) {
    try {
      await remove({ id: assignmentId, videoId });
      toast.success("Vidéo modèle retirée.");
    } catch (e) {
      toast.error(convexErrorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vidéos modèles — {creatorName}</DialogTitle>
          <DialogDescription>
            Des LIENS vers des vidéos existantes à reproduire avec le script. Le
            créateur les voit dans son brief comme « vidéos à reproduire ».
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Liste */}
          {modelVideos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
              Aucune vidéo modèle pour l&apos;instant.
            </p>
          ) : (
            <ul className="space-y-2">
              {modelVideos.map((mv) => {
                const platform =
                  detectInspirationType(mv.url)?.plateforme ?? "Lien";
                return (
                  <li
                    key={mv.id}
                    className="flex items-start gap-2 rounded-lg border border-slate-200 p-2.5"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                          {platform}
                        </span>
                        <a
                          href={mv.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-w-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          <span className="truncate">{mv.title ?? mv.url}</span>
                          <ExternalLinkIcon className="size-3.5 shrink-0" />
                        </a>
                      </div>
                      {mv.note && (
                        <p className="break-words text-xs text-slate-500">
                          {mv.note}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-8 shrink-0 p-0 text-rose-600 hover:text-rose-700"
                      onClick={() => onRemove(mv.id)}
                      aria-label="Retirer"
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Ajout */}
          <div className="space-y-2.5 border-t border-slate-200 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="mv-url">URL de la vidéo modèle</Label>
              <Input
                id="mv-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.tiktok.com/@…/video/…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mv-title">Titre (optionnel)</Label>
              <Input
                id="mv-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex. Le hook qui marche"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mv-note">À reproduire (optionnel)</Label>
              <Textarea
                id="mv-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ce qu'il faut reproduire (rythme, structure…)"
                rows={2}
              />
            </div>
            <Button onClick={onAdd} disabled={busy} className="w-full">
              {busy ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <PlusIcon className="mr-2 size-4" />
              )}
              Ajouter la vidéo modèle
            </Button>
          </div>

          {/* 2e voie : piocher une inspiration existante (scopée projet). */}
          <div className="space-y-2 border-t border-slate-200 pt-4">
            <Label>Ou choisir depuis mes inspirations</Label>
            {inspirations === undefined ? (
              <Skeleton className="h-24 w-full" />
            ) : pickableInspirations.length === 0 ? (
              <p className="text-sm text-slate-400">
                Aucune inspiration vidéo disponible.
              </p>
            ) : (
              <div className="max-h-52 space-y-1.5 overflow-y-auto">
                {pickableInspirations.map((insp) => (
                  <button
                    key={insp._id}
                    type="button"
                    onClick={() => onAddFromInspiration(insp)}
                    disabled={busy}
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-200 p-2 text-left transition-colors hover:bg-slate-50 disabled:opacity-50"
                  >
                    {insp.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={insp.thumbnailUrl}
                        alt=""
                        className="size-10 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <div className="grid size-10 shrink-0 place-items-center rounded bg-slate-100">
                        <VideoIcon className="size-4 text-slate-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {insp.titre ?? insp.url}
                      </p>
                      <p className="text-xs text-slate-400">{insp.plateforme}</p>
                    </div>
                    <PlusIcon className="size-4 shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

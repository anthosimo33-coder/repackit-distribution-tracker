"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeSourceId } from "@/lib/source-id";
import { cn } from "@/lib/utils";
import { CircleCheckIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

type SourceRow = FunctionReturnType<
  typeof api.publications.listSources
>[number];

/**
 * RenameSourceDialog — renomme un sourceId en cascade depuis /shorts/sources.
 *
 * source=null → fermé. Le parent passe key={source.sourceId} pour réinitialiser
 * l'état à chaque ouverture (pas d'effet de synchro). Preview de collision via
 * getSourceStatus (heuristique UI) ; le serveur reste le garde-fou précis
 * (collision par plateforme bloquante, cf renameSourceId).
 */
export function RenameSourceDialog({
  source,
  onClose,
}: {
  source: SourceRow | null;
  onClose: () => void;
}) {
  const open = source !== null;
  const [newName, setNewName] = useState(source?.displaySourceId ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const renameSourceId = useProjectMutation(api.publications.renameSourceId);

  const trimmed = newName.trim();
  const normalizedNew = normalizeSourceId(newName);
  const normalizedOld = normalizeSourceId(source?.displaySourceId ?? "");
  const isNoOp = normalizedNew === normalizedOld;

  // Preview status du nouveau nom (skip si fermé, vide ou identique à l'ancien).
  const status = useProjectQuery(
    api.publications.getSourceStatus,
    open && trimmed !== "" && !isNoOp ? { sourceId: newName } : "skip",
  );
  const previewConflict = !isNoOp && status?.exists === true;
  const conflictPlatforms = previewConflict
    ? [...new Set(status.publications.map((p) => p.plateforme))].join(", ")
    : "";

  const canSubmit =
    open && trimmed !== "" && !isNoOp && !previewConflict && !isSubmitting;

  async function handleSubmit() {
    if (!canSubmit || source === null) return;
    setIsSubmitting(true);
    try {
      const result = await renameSourceId({
        oldSourceId: source.sourceId,
        newSourceId: newName,
      });
      const n = result.renamed;
      toast.success(
        `${n} publication${n > 1 ? "s" : ""} renommée${n > 1 ? "s" : ""}`,
      );
      onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e, "Erreur lors du renommage"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const pubCount = source?.publications.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isSubmitting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Renommer la source</DialogTitle>
          <DialogDescription>
            Met à jour le sourceId de toutes les publications qui le partagent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Ancien nom</Label>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-600">
              {source?.displaySourceId}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rename-new">Nouveau nom</Label>
            <Input
              id="rename-new"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) handleSubmit();
              }}
              className="font-mono"
              autoFocus
            />
          </div>

          {trimmed !== "" && !isNoOp && (
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                previewConflict
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700",
              )}
            >
              {previewConflict ? (
                <>
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Conflit potentiel : ce nom existe déjà avec{" "}
                    {status.publications.length} publication
                    {status.publications.length > 1 ? "s" : ""} sur{" "}
                    {conflictPlatforms}.
                  </span>
                </>
              ) : (
                <>
                  <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>Nouveau nom disponible.</span>
                </>
              )}
            </div>
          )}

          {isNoOp && trimmed !== "" && (
            <p className="text-xs text-slate-500">
              Identique à l&apos;ancien nom — aucun changement.
            </p>
          )}

          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Cette action renommera{" "}
            <span className="font-semibold">{pubCount}</span> publication
            {pubCount > 1 ? "s" : ""} en cascade. Action irréversible.
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting && (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            )}
            Confirmer le renommage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

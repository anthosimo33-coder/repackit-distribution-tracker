"use client";

import { useState } from "react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { Loader2Icon } from "lucide-react";

/**
 * Lie UN OU PLUSIEURS dossiers d'assets à un assignment (multi-select). Le
 * créateur pourra télécharger les fichiers de TOUS les dossiers liés dans son
 * brief. Lien simple, modifiable (cocher/décocher + enregistrer).
 */
export function LinkAssetFolderDialog({
  open,
  onOpenChange,
  assignmentId,
  currentFolderIds,
  creatorName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignmentId: Id<"assignments">;
  currentFolderIds: Id<"assetFolders">[];
  creatorName: string;
}) {
  const folders = useProjectQuery(
    api.assets.listAssetFolders,
    open ? {} : "skip",
  );
  const setFolders = useProjectMutation(api.assignments.setAssetFolders);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(currentFolderIds),
  );
  const [busy, setBusy] = useState(false);

  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setSelected(new Set(currentFolderIds));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSave() {
    setBusy(true);
    try {
      await setFolders({
        id: assignmentId,
        folderIds: [...selected] as Id<"assetFolders">[],
      });
      toast.success(
        selected.size === 0
          ? "Dossiers déliés."
          : `${selected.size} dossier${selected.size > 1 ? "s" : ""} lié${selected.size > 1 ? "s" : ""}.`,
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dossiers d&apos;assets — {creatorName}</DialogTitle>
          <DialogDescription>
            Lie un ou plusieurs dossiers à cet assignment. Le créateur pourra
            télécharger leurs fichiers depuis son brief.
          </DialogDescription>
        </DialogHeader>

        {folders === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : folders.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            Aucun dossier d&apos;assets — crées-en un dans Assets.
          </p>
        ) : (
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {folders.map((f) => (
              <label
                key={f._id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50"
              >
                <Checkbox
                  checked={selected.has(f._id)}
                  onCheckedChange={() => toggle(f._id)}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                  {f.name}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {f.assetCount} fichier{f.assetCount > 1 ? "s" : ""}
                </span>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Annuler
          </Button>
          <Button onClick={onSave} disabled={busy}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

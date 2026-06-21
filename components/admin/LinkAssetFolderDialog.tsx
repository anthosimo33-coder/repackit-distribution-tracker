"use client";

import { useState } from "react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const NONE = "__none__";

/**
 * Lie (ou délie) UN dossier d'assets à un assignment. Lien simple, modifiable.
 * Le créateur pourra télécharger les images du dossier lié dans son brief.
 */
export function LinkAssetFolderDialog({
  open,
  onOpenChange,
  assignmentId,
  currentFolderId,
  creatorName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignmentId: Id<"assignments">;
  currentFolderId: Id<"assetFolders"> | null;
  creatorName: string;
}) {
  const folders = useProjectQuery(
    api.assets.listAssetFolders,
    open ? {} : "skip",
  );
  const link = useProjectMutation(api.assignments.linkAssetFolder);
  const [selected, setSelected] = useState<string>(currentFolderId ?? NONE);
  const [busy, setBusy] = useState(false);

  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setSelected(currentFolderId ?? NONE);
  }

  async function onConfirm() {
    setBusy(true);
    try {
      await link({
        id: assignmentId,
        folderId: selected === NONE ? null : (selected as Id<"assetFolders">),
      });
      toast.success(
        selected === NONE ? "Dossier délié." : "Dossier d'assets lié.",
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dossier d&apos;assets — {creatorName}</DialogTitle>
          <DialogDescription>
            Lie UN dossier d&apos;images à cet assignment. Le créateur pourra les
            télécharger depuis son brief.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="asset-folder">Dossier lié</Label>
          {folders === undefined ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select value={selected} onValueChange={(v) => v && setSelected(v)}>
              <SelectTrigger id="asset-folder" aria-label="Dossier d'assets">
                <SelectValue>
                  {selected === NONE
                    ? "Aucun (délié)"
                    : (folders.find((f) => f._id === selected)?.name ??
                      "Dossier")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Aucun (délié)</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f._id} value={f._id}>
                    {f.name} ({f.assetCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {folders !== undefined && folders.length === 0 && (
            <p className="text-xs text-slate-400">
              Aucun dossier d&apos;assets — crées-en un dans Assets.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Annuler
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

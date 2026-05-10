"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FOLDER_COLORS, type FolderColorKey } from "@/lib/folder-colors";
import { Loader2Icon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MAX_NAME_LENGTH = 80;

/**
 * Batch G — Dialog single-step création/édition de folder.
 *
 * En mode edit : fetch via folders.listFolders (single-shot) puis lookup
 * par id. Pattern wrapper + form interne pour useState avec initialData
 * (évite useEffect-set-state).
 */
export function FolderEditDialog({
  open,
  onOpenChange,
  mode,
  folderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  folderId?: Id<"folders">;
}) {
  const folders = useQuery(api.folders.listFolders, {});
  const folder =
    mode === "edit" && folderId !== undefined
      ? folders?.find((f) => f._id === folderId)
      : null;

  const isLoadingEdit = mode === "edit" && folders === undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        {isLoadingEdit ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <FolderEditDialogForm
            key={folder?._id ?? "create"}
            mode={mode}
            initialFolder={folder ?? null}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FolderEditDialogForm({
  mode,
  initialFolder,
  onClose,
}: {
  mode: "create" | "edit";
  initialFolder: {
    _id: Id<"folders">;
    name: string;
    description?: string;
    color?: string;
  } | null;
  onClose: () => void;
}) {
  const isEdit = mode === "edit";
  const [name, setName] = useState(initialFolder?.name ?? "");
  const [description, setDescription] = useState(
    initialFolder?.description ?? "",
  );
  const [color, setColor] = useState<FolderColorKey>(
    (initialFolder?.color as FolderColorKey | undefined) ?? "slate",
  );
  const [submitting, setSubmitting] = useState(false);

  const createFolder = useMutation(api.folders.createFolder);
  const updateFolder = useMutation(api.folders.updateFolder);

  const trimmed = name.trim();
  const canSubmit =
    trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH && !submitting;

  async function handleSave() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (isEdit && initialFolder) {
        await updateFolder({
          id: initialFolder._id,
          name: trimmed,
          description: description.trim() || undefined,
          color,
        });
        toast.success("Dossier mis à jour");
      } else {
        await createFolder({
          name: trimmed,
          description: description.trim() || undefined,
          color,
        });
        toast.success(`Dossier "${trimmed}" créé`);
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Modifier le dossier" : "Nouveau dossier"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Mets à jour le nom, la description ou la couleur."
            : "Crée un dossier pour organiser tes inspirations."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="folder-name">Nom *</Label>
        <Input
          id="folder-name"
          autoFocus
          maxLength={MAX_NAME_LENGTH}
          placeholder="Ex: Hooks Growth"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-xs text-slate-500">
          {trimmed.length}/{MAX_NAME_LENGTH} caractères
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="folder-description">Description</Label>
        <Textarea
          id="folder-description"
          rows={3}
          placeholder="Optionnel"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Couleur</Label>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {FOLDER_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setColor(c.key)}
              aria-label={`Couleur ${c.label}`}
              aria-pressed={color === c.key}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-md border-2 transition-all",
                color === c.key
                  ? "border-slate-900 ring-2 ring-slate-300"
                  : "border-transparent hover:border-slate-300",
              )}
            >
              <span className={cn("size-6 rounded-full", c.dotClass)} />
              {color === c.key && (
                <CheckIcon className="absolute size-4 text-white drop-shadow-md" />
              )}
            </button>
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={handleSave} disabled={!canSubmit}>
          {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          {isEdit ? "Sauvegarder" : "Créer"}
        </Button>
      </DialogFooter>
    </>
  );
}

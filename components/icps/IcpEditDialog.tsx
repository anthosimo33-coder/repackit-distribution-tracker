"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
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
import { convexErrorMessage } from "@/lib/convex-error";

const MAX_NAME_LENGTH = 80;

/**
 * Dialog single-step création/édition d'ICP. Calque FolderEditDialog (même
 * structure wrapper + form interne keyed par id). Réutilise FOLDER_COLORS
 * pour le color picker (pas de palette dédiée ICP).
 *
 * `onCreated` permet à IcpCombobox de sélectionner automatiquement l'ICP
 * fraîchement créé. `initialNom` prérempli le nom en mode create (query du
 * combobox).
 */
export function IcpEditDialog({
  open,
  onOpenChange,
  mode,
  icpId,
  onCreated,
  initialNom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  icpId?: Id<"icps">;
  onCreated?: (id: Id<"icps">) => void;
  initialNom?: string;
}) {
  const icps = useProjectQuery(api.icps.listIcps, {});
  const icp =
    mode === "edit" && icpId !== undefined
      ? icps?.find((i) => i._id === icpId)
      : null;

  const isLoadingEdit = mode === "edit" && icps === undefined;

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
          <IcpEditDialogForm
            key={icp?._id ?? "create"}
            mode={mode}
            initialIcp={icp ?? null}
            initialNom={initialNom}
            onCreated={onCreated}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function IcpEditDialogForm({
  mode,
  initialIcp,
  initialNom,
  onCreated,
  onClose,
}: {
  mode: "create" | "edit";
  initialIcp: {
    _id: Id<"icps">;
    nom: string;
    description?: string;
    color?: string;
  } | null;
  initialNom?: string;
  onCreated?: (id: Id<"icps">) => void;
  onClose: () => void;
}) {
  const isEdit = mode === "edit";
  const [nom, setNom] = useState(initialIcp?.nom ?? initialNom ?? "");
  const [description, setDescription] = useState(
    initialIcp?.description ?? "",
  );
  const [color, setColor] = useState<FolderColorKey>(
    (initialIcp?.color as FolderColorKey | undefined) ?? "slate",
  );
  const [submitting, setSubmitting] = useState(false);

  const createIcp = useProjectMutation(api.icps.createIcp);
  const updateIcp = useProjectMutation(api.icps.updateIcp);

  const trimmed = nom.trim();
  const canSubmit =
    trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH && !submitting;

  async function handleSave() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (isEdit && initialIcp) {
        await updateIcp({
          id: initialIcp._id,
          nom: trimmed,
          description: description.trim() || undefined,
          color,
        });
        toast.success("ICP modifié");
      } else {
        const newId = await createIcp({
          nom: trimmed,
          description: description.trim() || undefined,
          color,
        });
        toast.success(`ICP "${trimmed}" créé`);
        onCreated?.(newId);
      }
      onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Modifier l'ICP" : "Nouvel ICP"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Mets à jour le nom, la description ou la couleur."
            : "Crée un profil d'audience cible assignable à tes Shorts."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="icp-nom">Nom *</Label>
        <Input
          id="icp-nom"
          autoFocus
          maxLength={MAX_NAME_LENGTH}
          placeholder="Ex: Mid-tier FR"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
        />
        <p className="text-xs text-slate-500">
          {trimmed.length}/{MAX_NAME_LENGTH} caractères
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="icp-description">Description</Label>
        <Textarea
          id="icp-description"
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
          Enregistrer
        </Button>
      </DialogFooter>
    </>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { IcpEditDialog } from "./IcpEditDialog";
import {
  ArrowLeftIcon,
  CheckIcon,
  Loader2Icon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  TargetIcon,
  Trash2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FOLDER_COLORS,
  type FolderColorKey,
  getFolderColor,
} from "@/lib/folder-colors";
import { toast } from "sonner";

/**
 * Page admin des ICPs, accessible via /comptes?view=icps. CRUD complet :
 * créer, renommer, changer couleur, supprimer (avec cascade unset des
 * Shorts assignés). Calque FolderManagerSection.
 */
export function IcpsManagerSection({ onBack }: { onBack: () => void }) {
  const icps = useProjectQuery(api.icps.listIcps, {});
  const updateIcp = useProjectMutation(api.icps.updateIcp);
  const deleteIcp = useProjectMutation(api.icps.deleteIcp);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<Id<"icps"> | null>(null);
  const [editDialogKey, setEditDialogKey] = useState(0);

  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"icps">;
    nom: string;
    count: number;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setEditMode("create");
    setEditingId(null);
    setEditDialogKey((k) => k + 1);
    setEditDialogOpen(true);
  }

  function openEdit(id: Id<"icps">) {
    setEditMode("edit");
    setEditingId(id);
    setEditDialogKey((k) => k + 1);
    setEditDialogOpen(true);
  }

  async function handleColorChange(id: Id<"icps">, color: FolderColorKey) {
    try {
      await updateIcp({ id, color });
      toast.success("Couleur mise à jour");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const result = await deleteIcp({ id: deleteTarget.id });
      const unset = result?.unsetCount ?? 0;
      toast.success(
        unset > 0
          ? `ICP supprimé — ${unset} Short${unset > 1 ? "s" : ""} désassigné${unset > 1 ? "s" : ""}`
          : "ICP supprimé",
      );
      setDeleteTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeftIcon className="size-4" />
            Retour aux comptes
          </button>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            ICPs
          </h1>
          <p className="text-sm text-slate-500">
            Profils d&apos;audience cible assignables à tes Shorts.
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon className="size-4" />
          Nouvel ICP
        </Button>
      </div>

      {icps === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : icps.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
          <TargetIcon className="size-16 text-slate-300" strokeWidth={1.5} />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">
              Aucun ICP
            </h2>
            <p className="text-sm text-slate-500">
              Crée ton premier ICP pour cibler tes Shorts.
            </p>
          </div>
          <Button onClick={openCreate}>
            <PlusIcon className="size-4" />
            Nouvel ICP
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {icps.map((i) => {
            const color = getFolderColor(i.color);
            return (
              <li
                key={i._id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <span
                  className={cn(
                    "size-3 shrink-0 rounded-full",
                    color.dotClass,
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {i.nom}
                  </p>
                  {i.description && (
                    <p className="line-clamp-1 text-xs text-slate-500">
                      {i.description}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-700">
                  {i.shortsCount} Short{i.shortsCount > 1 ? "s" : ""}
                </span>
                <div className="flex shrink-0 gap-1">
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Changer la couleur de ${i.nom}`}
                        >
                          <PaletteIcon className="size-4" />
                        </Button>
                      }
                    />
                    <PopoverContent align="end" className="w-auto p-2">
                      <div className="grid grid-cols-4 gap-1.5">
                        {FOLDER_COLORS.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => handleColorChange(i._id, c.key)}
                            aria-label={`Couleur ${c.label}`}
                            className={cn(
                              "relative flex size-8 items-center justify-center rounded-md transition-colors hover:bg-slate-50",
                            )}
                          >
                            <span
                              className={cn("size-5 rounded-full", c.dotClass)}
                            />
                            {i.color === c.key && (
                              <CheckIcon className="absolute size-3.5 text-white drop-shadow" />
                            )}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Renommer ${i.nom}`}
                    onClick={() => openEdit(i._id)}
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Supprimer ${i.nom}`}
                    onClick={() =>
                      setDeleteTarget({
                        id: i._id,
                        nom: i.nom,
                        count: i.shortsCount,
                      })
                    }
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <IcpEditDialog
        key={editDialogKey}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        mode={editMode}
        icpId={editingId ?? undefined}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer {deleteTarget?.nom} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.count > 0
                ? `${deleteTarget.count} Short${deleteTarget.count > 1 ? "s" : ""} ${deleteTarget.count > 1 ? "seront désassignés" : "sera désassigné"}. Action irréversible.`
                : "Action irréversible. L'ICP sera supprimé."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

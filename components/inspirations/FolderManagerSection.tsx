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
import { FolderEditDialog } from "./FolderEditDialog";
import {
  ArrowLeftIcon,
  FolderIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  PaletteIcon,
  CheckIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FOLDER_COLORS,
  type FolderColorKey,
  getFolderColor,
} from "@/lib/folder-colors";
import { toast } from "sonner";

/**
 * Batch G — page admin folders (?view=folders). CRUD complet : créer,
 * renommer, changer couleur, supprimer (avec cascade unset).
 *
 * Layout : liste verticale (pas grid de cards — plus dense, plus lisible
 * pour < 50 folders attendus). Chaque ligne : dot color + nom +
 * description + count + 3 actions (rename / change-color / delete).
 *
 * Color picker : Popover inline pour le quick-change (pas le full Dialog
 * d'édition, qui requiert plus de friction).
 */
export function FolderManagerSection({ onBack }: { onBack: () => void }) {
  const folders = useProjectQuery(api.folders.listFolders, {});
  const updateFolder = useProjectMutation(api.folders.updateFolder);
  const deleteFolder = useProjectMutation(api.folders.deleteFolder);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<Id<"folders"> | null>(null);
  const [editDialogKey, setEditDialogKey] = useState(0);

  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"folders">;
    name: string;
    count: number;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setEditMode("create");
    setEditingId(null);
    setEditDialogKey((k) => k + 1);
    setEditDialogOpen(true);
  }

  function openEdit(id: Id<"folders">) {
    setEditMode("edit");
    setEditingId(id);
    setEditDialogKey((k) => k + 1);
    setEditDialogOpen(true);
  }

  async function handleColorChange(id: Id<"folders">, color: FolderColorKey) {
    try {
      await updateFolder({ id, color });
      toast.success("Couleur mise à jour");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const result = await deleteFolder({ id: deleteTarget.id });
      const moved = result?.unsetCount ?? 0;
      toast.success(
        moved > 0
          ? `Dossier supprimé — ${moved} inspiration(s) déplacée(s) vers Non classé`
          : "Dossier supprimé",
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
            Retour aux inspirations
          </button>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Dossiers
          </h1>
          <p className="text-sm text-slate-500">
            Organise tes inspirations en collections thématiques.
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon className="size-4" />
          Nouveau dossier
        </Button>
      </div>

      {folders === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : folders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
          <FolderIcon
            className="size-16 text-slate-300"
            strokeWidth={1.5}
          />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">
              Aucun dossier
            </h2>
            <p className="text-sm text-slate-500">
              Crée ton premier dossier pour organiser tes inspirations.
            </p>
          </div>
          <Button onClick={openCreate}>
            <PlusIcon className="size-4" />
            Nouveau dossier
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {folders.map((f) => {
            const folderColor = getFolderColor(f.color);
            return (
              <li
                key={f._id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <span
                  className={cn("size-3 shrink-0 rounded-full", folderColor.dotClass)}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {f.name}
                  </p>
                  {f.description && (
                    <p className="line-clamp-1 text-xs text-slate-500">
                      {f.description}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-700">
                  {f.inspirationCount}
                </span>
                <div className="flex shrink-0 gap-1">
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Changer la couleur de ${f.name}`}
                        >
                          <PaletteIcon className="size-4" />
                        </Button>
                      }
                    />
                    <PopoverContent
                      align="end"
                      className="w-auto p-2"
                    >
                      <div className="grid grid-cols-4 gap-1.5">
                        {FOLDER_COLORS.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => handleColorChange(f._id, c.key)}
                            aria-label={`Couleur ${c.label}`}
                            className={cn(
                              "relative flex size-8 items-center justify-center rounded-md transition-colors hover:bg-slate-50",
                            )}
                          >
                            <span className={cn("size-5 rounded-full", c.dotClass)} />
                            {f.color === c.key && (
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
                    aria-label={`Renommer ${f.name}`}
                    onClick={() => openEdit(f._id)}
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Supprimer ${f.name}`}
                    onClick={() =>
                      setDeleteTarget({
                        id: f._id,
                        name: f.name,
                        count: f.inspirationCount,
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

      <FolderEditDialog
        key={editDialogKey}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        mode={editMode}
        folderId={editingId ?? undefined}
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
              Supprimer &laquo;&nbsp;{deleteTarget?.name}&nbsp;&raquo; ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.count > 0
                ? `${deleteTarget.count} inspiration${deleteTarget.count > 1 ? "s" : ""} ${deleteTarget.count > 1 ? "seront déplacées" : "sera déplacée"} vers Non classé. Le dossier sera supprimé.`
                : "Action irréversible. Le dossier sera supprimé."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              )}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

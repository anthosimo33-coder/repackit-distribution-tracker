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
import { Skeleton } from "@/components/ui/skeleton";
import { PersonneEditDialog } from "./PersonneEditDialog";
import {
  ArrowLeftIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * Page admin des personnes (gestionnaires), accessible via
 * /comptes?view=personnes. CRUD complet : créer, renommer, supprimer
 * (avec cascade unset des comptes assignés).
 *
 * Layout calqué sur FolderManagerSection : liste verticale dense (< 50
 * personnes attendues). Chaque ligne : prénom + nom + badge compteCount +
 * actions rename / delete.
 */
export function PersonnesManagerSection({ onBack }: { onBack: () => void }) {
  const showError = useConvexError();
  const tr = useTranslations("admin.accounts.PersonnesManagerSection");
  const personnes = useProjectQuery(api.personnes.listPersonnes, {});
  const deletePersonne = useProjectMutation(api.personnes.deletePersonne);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<Id<"personnes"> | null>(null);
  const [editDialogKey, setEditDialogKey] = useState(0);

  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"personnes">;
    label: string;
    count: number;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setEditMode("create");
    setEditingId(null);
    setEditDialogKey((k) => k + 1);
    setEditDialogOpen(true);
  }

  function openEdit(id: Id<"personnes">) {
    setEditMode("edit");
    setEditingId(id);
    setEditDialogKey((k) => k + 1);
    setEditDialogOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const result = await deletePersonne({ id: deleteTarget.id });
      const unset = result?.unsetCount ?? 0;
      toast.success(
        unset > 0
          ? tr("personneSupprimeeCompteDesassigne", { unset: unset })
          : tr("personneSupprimee"),
      );
      setDeleteTarget(null);
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
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
            {tr("retourAuxComptes")}
          </button>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {tr("personnes")}
          </h1>
          <p className="text-sm text-slate-500">
            {tr("gereLesGestionnairesAssignablesA")}
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon className="size-4" />
          {tr("nouvellePersonne")}
        </Button>
      </div>

      {personnes === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : personnes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
          <UsersIcon className="size-16 text-slate-300" strokeWidth={1.5} />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">
              {tr("aucunePersonne")}
            </h2>
            <p className="text-sm text-slate-500">
              {tr("creeTaPremierePersonnePour")}
            </p>
          </div>
          <Button onClick={openCreate}>
            <PlusIcon className="size-4" />
            {tr("nouvellePersonne")}
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {personnes.map((p) => {
            const label = `${p.prenom} ${p.nom}`;
            return (
              <li
                key={p._id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <UsersIcon className="size-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {label}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-700">
                  {tr("compte", { compteCount: p.compteCount })}
                </span>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={tr("renommer", { label: label })}
                    onClick={() => openEdit(p._id)}
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={tr("supprimer3", { label: label })}
                    onClick={() =>
                      setDeleteTarget({
                        id: p._id,
                        label,
                        count: p.compteCount,
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

      <PersonneEditDialog
        key={editDialogKey}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        mode={editMode}
        personneId={editingId ?? undefined}
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
              {tr("supprimer", { label: deleteTarget?.label ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.count > 0
                ? tr("comptesDesassignes", { count: deleteTarget.count })
                : tr("actionIrreversibleLaPersonneSera")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tr("annuler")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {tr("supprimer2")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

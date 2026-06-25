"use client";

import { useState } from "react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  GuideModuleEditDialog,
  type GuideModuleDraft,
} from "./GuideModuleEditDialog";
import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

/**
 * Section admin « Comment ça marche » — CRUD + réordonnancement des modules
 * markdown du projet (scopé projet côté serveur). Liste verticale dense :
 * monter/descendre (échange d'order), badge statut, éditer, supprimer (avec
 * AlertDialog). Tri serveur par order (listModulesForAdmin).
 */
export function GuideModulesManager() {
  const modules = useProjectQuery(api.guideModules.listModulesForAdmin, {});
  const moveModule = useProjectMutation(api.guideModules.moveModule);
  const deleteModule = useProjectMutation(api.guideModules.deleteModule);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<GuideModuleDraft | null>(null);
  const [dialogKey, setDialogKey] = useState(0);

  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"guideModules">;
    title: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [movingId, setMovingId] = useState<Id<"guideModules"> | null>(null);

  function openCreate() {
    setDialogMode("create");
    setEditing(null);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  function openEdit(m: GuideModuleDraft) {
    setDialogMode("edit");
    setEditing(m);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  async function handleMove(
    id: Id<"guideModules">,
    direction: "up" | "down",
  ) {
    setMovingId(id);
    try {
      await moveModule({ id, direction });
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setMovingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteModule({ id: deleteTarget.id });
      toast.success("Module supprimé");
      setDeleteTarget(null);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Comment ça marche
          </h1>
          <p className="text-sm text-slate-500">
            Les modules de formation affichés aux créateurs (markdown, par
            projet). Les brouillons restent invisibles côté créateur.
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon className="size-4" />
          Nouveau module
        </Button>
      </header>

      {modules === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : modules.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
          <BookOpenIcon className="size-14 text-slate-300" strokeWidth={1.5} />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">
              Aucun module
            </h2>
            <p className="text-sm text-slate-500">
              Crée ton premier module pour expliquer le fonctionnement aux
              créateurs.
            </p>
          </div>
          <Button onClick={openCreate}>
            <PlusIcon className="size-4" />
            Nouveau module
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {modules.map((m, idx) => (
            <li
              key={m._id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex flex-col">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Monter ${m.title}`}
                  disabled={idx === 0 || movingId !== null}
                  onClick={() => handleMove(m._id, "up")}
                  className="h-5"
                >
                  <ChevronUpIcon className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Descendre ${m.title}`}
                  disabled={idx === modules.length - 1 || movingId !== null}
                  onClick={() => handleMove(m._id, "down")}
                  className="h-5"
                >
                  <ChevronDownIcon className="size-4" />
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {m.title}
                </p>
              </div>
              <Badge variant={m.status === "published" ? "default" : "secondary"}>
                {m.status === "published" ? "Publié" : "Brouillon"}
              </Badge>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Modifier ${m.title}`}
                  onClick={() =>
                    openEdit({
                      _id: m._id,
                      title: m.title,
                      contentMarkdown: m.contentMarkdown,
                      status: m.status,
                    })
                  }
                >
                  <PencilIcon className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Supprimer ${m.title}`}
                  onClick={() => setDeleteTarget({ id: m._id, title: m.title })}
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <GuideModuleEditDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        initialModule={editing}
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
              Supprimer &laquo;&nbsp;{deleteTarget?.title}&nbsp;&raquo; ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Action irréversible. Le module sera définitivement supprimé.
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

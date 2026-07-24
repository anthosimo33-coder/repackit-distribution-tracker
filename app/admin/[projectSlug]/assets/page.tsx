"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import {
  FolderIcon,
  ImagesIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

type Folder = FunctionReturnType<typeof api.assets.listAssetFolders>[number];

export default function AssetsPage() {
  const folders = useProjectQuery(api.assets.listAssetFolders, {});
  const projectPath = useProjectPath();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Folder | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Assets
          </h1>
          <p className="text-sm text-slate-500">
            Bibliothèque d&apos;images et vidéos en dossiers, à lier aux
            assignments pour
            téléchargement par les créateurs.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon className="mr-2 size-4" />
          Nouveau dossier
        </Button>
      </header>

      {folders === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : folders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ImagesIcon className="size-12 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm text-slate-500">
              Aucun dossier. Crée un dossier pour y uploader des images et
              vidéos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((f) => (
            <Card key={f._id} className="transition-colors hover:border-primary">
              <CardContent className="flex items-center gap-3 p-4">
                <Link
                  href={projectPath(`/assets/${f._id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <FolderIcon className="size-8 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">
                      {f.name}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      {f.assetCount} fichier{f.assetCount > 1 ? "s" : ""}
                      {f.postprocessImages === true && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900"
                          title="Les images déposées sont nettoyées de leurs métadonnées et ré-encodées"
                        >
                          <SparklesIcon className="size-3" />À publier
                        </span>
                      )}
                    </p>
                  </div>
                </Link>
                <FolderActions
                  folder={f}
                  onRename={() => setRenameTarget(f)}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <FolderDialog open={createOpen} onOpenChange={setCreateOpen} folder={null} />
      <FolderDialog
        open={renameTarget !== null}
        onOpenChange={(o) => !o && setRenameTarget(null)}
        folder={renameTarget}
      />
    </div>
  );
}

function FolderActions({
  folder,
  onRename,
}: {
  folder: Folder;
  onRename: () => void;
}) {
  const remove = useProjectMutation(api.assets.deleteAssetFolder);

  async function onDelete() {
    try {
      await remove({ id: folder._id });
      toast.success("Dossier supprimé.");
    } catch (e) {
      toast.error(convexErrorMessage(e));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="size-8 shrink-0 p-0">
            <MoreHorizontalIcon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onRename}>Renommer</DropdownMenuItem>
        <DropdownMenuItem
          onClick={onDelete}
          className="text-rose-600 focus:text-rose-700"
        >
          Supprimer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FolderDialog({
  open,
  onOpenChange,
  folder,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  folder: Folder | null;
}) {
  const create = useProjectMutation(api.assets.createAssetFolder);
  const rename = useProjectMutation(api.assets.renameAssetFolder);
  const setPostprocess = useProjectMutation(api.assets.setAssetFolderPostprocess);
  const isEdit = folder !== null;
  const [name, setName] = useState("");
  const [postprocessImages, setPostprocessImages] = useState(false);
  const [busy, setBusy] = useState(false);

  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(folder?.name ?? "");
      setPostprocessImages(folder?.postprocessImages === true);
    }
  }

  async function onSubmit() {
    if (name.trim().length === 0) {
      toast.error("Le nom est requis.");
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await rename({ id: folder._id, name });
        if ((folder.postprocessImages === true) !== postprocessImages) {
          await setPostprocess({ id: folder._id, postprocessImages });
        }
        toast.success("Dossier mis à jour.");
      } else {
        await create({ name, postprocessImages });
        toast.success("Dossier créé.");
      }
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
          <DialogTitle>
            {isEdit ? "Modifier le dossier" : "Nouveau dossier"}
          </DialogTitle>
          <DialogDescription>
            Un dossier regroupe des images et vidéos à fournir aux créateurs.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="folder-name">Nom</Label>
          <Input
            id="folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex. Logos & overlays"
          />
        </div>
        <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3">
          <Switch
            checked={postprocessImages}
            onCheckedChange={setPostprocessImages}
            aria-label="Contenu à publier — nettoyer les métadonnées des images"
            className="mt-0.5"
          />
          <span className="min-w-0 text-xs text-slate-600">
            <span className="block text-sm font-medium text-slate-900">
              Contenu à publier
            </span>
            Les images déposées seront nettoyées de leurs métadonnées (C2PA,
            EXIF, XMP) et ré-encodées en JPEG. À laisser DÉSACTIVÉ pour du
            matériel source que les créatrices retravaillent : la recompression
            est irréversible.
          </span>
        </label>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Annuler
          </Button>
          <Button onClick={onSubmit} disabled={busy}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {isEdit ? "Enregistrer" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

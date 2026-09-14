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
import { useTranslations } from "next-intl";

type Folder = FunctionReturnType<typeof api.assets.listAssetFolders>[number];

export default function AssetsPage() {
  const tr = useTranslations("admin.library.AssetsPage");
  const folders = useProjectQuery(api.assets.listAssetFolders, {});
  const projectPath = useProjectPath();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Folder | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {tr("assets")}
          </h1>
          <p className="text-sm text-slate-500">
            {tr("bibliothequeDImagesEtVideos")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon className="mr-2 size-4" />
          {tr("nouveauDossier")}
        </Button>
      </header>

      {folders === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : folders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ImagesIcon className="size-12 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm text-slate-500">
              {tr("aucunDossierCreeUnDossier")}
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
                      {tr("fichier", { assetCount: f.assetCount })}
                      {f.postprocessImages === true && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900"
                          title={tr("lesImagesDeposeesSontNettoyees")}
                        >
                          <SparklesIcon className="size-3" />{tr("aPublier")}
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
  const tr = useTranslations("admin.library.FolderActions");
  const remove = useProjectMutation(api.assets.deleteAssetFolder);

  async function onDelete() {
    try {
      await remove({ id: folder._id });
      toast.success(tr("dossierSupprime"));
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
        {/* « Modifier » et pas « Renommer » : le dialog porte AUSSI le réglage
            « Contenu à publier », qu'on ne penserait jamais à chercher
            derrière un intitulé de renommage. */}
        <DropdownMenuItem onClick={onRename}>{tr("modifier")}</DropdownMenuItem>
        <DropdownMenuItem
          onClick={onDelete}
          className="text-rose-600 focus:text-rose-700"
        >
          {tr("supprimer")}
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
  const tr = useTranslations("admin.library.FolderDialog");
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
      toast.error(tr("leNomEstRequis"));
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await rename({ id: folder._id, name });
        if ((folder.postprocessImages === true) !== postprocessImages) {
          await setPostprocess({ id: folder._id, postprocessImages });
        }
        toast.success(tr("dossierMisAJour"));
      } else {
        await create({ name, postprocessImages });
        toast.success(tr("dossierCree"));
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
            {isEdit ? tr("modifierLeDossier") : tr("nouveauDossier")}
          </DialogTitle>
          <DialogDescription>
            {tr("unDossierRegroupeDesImages")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="folder-name">{tr("nom")}</Label>
          <Input
            id="folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tr("exLogosOverlays")}
          />
        </div>
        <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3">
          <Switch
            checked={postprocessImages}
            onCheckedChange={setPostprocessImages}
            aria-label={tr("contenuAPublierNettoyerLes")}
            className="mt-0.5"
          />
          <span className="min-w-0 text-xs text-slate-600">
            <span className="block text-sm font-medium text-slate-900">
              {tr("contenuAPublier")}
            </span>
            {tr("lesImagesDeposeesSerontNettoyees")}
          </span>
        </label>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {tr("annuler")}
          </Button>
          <Button onClick={onSubmit} disabled={busy}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {isEdit ? tr("enregistrer") : tr("creer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetUploader } from "@/components/admin/AssetUploader";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { ArrowLeftIcon, SparklesIcon, Trash2Icon } from "lucide-react";

export default function AssetFolderDetailPage() {
  const params = useParams<{ folderId: string }>();
  const folderId = params.folderId as Id<"assetFolders">;
  const projectPath = useProjectPath();
  const folders = useProjectQuery(api.assets.listAssetFolders, {});
  const assets = useProjectQuery(api.assets.listAssets, { folderId });
  const removeAsset = useProjectMutation(api.assets.deleteAsset);

  const folder = folders?.find((f) => f._id === folderId);

  async function onDelete(id: Id<"assets">) {
    try {
      await removeAsset({ id });
      toast.success("Fichier supprimé.");
    } catch (e) {
      toast.error(convexErrorMessage(e));
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href={projectPath("/assets")}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        Assets
      </Link>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          {folders === undefined ? "…" : (folder?.name ?? "Dossier introuvable")}
        </h1>
        <p className="text-sm text-slate-500">
          Images JPG/PNG/WebP (10 Mo) · Vidéos MP4/MOV/WebM (100 Mo). Lie ce
          dossier à un assignment depuis la page Assignments.
        </p>
      </header>

      {folder?.postprocessImages === true && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <SparklesIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-medium">Contenu à publier.</span> Les images
            déposées ici sont nettoyées de leurs métadonnées (C2PA, EXIF, XMP) et
            ré-encodées en JPEG à l&apos;ingestion. La recompression est
            irréversible — n&apos;y dépose pas de matériel source.
          </p>
        </div>
      )}

      {folder && (
        <AssetUploader
          folderId={folderId}
          postprocess={folder.postprocessImages === true}
        />
      )}

      {assets === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : assets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-400">
            Aucun fichier dans ce dossier.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((a) => (
            <Card key={a._id} className="overflow-hidden">
              <div className="relative aspect-square bg-slate-50">
                {a.url &&
                  (a.contentType.startsWith("video/") ? (
                    <video
                      src={a.url}
                      controls
                      preload="metadata"
                      className="size-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.url}
                      alt={a.fileName}
                      className="size-full object-cover"
                    />
                  ))}
                {a.contentType.startsWith("video/") && (
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    Vidéo
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 size-7 bg-white/80 p-0 text-rose-600 hover:bg-white hover:text-rose-700"
                  onClick={() => onDelete(a._id)}
                  aria-label={`Supprimer ${a.fileName}`}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
              <CardContent className="p-2">
                <p className="truncate text-xs text-slate-600" title={a.fileName}>
                  {a.fileName}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { convexErrorMessage } from "@/lib/convex-error";
import {
  ASSET_ACCEPTED_TYPES,
  resolveAssetContentType,
  validateAssetFile,
} from "@/lib/asset-file";

// Accept = types MIME + extensions (certains OS ne renseignent pas le MIME des
// .mp4/.mov dans le picker → l'extension garantit qu'ils restent sélectionnables).
const ACCEPT_ATTR = [
  ...ASSET_ACCEPTED_TYPES,
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".mp4",
  ".mov",
  ".webm",
].join(",");

/**
 * POST direct du blob vers l'URL signée Convex via XHR (progression d'upload +
 * timeout). Résout/rejette TOUJOURS (load/error/timeout) → l'appelant ne reste
 * jamais bloqué. Le File est envoyé tel quel (pas de lecture mémoire).
 */
function putBlob(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<Id<"_storage">> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.timeout = 5 * 60 * 1000; // 5 min (large pour ~100 Mo)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const { storageId } = JSON.parse(xhr.responseText) as {
            storageId: Id<"_storage">;
          };
          resolve(storageId);
        } catch {
          reject(new Error("Réponse d'upload invalide."));
        }
      } else {
        reject(new Error(`Upload échoué (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Erreur réseau pendant l'upload."));
    xhr.ontimeout = () => reject(new Error("Upload expiré — réessaie."));
    xhr.send(file);
  });
}

/**
 * Upload MULTI de fichiers vers un dossier d'assets (Convex storage) : IMAGES
 * (≤ 10 Mo) ET VIDÉOS courtes (≤ 100 Mo). Pour chaque fichier : résolution du
 * type (MIME ou EXTENSION en fallback) → validation (lib/asset-file) →
 * generateUploadUrl → POST (XHR, progression) → createAsset (re-valide serveur).
 * L'UI ne reste JAMAIS bloquée : toute issue remet la zone à l'état normal.
 */
export function AssetUploader({ folderId }: { folderId: Id<"assetFolders"> }) {
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const createAsset = useProjectMutation(api.assets.createAsset);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadOne(file: File): Promise<boolean> {
    // Type effectif : MIME s'il est accepté, sinon déduit de l'extension.
    const contentType = resolveAssetContentType(file) ?? file.type;
    const check = validateAssetFile({ contentType, size: file.size });
    if (!check.ok) {
      toast.error(`${file.name} : ${check.error ?? "fichier invalide."}`);
      return false;
    }
    const uploadUrl = await generateUploadUrl();
    setProgress(0);
    const storageId = await putBlob(uploadUrl, file, contentType, setProgress);
    await createAsset({
      folderId,
      storageId,
      fileName: file.name,
      contentType,
      size: file.size,
    });
    return true;
  }

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    setProgress(null);
    let ok = 0;
    try {
      for (const f of arr) {
        try {
          if (await uploadOne(f)) ok++;
        } catch (e) {
          toast.error(
            convexErrorMessage(
              e,
              convexErrorMessage(e, "Erreur d'upload."),
            ),
          );
        }
      }
      if (ok > 0) {
        toast.success(
          `${ok} fichier${ok > 1 ? "s" : ""} ajouté${ok > 1 ? "s" : ""}.`,
        );
      }
    } finally {
      // Quoi qu'il arrive (succès, rejet, exception), on débloque la zone.
      setUploading(false);
      setProgress(null);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!uploading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!uploading && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
        dragOver
          ? "border-slate-900 bg-slate-50"
          : "border-slate-300 bg-white hover:border-slate-400",
        uploading && "cursor-not-allowed opacity-60",
      )}
    >
      {uploading ? (
        <>
          <Loader2Icon className="size-6 animate-spin text-slate-400" />
          <p className="text-sm text-slate-500">
            {progress === null
              ? "Préparation…"
              : `Upload en cours… ${progress}%`}
          </p>
        </>
      ) : (
        <>
          <UploadIcon className="size-6 text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-700">
              Glisse des images ou vidéos ici
            </p>
            <p className="text-xs text-slate-500">
              Images JPG/PNG/WebP (10 Mo) · Vidéos MP4/MOV/WebM (100 Mo, ~1 min)
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            Parcourir
          </Button>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="hidden"
        aria-label="Sélectionner des images ou vidéos"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
        disabled={uploading}
      />
    </div>
  );
}

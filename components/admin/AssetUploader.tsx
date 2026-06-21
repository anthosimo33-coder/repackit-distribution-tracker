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
import { ASSET_ACCEPTED_TYPES, validateAssetFile } from "@/lib/asset-file";

/**
 * Upload MULTI de fichiers vers un dossier d'assets (Convex storage) : IMAGES
 * (≤ 10 Mo) ET VIDÉOS courtes (≤ 100 Mo). Pour chaque fichier : validation
 * client (lib/asset-file, limite PAR type) → generateUploadUrl → POST →
 * createAsset (qui RE-VALIDE serveur). Les types non supportés / trop gros sont
 * rejetés des deux côtés.
 */
export function AssetUploader({ folderId }: { folderId: Id<"assetFolders"> }) {
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const createAsset = useProjectMutation(api.assets.createAsset);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadOne(file: File) {
    const check = validateAssetFile({ contentType: file.type, size: file.size });
    if (!check.ok) {
      toast.error(check.error ?? "Fichier invalide.");
      return false;
    }
    const uploadUrl = await generateUploadUrl();
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) throw new Error(`Upload échoué (HTTP ${res.status}).`);
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    await createAsset({
      folderId,
      storageId,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    });
    return true;
  }

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    let ok = 0;
    try {
      for (const f of arr) {
        try {
          if (await uploadOne(f)) ok++;
        } catch (e) {
          toast.error(
            convexErrorMessage(
              e,
              e instanceof Error ? e.message : "Erreur d'upload.",
            ),
          );
        }
      }
      if (ok > 0) {
        toast.success(`${ok} image${ok > 1 ? "s" : ""} ajoutée${ok > 1 ? "s" : ""}.`);
      }
    } finally {
      setUploading(false);
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
          <p className="text-sm text-slate-500">Upload en cours…</p>
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
        accept={ASSET_ACCEPTED_TYPES.join(",")}
        className="hidden"
        aria-label="Sélectionner des images"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
        disabled={uploading}
      />
    </div>
  );
}

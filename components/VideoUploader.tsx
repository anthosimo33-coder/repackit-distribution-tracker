"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MAX_SIZE_BYTES = 300 * 1024 * 1024; // 300 MB
const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export type UploadedVideo = {
  storageId: Id<"_storage">;
  mimeType: string;
  title: string;
};

/**
 * P6 — VideoUploader : upload navigateur → Convex storage (jamais via une route
 * API Next ; les fonctions Vercel plafonnent ~4,5 Mo de body). Modèle
 * d'ImageUploader, MAIS :
 *  - POST en XMLHttpRequest (fetch n'expose pas la progression d'upload) →
 *    barre de progression réelle ;
 *  - types vidéo mp4 / quicktime(.mov) / webm, 300 Mo max (client).
 * Le blob n'est lié au format que côté serveur (updateFormat) ; sa suppression
 * (retrait d'exemple) supprime le blob via le diff serveur.
 */
export function VideoUploader({
  onUploaded,
  disabled,
}: {
  onUploaded: (v: UploadedVideo) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);

  function uploadWithProgress(uploadUrl: string, file: File): Promise<Id<"_storage">> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
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
      xhr.onerror = () => reject(new Error("Upload interrompu (réseau)."));
      xhr.send(file);
    });
  }

  async function handleFile(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Format vidéo invalide. Utilise MP4, MOV ou WebM.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      toast.error("Vidéo trop lourde (≤ 300 Mo).");
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const uploadUrl = await generateUploadUrl();
      const storageId = await uploadWithProgress(uploadUrl, file);
      const title = file.name.replace(/\.[^.]+$/, "");
      onUploaded({ storageId, mimeType: file.type, title });
      toast.success("Vidéo ajoutée");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'upload");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled && !uploading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors",
        dragOver
          ? "border-slate-900 bg-slate-50"
          : "border-slate-300 bg-white hover:border-slate-400",
        (disabled || uploading) && "cursor-not-allowed opacity-60",
      )}
    >
      {uploading ? (
        <div className="w-full max-w-xs space-y-2">
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2Icon className="size-4 animate-spin" />
            Upload {progress}%
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-slate-900 transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <>
          <UploadIcon className="size-6 text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-700">
              Glisse une vidéo exemple ici
            </p>
            <p className="text-xs text-slate-500">MP4, MOV ou WebM — 300 Mo max</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            Parcourir
          </Button>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={handleInputChange}
        disabled={disabled || uploading}
        aria-label="Sélectionner une vidéo"
      />
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Loader2Icon, UploadIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * ImageUploader — upload d'image vers Convex storage (Batch D, greenfield).
 *
 * Pattern documenté Convex : (1) generateUploadUrl mutation, (2) POST direct
 * du blob vers l'URL signée, (3) parse storageId du JSON retour, (4)
 * onChange(storageId) côté parent qui le passe à createPublication /
 * updateDraft. La résolution de l'URL publique se fait toujours serveur
 * (listPublications enrichi avec imageUrl).
 *
 * Validation client : type image/* (jpeg/png/webp), taille ≤ 5 MB.
 * Erreurs surfacées via toast pour rester dans le scope du composant.
 */
export function ImageUploader({
  value,
  imageUrl,
  onChange,
  disabled,
}: {
  value: Id<"_storage"> | null;
  imageUrl: string | null;
  onChange: (storageId: Id<"_storage"> | null) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);

  async function handleFile(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Format invalide. Utilise JPG, PNG ou WebP.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      toast.error("Image trop lourde (≤ 5 MB).");
      return;
    }
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) {
        throw new Error(`Upload failed: HTTP ${res.status}`);
      }
      const { storageId } = (await res.json()) as {
        storageId: Id<"_storage">;
      };
      onChange(storageId);
    } catch (e) {
      toast.error(
        convexErrorMessage(e, "Erreur lors de l'upload"),
      );
    } finally {
      setUploading(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset le input pour permettre de re-uploader le même fichier après
    // suppression (sinon le navigateur ne re-déclenche pas onChange).
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleRemove() {
    onChange(null);
  }

  if (value && imageUrl) {
    return (
      <div className="space-y-2">
        <div className="relative overflow-hidden rounded-md border border-slate-200 bg-slate-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Preview"
            className="aspect-video w-full object-cover"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <UploadIcon className="size-4" />
            )}
            Remplacer
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || uploading}
            onClick={handleRemove}
            className="text-rose-600 hover:text-rose-700"
          >
            <XIcon className="size-4" />
            Supprimer
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={handleInputChange}
          disabled={disabled || uploading}
        />
      </div>
    );
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
        <>
          <Loader2Icon className="size-6 animate-spin text-slate-400" />
          <p className="text-sm text-slate-500">Upload en cours…</p>
        </>
      ) : (
        <>
          <UploadIcon className="size-6 text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-700">
              Glisse une image ici
            </p>
            <p className="text-xs text-slate-500">JPG, PNG ou WebP — 5 MB max</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || uploading}
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
        aria-label="Sélectionner une image"
      />
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ASSET_ACCEPTED_TYPES,
  assetKind,
  resolveAssetContentType,
  validateAssetFile,
} from "@/lib/asset-file";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

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
          // i18n-exempt: message technique jamais affiché (le toast rend le repli traduit)
          reject(new Error("Réponse d'upload invalide."));
        }
      } else {
        // i18n-exempt: message technique jamais affiché (le toast rend le repli traduit)
        reject(new Error(`Upload échoué (HTTP ${xhr.status}).`));
      }
    };
    // i18n-exempt: message technique jamais affiché (le toast rend le repli traduit)
    xhr.onerror = () => reject(new Error("Erreur réseau pendant l'upload."));
    // i18n-exempt: message technique jamais affiché (le toast rend le repli traduit)
    xhr.ontimeout = () => reject(new Error("Upload expiré — réessaie."));
    xhr.send(file);
  });
}

/** Fichier prêt à être enregistré — version post-traitée quand il y en a une. */
type IngestedFile = {
  storageId: Id<"_storage">;
  fileName: string;
  contentType: string;
  size: number;
  /** Blob d'origine supplanté, à purger par createAsset. */
  replacedStorageId?: Id<"_storage">;
  /** A traversé le pipeline → createAsset horodate (verrou d'idempotence). */
  postprocessed?: boolean;
};

/**
 * Upload MULTI de fichiers vers un dossier d'assets (Convex storage) : IMAGES
 * (≤ 10 Mo) ET VIDÉOS courtes (≤ 100 Mo). Pour chaque fichier : résolution du
 * type (MIME ou EXTENSION en fallback) → validation (lib/asset-file) →
 * generateUploadUrl → POST (XHR, progression) → POST-TRAITEMENT des images
 * (si le dossier est marqué « contenu à publier ») → createAsset (re-valide
 * serveur).
 * L'UI ne reste JAMAIS bloquée : toute issue remet la zone à l'état normal.
 *
 * `postprocess` vient du dossier (assetFolders.postprocessImages), jamais d'un
 * choix par fichier : dans un dossier marqué c'est systématique, ailleurs ça ne
 * se déclenche jamais. Le pipeline est destructif — il ne doit pas s'appliquer
 * au matériel source que les créatrices retravaillent.
 */
export function AssetUploader({
  folderId,
  postprocess,
}: {
  folderId: Id<"assetFolders">;
  postprocess: boolean;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.library.AssetUploader");
  const tErr = useTranslations("admin.library.assetError");
  const convex = useConvex();
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const createAsset = useProjectMutation(api.assets.createAsset);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  // Phase post-upload (pipeline image) : sans ça la barre reste figée à 100 %.
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Post-traitement d'UNE image (retrait C2PA/EXIF/XMP + ré-encodage, cf.
   * app/api/assets/postprocess/route.ts). Appelé DANS la boucle par fichier :
   * chaque image du lot est traitée pour elle-même, avec SES dimensions.
   *
   * Ne jette JAMAIS : format non supporté, route indisponible, pipeline en
   * échec → on retombe sur l'original (log + upload qui aboutit). Le seul
   * traitement systématique est la TENTATIVE ; la garantie est que rien ne
   * bloque l'ingestion.
   */
  async function postProcess(
    file: File,
    storageId: Id<"_storage">,
    contentType: string,
  ): Promise<IngestedFile> {
    const original: IngestedFile = {
      storageId,
      fileName: file.name,
      contentType,
      size: file.size,
    };
    // Dossier de matériel source → on ne dégrade rien, on stocke tel quel.
    if (!postprocess) return original;
    // Les vidéos ne sont pas concernées par le pipeline image.
    if (assetKind(contentType) !== "image") return original;

    try {
      const sourceUrl = await convex.query(api.storage.getPreviewUrl, {
        storageId,
      });
      // i18n-exempt: message technique jamais affiché (le toast rend le repli traduit)
      if (!sourceUrl) throw new Error("URL de lecture introuvable.");
      const uploadUrl = await generateUploadUrl();

      const res = await fetch("/api/assets/postprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl,
          uploadUrl,
          contentType,
          fileName: file.name,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as
        | { processed: false; reason: string }
        | {
            processed: true;
            storageId: Id<"_storage">;
            fileName: string;
            contentType: string;
            size: number;
          };

      if (!data.processed) {
        console.warn(
          `[assets] ${file.name} : post-traitement ignoré (${data.reason}) — original stocké.`,
        );
        return original;
      }
      return {
        storageId: data.storageId,
        fileName: data.fileName,
        contentType: data.contentType,
        size: data.size,
        replacedStorageId: storageId,
        postprocessed: true,
      };
    } catch (e) {
      console.error(
        `[assets] ${file.name} : post-traitement échoué — original stocké.`,
        e,
      );
      return original;
    }
  }

  async function uploadOne(file: File): Promise<boolean> {
    // Type effectif : MIME s'il est accepté, sinon déduit de l'extension.
    const contentType = resolveAssetContentType(file) ?? file.type;
    const check = validateAssetFile({ contentType, size: file.size });
    if (!check.ok) {
      toast.error(`${file.name} : ${tErr(check.error ?? "invalid")}`);
      return false;
    }
    const uploadUrl = await generateUploadUrl();
    setProgress(0);
    const storageId = await putBlob(uploadUrl, file, contentType, setProgress);
    setProcessing(true);
    let ingested: IngestedFile;
    try {
      ingested = await postProcess(file, storageId, contentType);
    } finally {
      setProcessing(false);
    }
    await createAsset({
      folderId,
      storageId: ingested.storageId,
      fileName: ingested.fileName,
      contentType: ingested.contentType,
      size: ingested.size,
      replacedStorageId: ingested.replacedStorageId,
      postprocessed: ingested.postprocessed,
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
            showError(
              e,
              showError(e, tr("erreurDUpload")),
            ),
          );
        }
      }
      if (ok > 0) {
        toast.success(
          tr("fichierAjoute", { ok: ok }),
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
            {processing
              ? tr("nettoyageDesMetadonnees")
              : progress === null
                ? tr("preparation")
                : tr("uploadEnCours", { progress: progress })}
          </p>
        </>
      ) : (
        <>
          <UploadIcon className="size-6 text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-700">
              {tr("glisseDesImagesOuVideos")}
            </p>
            <p className="text-xs text-slate-500">
              {tr("imagesJpgPngWebp10")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            {tr("parcourir")}
          </Button>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="hidden"
        aria-label={tr("selectionnerDesImagesOuVideos")}
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
        disabled={uploading}
      />
    </div>
  );
}

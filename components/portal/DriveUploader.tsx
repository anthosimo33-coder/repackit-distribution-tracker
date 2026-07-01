"use client";

import { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  CloudUploadIcon,
  Loader2Icon,
  CircleCheckIcon,
  RotateCwIcon,
  FilmIcon,
  ImageIcon,
  FilesIcon,
} from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { classifyDriveKind, formatBytes } from "@/lib/snytch-drive";
import { cn } from "@/lib/utils";

/**
 * Dépôt de contenu Snytch — upload DIRECT navigateur → Google Drive (le gros
 * fichier ne transite JAMAIS par Convex). Par fichier :
 *   1. getUploadSession (action) → URL de session resumable Drive (dossier du
 *      créateur, fixé serveur) ;
 *   2. PUT du binaire directement sur Google (XMLHttpRequest → barre de
 *      progression réelle ; fetch n'expose pas la progression d'upload) ;
 *   3. confirmUpload (mutation) → enregistre les métadonnées (la liste « déposé »
 *      se rafraîchit toute seule via la réactivité Convex).
 *
 * Multi-fichiers (séquentiel par lot), retry par fichier. Accepte vidéos +
 * photos, extensions Apple (.mov/.heic) tolérées. Mobile-first (dépôts iPhone).
 */

/** Garde-fou : 5 Go max par fichier (au-delà, upload navigateur peu fiable). */
const MAX_BYTES = 5 * 1024 * 1024 * 1024;
const ACCEPT = "video/*,image/*,.mov,.MOV,.heic,.HEIC,.heif";

type ItemStatus = "uploading" | "done" | "error";
type UploadItem = {
  localId: string;
  file: File;
  name: string;
  size: number;
  kind: "video" | "photo" | "other";
  status: ItemStatus;
  progress: number;
  error?: string;
};

/** PUT resumable d'un fichier sur l'URL de session Drive, avec progression. */
function putToDrive(
  sessionUrl: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ id: string; webViewLink?: string; thumbnailLink?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.timeout = 60 * 60 * 1000; // 1 h (vidéos iPhone lourdes sur mobile)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const r = JSON.parse(xhr.responseText) as {
            id?: string;
            webViewLink?: string;
            thumbnailLink?: string;
          };
          if (!r.id) {
            reject(new Error("Réponse Drive invalide (id manquant)."));
            return;
          }
          resolve({
            id: r.id,
            webViewLink: r.webViewLink,
            thumbnailLink: r.thumbnailLink,
          });
        } catch {
          reject(new Error("Réponse Drive illisible."));
        }
      } else {
        reject(new Error(`Upload Drive échoué (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () =>
      reject(new Error("Upload interrompu (réseau ou blocage navigateur)."));
    xhr.ontimeout = () =>
      reject(new Error("Upload expiré (fichier trop lourd / connexion lente)."));
    xhr.send(file);
  });
}

export function DriveUploader({ projectId }: { projectId: Id<"projects"> }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const getUploadSession = useAction(api.snytchDrive.getUploadSession);
  const confirmUpload = useMutation(api.snytchDrive.confirmUpload);

  function patch(localId: string, next: Partial<UploadItem>) {
    setItems((prev) =>
      prev.map((it) => (it.localId === localId ? { ...it, ...next } : it)),
    );
  }

  async function uploadOne(item: UploadItem) {
    patch(item.localId, { status: "uploading", progress: 0, error: undefined });
    try {
      const session = await getUploadSession({
        projectId,
        fileName: item.file.name,
        mimeType: item.file.type,
        sizeBytes: item.file.size,
      });
      if (!session.ok) {
        const msg =
          session.reason === "disabled"
            ? "Le dépôt de fichiers n'est pas encore activé. Préviens l'administrateur."
            : "Dépôt de fichiers indisponible pour ce projet.";
        patch(item.localId, { status: "error", error: msg });
        toast.error(msg);
        return;
      }
      const res = await putToDrive(session.uploadUrl, item.file, (pct) =>
        patch(item.localId, { progress: pct }),
      );
      await confirmUpload({
        projectId,
        driveFileId: res.id,
        fileName: item.file.name,
        mimeType: item.file.type || "application/octet-stream",
        sizeBytes: item.file.size,
        webViewLink: res.webViewLink,
        thumbnailLink: res.thumbnailLink,
      });
      patch(item.localId, { status: "done", progress: 100 });
      toast.success(`${item.name} envoyé`);
    } catch (e) {
      patch(item.localId, {
        status: "error",
        error: convexErrorMessage(e, "Échec de l'upload."),
      });
    }
  }

  function enqueue(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const batch: UploadItem[] = [];
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} : trop lourd (5 Go max).`);
        continue;
      }
      const kind = classifyDriveKind(file.type, file.name);
      if (kind === "other") {
        toast.error(`${file.name} : accepte uniquement vidéos et photos.`);
        continue;
      }
      batch.push({
        localId: crypto.randomUUID(),
        file,
        name: file.name,
        size: file.size,
        kind,
        status: "uploading",
        progress: 0,
      });
    }
    if (batch.length === 0) return;
    // Plus récents en tête de la file d'upload.
    setItems((prev) => [...batch, ...prev]);
    void (async () => {
      for (const it of batch) await uploadOne(it);
    })();
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) enqueue(e.dataTransfer.files);
  }

  const active = items.some((it) => it.status === "uploading");

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-slate-300 bg-white hover:border-slate-400",
        )}
      >
        <CloudUploadIcon className="size-8 text-slate-400" />
        <div>
          <p className="text-sm font-medium text-slate-700">
            Glisse tes vidéos et photos ici
          </p>
          <p className="text-xs text-slate-500">
            Vidéos et photos (iPhone .mov / .heic acceptés) — jusqu&apos;à 5 Go
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          className="h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm"
        >
          Choisir des fichiers
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) enqueue(e.target.files);
            e.target.value = "";
          }}
          aria-label="Sélectionner des vidéos ou des photos"
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-2" aria-label="Fichiers en cours d'envoi" aria-busy={active}>
          {items.map((it) => (
            <li
              key={it.localId}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
            >
              <span className="shrink-0 text-slate-400">
                {it.kind === "video" ? (
                  <FilmIcon className="size-5" />
                ) : it.kind === "photo" ? (
                  <ImageIcon className="size-5" />
                ) : (
                  <FilesIcon className="size-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {it.name}
                  </p>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400">
                    {formatBytes(it.size)}
                  </span>
                </div>
                {it.status === "uploading" && (
                  <div className="mt-1.5 space-y-1">
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
                      role="progressbar"
                      aria-valuenow={it.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${it.progress}%` }}
                      />
                    </div>
                    <p className="flex items-center gap-1 text-xs text-slate-500">
                      <Loader2Icon className="size-3 animate-spin" />
                      Envoi {it.progress}%
                    </p>
                  </div>
                )}
                {it.status === "done" && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-emerald-600">
                    <CircleCheckIcon className="size-3.5" />
                    Envoyé
                  </p>
                )}
                {it.status === "error" && (
                  <p className="mt-0.5 text-xs text-red-600">{it.error}</p>
                )}
              </div>
              {it.status === "error" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void uploadOne(it)}
                  className="shrink-0 gap-1"
                >
                  <RotateCwIcon className="size-3.5" />
                  Réessayer
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

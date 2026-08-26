"use client";

import { useRef, useState } from "react";
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
import { ConvexError } from "convex/values";
import { classifyDriveKind, formatBytes } from "@/lib/snytch-drive";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useTranslations } from "next-intl";

/**
 * Dépôt de fichiers — upload navigateur → Google Drive (le gros fichier ne
 * transite JAMAIS par Convex). Par fichier :
 *   1. `backend.requestSession` (action Convex) → URL de session resumable Drive
 *      (dossier de la personne + métadonnées fixés serveur, service account) ;
 *   2. upload PAR CHUNKS via le route handler same-origin /api/snytch-drive/upload
 *      (uploadViaProxy) — le PUT DIRECT navigateur → Google est bloqué par CORS,
 *      on relaie donc chaque chunk côté serveur (même origine = pas de CORS) ;
 *   3. `backend.confirm` (mutation) → enregistre les métadonnées (la liste se
 *      rafraîchit toute seule via la réactivité Convex).
 *
 * Multi-fichiers (séquentiel par lot), retry par fichier, extensions Apple
 * (.mov/.heic) tolérées. Mobile-first (dépôts iPhone).
 *
 * DEUX PORTAILS, UN SEUL TRANSPORT. Le créateur partenaire dépose vidéos +
 * photos dans `snytchDriveFiles` ; le talent dépose des rushes vidéo dans
 * `rushes`. Les fonctions Convex, les bornes et les libellés sont donc INJECTÉS
 * — ce composant ne connaît ni l'une ni l'autre des deux populations. La
 * mécanique d'upload, elle, reste unique : c'est elle qui a été éprouvée, et la
 * dupliquer pour changer trois libellés serait le meilleur moyen de la voir
 * diverger.
 */

/** Réponse d'octroi de session — forme structurelle, alignée sur le serveur. */
export type DriveUploadSession =
  | { ok: true; uploadUrl: string }
  | { ok: false; reason: "disabled" | "not-enabled" };

/** Fonctions Convex du portail appelant (le rôle est fixé côté serveur). */
export type DriveUploadBackend = {
  requestSession: (args: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) => Promise<DriveUploadSession>;
  confirm: (args: {
    driveFileId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    webViewLink?: string;
    thumbnailLink?: string;
  }) => Promise<unknown>;
};

/**
 * Bornes du dépôt. `kinds` filtre ce qui est accepté (classifyDriveKind) et
 * `maxBytes` refuse AVANT tout upload : les deux doivent décrire le dépôt réel,
 * pas le maximum technique — un écran qui annonce 5 Go à quelqu'un qui dépose des
 * prises de 5 secondes lui fait croire qu'on attend autre chose.
 */
export type DriveUploadLimits = {
  maxBytes: number;
  /** Attribut `accept` de l'input fichier. */
  accept: string;
  kinds: ReadonlyArray<"video" | "photo">;
};

/** Libellés — propres à chaque population, jamais devinés par le composant. */
export type DriveUploadCopy = {
  title: string;
  hint: string;
  button: string;
  /** Message d'un fichier trop lourd / d'un type refusé (nom du fichier fourni). */
  tooBig: (fileName: string) => string;
  wrongKind: (fileName: string) => string;
};

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

/**
 * Taille de chunk : 4 Mo (16 × 256 Ko — multiple de 256 Ko requis par Drive pour
 * les chunks intermédiaires), volontairement < 4,5 Mo (limite de body des
 * fonctions Vercel) pour que chaque requête passe l'ingress. Découpe les gros
 * fichiers (vidéo iPhone > 1 Go) sans jamais les bufferiser en entier.
 */
const CHUNK_BYTES = 4 * 1024 * 1024;

type ProxyChunkResponse =
  | { status: "incomplete"; range: string | null }
  | {
      status: "complete";
      file: { id?: string; webViewLink?: string; thumbnailLink?: string } | null;
    }
  | { status: "error"; httpStatus: number; message: string };

/**
 * Upload d'un fichier PAR CHUNKS via le route handler same-origin
 * (/api/snytch-drive/upload) — contourne le blocage CORS du PUT direct
 * navigateur → Google. Chaque chunk est PUT sur la session Drive côté serveur ;
 * Drive répond « incomplete » jusqu'au dernier (« complete » → ressource
 * fichier). Progression au chunk. Aucune bufferisation du fichier entier.
 */
async function uploadViaProxy(
  sessionUrl: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ id: string; webViewLink?: string; thumbnailLink?: string }> {
  const total = file.size;
  let start = 0;
  let fileResource:
    | { id?: string; webViewLink?: string; thumbnailLink?: string }
    | null = null;

  while (start < total) {
    const end = Math.min(start + CHUNK_BYTES, total);
    const contentRange = `bytes ${start}-${end - 1}/${total}`;
    const res = await fetch("/api/snytch-drive/upload", {
      method: "POST",
      headers: {
        "x-drive-session": sessionUrl,
        "x-drive-content-range": contentRange,
      },
      body: file.slice(start, end),
    });
    if (!res.ok) {
      throw new Error(`Upload interrompu (HTTP ${res.status}).`);
    }
    const data = (await res.json()) as ProxyChunkResponse;
    if (data.status === "error") {
      throw new Error(`Drive a refusé l'upload (HTTP ${data.httpStatus}).`);
    }
    if (data.status === "complete") {
      fileResource = data.file;
      onProgress(100);
      break;
    }
    start = end;
    onProgress(Math.round((start / total) * 100));
  }

  if (!fileResource?.id) {
    // i18n-exempt: erreur TECHNIQUE d'un helper hors composant (pas de hook ici) ; l'appelant affiche drive.uploadFailed
    throw new Error("Réponse Drive invalide (id manquant).");
  }
  return {
    id: fileResource.id,
    webViewLink: fileResource.webViewLink,
    thumbnailLink: fileResource.thumbnailLink,
  };
}

export function DriveUploader({
  backend,
  limits,
  copy,
}: {
  backend: DriveUploadBackend;
  limits: DriveUploadLimits;
  copy: DriveUploadCopy;
}) {
  const tdr = useTranslations("drive");
  const loc = useIntlLocale();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function patch(localId: string, next: Partial<UploadItem>) {
    setItems((prev) =>
      prev.map((it) => (it.localId === localId ? { ...it, ...next } : it)),
    );
  }

  async function uploadOne(item: UploadItem) {
    patch(item.localId, { status: "uploading", progress: 0, error: undefined });
    try {
      const session = await backend.requestSession({
        fileName: item.file.name,
        mimeType: item.file.type,
        sizeBytes: item.file.size,
      });
      if (!session.ok) {
        const msg =
          session.reason === "disabled"
            ? tdr("notEnabled")
            : tdr("unavailable");
        patch(item.localId, { status: "error", error: msg });
        toast.error(msg);
        return;
      }
      const res = await uploadViaProxy(session.uploadUrl, item.file, (pct) =>
        patch(item.localId, { progress: pct }),
      );
      await backend.confirm({
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
      // Surface le message réel (ConvexError métier OU Error d'upload avec le
      // code HTTP) pour un diagnostic utile côté créateur/fondateur.
      const msg =
        e instanceof ConvexError && typeof e.data === "string"
          ? e.data
          : e instanceof Error
            ? e.message
            : tdr("uploadFailed");
      patch(item.localId, { status: "error", error: msg });
    }
  }

  function enqueue(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const batch: UploadItem[] = [];
    for (const file of files) {
      if (file.size > limits.maxBytes) {
        toast.error(copy.tooBig(file.name));
        continue;
      }
      const kind = classifyDriveKind(file.type, file.name);
      if (kind === "other" || !limits.kinds.includes(kind)) {
        toast.error(copy.wrongKind(file.name));
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
          <p className="text-sm font-medium text-slate-700">{copy.title}</p>
          <p className="text-xs text-slate-500">{copy.hint}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          className="h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm"
        >
          {copy.button}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={limits.accept}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) enqueue(e.target.files);
            e.target.value = "";
          }}
          aria-label={copy.button}
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-2" aria-label={tdr("sending")} aria-busy={active}>
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
                    {formatBytes(it.size, loc)}
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
                    <CircleCheckIcon className="size-3.5" />{tdr("sent")}</p>
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
                  <RotateCwIcon className="size-3.5" />{tdr("retry")}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

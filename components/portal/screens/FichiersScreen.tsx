"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { useViewAs } from "@/components/portal/ViewAsContext";
import {
  DriveUploader,
  type DriveUploadCopy,
  type DriveUploadLimits,
} from "@/components/portal/DriveUploader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FilmIcon, ImageIcon, FilesIcon, InboxIcon } from "lucide-react";
import { isSnytchProject, classifyDriveKind, formatBytes } from "@/lib/snytch-drive";
import { formatDate } from "@/lib/format";

/**
 * « Dépôt de contenu » — écran créateur SNYTCH UNIQUEMENT. Le créateur dépose
 * ses vidéos/photos (upload direct navigateur → son dossier Google Drive) et voit
 * la liste de ce qu'il a déposé. Il ne voit JAMAIS Google Drive lui-même (aucun
 * lien Drive exposé). Aucune vue admin in-app : en mode « voir l'espace d'un
 * créateur », on affiche juste un rappel (le fondateur accède aux fichiers via
 * son Drive) — pas de chemin de données admin (cohérent avec le périmètre).
 */

// Table de CLÉS i18n, pas de libellés : la valeur stockée (`kind`) ne bouge
// pas, seule sa traduction est résolue au rendu.
const KIND_LABEL_KEY: Record<"video" | "photo" | "other", string> = {
  video: "fichiers.kind.video",
  photo: "fichiers.kind.photo",
  other: "fichiers.kind.other",
};

/**
 * Bornes et libellés du dépôt PARTENAIRE — repris à l'identique de ce que
 * DriveUploader portait en dur avant d'être partagé avec l'espace talent (5 Go,
 * vidéos + photos, extensions Apple). Aucun changement de comportement ici.
 */
const PARTNER_LIMITS: DriveUploadLimits = {
  maxBytes: 5 * 1024 * 1024 * 1024,
  accept: "video/*,image/*,.mov,.MOV,.heic,.HEIC,.heif",
  kinds: ["video", "photo"],
};

const PARTNER_COPY: DriveUploadCopy = {
  title: "Glisse tes vidéos et photos ici",
  hint: "Vidéos et photos (iPhone .mov / .heic acceptés) — jusqu'à 5 Go",
  button: "Choisir des fichiers",
  tooBig: (name) => `${name} : trop lourd (5 Go max).`,
  wrongKind: (name) => `${name} : accepte uniquement vidéos et photos.`,
};

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        {title}
      </h1>
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-500">
          {body}
        </CardContent>
      </Card>
    </div>
  );
}

export default function FichiersScreen() {
  const { current } = useCreatorProject();
  const va = useViewAs();
  const snytch = isSnytchProject(current.slug);
  const files = useQuery(
    api.snytchDrive.listMyDriveFiles,
    snytch && !va ? { projectId: current.projectId } : "skip",
  );
  const getUploadSession = useAction(api.snytchDrive.getUploadSession);
  const confirmUpload = useMutation(api.snytchDrive.confirmUpload);

  // Mode admin « voir l'espace d'un créateur » : pas de vue fichiers in-app.
  if (va) {
    return (
      <Notice
        title="Dépôt de contenu"
        body="Les fichiers déposés par le créateur sont accessibles directement dans le Google Drive du projet. Il n'y a pas de vue des fichiers dans l'app."
      />
    );
  }

  // Défense en profondeur : la nav ne pointe ici que pour Snytch.
  if (!snytch) {
    return (
      <Notice
        title="Dépôt de contenu"
        body="Le dépôt de fichiers n'est pas disponible pour ce projet."
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Dépôt de contenu
        </h1>
        <p className="text-sm text-slate-500">
          Dépose ici tes vidéos et photos. Elles sont envoyées directement dans
          ton dossier — pas besoin de compte Drive.
        </p>
      </header>

      <DriveUploader
        backend={{
          requestSession: (args) =>
            getUploadSession({ projectId: current.projectId, ...args }),
          confirm: (args) =>
            confirmUpload({ projectId: current.projectId, ...args }),
        }}
        limits={PARTNER_LIMITS}
        copy={PARTNER_COPY}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Ce que tu as déposé
        </h2>
        {files === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : files.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-slate-500">
              <InboxIcon className="size-6 text-slate-300" />
              Tu n&apos;as encore rien déposé.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {files.map((f) => {
              const kind = classifyDriveKind(f.mimeType, f.fileName);
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
                >
                  <span className="shrink-0 text-slate-400">
                    {kind === "video" ? (
                      <FilmIcon className="size-5" />
                    ) : kind === "photo" ? (
                      <ImageIcon className="size-5" />
                    ) : (
                      <FilesIcon className="size-5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {f.fileName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {KIND_LABEL_KEY[kind]} · {formatBytes(f.sizeBytes)} ·{" "}
                      {formatDate(f.uploadedAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

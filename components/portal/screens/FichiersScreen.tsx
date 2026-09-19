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
import { classifyDriveKind, formatBytes } from "@/lib/snytch-drive";
import { formatDate } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useTranslations } from "next-intl";

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
//
// ⚠️ La table était affichée TELLE QUELLE (`{KIND_LABEL_KEY[kind]}`) : chaque
// fichier déposé portait « fichiers.kind.video » en toutes lettres, en français
// comme en anglais, depuis l'extraction du 2026-08-22. Les clés sont désormais
// complètes et passent par `t()`.
const KIND_LABEL_KEY = {
  video: "kind.video",
  photo: "kind.photo",
  other: "kind.other",
} as const;

/**
 * Bornes du dépôt PARTENAIRE — reprises à l'identique de ce que DriveUploader
 * portait en dur avant d'être partagé avec l'espace talent (5 Go, vidéos +
 * photos, extensions Apple). Les libellés vivent dans `drive.partner.*`.
 */
const PARTNER_LIMITS: DriveUploadLimits = {
  maxBytes: 5 * 1024 * 1024 * 1024,
  accept: "video/*,image/*,.mov,.MOV,.heic,.HEIC,.heif",
  kinds: ["video", "photo"],
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
  const t = useTranslations("portal.fichiers");
  const td = useTranslations("drive.partner");
  const loc = useIntlLocale();
  const partnerCopy: DriveUploadCopy = {
    title: td("title"),
    hint: td("hint"),
    button: td("button"),
    tooBig: (name) => td("tooBig", { name }),
    wrongKind: (name) => td("wrongKind", { name }),
  };
  const { current } = useCreatorProject();
  const va = useViewAs();
  // Même décision que le serveur (confirmUpload, openUploadSession) : le
  // portail suit l'interrupteur admin au lieu de comparer le slug.
  const open = current.fileDropEnabled;
  const files = useQuery(
    api.snytchDrive.listMyDriveFiles,
    open && !va ? { projectId: current.projectId } : "skip",
  );
  const getUploadSession = useAction(api.snytchDrive.getUploadSession);
  const confirmUpload = useMutation(api.snytchDrive.confirmUpload);

  // Mode admin « voir l'espace d'un créateur » : pas de vue fichiers in-app.
  if (va) {
    return (
      <Notice title={t("title")} body={t("viewAsBody")} />
    );
  }

  // Défense en profondeur : la nav ne pointe ici que si le dépôt est ouvert.
  if (!open) {
    return (
      <Notice title={t("title")} body={t("unavailableBody")} />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {t("title")}
        </h1>
        <p className="text-sm text-slate-500">{t("subtitle")}</p>
      </header>

      <DriveUploader
        backend={{
          requestSession: (args) =>
            getUploadSession({ projectId: current.projectId, ...args }),
          confirm: (args) =>
            confirmUpload({ projectId: current.projectId, ...args }),
        }}
        limits={PARTNER_LIMITS}
        copy={partnerCopy}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          {t("deposited")}
        </h2>
        {files === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : files.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-slate-500">
              <InboxIcon className="size-6 text-slate-300" />
              {t("empty")}
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
                      {t(KIND_LABEL_KEY[kind])} · {formatBytes(f.sizeBytes, loc)} ·{" "}
                      {formatDate(f.uploadedAt, loc)}
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

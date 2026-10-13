"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BlockInstruction } from "@/components/scripts/ScriptDestinationZones";
import { DownloadIcon, FileTextIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

export type ScriptConversationFileView = {
  storageId: string;
  name: string;
  kind: "export" | "image";
  size: number;
  /** URL signée : toujours pour une image ; pour un export, seulement en aperçu admin (fichier brut). */
  url: string | null;
};

/**
 * La CONVERSATION d'une vidéo (brique optionnelle, cf convex/scriptConversation)
 * — ce que la créatrice télécharge pour l'importer dans l'app pendant le
 * tournage : l'export WhatsApp et/ou les captures, avec ce que raconte la conv
 * et la consigne de la brique.
 *
 * L'export ne se télécharge JAMAIS par son URL brute dans la fiche : il passe
 * par `onDownloadExport`, qui le personnalise (dates du jour, prénom de la
 * créatrice). Sans ce rappel (aperçu admin), le lien brut sert à vérifier le
 * fichier déposé.
 *
 * Réutilisée par la fiche créatrice et l'aperçu admin (« ce que verra la
 * créatrice »).
 */
export function ScriptConversationCard({
  text,
  instruction = null,
  files,
  onDownloadExport,
  className,
}: {
  text: string;
  instruction?: string | null;
  files: readonly ScriptConversationFileView[];
  onDownloadExport?: (file: ScriptConversationFileView) => Promise<void>;
  className?: string;
}) {
  const t = useTranslations("portal.script");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function download(f: ScriptConversationFileView) {
    if (!onDownloadExport) return;
    setBusy(f.storageId);
    setFailed(false);
    try {
      await onDownloadExport(f);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  const exports = files.filter((f) => f.kind === "export");
  const images = files.filter((f) => f.kind === "image");

  return (
    <Card className={className} data-testid="script-conversation">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span aria-hidden>💬</span>
          {t("conversationTitle")}
        </CardTitle>
        <CardDescription>{t("conversationHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {text && (
          <p
            className="whitespace-pre-wrap break-words text-sm text-slate-900"
            data-testid="script-conversation-text"
          >
            {text}
          </p>
        )}
        <BlockInstruction text={instruction} label={t("instruction")} />

        {exports.map((f) => (
          <div
            key={f.storageId}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
            data-testid="script-conversation-export"
          >
            <FileTextIcon className="size-5 shrink-0 text-emerald-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{f.name}</p>
              <p className="text-xs text-slate-500">{t("conversationExport")}</p>
            </div>
            {onDownloadExport ? (
              <Button
                size="sm"
                className="h-11 w-full sm:h-8 sm:w-auto"
                onClick={() => download(f)}
                disabled={busy !== null}
              >
                {busy === f.storageId ? (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                ) : (
                  <DownloadIcon className="mr-2 size-4" />
                )}
                {t("conversationDownload")}
              </Button>
            ) : f.url ? (
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                {t("conversationOpen")}
              </a>
            ) : null}
          </div>
        ))}
        {failed && (
          <p className="text-sm text-rose-600" role="alert">
            {t("conversationDownloadError")}
          </p>
        )}

        {images.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">{t("conversationImagesHint")}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((f) =>
                f.url ? (
                  <a
                    key={f.storageId}
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-md border border-slate-200 bg-slate-100"
                    title={f.name}
                    data-testid="script-conversation-image"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL signée du storage, servie telle quelle */}
                    <img
                      src={f.url}
                      alt={f.name}
                      className="aspect-[9/19.5] w-full object-cover object-top"
                    />
                  </a>
                ) : null,
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

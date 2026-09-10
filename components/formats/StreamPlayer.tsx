"use client";

import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { streamIframeUrl } from "@/lib/cloudflare-stream";

/**
 * Player Cloudflare Stream — lit la vidéo TRANSCODÉE par Stream (HEVC iPhone
 * inclus) dans une iframe, inline. Rendu quand la soumission a un UID Stream
 * "ready". L'état "processing" affiche un message d'attente : la réactivité
 * Convex (listVideoSubmitted re-tourne quand le poll serveur passe à "ready")
 * remplace ce message par le player, sans action de l'admin.
 *
 * SANS lien de download (cohérent avec <VideoExample>) ; le bouton « Télécharger
 * la vidéo » (#56) reste géré séparément sur le fichier ORIGINAL Convex.
 */
export function StreamPlayer({
  uid,
  status,
  title,
}: {
  uid: string;
  status: "processing" | "ready" | "error";
  title?: string;
}) {
  const tsp = useTranslations("stream");
  const t = useTranslations("portal");
  if (status === "ready") {
    return (
      <figure className="space-y-1.5">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-black">
          <iframe
            src={streamIframeUrl(uid)}
            title={title || t("stream.submitted")}
            allow="accelerometer; gyroscope; encrypted-media; picture-in-picture;"
            allowFullScreen
            className="aspect-video w-full"
            data-testid="stream-player"
          />
        </div>
        {title && (
          <figcaption className="text-xs text-slate-500">{title}</figcaption>
        )}
      </figure>
    );
  }

  // "processing" — transcoding en cours (le player apparaîtra automatiquement).
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500"
      data-testid="stream-processing"
    >
      <Loader2Icon className="size-6 animate-spin text-slate-400" />
      <p>
        {tsp("transcoding")}
      </p>
    </div>
  );
}

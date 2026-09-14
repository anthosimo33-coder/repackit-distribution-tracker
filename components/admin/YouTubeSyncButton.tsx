"use client";

import { api } from "@/convex/_generated/api";
import { SyncButton } from "@/components/admin/SyncButton";
import { useTranslations } from "next-intl";

/**
 * Déclenchement MANUEL du relevé des vues YouTube (sans attendre le cron de 8h).
 * Fin wrapper de SyncButton — la logique (état, toast d'erreur) est partagée.
 */
export function YouTubeSyncButton() {
  const tr = useTranslations("admin.dashboard.YouTubeSyncButton");
  return (
    <SyncButton
      mutation={api.youtubeSync.requestYouTubeSync}
      idleLabel={tr("synchroniserYoutube")}
      title={tr("synchroniserLesVuesYoutubeMaintenant")}
    />
  );
}

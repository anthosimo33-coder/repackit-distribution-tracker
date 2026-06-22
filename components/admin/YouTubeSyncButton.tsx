"use client";

import { api } from "@/convex/_generated/api";
import { SyncButton } from "@/components/admin/SyncButton";

/**
 * Déclenchement MANUEL du relevé des vues YouTube (sans attendre le cron de 8h).
 * Fin wrapper de SyncButton — la logique (état, toast d'erreur) est partagée.
 */
export function YouTubeSyncButton() {
  return (
    <SyncButton
      mutation={api.youtubeSync.requestYouTubeSync}
      idleLabel="Synchroniser YouTube"
      title="Synchroniser les vues YouTube maintenant"
    />
  );
}

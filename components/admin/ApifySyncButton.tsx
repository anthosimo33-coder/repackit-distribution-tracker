"use client";

import { api } from "@/convex/_generated/api";
import { SyncButton } from "@/components/admin/SyncButton";

/**
 * Déclenchement MANUEL du relevé des vues TikTok/Instagram via Apify (sans
 * attendre le cron de 8h UTC). Fin wrapper de SyncButton — la logique (état,
 * toast d'erreur) est partagée.
 */
export function ApifySyncButton() {
  return (
    <SyncButton
      mutation={api.apifySync.requestApifySync}
      idleLabel="Synchroniser TikTok/Insta"
      title="Synchroniser les vues TikTok/Instagram maintenant"
    />
  );
}

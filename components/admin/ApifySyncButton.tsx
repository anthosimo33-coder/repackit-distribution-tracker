"use client";

import { api } from "@/convex/_generated/api";
import { SyncButton } from "@/components/admin/SyncButton";
import { useTranslations } from "next-intl";

/**
 * Déclenchement MANUEL du relevé des vues TikTok/Instagram via Apify (sans
 * attendre le cron de 8h UTC). Fin wrapper de SyncButton — la logique (état,
 * toast d'erreur) est partagée.
 */
export function ApifySyncButton() {
  const tr = useTranslations("admin.dashboard.ApifySyncButton");
  return (
    <SyncButton
      mutation={api.apifySync.requestApifySync}
      idleLabel={tr("synchroniserTiktokInsta")}
      title={tr("synchroniserLesVuesTiktokInstagram")}
    />
  );
}

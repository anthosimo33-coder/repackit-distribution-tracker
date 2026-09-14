"use client";

import { api } from "@/convex/_generated/api";
import { SyncButton } from "@/components/admin/SyncButton";
import { useTranslations } from "next-intl";

/**
 * Bouton « Synchroniser » du module Radar — RÉUTILISE le SyncButton générique
 * (état pending/done, planification asynchrone, réactivité Convex). Déclenche
 * api.radar.requestRadarSync (clé RADAR, tous les comptes du projet).
 */
export function RadarSyncButton() {
  const tr = useTranslations("admin.ops.RadarSyncButton");
  return (
    <SyncButton
      mutation={api.radar.requestRadarSync}
      idleLabel={tr("synchroniser")}
      title={tr("recupererLesDernieresVideosDes")}
    />
  );
}

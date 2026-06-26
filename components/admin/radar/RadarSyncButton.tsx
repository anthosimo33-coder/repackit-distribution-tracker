"use client";

import { api } from "@/convex/_generated/api";
import { SyncButton } from "@/components/admin/SyncButton";

/**
 * Bouton « Synchroniser » du module Radar — RÉUTILISE le SyncButton générique
 * (état pending/done, planification asynchrone, réactivité Convex). Déclenche
 * api.radar.requestRadarSync (clé RADAR, tous les comptes du projet).
 */
export function RadarSyncButton() {
  return (
    <SyncButton
      mutation={api.radar.requestRadarSync}
      idleLabel="Synchroniser"
      title="Récupérer les dernières vidéos des comptes suivis"
    />
  );
}

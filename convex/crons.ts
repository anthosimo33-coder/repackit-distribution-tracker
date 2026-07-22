import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Crons Convex. Auto-découvert (convex/crons.ts) — pas de config supplémentaire.
 *
 * ⚠️ FUSEAU — Convex planifie en UTC ; il ne gère pas les fuseaux nativement.
 * Choix (simplicité, cf brief) : heure UTC FIXE à 07:00.
 *   - 07:00 UTC = 08:00 Europe/Paris en HIVER (CET, UTC+1).
 *   - 07:00 UTC = 09:00 Europe/Paris en ÉTÉ (CEST, UTC+2).
 * Décalage réel : +1h l'été. Pour un point/jour à heure ~fixe de tracking de
 * vues, c'est sans impact (les fenêtres analytics J+X prennent le snapshot le
 * plus proche, cf findMatchingSnapshot). Si un 8h Paris EXACT toute l'année
 * devient nécessaire, basculer sur un cron HORAIRE qui ne s'exécute que lorsque
 * l'heure de Paris vaut 8h (calcul du décalage DST).
 */
const crons = cronJobs();

crons.daily(
  "daily-youtube-views",
  { hourUTC: 7, minuteUTC: 0 },
  internal.youtubeSync.runDailySync,
  {},
);

// Tracking auto TikTok/Instagram via Apify (calqué sur YouTube). DÉCALÉ à 08:00
// UTC (1h après YouTube) pour ne pas lancer tous les relevés en même temps —
// Apify est payant/limité, on étale la charge. Même robustesse de bord de jour
// (bucketisation UTC dans upsertApifySnapshot). Cf convex/apifySync.ts.
crons.daily(
  "daily-tiktok-insta-views",
  { hourUTC: 8, minuteUTC: 0 },
  internal.apifySync.runDailySync,
  {},
);

// RADAR (veille TikTok, module séparé) — sync des comptes favoris 2×/SEMAINE
// (lundi + jeudi) et NON quotidien : on reste dans le quota Apify gratuit du
// COMPTE RADAR distinct. 09:00 UTC (après les relevés créateurs 07/08h) pour
// étaler la charge. Aucun arg → tous les comptes Radar, tous projets confondus.
// Distinct des crons créateurs ci-dessus (ne pas les fusionner).
crons.weekly(
  "radar-sync-monday",
  { dayOfWeek: "monday", hourUTC: 9, minuteUTC: 0 },
  internal.radar.runRadarSync,
  {},
);
crons.weekly(
  "radar-sync-thursday",
  { dayOfWeek: "thursday", hourUTC: 9, minuteUTC: 0 },
  internal.radar.runRadarSync,
  {},
);

// Revenu Whop (rentabilité P2) — ingestion HORAIRE des paiements de chaque projet
// configuré (projects.whop) via l'API Whop. Un délai ~1h est acceptable (pas de
// temps réel, pas de webhook). Idempotent (dédup par whopId) → re-synchroniser ne
// duplique pas. minuteUTC:30 pour décaler des relevés de vues (07/08/09h UTC).
// Aucun arg → tous les projets configurés. Cf convex/whopSync.ts.
crons.hourly(
  "whop-revenue-sync",
  { minuteUTC: 30 },
  internal.whopSync.runHourlySync,
  {},
);

export default crons;

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

export default crons;

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

// Agrégats PostHog (hub Analytics) — ingestion HORAIRE des métriques produit de
// chaque projet configuré (projects.posthog) via l'API HogQL. L'API est lente et
// rate-limitée : on ne l'appelle JAMAIS dans le rendu, les queries lisent le
// cache (posthogCache). Un délai ~1h est acceptable (pilotage, pas de temps
// réel) et un bouton « Actualiser » replanifie à la demande. Idempotent (upsert
// par (projet, key)). minuteUTC:45 pour décaler de la sync Whop (:30) et des
// relevés de vues (07/08/09h UTC). Aucun arg → tous les projets configurés.
// Cf convex/posthogSync.ts.
crons.hourly(
  "posthog-analytics-sync",
  { minuteUTC: 45 },
  internal.posthogSync.runHourlySync,
  {},
);

// Rappels de deadline créateur (email) — QUOTIDIEN. Relance les missions qui
// échoient sous 48 h (retards inclus) et jamais encore relancées. 10:00 UTC :
// clair des relevés de vues (07/08/09h) et de la sync Whop (:30), et heure
// ouvrée en Europe. Anti-spam : marqueur assignments.deadlineReminderSentAt →
// une mission ne génère qu'UN rappel. No-op complet si l'env Resend est absente
// (dev/preview). Cf convex/emails.ts.
crons.daily(
  "creator-deadline-reminders",
  { hourUTC: 10, minuteUTC: 0 },
  internal.emails.runDeadlineReminders,
  {},
);

// Digest quotidien des notifications hors-app — UN message par projet configuré,
// et AUCUN message s'il n'y a rien à signaler (trois sections vides → pas
// d'envoi). 06:00 UTC = 08:00 Europe/Paris en ÉTÉ, 07:00 en HIVER : le décalage
// DST est ici sans conséquence (c'est un point du matin, pas une heure exacte),
// même arbitrage que l'en-tête de ce fichier. Clair des relevés de vues
// (07/08/09h) et des rappels créateurs (10h). No-op complet si aucun projet n'a
// de canal configuré. Cf convex/notifications.ts.
crons.daily(
  "daily-ops-digest",
  { hourUTC: 6, minuteUTC: 0 },
  internal.notifications.runDailyDigest,
  {},
);

// Balayage des blobs orphelins du File Storage — QUOTIDIEN. Filet de sécurité
// pour les uploads ABANDONNÉS (blob POSTé, mutation d'attache jamais passée) :
// aucune suppression de row ne peut les rattraper, ils ne sont référencés nulle
// part. 04:15 UTC — creux de nuit, clair des relevés de vues (07/08/09h) et des
// crons horaires (:30 Whop, :45 PostHog). Fenêtre de grâce de 24 h côté
// mutation → un upload en cours n'est JAMAIS touché. Cf convex/storageCleanup.ts.
crons.daily(
  "purge-orphan-storage-blobs",
  { hourUTC: 4, minuteUTC: 15 },
  internal.storageCleanup.purgerBlobsOrphelins,
  {},
);

export default crons;

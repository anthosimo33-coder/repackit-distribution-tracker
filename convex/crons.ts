import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Crons Convex. Auto-découvert (convex/crons.ts) — pas de config supplémentaire.
 *
 * ⚠️ FUSEAU — Convex planifie en UTC ; il ne gère pas les fuseaux nativement.
 * Deux traitements coexistent dans ce fichier, et le choix dépend de l'enjeu :
 *   - heure UTC FIXE quand une heure « à peu près » suffit (les crons de
 *     nettoyage, les syncs d'API) : le décalage d'une heure au changement
 *     d'heure est sans conséquence ;
 *   - cron HORAIRE + garde sur l'heure de Paris quand l'heure est PROMISE à un
 *     humain ou porte du sens métier (bilan du soir, relevé de fin de journée).
 * Le second est le remède annoncé de longue date pour le premier ; ne pas le
 * généraliser par principe, il coûte 23 exécutions à vide par jour.
 */
const crons = cronJobs();

// RELEVÉ DE VUES NOCTURNE — 23h30 EUROPE/PARIS, YouTube ET TikTok/Instagram.
//
// HORAIRE et non quotidien, avec garde sur l'heure de Paris (cf
// convex/nightlyViewsSync.ts) : à heure UTC fixe, « le relevé de 23h30 »
// tomberait à 22h30 tout l'hiver, et le snapshot cesserait de fermer la journée
// qu'il mesure — c'est précisément ce qu'on vient corriger.
//
// REMPLACE les anciens `daily-youtube-views` (07:00 UTC) et
// `daily-tiktok-insta-views` (08:00 UTC). Les garder EN PLUS aurait été payer
// deux fois : la bucketisation par jour UTC (upsertApifySnapshot) fait que le
// relevé du soir ÉCRASE celui du matin dans la même journée UTC.
//
// minuteUTC:30 est imposé par l'heure voulue (23h30 Paris) et coïncide donc avec
// `whop-revenue-sync` — collision assumée : l'un est un appel d'API léger,
// l'autre ne fait que planifier une chaîne de lots.
crons.hourly(
  "nightly-views-sync",
  { minuteUTC: 30 },
  internal.nightlyViewsSync.runNightlySync,
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

// BILAN DE FIN DE JOURNÉE — un message par créatrice ayant encore des posts
// prévus AUJOURD'HUI non publiés. HORAIRE, et c'est le point : chaque projet ne
// tire que lorsque l'heure de PARIS vaut son heure configurée (21 h par défaut).
//
// C'est exactement le remède annoncé dans l'en-tête de ce fichier : un cron
// quotidien à heure UTC fixe glisserait au changement d'heure d'octobre, et « le
// bilan de 21 h » arriverait à 20 h tout l'hiver. Pour un point de tracking de
// vues, une heure de décalage est sans conséquence ; pour un bilan de fin de
// journée annoncé à une heure précise, c'en est une.
//
// minuteUTC:15 — clair des crons horaires déjà posés (:30 Whop, :45 PostHog).
// L'action est un no-op complet pour tout projet dont ce n'est pas l'heure.
crons.hourly(
  "evening-unpublished-reports",
  { minuteUTC: 15 },
  internal.notifications.runEveningReports,
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

// Expiration des rushes jamais retenus — QUOTIDIEN. Un hook brut qui n'a pas
// servi en 60 jours n'a plus de valeur d'usage et son binaire encombre Drive :
// le rush passe `expired` et son fichier est purgé (métadonnées conservées).
// Ne touche QUE les rushes encore libres — un rush déjà retenu ne périme pas,
// la purge emporterait le binaire sous le clip en cours. 04:45 UTC : creux de
// nuit, juste après la purge des blobs orphelins (04:15) avec laquelle il partage
// la nature — du nettoyage — et clair de tous les relevés (07/08/09h) et des
// crons horaires (:30 Whop, :45 PostHog, sur d'autres heures). Idempotent :
// rejouer ne repasse pas sur ce qui est déjà expiré. Cf convex/rushes.ts.
crons.daily(
  "expire-unassigned-rushes",
  { hourUTC: 4, minuteUTC: 45 },
  internal.rushes.runExpiration,
  {},
);

export default crons;

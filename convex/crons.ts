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

// RELEVÉ RAPIDE — toutes les 30 min, aux minutes 5 et 35 UTC (donc Paris).
// Relève toutes les 2 h les posts TikTok/Instagram de moins de 36 h, pour que
// l'alerte « ce post décolle » ait de quoi s'évaluer : le relevé nocturne seul
// laissait un trou de plus de 30 h sur 15 % des posts (mesure du 2026-09-26).
//
// Un cron à 30 min pour une cadence de 2 h : le premier relevé d'un post part
// au plus 30 min après la saisie de son lien, au lieu d'attendre le prochain
// créneau de 2 h. La cadence elle-même est tenue post par post
// (cf convex/earlyTracking.ts), et un passage sans rien de dû ne fait qu'une
// lecture. `crons.cron` et non `crons.interval` : l'intervalle part de l'heure
// du déploiement, et la fenêtre de silence autour du relevé de 23 h 30 exige de
// savoir à quelles minutes on tombe. :05/:35 — clair des crons posés à :15, :30,
// :45 et :50.
crons.cron(
  "early-views-readings",
  "5,35 * * * *",
  internal.earlyReadings.runEarlyReadings,
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

// Compta (onglet Compta) — import HORAIRE du grand livre Whop (GET
// /financial_activity) de chaque projet configuré, depuis 3 jours avant la
// dernière écriture vue, + coût des scans du mois (PostHog). Idempotent (dédup
// par id de ligne). minuteUTC:20 — clair de la sync Whop (:30), de PostHog
// (:45), des crons à :15 et :50. Cf convex/compta.ts.
crons.hourly(
  "compta-ledger-sync",
  { minuteUTC: 20 },
  internal.compta.syncCompta,
  { mode: "incremental" },
);

// Compta — relecture QUOTIDIENNE depuis le début du mois précédent : rattrape
// une écriture postée avec une date plus ancienne que la fenêtre horaire.
// 03:20 UTC, heure creuse.
crons.daily(
  "compta-ledger-recent",
  { hourUTC: 3, minuteUTC: 20 },
  internal.compta.syncCompta,
  { mode: "recent" },
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

// ATTRIBUTION DE CONVERSION par créatrice — QUOTIDIEN, juste après le relevé de
// vues de 23h30. HORAIRE gardé sur l'heure de PARIS (même remède que
// nightly-views-sync) ; l'action collecte LA VEILLE (jour Paris complet) et
// backfille 30 jours au premier run d'un projet. minuteUTC:50 — clair des
// crons horaires posés (:15 bilans, :30 Whop+vues, :45 PostHog).
crons.hourly(
  "creator-conversions-sync",
  { minuteUTC: 50 },
  internal.conversionSync.runConversionSync,
  {},
);

// CLASSEMENT DU CYCLE PRÉ-CALCULÉ — toutes les 30 minutes (10 au départ : la
// mesure du 2026-09-20 a montré que le recalcul lui-même était devenu le 1er
// poste de lecture, 363 MB/jour). Le portail lit le
// résultat (leaderboardCache) au lieu de recalculer tout le projet à chaque
// affichage : c'était 45 % de la facture Convex (2026-09-15). Intervalle, pas
// heure fixe : c'est ce qui borne le retard du portail, quel que soit ce qui a
// fait bouger un montant (relevé, publication, barème, bascule de cycle).
// N'écrit rien si le classement n'a pas changé. Cf convex/leaderboardCache.ts.
crons.interval(
  "leaderboard-cache-refresh",
  { minutes: 30 },
  internal.leaderboardCache.refreshAll,
  {},
);

// ACCUEIL ADMIN PRÉ-CALCULÉ (décisions + total dû) — toutes les 30 minutes,
// même recette et même cadence que le classement ci-dessus. Ces deux vues sont
// montées sur l'accueil admin et relisaient tout le projet à chaque écriture de
// la journée. N'écrit rien si le résultat n'a pas changé.
// Cf convex/dashboardCache.ts.
crons.interval(
  "admin-dashboard-cache-refresh",
  { minutes: 30 },
  internal.dashboardCache.refreshAll,
  {},
);

export default crons;

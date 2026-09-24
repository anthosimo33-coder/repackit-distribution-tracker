/**
 * LISTE DES TABLES de la suppression d'un projet — pure, lue par la purge
 * (convex/projectLifecycle.ts) et par sa garde (lib/project-lifecycle.test.ts).
 *
 * À part des règles de convex/projectLifecycleRules.ts : celles-ci sont aussi
 * importées par l'écran, pas cette liste, qui n'a rien à faire dans le
 * navigateur.
 */

/**
 * TABLES PURGÉES à la suppression d'un projet, DANS L'ORDRE de la purge.
 *
 * L'ordre n'est pas décoratif. Le projet est effacé AVANT ses données (tous les
 * crons qui parcourent `projects` l'ignorent dès lors), mais quelques relevés
 * parcourent encore des tables ENTIÈRES — les comptes surtout (relevé des
 * profils). Les comptes et les assignations partent donc en premier, et les
 * caches en dernier : un job déjà en vol qui réécrirait une ligne de cache
 * pendant la purge est alors rattrapé.
 *
 * Toute table portant un `projectId` doit figurer ici OU dans `HORS_PURGE` —
 * lib/project-lifecycle.test.ts le vérifie contre convex/schema.ts. Une table
 * ajoutée demain sans être rangée fait échouer la CI au lieu de laisser des
 * lignes orphelines.
 */
export const TABLES_PURGEES = [
  "comptes",
  "assignments",
  "publications",
  "metricSnapshots",
  "accountProfileSnapshots",
  "publicationFlagChanges",
  "publicationUrlChanges",
  "creators",
  "creatorContracts",
  "creatorConversions",
  "rushes",
  "bonusUnlocks",
  "payments",
  "managerPayouts",
  "challengeWins",
  "challenges",
  "hooks",
  "hookGraduations",
  "scriptBricks",
  "scriptCampaigns",
  "formats",
  "pricings",
  "bonusTemplates",
  "inspirations",
  "folders",
  "assets",
  "assetFolders",
  "personnes",
  "icps",
  "filterPresets",
  "publicShares",
  "projectGuide",
  "guideModules",
  "radarVideos",
  "radarAccounts",
  "whopPayments",
  "whopMemberships",
  "whopPlans",
  "marketGroups",
  "offerChanges",
  "notificationWindows",
  "permissionChanges",
  "syncMarkers",
  "leaderboardCache",
  "dashboardCache",
  "posthogCache",
  "posthogWindowCache",
] as const;

export type TablePurgee = (typeof TABLES_PURGEES)[number];

/**
 * Tables à `projectId` que la boucle de purge ne parcourt PAS elle-même, avec
 * la raison. Aucune n'est oubliée : chacune a son chemin.
 */
export const HORS_PURGE: Record<string, string> = {
  memberships:
    "effacés dans la MÊME transaction que le projet : l'accès doit tomber d'un coup",
  passwordResetTokens:
    "sans index projet ; effacés avec les membres du projet (par utilisateur)",
  invitations: "sans index projet ; effacées avec chaque créatrice (by_creator)",
  snytchDriveFiles:
    "sans index projet ; effacés avec chaque créatrice (by_creator) — les fichiers Drive eux-mêmes restent chez Google",
  challengeParticipants:
    "sans index projet ; effacés avec chaque défi (by_challenge)",
  radarTrendHashtags:
    "cache GLOBAL partagé entre projets (projectId vestigial, optionnel)",
  radarTrendVideos:
    "cache GLOBAL partagé entre projets (projectId vestigial, optionnel)",
  radarSearches:
    "cache GLOBAL partagé entre projets (projectId vestigial, optionnel)",
};

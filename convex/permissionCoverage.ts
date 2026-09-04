/**
 * GÉNÉRÉ — ne pas éditer à la main.
 *
 * Combien de LECTURES et d'ÉCRITURES chaque bloc de permission couvre.
 * L'écran de gestion des rôles en dérive le marqueur « Lecture » ou
 * « Lecture + modification » affiché à côté de chaque case : sans lui, on coche
 * sans savoir si on autorise à consulter ou à modifier.
 *
 * Régénérer :  node scripts/check-permission-coverage.mjs --write
 * Le contrôle D de ce même script échoue si ce fichier ne correspond plus au code.
 */
export type BlocCoverage = { queries: number; mutations: number };

export const PERMISSION_COVERAGE: Record<string, BlocCoverage> = {
  "accounts.manage": { queries: 5, mutations: 14 },
  "assignments.manage": { queries: 3, mutations: 13 },
  "business.read": { queries: 12, mutations: 2 },
  "challenges.money": { queries: 1, mutations: 3 },
  "challenges.run": { queries: 3, mutations: 7 },
  "content.analytics": { queries: 14, mutations: 0 },
  "creators.delete": { queries: 1, mutations: 1 },
  "creators.manage": { queries: 0, mutations: 5 },
  "creators.pay_terms": { queries: 1, mutations: 1 },
  "creators.read": { queries: 3, mutations: 0 },
  "guide.manage": { queries: 3, mutations: 5 },
  "legacy.access": { queries: 4, mutations: 3 },
  "library.manage": { queries: 11, mutations: 17 },
  "notifications.manage": { queries: 1, mutations: 1 },
  "payments.manage": { queries: 4, mutations: 5 },
  "pricing.manage": { queries: 5, mutations: 6 },
  "project.settings": { queries: 3, mutations: 3 },
  "radar.use": { queries: 6, mutations: 5 },
  "review.manage": { queries: 6, mutations: 4 },
  "scripts.manage": { queries: 9, mutations: 13 },
  "tracker.manage": { queries: 3, mutations: 10 },
};

/** Un bloc qui ne couvre AUCUNE écriture ne donne qu'un droit de consultation. */
export function couvreDesEcritures(bloc: string): boolean {
  return (PERMISSION_COVERAGE[bloc]?.mutations ?? 0) > 0;
}

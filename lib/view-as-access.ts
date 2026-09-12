/**
 * QUI PEUT OBSERVER L'ESPACE D'UNE CRÉATRICE — la règle d'affichage du bouton.
 *
 * ⚠️ CETTE FONCTION NE PROTÈGE RIEN. La barrière est
 * `requireCreatorViewableByAdmin` (convex/functions), qui exige le rôle ADMIN du
 * projet à chaque requête de l'observation. Ceci ne sert qu'à ne pas proposer
 * une porte qu'on sait fermée.
 *
 * ── POURQUOI ON CACHE ICI, ALORS QU'AILLEURS ON MONTRE ───────────────────────
 * La doctrine du dépôt (cf `canSeeRoute`) est « en cas de doute, on montre » :
 * cacher à tort casse un rôle en silence, montrer à tort coûte un refus propre.
 * Elle vaut pour le DOUTE. Ici il n'y en a aucun : un manager ne passera JAMAIS
 * la garde, quels que soient ses droits cochés — le rôle admin ne se coche pas.
 * Lui laisser « Voir son espace », l'action la plus visible de la fiche, c'est
 * lui promettre un écran qu'il ne verra pas. Constaté en prod le 10/09/2026 :
 * une manageuse cliquait et tombait sur « accès refusé ».
 *
 * Le doute, lui, est respecté : tant que le rôle n'est pas connu, on montre.
 */

/** Rôle projet tel que `usePermissions().role` le rend. */
export type RoleProjet = string | null;

export function canObserveCreatorSpace(opts: {
  role: RoleProjet;
  /** Les droits ne sont pas encore chargés : on ne cache rien. */
  chargement: boolean;
}): boolean {
  if (opts.chargement) return true;
  return opts.role === "admin" || opts.role === "superadmin";
}

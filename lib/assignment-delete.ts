/**
 * Garde-fou de SUPPRESSION (hard-delete) d'un assignment par l'admin. Pur & testé
 * (Vitest). RÉPLIQUE serveur dans convex/assignments.ts (règle A6 : convex/ ne
 * peut pas importer lib/) — toute évolution doit l'être là-bas.
 *
 * Un hard-delete LIBÈRE le comboKey occupé (unicité créateur+plateforme, cf
 * lib/script-combo-uniqueness) : plus d'assignment = plus d'occupation. Mais il
 * est BORNÉ aux statuts SÛRS — ceux sans empreinte financière/analytique :
 *
 *  - SUPPRIMABLES : todo, in_progress, video_submitted, video_rejected, to_publish
 *    (+ legacy submitted, rejected). Aucune publication n'est matérialisée et
 *    aucune lineItem de paie n'est accrue avant `published` → le hard-delete est
 *    propre (il ne reste qu'une éventuelle vidéo soumise à purger).
 *  - BLOQUÉS : published, paid (+ legacy validated). Ils portent une publication
 *    (analytics + snapshots) et/ou un paiement accru/réglé : les supprimer
 *    orphelinerait l'historique financier & statistique. On NE supprime JAMAIS
 *    par mégarde un assignment publié ou payé.
 */
import type { AssignmentStatus } from "./assignment-status";

/** Statuts pré-publication, sans publication ni paie rattachée → hard-delete sûr. */
export const DELETABLE_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  "todo",
  "in_progress",
  "video_submitted",
  "video_rejected",
  "to_publish",
  // LEGACY (équivalents pré-publication) :
  "submitted",
  "rejected",
];

const DELETABLE_SET = new Set<string>(DELETABLE_ASSIGNMENT_STATUSES);

/** L'admin peut-il hard-delete un assignment dans ce statut ? */
export function canDeleteAssignment(status: AssignmentStatus): boolean {
  return DELETABLE_SET.has(status);
}

/**
 * Statuts depuis lesquels l'admin peut ABANDONNER une assignation.
 *
 * Même frontière que le hard-delete : tout ce qui n'a ni publication
 * matérialisée ni paie accrue. La différence est la TRACE — « Abandonner »
 * garde la ligne en base (auditable, filtrable, et le combo est libéré par le
 * statut), « Supprimer » l'efface. L'abandon est le geste courant ; la
 * suppression reste réservée aux erreurs de manipulation.
 *
 * `cancelled` n'y figure pas : abandonner deux fois n'a pas de sens (la
 * mutation est idempotente, elle ne re-patche pas).
 */
export function canCancelAssignment(status: AssignmentStatus): boolean {
  return DELETABLE_SET.has(status);
}

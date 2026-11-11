/**
 * Module PUR — extrait de convex/scripts.ts pour être lu aussi par
 * convex/assignments.ts (qui ne peut pas importer scripts.ts : scripts.ts
 * l'importe déjà). Une seule définition, deux lecteurs.
 */

/**
 * Statuts qui NE CONSOMMENT PAS un comboKey — ni dans ce qu'une créatrice a
 * « déjà fait » (la préférence du tirage, cf convex/comboRecency), ni pour la
 * fenêtre de cooldown.
 *
 * Le principe des deux lectures est le même : ce qui est DÉJÀ SORTI. Une assignation abandonnée ou dont la vidéo a été refusée n'a jamais
 * été publiée — il n'y a rien à protéger, et garder le combo réservé
 * appauvrirait le pool pour rien.
 *
 * ⚠️ Le simple RETARD ne libère pas : une assignation en retard mais vivante
 * (todo, in_progress, video_submitted, to_publish) continue de réserver son
 * combo. C'est l'ABANDON qui libère, jamais l'attente.
 */
export const COMBO_FREEING_STATUSES: ReadonlySet<string> = new Set([
  "video_rejected",
  "cancelled",
]);

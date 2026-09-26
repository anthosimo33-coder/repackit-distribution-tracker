/**
 * Module PUR — extrait de convex/scripts.ts pour être lu aussi par
 * convex/assignments.ts (qui ne peut pas importer scripts.ts : scripts.ts
 * l'importe déjà). Une seule définition, deux lecteurs.
 */

/**
 * Statuts qui NE CONSOMMENT PAS un comboKey — ni pour l'unicité à vie, ni pour
 * la fenêtre de cooldown.
 *
 * Le principe des deux protections est le même : ne pas re-servir un contenu
 * DÉJÀ VU. Une assignation abandonnée ou dont la vidéo a été refusée n'a jamais
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

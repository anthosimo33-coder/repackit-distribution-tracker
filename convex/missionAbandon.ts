/**
 * ABANDONNER / RÉTABLIR une mission — les règles PURES (le serveur :
 * convex/assignments cancelAssignmentCore et restoreAssignmentCore ; l'écran et
 * les tests : lib/mission-abandon).
 *
 * L'abandon garde la ligne : la mission reste dans la liste, statut
 * « Abandonnée », et chaque geste laisse une trace (`assignmentStatusEvents` :
 * qui, quand, depuis quel statut, créatrice prévenue ou non). « Rétablir » relit
 * cette trace pour remettre le statut EXACT d'avant le dernier abandon.
 */

export interface StatusEvent {
  action: "cancelled" | "restored";
  from: string;
  to: string;
  at: number;
}

/**
 * Le statut que « Rétablir » remet : celui d'avant le DERNIER abandon tracé.
 *
 * Un abandon d'avant la trace (avant octobre 2026) n'en a pas : le statut est
 * alors DÉDUIT, et dit comme tel (`exact: false`) — « vidéo envoyée » si un
 * fichier est là (l'équipe la revoit en Validation), « à faire » sinon.
 */
export function statutARetablir(
  events: readonly StatusEvent[],
  aUneVideo: boolean,
): { status: string; exact: boolean } {
  const dernier = [...events].sort((x, y) => y.at - x.at).find((e) => e.action === "cancelled");
  if (dernier) return { status: dernier.from, exact: true };
  return { status: aUneVideo ? "video_submitted" : "todo", exact: false };
}

/**
 * CRÉNEAU DE SORTIE d'une vidéo en attente de revue — « ça sort quand ? ».
 *
 * La file de validation est classée par date de PUBLICATION prévue (côté
 * serveur, cf convex/assignments.compareByPostDate). Ce module ne trie rien : il
 * NOMME, pour chaque ligne, le créneau auquel elle appartient, de sorte que
 * « demain » se repère sans lire une date.
 *
 * ⚠️ Le repère est le JOUR LOCAL de l'admin — même convention que le calendrier
 * de pilotage et que lib/creator-schedule. Comparer des timestamps bruts ferait
 * basculer « demain » à « aujourd'hui » selon l'heure de la journée : une vidéo
 * prévue demain à minuit est à 2 h d'ici quand on la relit à 22 h, et resterait
 * pourtant « demain » pour l'humain qui la lit.
 *
 * PUR (`now` injecté) → testé en Vitest. Aucune réplique serveur : le serveur
 * trie, le client étiquette, ils ne partagent aucune règle.
 */

export type ReviewSlot =
  /** Le jour prévu est PASSÉ et la vidéo n'est même pas validée. */
  | "overdue"
  /** À publier aujourd'hui. */
  | "today"
  /** À publier demain — le créneau que la file doit rendre évident. */
  | "tomorrow"
  /** Plus tard, à une date connue. */
  | "upcoming"
  /** Aucune date de publication planifiée. */
  | "undated";

/** Index de jour LOCAL (année/mois/jour), comme lib/creator-schedule. */
function dayIndex(ts: number): number {
  const d = new Date(ts);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

/**
 * Écart en JOURS CALENDAIRES locaux entre deux instants. Passe par minuit local
 * des deux dates plutôt que par une division de timestamps : un changement
 * d'heure (mars/octobre) rend une journée de 23 ou 25 h, et `(b - a) / 86400000`
 * répondrait alors 0,96 jour là où l'humain en compte 1.
 */
function dayDelta(from: number, to: number): number {
  const a = new Date(from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(to);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function reviewSlot(
  postDate: number | null | undefined,
  now: number,
): ReviewSlot {
  if (postDate == null) return "undated";
  if (dayIndex(postDate) === dayIndex(now)) return "today";
  if (postDate < now) return "overdue";
  return dayDelta(now, postDate) === 1 ? "tomorrow" : "upcoming";
}

/** Nombre de lignes dont la sortie est prévue DEMAIN (l'en-tête de la file). */
export function countTomorrow(
  rows: { postDate?: number | null }[],
  now: number,
): number {
  return rows.filter((r) => reviewSlot(r.postDate, now) === "tomorrow").length;
}

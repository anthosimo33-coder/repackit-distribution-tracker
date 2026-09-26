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
 * PUR (`now` injecté) → testé en Vitest. Vit dans convex/ (lib/review-queue le
 * ré-exporte) pour l'outil MCP `validation`, qui étiquette la MÊME file. Le
 * serveur, lui, tourne en UTC : il n'a pas de « jour local ». Il passe donc un
 * FUSEAU (`timeZone`, celui de l'équipe) ; sans fuseau, le jour local du
 * navigateur — le comportement de l'écran, inchangé.
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

/** Jour calendaire (a, m, j) d'un instant : LOCAL au navigateur, ou dans `timeZone`. */
function jourDe(ts: number, timeZone?: string): [number, number, number] {
  if (!timeZone) {
    const d = new Date(ts);
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  }
  const [a, m, j] = new Intl.DateTimeFormat("en-CA", { timeZone })
    .format(new Date(ts))
    .split("-")
    .map(Number);
  return [a, m, j];
}

/** Index de jour (année/mois/jour), comme lib/creator-schedule. */
function dayIndex(ts: number, timeZone?: string): number {
  const [a, m, j] = jourDe(ts, timeZone);
  return a * 10000 + m * 100 + j;
}

/**
 * Écart en JOURS CALENDAIRES locaux entre deux instants. Passe par minuit local
 * des deux dates plutôt que par une division de timestamps : un changement
 * d'heure (mars/octobre) rend une journée de 23 ou 25 h, et `(b - a) / 86400000`
 * répondrait alors 0,96 jour là où l'humain en compte 1.
 */
function dayDelta(from: number, to: number, timeZone?: string): number {
  if (timeZone) {
    // Deux jours CIVILS : leur écart se compte en UTC pur, sans heure d'été.
    const [a1, m1, j1] = jourDe(from, timeZone);
    const [a2, m2, j2] = jourDe(to, timeZone);
    return Math.round((Date.UTC(a2, m2 - 1, j2) - Date.UTC(a1, m1 - 1, j1)) / 86_400_000);
  }
  const a = new Date(from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(to);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function reviewSlot(
  postDate: number | null | undefined,
  now: number,
  /** Fuseau du repère ; absent = jour local du navigateur (l'écran). */
  timeZone?: string,
): ReviewSlot {
  if (postDate == null) return "undated";
  if (dayIndex(postDate, timeZone) === dayIndex(now, timeZone)) return "today";
  if (postDate < now) return "overdue";
  return dayDelta(now, postDate, timeZone) === 1 ? "tomorrow" : "upcoming";
}

/** Nombre de lignes dont la sortie est prévue DEMAIN (l'en-tête de la file). */
export function countTomorrow(
  rows: { postDate?: number | null }[],
  now: number,
  timeZone?: string,
): number {
  return rows.filter((r) => reviewSlot(r.postDate, now, timeZone) === "tomorrow").length;
}

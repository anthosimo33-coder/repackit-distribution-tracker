/**
 * CYCLE DE VIE D'UN RUSH — source unique des états, des transitions et de leurs
 * libellés.
 *
 * Module PUR (aucun import `_generated`) → importable côté client ET testable
 * depuis `lib/`, exactement comme `convex/roles.ts` et
 * `convex/creatorAssignmentFields.ts`. Il n'y a donc PAS de réplique `lib/` à
 * maintenir : la règle A6 interdit à `convex/` d'importer `lib/`, pas l'inverse.
 * Une paire à répliquer serait ici de la surface de dérive gratuite.
 *
 * LES ÉTATS
 *
 *   deposited  le talent a déposé le fichier, rien n'a encore été décidé
 *   assigned   un script a été monté dessus (chantier PR 4)
 *   published  le clip qui en est issu est sorti (chantier PR 6)
 *   rejected   l'admin l'écarte, avec un motif — binaire purgé
 *   expired    jamais retenu au bout de 60 jours — binaire purgé
 *
 * ⚠️ DEUX VOCABULAIRES, DÉLIBÉRÉMENT. En interne un rush est « assigned » : il
 * est apparié à un script. Le TALENT, lui, ne connaît ni script, ni clippeur, ni
 * appariement — de son point de vue son rush est accepté ou refusé. Il lit donc
 * « Validé ». Le vocabulaire système reste dans le code, il ne remonte pas à
 * l'écran (cf TALENT_STATUS_LABELS).
 */

/** Les cinq états d'un rush. */
export const RUSH_STATUSES = [
  "deposited",
  "assigned",
  "published",
  "rejected",
  "expired",
] as const;
export type RushStatus = (typeof RUSH_STATUSES)[number];

/**
 * Transitions AUTORISÉES, source de vérité unique. Ce qui n'y figure pas est
 * refusé — y compris les retours en arrière : un rush refusé ou expiré a vu son
 * binaire purgé, le ressusciter donnerait une ligne qui pointe un fichier
 * disparu.
 */
const ALLOWED_TRANSITIONS: Record<RushStatus, readonly RushStatus[]> = {
  // Un rush encore libre peut être retenu, écarté, ou périmer.
  deposited: ["assigned", "rejected", "expired"],
  // Retenu : il sort (publié) ou l'admin se ravise (rejet). Il ne PÉRIME PLUS —
  // l'expiration ne vise que le stock jamais exploité.
  assigned: ["published", "rejected"],
  // Terminaux.
  published: [],
  rejected: [],
  expired: [],
};

/** La transition `from → to` est-elle légale ? (`from === to` : non, no-op). */
export function canTransition(from: RushStatus, to: RushStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** États dont plus rien ne part. */
export function isTerminal(status: RushStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/** Le binaire Drive doit-il être purgé quand on entre dans cet état ? */
export function purgesBinary(status: RushStatus): boolean {
  return status === "rejected" || status === "expired";
}

/**
 * Libellés servis AU TALENT. « Validé » et non « Retenu » : le premier décrit ce
 * qu'elle vit, le second ce que fait le système. Aucun de ces libellés ne laisse
 * deviner qu'il existe des scripts, des comptes ou des clippeurs.
 */
export const TALENT_STATUS_LABELS: Record<RushStatus, string> = {
  deposited: "Déposé",
  assigned: "Validé",
  published: "Publié",
  rejected: "Refusé",
  expired: "Expiré",
};

/**
 * Délai au bout duquel un rush JAMAIS retenu périme (Q5 des arbitrages), en
 * millisecondes. 60 jours : au-delà, un hook brut n'a plus de valeur d'usage et
 * son binaire encombre Drive pour rien.
 */
export const RUSH_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Un rush déposé à `depositedAt` est-il périmé à l'instant `now` ?
 *
 * Comparaison STRICTE : à exactement 60 jours il ne l'est pas encore (le seuil
 * est une durée écoulée, pas un compte à rebours qui déclenche à zéro). `now`
 * est toujours INJECTÉ par l'appelant — c'est ce qui rend la règle prouvable en
 * test sans attendre deux mois.
 */
export function isRushExpired(depositedAt: number, now: number): boolean {
  return now - depositedAt > RUSH_EXPIRY_MS;
}

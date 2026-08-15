/**
 * PLAGE HORAIRE de publication — « publie entre 21 h et 23 h ».
 *
 * Module PUR (aucun import Convex) : importé par le serveur (validation à
 * l'écriture) ET par les composants React (rendu admin + créatrice), comme
 * convex/accountPhase et convex/postUrlDate le sont déjà. Une seule définition,
 * donc pas de réplique lib↔convex à tenir : la règle A6 interdit convex → lib,
 * pas l'inverse. Testé depuis lib/post-window.test.ts.
 *
 * ⚠️ MINUTES DEPUIS MINUIT LOCAL, jamais un timestamp. Une plage est une
 * intention d'horloge murale : « 21 h » veut dire 21 h à l'écran de la
 * créatrice, quel que soit le fuseau du serveur et de part et d'autre du
 * changement d'heure. Deux entiers ne peuvent pas dériver ; deux timestamps,
 * si (cf. le défaut de fuseau corrigé par #51/#52/#54).
 */

export interface PostWindow {
  /** Minutes depuis minuit local, début inclus. 0 = 00:00. */
  startMin: number;
  /** Minutes depuis minuit local, fin. 1440 = minuit du lendemain. */
  endMin: number;
}

/** Créneaux du process, proposés en un clic dans la modale d'assignation. */
export const POST_WINDOW_PRESETS: {
  id: string;
  label: string;
  window: PostWindow;
}[] = [
  { id: "midi", label: "Midi (11h-13h)", window: { startMin: 11 * 60, endMin: 13 * 60 } },
  { id: "apresmidi", label: "Après-midi (15h-17h)", window: { startMin: 15 * 60, endMin: 17 * 60 } },
  { id: "soir", label: "Soir (21h-23h)", window: { startMin: 21 * 60, endMin: 23 * 60 } },
];

/**
 * Plage exploitable ? Bornes dans la journée et début STRICTEMENT avant la fin
 * (une plage de durée nulle n'est pas une consigne, c'est une saisie ratée).
 * Entiers exigés : une demi-minute ne veut rien dire ici.
 */
export function isValidPostWindow(w: unknown): w is PostWindow {
  if (typeof w !== "object" || w === null) return false;
  const { startMin, endMin } = w as Record<string, unknown>;
  if (typeof startMin !== "number" || typeof endMin !== "number") return false;
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin)) return false;
  return startMin >= 0 && endMin <= 1440 && startMin < endMin;
}

/** "21h" ou "21h30" — l'heure ronde ne traîne pas de "00" inutile. */
function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** "21h-23h". `null` si la plage est absente ou invalide — jamais "undefined". */
export function formatPostWindow(w: PostWindow | null | undefined): string | null {
  if (!isValidPostWindow(w)) return null;
  return `${hhmm(w.startMin)}-${hhmm(w.endMin)}`;
}

/**
 * Phrase complète pour la créatrice.
 *
 * ⚠️ LE CAS SANS PLAGE EST LE CAS NORMAL : les 191 assignments antérieurs à ce
 * champ n'en ont pas, et une assignation peut légitimement rester sans consigne
 * d'heure. On rend alors « À publier le 15/08 » — pas de « entre  et  », pas de
 * « undefined », pas de tiret orphelin. Le jour est déjà formaté par l'appelant
 * (convex/dateFr) : cette fonction n'invente aucun fuseau.
 */
export function postWindowSentence(
  jourFormate: string,
  w: PostWindow | null | undefined,
): string {
  const plage = formatPostWindow(w);
  return plage === null
    ? `À publier le ${jourFormate}`
    : `À publier le ${jourFormate} entre ${hhmm(w!.startMin)} et ${hhmm(w!.endMin)}`;
}

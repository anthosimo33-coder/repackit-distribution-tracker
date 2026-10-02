/**
 * MESSAGE DE L'ÉQUIPE À UNE CRÉATRICE — le coach : un retour personnel écrit par
 * Claude, relu, puis envoyé par email au nom de l'équipe (le gabarit signe).
 * Module PUR, testé par Vitest (lib/message-equipe.test.ts).
 *
 * Le texte vient d'un modèle : il est ÉCHAPPÉ (jamais de HTML injecté), coupé en
 * paragraphes sur les lignes vides, borné en longueur. Une créatrice ne reçoit
 * pas plus d'un message de ce canal tous les 3 jours : un coach qui écrit tous
 * les jours devient du bruit.
 */

import { escapeHtml, p } from "./emailApi";

export const OBJET_MAX = 120;
export const MESSAGE_MAX = 2500;
export const DELAI_ENTRE_MESSAGES_MS = 3 * 86_400_000;

/** Un objet et un message envoyables, ou le problème. */
export function verifierMessage(objet: string, message: string): string | null {
  const o = objet.trim();
  const m = message.trim();
  if (o.length < 3) return "« objet » : l'objet de l'email, court.";
  if (o.length > OBJET_MAX) return `« objet » : ${OBJET_MAX} caractères au plus.`;
  if (m.length < 40) return "« message » : quelques phrases, adressées à la créatrice.";
  if (m.length > MESSAGE_MAX) return `« message » : ${MESSAGE_MAX} caractères au plus — fais plus court.`;
  return null;
}

/** Le corps HTML : paragraphes (lignes vides), retours à la ligne gardés, tout échappé. */
export function messageVersHtml(message: string): string {
  return message
    .trim()
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter((para) => para !== "")
    .map((para) => p(escapeHtml(para).replace(/\n/g, "<br>")))
    .join("");
}

/** Peut-on écrire à nouveau ? `null` = oui, sinon l'instant à partir duquel. */
export function prochainMessagePossible(dernier: number | null, maintenant: number): number | null {
  if (dernier === null) return null;
  const possible = dernier + DELAI_ENTRE_MESSAGES_MS;
  return possible <= maintenant ? null : possible;
}

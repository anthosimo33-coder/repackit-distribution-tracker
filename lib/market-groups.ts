/**
 * LES MARCHÉS COMPOSÉS — la règle, et ce qu'elle refuse.
 *
 * « Serbie + Croatie » se lit comme un seul marché : leurs coûts s'additionnent,
 * leurs revenus aussi, et le retour se calcule sur les totaux. Ce module tient
 * la règle qui rend ça possible, et il n'en tient qu'une.
 *
 * ── UN PAYS N'APPARTIENT QU'À UN SEUL MARCHÉ ────────────────────────────────
 * Ce n'est pas une commodité d'implémentation, c'est une condition de lecture.
 * Si la Serbie pouvait être dans « Balkans » ET dans « Europe de l'Est », son
 * coût apparaîtrait deux fois dans la même colonne, et le total du tableau ne
 * serait plus le total de rien. La partition est ce qui permet à la ligne
 * « tous marchés » d'être vraie.
 *
 * Le refus est donc porté ICI et par le SERVEUR : l'écran ne fait que l'annoncer
 * avant le clic.
 */

import type { MarcheCompose } from "../convex/marketDerive";

// Le type et la PARTITION vivent dans convex/marketDerive.ts, partagés avec l'outil
// MCP `marches`. Ce module garde la validation (et ses messages d'écran).
export { partitionMarches } from "../convex/marketDerive";
export type { MarcheCompose } from "../convex/marketDerive";

/** Bornes du nom d'un marché. Un nom vide rendrait la puce illisible. */
export const NOM_MIN = 1;
export const NOM_MAX = 40;


export type RefusDeMarche =
  | { code: "nom-vide"; message: string }
  | { code: "nom-trop-long"; message: string }
  | { code: "aucun-pays"; message: string }
  | { code: "pays-en-double"; message: string }
  | { code: "pays-deja-pris"; message: string; pays: string[]; marche: string };

/**
 * Le marché proposé est-il recevable, compte tenu de ceux qui existent déjà ?
 *
 * `null` = recevable. Sinon le refus porte un CODE (pour les tests et les
 * gardes) et un message (pour la personne devant l'écran) : une garde qui ne
 * rendrait qu'un message se testerait sur sa formulation, et casserait au
 * premier mot changé.
 */
export function refusDeMarche(
  candidat: { nom: string; pays: readonly string[] },
  existants: readonly MarcheCompose[],
  /** Le marché qu'on ÉDITE — il ne se fait pas concurrence à lui-même. */
  idEdite?: string,
): RefusDeMarche | null {
  const nom = candidat.nom.trim();
  if (nom.length < NOM_MIN) {
    return { code: "nom-vide", message: "Donne un nom à ce marché." };
  }
  if (nom.length > NOM_MAX) {
    return {
      code: "nom-trop-long",
      message: `Le nom d'un marché tient en ${NOM_MAX} caractères.`,
    };
  }
  if (candidat.pays.length === 0) {
    return { code: "aucun-pays", message: "Choisis au moins un pays." };
  }
  if (new Set(candidat.pays).size !== candidat.pays.length) {
    return {
      code: "pays-en-double",
      message: "Un pays ne peut pas être choisi deux fois.",
    };
  }

  // Un pays déjà pris ailleurs : on nomme le marché qui le détient, sinon la
  // personne doit chercher elle-même lequel des sept c'était.
  for (const autre of existants) {
    if (autre.id === idEdite) continue;
    const communs = candidat.pays.filter((p) => autre.pays.includes(p));
    if (communs.length > 0) {
      return {
        code: "pays-deja-pris",
        message: `${communs.join(", ")} appartient déjà au marché « ${autre.nom} ».`,
        pays: communs,
        marche: autre.nom,
      };
    }
  }
  return null;
}

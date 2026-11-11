/**
 * Ce qu'une créatrice a DÉJÀ FAIT, par (CRÉATEUR + PLATEFORME) — l'entrée de la
 * préférence du tirage. Ce n'est plus une unicité (décision du 11/11/2026,
 * tous projets) : un même comboKey (hook:flux:cta) peut revenir chez la même
 * créatrice sur la même plateforme. Le tirage prend d'abord un script qu'elle
 * n'a jamais fait, puis celui qu'elle a fait il y a le plus longtemps (cf
 * convex/comboRecency, module pur partagé avec le serveur).
 *
 *  - PAR créateur : ce qu'une autre créatrice a fait ne compte pas.
 *  - PAR plateforme : un script fait sur son TikTok reste neuf pour son YouTube.
 *  - « Même combo » = comboKey identique. Un fork de brique (#53) crée un
 *    nouveau brickId → nouveau comboKey → considéré neuf.
 *
 * Pur & testé (Vitest). Le serveur (convex/scripts.ts, `derniersPassagesDe`)
 * convertit ses missions vers le même `derniersPassages` ; ce module en est la
 * face lib, à la forme des lignes d'écran.
 */
import { derniersPassages } from "../convex/comboRecency";
import { COMBO_FREEING_STATUSES } from "../convex/comboFreeing";

export interface AssignmentComboUsage {
  creatorId: string;
  comboKey: string | null | undefined;
  /** Plateformes ciblées par l'assignment (1 assignment = 1+ posts). */
  platforms: string[];
  /**
   * Quand elle le dit : publication prévue, sinon réelle, sinon création de la
   * mission (cf convex/scripts `passageAt`).
   */
  usedAt: number;
  /**
   * Combo IMPOSÉ (« Rejouer ce script » / choix manuel). Une ligne imposée ne
   * compte pas comme « déjà fait » pour le tirage automatique (« un choix
   * manuel ne retire rien de la rotation »). Même règle côté serveur.
   */
  comboImposed?: boolean;
  /** Statut de l'assignment : abandonnée ou vidéo refusée = jamais sortie, ne compte pas. */
  status?: string;
}

/**
 * Dernier passage de chaque script chez ce créateur, sur AU MOINS UNE des
 * plateformes données (union : chaque nouvel assignment publie sur TOUTES ses
 * cibles, un script fait sur l'une est déjà fait pour l'assignment).
 */
export function lastUseForCreatorPlatforms(input: {
  creatorId: string;
  platforms: string[];
  existingAssignments: AssignmentComboUsage[];
}): Map<string, number> {
  return derniersPassages(
    input.existingAssignments.map((a) => ({
      creatorId: a.creatorId,
      comboKey: a.comboKey,
      platforms: a.platforms,
      at: a.usedAt,
      comboImposed: a.comboImposed,
      liberee: a.status !== undefined && COMBO_FREEING_STATUSES.has(a.status),
    })),
    { creatorId: input.creatorId, platforms: input.platforms },
  );
}

/** Les comboKeys déjà faits par ce créateur sur ces plateformes. */
export function usedComboKeysForCreatorPlatforms(input: {
  creatorId: string;
  platforms: string[];
  existingAssignments: AssignmentComboUsage[];
}): Set<string> {
  return new Set(lastUseForCreatorPlatforms(input).keys());
}

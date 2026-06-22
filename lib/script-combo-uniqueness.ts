/**
 * Unicité d'un combo de script par (CRÉATEUR + PLATEFORME). Un même comboKey
 * (hook:flux:cta) ne peut être assigné qu'UNE seule fois à un créateur donné
 * sur une plateforme donnée — sinon le créateur posterait deux fois le même
 * script mot pour mot sur deux comptes de la même plateforme.
 *
 *  - PAR créateur : deux créateurs DIFFÉRENTS peuvent partager un combo.
 *  - PAR plateforme : cross-plateforme AUTORISÉ (le même combo sur le TikTok ET
 *    le YouTube du même créateur est OK).
 *  - « Même combo » = comboKey identique. Un fork de brique (#53) crée un
 *    nouveau brickId → nouveau comboKey → considéré différent.
 *
 * Pur & testé (Vitest). RÉPLIQUE serveur dans convex/scripts.ts (règle A6 :
 * convex/ ne peut pas importer lib/) — toute évolution doit l'être là-bas.
 */
export interface AssignmentComboUsage {
  creatorId: string;
  comboKey: string | null | undefined;
  /** Plateformes ciblées par l'assignment (1 assignment = 1+ posts). */
  platforms: string[];
}

/**
 * Le combo est-il LIBRE pour (créateur, plateforme) parmi les assignments
 * existants ? Vrai si aucun assignment du même créateur ne porte ce comboKey
 * sur cette plateforme.
 */
export function isComboAvailableForCreatorPlatform(input: {
  comboKey: string;
  creatorId: string;
  platform: string;
  existingAssignments: AssignmentComboUsage[];
}): boolean {
  return !input.existingAssignments.some(
    (a) =>
      a.creatorId === input.creatorId &&
      a.comboKey === input.comboKey &&
      a.platforms.includes(input.platform),
  );
}

/**
 * comboKeys déjà pris par un créateur sur AU MOINS UNE des plateformes données
 * (union). Sert à EXCLURE de la génération : chaque nouvel assignment publie sur
 * TOUTES ses cibles, donc un combo doit être libre sur CHAQUE plateforme visée ;
 * il suffit qu'il soit pris sur l'une d'elles pour être indisponible.
 */
export function usedComboKeysForCreatorPlatforms(input: {
  creatorId: string;
  platforms: string[];
  existingAssignments: AssignmentComboUsage[];
}): Set<string> {
  const targetSet = new Set(input.platforms);
  const used = new Set<string>();
  for (const a of input.existingAssignments) {
    if (a.creatorId !== input.creatorId || !a.comboKey) continue;
    if (a.platforms.some((p) => targetSet.has(p))) used.add(a.comboKey);
  }
  return used;
}

/**
 * Options du filtre CRÉATEUR de l'onglet Assignments. Pur, testé (Vitest).
 *
 * Les options viennent des ASSIGNATIONS, pas de la table des créatrices : une
 * créatrice supprimée laisse des assignations (nom figé), et elles doivent
 * rester retrouvables. Mais sur Snytch, au 2026-09-24, cela faisait 27 noms dont
 * 15 sortis du parc — la liste était d'abord un cimetière. Les sorties passent
 * donc dans une seconde section, que le menu REPLIE (cf FilterMultiSelect
 * `folded`) : invisibles par défaut, à un clic quand on les cherche.
 */

import { isCreatorInactive, type CreatorStatus } from "./creator-status";

export interface CreatorFilterable {
  creatorId: string;
  creatorName: string;
  /** `null` = créatrice supprimée. */
  creatorStatus?: CreatorStatus | null;
}

export interface CreatorOption {
  value: string;
  label: string;
  /** Nombre d'assignations — affiché en suffixe dans le menu. */
  count: number;
  section: "active" | "inactive";
}

/**
 * Actives d'abord, puis sorties ; ordre ALPHABÉTIQUE dans chaque section — on
 * cherche un prénom, pas un classement (l'effectif reste lisible en suffixe).
 */
export function buildCreatorOptions(
  assignments: readonly CreatorFilterable[],
): CreatorOption[] {
  const parId = new Map<string, CreatorOption>();
  for (const a of assignments) {
    const o = parId.get(a.creatorId);
    if (o) {
      o.count += 1;
      continue;
    }
    parId.set(a.creatorId, {
      value: a.creatorId,
      label: a.creatorName,
      count: 1,
      section: isCreatorInactive(a.creatorStatus) ? "inactive" : "active",
    });
  }
  const alpha = (a: CreatorOption, b: CreatorOption) =>
    a.label.localeCompare(b.label, "fr", { sensitivity: "base" });
  const toutes = [...parId.values()];
  return [
    ...toutes.filter((o) => o.section === "active").sort(alpha),
    ...toutes.filter((o) => o.section === "inactive").sort(alpha),
  ];
}

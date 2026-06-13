/**
 * S1 — moteur d'assemblage combinatoire (pur, testé Vitest). Cœur réutilisé par
 * S2 (génération des combos) : 1 vidéo = 1 hook + 1 corps + 1 flux + 1 cta posés
 * sur un socle démo fixe. Aucune dépendance Convex/React → importable client.
 */

export type ScriptKind = "hook" | "corps" | "flux" | "cta";
export type ScriptTier = "S" | "A" | "B";

/** Les 4 kinds combinables, dans l'ordre de montage. */
export const SCRIPT_KINDS: readonly ScriptKind[] = [
  "hook",
  "corps",
  "flux",
  "cta",
] as const;

export const KIND_LABELS: Record<ScriptKind, string> = {
  hook: "Hook",
  corps: "Corps",
  flux: "Flux",
  cta: "CTA",
};

export interface AssembleInput {
  hook: string;
  corps: string;
  flux: string;
  cta: string;
  demoBlock: string;
}

/**
 * Monte le script final dans l'ordre hook → corps → flux → cta → socle démo,
 * en markdown lisible (un titre de section `##` par brique). C'est le rendu
 * qu'un créateur verra en S2 (script fini, sans les briques séparées visibles).
 */
export function assembleScript(input: AssembleInput): string {
  const sections: Array<[string, string]> = [
    ["Hook", input.hook],
    ["Corps", input.corps],
    ["Flux", input.flux],
    ["CTA", input.cta],
    ["Démo", input.demoBlock],
  ];
  return sections
    .map(([title, body]) => `## ${title}\n\n${body.trim()}`)
    .join("\n\n");
}

/** Forme minimale d'une brique pour le décompte (kind + activité). */
export interface BrickLike {
  kind: ScriptKind;
  active: boolean;
}

export interface CombinationCount {
  total: number;
  byKind: Record<ScriptKind, number>;
}

/**
 * Nombre de combos VALIDES d'une campagne = (hooks actifs) × (corps actifs) ×
 * (flux actifs) × (cta actifs). Si un kind n'a aucune brique active → 0 combo
 * (un kind manquant rend toute vidéo impossible). `byKind` détaille le compte
 * d'actifs par kind (pour l'affichage admin).
 */
export function countCombinations(bricks: BrickLike[]): CombinationCount {
  const byKind: Record<ScriptKind, number> = {
    hook: 0,
    corps: 0,
    flux: 0,
    cta: 0,
  };
  for (const b of bricks) {
    if (b.active) byKind[b.kind] += 1;
  }
  const total = byKind.hook * byKind.corps * byKind.flux * byKind.cta;
  return { total, byKind };
}

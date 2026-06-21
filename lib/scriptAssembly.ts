/**
 * S1 — moteur d'assemblage combinatoire (pur, testé Vitest). Cœur réutilisé par
 * S2 (génération des combos) : 1 vidéo = 1 hook + 1 flux + 1 cta. Aucune
 * dépendance Convex/React → importable client.
 *
 * Refonte 3 briques : le kind "corps" et le socle démo (champ campagne
 * `demoBlock`) ont été retirés du montage. Les scripts DÉJÀ livrés
 * (assembledScript figé sur les assignments) sont du TEXTE autonome — ils ne
 * repassent JAMAIS par cette fonction, donc l'historique reste intact par
 * construction.
 */

export type ScriptKind = "hook" | "flux" | "cta";
export type ScriptTier = "S" | "A" | "B";

/** Les 3 kinds combinables, dans l'ordre de montage. */
export const SCRIPT_KINDS: readonly ScriptKind[] = [
  "hook",
  "flux",
  "cta",
] as const;

export const KIND_LABELS: Record<ScriptKind, string> = {
  hook: "Hook",
  flux: "Flux",
  cta: "CTA",
};

export interface AssembleInput {
  hook: string;
  flux: string;
  cta: string;
}

export interface AssembleOptions {
  /**
   * true (défaut) → chaque section préfixée par son titre `## Hook`/`## Flux`/
   * `## CTA` (aperçu ADMIN, on veut voir la structure). false → script NATUREL,
   * sans étiquettes de type ni titres (rendu CRÉATEUR : il lit un script, pas un
   * document à sections nommées).
   */
  labels?: boolean;
}

/**
 * Monte le script final dans l'ordre hook → flux → cta. `labels: true` (défaut)
 * = titres de section visibles (aperçu admin). `labels: false` = enchaînement
 * naturel des textes (ce que voit le créateur).
 */
export function assembleScript(
  input: AssembleInput,
  options: AssembleOptions = {},
): string {
  const labels = options.labels ?? true;
  const sections: Array<[string, string]> = [
    ["Hook", input.hook],
    ["Flux", input.flux],
    ["CTA", input.cta],
  ];
  if (labels) {
    return sections
      .map(([title, body]) => `## ${title}\n\n${body.trim()}`)
      .join("\n\n");
  }
  // Script naturel : juste les textes enchaînés, aucun libellé de brique.
  return sections.map(([, body]) => body.trim()).join("\n\n");
}

/** Forme minimale d'une brique pour le décompte (kind + activité). `kind` est
 *  une string libre pour tolérer une brique legacy "corps" pas encore migrée
 *  (elle est alors ignorée du décompte). */
export interface BrickLike {
  kind: string;
  active: boolean;
}

export interface CombinationCount {
  total: number;
  byKind: Record<ScriptKind, number>;
}

/**
 * Nombre de combos VALIDES d'une campagne = (hooks actifs) × (flux actifs) ×
 * (cta actifs). Si un kind n'a aucune brique active → 0 combo (un kind manquant
 * rend toute vidéo impossible). Toute brique d'un kind hors hook/flux/cta (ex.
 * une "corps" legacy non encore reclassée) est IGNORÉE. `byKind` détaille le
 * compte d'actifs par kind (pour l'affichage admin).
 */
export function countCombinations(bricks: BrickLike[]): CombinationCount {
  const byKind: Record<ScriptKind, number> = {
    hook: 0,
    flux: 0,
    cta: 0,
  };
  for (const b of bricks) {
    if (
      b.active &&
      (b.kind === "hook" || b.kind === "flux" || b.kind === "cta")
    ) {
      byKind[b.kind] += 1;
    }
  }
  const total = byKind.hook * byKind.flux * byKind.cta;
  return { total, byKind };
}

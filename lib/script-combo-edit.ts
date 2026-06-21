/**
 * Correction d'UNE brique du combo d'un assignment de script — gardes PURES
 * (testées Vitest). Une brique remplaçable UNE seule fois, et UNIQUEMENT avant
 * toute soumission/publication.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. Les constantes/gardes sont
 * RÉPLIQUÉES côté serveur (convex/scripts.ts editScriptCombo) ; toute évolution
 * ici doit l'être là-bas.
 */

export type ScriptComboSlot = "hook" | "flux" | "cta";

export const SCRIPT_COMBO_SLOTS: readonly ScriptComboSlot[] = [
  "hook",
  "flux",
  "cta",
] as const;

/**
 * Statuts qui autorisent la correction du combo : AVANT toute soumission de
 * vidéo ou publication. Dès qu'une vidéo est soumise (video_submitted /
 * video_rejected / to_publish / submitted legacy) ou publiée/payée, le combo est
 * verrouillé (le script affiché doit rester ce qui a été produit/publié).
 */
export const COMBO_EDITABLE_STATUSES: readonly string[] = [
  "todo",
  "in_progress",
];

/** Le statut autorise-t-il la correction (pré-soumission) ? */
export function isComboStatusEditable(status: string): boolean {
  return COMBO_EDITABLE_STATUSES.includes(status);
}

/**
 * Le combo est-il corrigeable ? true ssi statut pré-soumission ET jamais encore
 * corrigé. Sert à la visibilité du bouton (UI) ET aux gardes serveur (répliqué).
 */
export function canEditScriptCombo(input: {
  status: string;
  editedOnce: boolean;
}): boolean {
  return isComboStatusEditable(input.status) && !input.editedOnce;
}

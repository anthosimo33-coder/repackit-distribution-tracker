/**
 * Correction du combo d'un assignment de script — garde PUR (testé Vitest).
 *
 * RÈGLE (depuis « éditer jusqu'à la publication ») : le script est modifiable
 * TANT QU'AUCUN LIEN DE PUBLICATION n'existe. Le seul verrou est la publication —
 * pas le statut, pas un quota d'éditions. Une fois le post en ligne, le texte est
 * figé sur la plateforme : le modifier dans Jarvia créerait un décalage avec la
 * réalité. On peut donc corriger autant de fois que nécessaire AVANT la mise en
 * ligne (statuts todo / in_progress / video_submitted / to_publish…).
 *
 * Source de vérité de « publié » = `postedAt` (= representativePostedAt : le
 * publishedAt d'au moins une cible, fallback legacy) — LE MÊME signal que le
 * statut calendrier. Multi-cibles : une seule cible publiée suffit à verrouiller.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. Le garde serveur (convex/
 * scripts.ts : editScriptCombo / editScriptBrickText) applique la MÊME règle via
 * representativePostedAt(a) !== null ; toute évolution ici doit l'être là-bas.
 */

export type ScriptComboSlot = "hook" | "flux" | "cta";

export const SCRIPT_COMBO_SLOTS: readonly ScriptComboSlot[] = [
  "hook",
  "flux",
  "cta",
] as const;

/**
 * Le combo est-il corrigeable ? true ssi AUCUN lien de publication n'existe
 * (`postedAt` null = pas encore publié). Sert à la visibilité du bouton (UI) ET
 * mirroir du garde serveur. `postedAt` = date de post réelle (representativePostedAt).
 */
export function canEditScriptCombo(input: {
  postedAt: number | null | undefined;
}): boolean {
  return input.postedAt == null;
}

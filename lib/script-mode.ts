/**
 * SNYTCH — MODE d'usage d'une brique DANS LA VIDÉO (zone 🎬), PAR BRIQUE (hook /
 * flux) : à DIRE à l'oral, à AFFICHER en texte à l'écran, ou LES DEUX. Le champ
 * vit sur `scriptBricks.mode` ; ici on centralise le type, les options du
 * sélecteur admin, la résolution du défaut (rétrocompat "les_deux") et le
 * libellé + icône affichés à la créatrice. Pur + testé (Vitest).
 *
 * ⚠️ `resolveBrickMode` et le type `BrickMode` ne sont PLUS définis ici : ils
 * vivent dans `convex/rushScriptEligibility.ts`, module PUR dont la garde D7
 * (« un rush est muet, seul ce qui s'affiche est assignable ») dérive. A6
 * interdit `convex/ → lib/`, pas l'inverse : une seule définition, consommée des
 * deux côtés, plutôt qu'une paire à surveiller. Ce fichier reste le point
 * d'entrée FRONT (ré-export + options du sélecteur + libellés) — aucun site
 * d'appel n'a changé.
 *
 * Il reste UNE occurrence non fusionnée, hors périmètre : le `?? "les_deux"`
 * inline de `convex/assignments.splitScriptZones`, qui rend le script de la
 * créatrice PARTENAIRE. Sa garde anti-divergence existe déjà.
 */

export {
  resolveBrickMode,
  type BrickMode,
} from "../convex/rushScriptEligibility";
import type { BrickMode } from "../convex/rushScriptEligibility";

/** Options ordonnées pour le sélecteur admin (hook / flux uniquement). */
export const BRICK_MODE_OPTIONS: { value: BrickMode; labelKey: string }[] = [
  { value: "dire", labelKey: "scriptMode.option.dire" },
  { value: "afficher", labelKey: "scriptMode.option.afficher" },
  { value: "les_deux", labelKey: "scriptMode.option.les_deux" },
];

/**
 * Libellé + icône affichés à la créatrice AU-DESSUS de chaque bloc de la zone
 * vidéo — lève l'ambiguïté « qu'est-ce que je dis / j'affiche ».
 */
export function brickModeDisplay(mode: BrickMode): {
  icon: string;
  labelKey: string;
} {
  switch (mode) {
    case "dire":
      return { icon: "🗣️", labelKey: "scriptMode.hint.dire" };
    case "afficher":
      return { icon: "💬", labelKey: "scriptMode.hint.afficher" };
    case "les_deux":
      return { icon: "🗣️💬", labelKey: "scriptMode.hint.les_deux" };
  }
}

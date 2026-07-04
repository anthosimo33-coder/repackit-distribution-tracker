/**
 * SNYTCH — MODE d'usage d'une brique DANS LA VIDÉO (zone 🎬), PAR BRIQUE (hook /
 * flux) : à DIRE à l'oral, à AFFICHER en texte à l'écran, ou LES DEUX. Le champ
 * vit sur `scriptBricks.mode` ; ici on centralise le type, les options du
 * sélecteur admin, la résolution du défaut (rétrocompat "les_deux") et le
 * libellé + icône affichés à la créatrice. Pur + testé (Vitest).
 *
 * `resolveBrickMode` est RÉPLIQUÉ côté serveur en `?? "les_deux"` inline
 * (convex/assignments.splitScriptZones, A6) — la sémantique DOIT rester
 * identique. La résolution du mode est ORTHOGONALE au contenu de la brique :
 * changer le mode ne modifie pas `assembledScript`, donc la garde anti-
 * divergence du split reste intacte.
 */

export type BrickMode = "dire" | "afficher" | "les_deux";

/** Options ordonnées pour le sélecteur admin (hook / flux uniquement). */
export const BRICK_MODE_OPTIONS: { value: BrickMode; label: string }[] = [
  { value: "dire", label: "Dire à l'oral" },
  { value: "afficher", label: "Afficher à l'écran" },
  { value: "les_deux", label: "Les deux" },
];

/** Défaut rétrocompat : brique sans mode (ou valeur inconnue) → "les_deux". */
export function resolveBrickMode(mode: string | null | undefined): BrickMode {
  return mode === "dire" || mode === "afficher" || mode === "les_deux"
    ? mode
    : "les_deux";
}

/**
 * Libellé + icône affichés à la créatrice AU-DESSUS de chaque bloc de la zone
 * vidéo — lève l'ambiguïté « qu'est-ce que je dis / j'affiche ».
 */
export function brickModeDisplay(mode: BrickMode): {
  icon: string;
  label: string;
} {
  switch (mode) {
    case "dire":
      return { icon: "🗣️", label: "À dire à l'oral" };
    case "afficher":
      return { icon: "💬", label: "À afficher en texte à l'écran" };
    case "les_deux":
      return { icon: "🗣️💬", label: "À dire ET afficher à l'écran" };
  }
}

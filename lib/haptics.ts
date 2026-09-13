/**
 * RETOUR HAPTIQUE — une petite vibration au moment d'un geste réussi.
 *
 * `navigator.vibrate` n'existe que sur Android (Chrome, Firefox) ; iOS l'ignore
 * et les ordinateurs n'ont rien à faire vibrer. On détecte, on essaie, on se
 * tait : une vibration absente ne doit JAMAIS casser le geste qu'elle accompagne.
 *
 * Trois motifs seulement, pour qu'ils restent reconnaissables :
 *   - `tap`       : un geste validé (check de chauffe, copie) ;
 *   - `success`   : une étape franchie ;
 *   - `celebrate` : un moment de fierté (publication, palier, place gagnée).
 */
export type HapticPattern = "tap" | "success" | "celebrate";

export const HAPTIC_PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 12,
  success: [14, 40, 22],
  celebrate: [18, 60, 18, 60, 36],
};

export function haptic(pattern: HapticPattern = "tap"): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(HAPTIC_PATTERNS[pattern]);
  } catch {
    /* navigateur qui refuse (onglet en arrière-plan, politique) : sans effet */
  }
}

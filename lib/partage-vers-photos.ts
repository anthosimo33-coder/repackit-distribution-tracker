/**
 * Faut-il ENREGISTRER un fichier par la feuille de partage plutôt que par un
 * téléchargement ? Oui sur iPhone et iPad : un téléchargement y finit dans
 * l'app Fichiers, alors que la feuille de partage propose « Enregistrer la
 * vidéo » et range le fichier dans Photos — là où la créatrice le monte.
 *
 * Android et ordinateur : non. Le téléchargement y marche (dossier
 * Téléchargements, visible de la galerie), et la feuille de partage d'Android
 * n'offre souvent aucune option « enregistrer ».
 *
 * L'iPad sous iPadOS se présente comme un Mac : seul l'écran tactile le trahit.
 */
export function partageVersPhotos(nav: {
  userAgent: string;
  maxTouchPoints: number;
}): boolean {
  if (/iphone|ipad|ipod/i.test(nav.userAgent)) return true;
  return /macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1;
}

/**
 * Une adresse tapée à la main, rendue enregistrable : `https://` ajouté quand
 * elle n'a pas de schéma, rien quand le champ est vide.
 *
 * POURQUOI. Une créatrice tape `www.tiktok.com/@son_compte`, pas
 * `https://www.tiktok.com/@son_compte`. Un `<input type="url">` refuse la
 * première (« Saisir une URL » sur iPhone) et bloque le formulaire AVANT tout
 * appel au serveur : le 18/11/2026, Kelly ne pouvait plus déclarer de compte.
 * On accepte donc le texte tel quel et on complète le schéma ici.
 */
export function urlSaisie(brute: string): string | undefined {
  const s = brute.trim();
  if (s === "") return undefined;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
}

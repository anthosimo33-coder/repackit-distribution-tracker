import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_S, type Locale } from "./locales";

/**
 * Pose le cookie de langue, CÔTÉ CLIENT.
 *
 * Hors composant : `document.cookie = …` mute une valeur externe, ce que la
 * règle `react-hooks/immutability` du compilateur React refuse dans un corps de
 * composant. L'isoler dit aussi ce que c'est — un effet de bord sur le document,
 * pas de l'état React.
 *
 * Deux appelants, et ils ne poursuivent pas le même but :
 *   - le sélecteur de langue : l'utilisateur CHOISIT, on mémorise ;
 *   - la page /join : le créateur arrive sans session ET sans cookie, la langue
 *     vient de l'invitation. C'est le seul endroit qui peut la lui donner avant
 *     qu'il ait un compte.
 *
 * Le cookie ne porte aucun secret : il est lisible et modifiable par le client,
 * et c'est sans conséquence — il ne fait que choisir une langue d'affichage,
 * jamais un droit.
 */
export function writeLocaleCookie(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_S}; samesite=lax`;
}

import { FORMAT_LOCALE_DEFAULT } from "./format-rate";

/**
 * Formateurs d'affichage. Chacun prend la langue en DERNIER paramètre, avec
 * `fr-FR` par défaut : un appelant qui ne la passe pas rend exactement ce qu'il
 * rendait avant l'i18n. Côté écran, la langue vient de `useIntlLocale()`.
 */

export function formatNumber(
  n: number | null | undefined,
  locale: string = FORMAT_LOCALE_DEFAULT,
): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(locale);
}

/**
 * Pourcentage. Le séparateur décimal était un `.replace(".", ",")` codé en dur,
 * qui produisait « 12,50 % » y compris en anglais.
 *
 * ⚠️ PAS `style: "percent"`, et c'est délibéré. Intl en mode `percent` insère en
 * français une ESPACE FINE INSÉCABLE (U+202F) avant le signe, là où le rendu
 * historique met une espace ordinaire. Typographiquement Intl a raison, mais le
 * caractère est INVISIBLE et il casse les assertions e2e existantes
 * (`e2e/verdict-follows-période.spec.ts` attend « 0,50 % »). On formate donc le
 * NOMBRE via Intl — qui donne bien « , » en français et « . » en anglais — et on
 * pose le signe à la main : espace avant en français, collé en anglais.
 *
 * `useGrouping: false` reproduit `toFixed()` à l'octet près. Tous les appelants
 * passent des taux (save rate, like rate, engagement) très inférieurs à 100 %,
 * donc aucun séparateur de milliers n'est attendu de toute façon.
 */
export function formatPercent(
  n: number | null | undefined,
  decimals: number = 2,
  locale: string = FORMAT_LOCALE_DEFAULT,
): string {
  if (n === null || n === undefined) return "—";
  const num = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  }).format(n * 100);
  return locale.startsWith("fr") ? `${num} %` : `${num}%`;
}

/**
 * Date courte. ⚠️ C'est le format le plus dangereux du produit : « 03/09/26 »
 * se lit 3 septembre en français et 9 mars en anglais US. Les deux sont
 * plausibles, aucune erreur n'est visible — d'où le passage par `Intl`, qui
 * inverse l'ordre des champs selon la langue.
 */
export function formatDate(
  timestamp: number,
  locale: string = FORMAT_LOCALE_DEFAULT,
): string {
  return new Date(timestamp).toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

/**
 * Date d'un écran qui affiche de l'ARGENT — paie et gains.
 *
 * Année sur QUATRE chiffres en anglais, deux en français. Ce n'est pas une
 * incohérence : `09/03/26` reste ambigu pour un lecteur qui n'a pas encore
 * intégré que l'ordre des champs a changé, et sur un écran où l'on annonce un
 * versement, une date non ambiguë vaut plus que deux caractères de largeur.
 * Le français, lui, ne gagne rien à s'allonger — son ordre n'a jamais bougé —
 * et le garder inchangé préserve l'invariant tenu sur tout le chantier.
 *
 * Partout ailleurs, `formatDate` (2 chiffres des deux côtés) reste la règle.
 */
export function formatMoneyDate(
  timestamp: number,
  locale: string = FORMAT_LOCALE_DEFAULT,
): string {
  return new Date(timestamp).toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: locale.startsWith("fr") ? "2-digit" : "numeric",
  });
}

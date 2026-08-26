import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "@/convex/locales";

/**
 * LANGUE D'INTERFACE → ÉTIQUETTE BCP-47 DE MISE EN FORME.
 *
 * `next-intl` porte une langue (`fr`, `en`) ; `Intl` veut une étiquette
 * régionale (`fr-FR`, `en-US`). C'est la région, pas la langue, qui décide du
 * format d'une date et d'un nombre — et l'écart est brutal entre nos deux
 * cibles :
 *
 *   03/09/2026   se lit 3 septembre en fr-FR et 9 mars en en-US
 *   1 234,56 €   devient $1,234.56 : le séparateur de milliers ET le
 *                séparateur décimal ET la position du symbole changent
 *
 * L'anglais du produit est de l'anglais **US** (décision D3) : `en` mappe donc
 * `en-US`, jamais `en-GB` ni le `en` nu, dont le format de date dépend de
 * l'implémentation.
 *
 * ⚠️ CE MODULE NE TOUCHE JAMAIS À LA DEVISE. La devise vient de la TRANSACTION
 * (`projects.payCurrency` pour la paie, `whopPayments.currency` pour le revenu),
 * jamais de la langue : un payout en dollars reste en dollars dans une interface
 * française, et un revenu en euros reste en euros dans une interface anglaise.
 * Ce module ne pilote que la MISE EN FORME — séparateurs, ordre des champs,
 * position du symbole.
 *
 * ⚠️ IL NE TOUCHE PAS NON PLUS AU FUSEAU. Le produit épingle `Europe/Paris`
 * (i18n/request.ts) et fait coexister trois conventions d'horodatage
 * documentées champ par champ. `en` ne veut pas dire UTC.
 */
export const INTL_TAG: Record<Locale, string> = {
  fr: "fr-FR",
  en: "en-US",
};

/**
 * Étiquette de mise en forme d'une langue, quelle que soit sa provenance
 * (`useLocale()`, un champ de base, un cookie). Toute valeur non supportée
 * retombe sur le défaut du produit — on ne devine pas une région.
 */
export function intlTag(locale: unknown): string {
  return INTL_TAG[normalizeLocale(locale) ?? DEFAULT_LOCALE];
}

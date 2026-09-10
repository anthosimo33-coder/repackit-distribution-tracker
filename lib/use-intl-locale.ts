"use client";

import { useLocale } from "next-intl";
import { intlTag } from "./intl-locale";

/**
 * Étiquette de mise en forme de la langue ACTIVE, pour les composants client.
 *
 * Les formateurs de `lib/` (`formatMoney`, `formatDate`, `formatNumber`,
 * `formatCycleRange`…) prennent tous une langue en dernier paramètre, avec
 * `fr-FR` par défaut : sans appelant qui la passe, le rendu reste exactement
 * celui d'avant l'i18n. Ce hook est le seul point qui la fournit côté écran.
 *
 * Pourquoi un hook et pas une lecture globale : la langue est résolue par
 * requête (compte → fiche → cookie → Accept-Language), elle vit dans le contexte
 * next-intl. La lire ailleurs qu'au rendu donnerait la langue d'un autre
 * utilisateur en rendu concurrent.
 */
export function useIntlLocale(): string {
  return intlTag(useLocale());
}

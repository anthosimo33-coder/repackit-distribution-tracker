import { enUS, es, fr, ptBR } from "date-fns/locale";
import type { Locale as DateFnsLocale } from "date-fns";

/**
 * LOCALE date-fns DE LA LANGUE ACTIVE — pour les masques `format(d, "MMMM yyyy")`.
 *
 * Les calendriers importaient `fr` de `date-fns/locale` en dur : « septembre
 * 2026 » s'affichait tel quel à une créatrice anglophone, sous des jours de la
 * semaine eux aussi écrits en français. La garde i18n refuse désormais cet
 * import dans le périmètre traduit ; ce module est le seul point qui choisit.
 *
 * Prend l'étiquette de `useIntlLocale()` (`fr-FR`, `en-US`) ou la langue nue.
 */
export function dateFnsLocale(loc: string): DateFnsLocale {
  if (loc.startsWith("en")) return enUS;
  if (loc.startsWith("es")) return es;
  if (loc.startsWith("pt")) return ptBR;
  return fr;
}

/**
 * Les sept jours, LUNDI EN PREMIER (la grille des calendriers commence lundi
 * dans toutes les langues), sous forme de clés du catalogue `calendar.weekday`.
 */
export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * Langues livrées. Le FRANÇAIS reste la langue par défaut et la langue de
 * référence : `messages/fr.json` est la source, `en.json`, `es.json` et
 * `pt.json` en sont des copies de clés traduites. L'anglais a été AJOUTÉ pour
 * onboarder des créateurs US, l'espagnol et le portugais (brésilien) pour le
 * parcours créateur seulement — l'espace d'équipe reste FR/EN.
 *
 * Ce module porte les concerns NEXT (cookie, endonymes, Accept-Language) et
 * réexporte la liste des langues depuis convex/locales.ts, sa source unique.
 */

// Source unique dans convex/ : le runtime Convex n'importe rien hors de
// convex/ (règle A6), et les e-mails ont besoin de normaliser une langue.
// La dépendance va donc dans le sens permis, Next → Convex.
export {
  LOCALES,
  TEAM_LOCALES,
  teamLocaleOf,
  DEFAULT_LOCALE,
  isLocale,
  normalizeLocale,
  normalizeCreatorLocale,
  localeOrDefault,
  type Locale,
  type TeamLocale,
} from "@/convex/locales";

import { normalizeLocale, type Locale } from "@/convex/locales";

/** Nom de la langue DANS cette langue (jamais traduit : c'est un endonyme). */
export const LOCALE_LABELS: Record<Locale, string> = {
  // i18n-exempt: ENDONYME : le nom d'une langue s'écrit dans cette langue, jamais traduit
  fr: "Français",
  en: "English",
  // i18n-exempt: ENDONYME : le nom d'une langue s'écrit dans cette langue, jamais traduit
  es: "Español",
  // i18n-exempt: ENDONYME : le nom d'une langue s'écrit dans cette langue, jamais traduit
  pt: "Português",
};

/** Cookie qui matérialise la préférence, y compris AVANT toute session. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Un an : la préférence n'a pas de raison d'expirer avant. */
export const LOCALE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;



/**
 * Meilleure langue supportée d'un header `Accept-Language`, en respectant les
 * facteurs de qualité (`q=`). Retourne `null` si aucune ne correspond — on ne
 * devine pas, l'appelant décide du défaut.
 */
export function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return { tag, quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((x) => x.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  for (const { tag } of ranked) {
    const loc = normalizeLocale(tag);
    if (loc) return loc;
  }
  return null;
}

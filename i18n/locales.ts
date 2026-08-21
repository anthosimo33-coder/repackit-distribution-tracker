/**
 * Langues livrées. Le FRANÇAIS reste la langue par défaut et la langue de
 * référence : `messages/fr.json` est la source, `messages/en.json` en est la
 * copie de clés. L'anglais est AJOUTÉ pour onboarder des créateurs US, il ne
 * remplace rien.
 *
 * Module SANS dépendance (ni React, ni Next, ni Convex) : il est importé aussi
 * bien par le rendu serveur que par le client et par scripts/check-i18n.mjs.
 */

export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Langue par défaut — dernier maillon de la chaîne de résolution. */
export const DEFAULT_LOCALE: Locale = "fr";

/** Nom de la langue DANS cette langue (jamais traduit : c'est un endonyme). */
export const LOCALE_LABELS: Record<Locale, string> = {
  fr: "Français",
  en: "English",
};

/** Cookie qui matérialise la préférence, y compris AVANT toute session. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Un an : la préférence n'a pas de raison d'expirer avant. */
export const LOCALE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/**
 * Normalise une valeur quelconque en langue supportée, ou `null`.
 * Tolère les étiquettes régionales (« en-US » → « en ») et la casse : le
 * header Accept-Language et les préférences navigateur en produisent.
 */
export function normalizeLocale(v: unknown): Locale | null {
  if (typeof v !== "string") return null;
  const base = v.trim().toLowerCase().split("-")[0];
  return isLocale(base) ? base : null;
}

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

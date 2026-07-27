/**
 * Libellés d'affichage des pays (drapeau + nom FR) + codes, pour les sélecteurs
 * ADMIN. Source d'AFFICHAGE PARTAGÉE (client) : sélecteur Radar Tendances + pays
 * ciblé par compte. La validation serveur (liste fermée) vit côté convex
 * (convex/countries.SUPPORTED_COUNTRIES + countryValidator) — A6 : un module
 * convex ne peut pas importer lib/, garder les deux EN PHASE (mêmes codes).
 */

/** Codes pays supportés (ordre d'affichage). En phase avec convex/countries. */
export const COUNTRY_CODES = [
  "US", "FR", "GB", "DE", "ES", "IT", "CA", "AU", "BR", "AR",
] as const;

/** Code pays supporté (union fermée). */
export type CountryCode = (typeof COUNTRY_CODES)[number];

/** Libellé (drapeau + nom FR) par code. Indexable par string (fallback géré). */
export const COUNTRY_LABELS: Record<string, string> = {
  US: "🇺🇸 États-Unis",
  FR: "🇫🇷 France",
  GB: "🇬🇧 Royaume-Uni",
  DE: "🇩🇪 Allemagne",
  ES: "🇪🇸 Espagne",
  IT: "🇮🇹 Italie",
  CA: "🇨🇦 Canada",
  AU: "🇦🇺 Australie",
  BR: "🇧🇷 Brésil",
  AR: "🇦🇷 Argentine",
};

/** Code → libellé (drapeau + nom), fallback sur le code brut. null si non défini. */
export function countryLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return COUNTRY_LABELS[code] ?? code;
}

/**
 * Drapeau emoji SEUL (compact, ex. pastille du calendrier de pilotage), dérivé du
 * code ISO-3166-α2 via les Regional Indicator Symbols (A→🇦…). null si absent ou
 * hors liste fermée → l'appelant n'affiche alors aucun drapeau.
 */
export function countryFlag(code: string | null | undefined): string | null {
  if (!code) return null;
  const cc = code.trim().toUpperCase();
  if (!(COUNTRY_CODES as readonly string[]).includes(cc)) return null;
  return String.fromCodePoint(
    ...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

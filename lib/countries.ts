/**
 * Codes pays des sélecteurs ADMIN, et leur libellé d'affichage.
 *
 * ⚠️ LES NOMS NE SONT PLUS ÉCRITS ICI. Ils viennent d'ICU
 * (`lib/country-name.isoCountryLabel`), et seul le DRAPEAU est dérivé du code.
 * Cette table portait dix noms français à la main ; à 250 pays elle aurait été
 * 250 occasions de fautes de frappe, et une liste à reprendre à chaque
 * changement de nom officiel. Le drapeau, lui, se calcule : deux lettres
 * ↦ deux symboles régionaux.
 *
 * DEUX LISTES, comme côté serveur (cf convex/countries) :
 *   - `COUNTRY_CODES` — le PAYS CIBLÉ d'un compte : les 250 codes ISO 3166-1
 *     alpha-2 assignés ;
 *   - `TREND_COUNTRY_CODES` — le Radar Tendances : les dix que la source de
 *     tendances sait servir. L'élargir ne donnerait pas de données, elle
 *     proposerait des pays qui répondent vide.
 *
 * A6 : un module convex ne peut pas importer lib/ — les deux listes de codes
 * sont donc DUPLIQUÉES, et `lib/countries.test.ts` les tient en phase.
 */

import { isoCountryLabel } from "./country-name";

/** Codes pays proposables comme PAYS CIBLÉ. En phase avec convex/countries. */
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT",
  "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI",
  "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY",
  "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM",
  "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK",
  "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL",
  "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR",
  "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN",
  "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS",
  "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW",
  "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP",
  "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM",
  "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM",
  "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF",
  "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW",
  "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

/** Code pays supporté (union fermée). */
export type CountryCode = (typeof COUNTRY_CODES)[number];

/** Pays du Radar Tendances. En phase avec convex/countries.TREND_COUNTRIES. */
export const TREND_COUNTRY_CODES = [
  "US", "FR", "GB", "DE", "ES", "IT", "CA", "AU", "BR", "AR",
] as const;

const CODES: ReadonlySet<string> = new Set(COUNTRY_CODES);

/**
 * Drapeau emoji SEUL (compact, ex. pastille du calendrier de pilotage), dérivé du
 * code ISO-3166-α2 via les Regional Indicator Symbols (A→🇦…). null si absent ou
 * hors liste fermée → l'appelant n'affiche alors aucun drapeau.
 */
export function countryFlag(code: string | null | undefined): string | null {
  if (!code) return null;
  const cc = code.trim().toUpperCase();
  if (!CODES.has(cc)) return null;
  return String.fromCodePoint(
    ...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

/**
 * Code → « 🇷🇸 Serbie ». `null` quand le code est absent.
 *
 * Un code HORS liste fermée est rendu tel quel, sans drapeau : c'est une donnée
 * qu'on n'a pas écrite nous-mêmes, la montrer brute vaut mieux que l'habiller.
 */
export function countryLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const cc = code.trim().toUpperCase();
  if (!CODES.has(cc)) return code;
  return `${countryFlag(cc)} ${isoCountryLabel(cc)}`;
}

/**
 * Le NOM seul, sans drapeau — pour un texte courant où l'emoji détonnerait.
 */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return isoCountryLabel(code);
}

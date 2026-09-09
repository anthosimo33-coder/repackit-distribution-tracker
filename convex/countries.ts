import { v, ConvexError } from "convex/values";

/**
 * CODES PAYS — deux listes, parce que ce sont deux questions différentes.
 *
 * ─── `SUPPORTED_COUNTRIES` : le PAYS CIBLÉ d'un compte ───────────────────────
 * Un label interne, posé à la main par l'équipe. Il n'ouvre aucune porte et
 * n'appelle aucune API : il n'y a donc aucune raison de le restreindre à dix
 * pays. Elle en portait dix, et le parc réel en déborde depuis longtemps
 * (Serbie, Bosnie, Croatie, Suisse…) — on écrivait « Non défini » faute de
 * pouvoir écrire la vérité.
 *
 * La liste est celle des codes ISO 3166-1 alpha-2 ACTUELLEMENT ASSIGNÉS (250),
 * dérivée d'ICU puis figée ici. Sont écartés : les regroupements et pseudo-codes
 * (EU, UN, QO, XA/XB/ZZ, UK, IC…) et les codes RETIRÉS de pays disparus (AN, CS,
 * DD, SU, YU, ZR…) — proposer « Yougoslavie » dans un sélecteur de 2026 serait
 * une donnée fausse offerte d'un clic. `XK` (Kosovo) est GARDÉ : hors norme mais
 * universellement employé, et la région est dans le parc.
 *
 * ⚠️ ELLE RESTE FERMÉE. Le sélecteur ne laisse rien taper, et le serveur refuse
 * un code hors liste : c'est ce qui empêche « FRA », « fr » ou une faute de
 * frappe d'entrer en base et de rendre les regroupements faux plus tard.
 *
 * Les NOMS ne sont pas ici : ils viennent d'ICU au moment de l'affichage
 * (`lib/country-name.isoCountryLabel`). Écrire 250 noms à la main aurait été
 * 250 occasions de fautes, et une liste à re-traduire à chaque changement de
 * nom officiel.
 *
 * ─── `TREND_COUNTRIES` : le Radar Tendances ─────────────────────────────────
 * Celle-ci ne bouge PAS. Elle décrit ce que la source de tendances sait servir,
 * pas ce qu'on aimerait lui demander : l'élargir n'ajouterait pas de données,
 * elle proposerait des pays qui répondent vide. Les deux listes étaient
 * confondues — c'est cette confusion qui empêchait d'élargir l'une sans casser
 * l'autre.
 */
export const TREND_COUNTRIES = [
  "US", "FR", "GB", "DE", "ES", "IT", "CA", "AU", "BR", "AR",
] as const;

/** Pays proposables comme PAYS CIBLÉ d'un compte (liste fermée, 250 codes). */
export const SUPPORTED_COUNTRIES = [
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

/**
 * Validateur FERMÉ (union de littéraux) DÉRIVÉ de la liste unique → 0 duplication
 * des codes. Rejette au runtime (validation schéma/args) tout code hors liste.
 * Utilisé par comptes.targetCountry (schéma + arg de mutation).
 */
export const countryValidator = v.union(
  ...SUPPORTED_COUNTRIES.map((c) => v.literal(c)),
);

/**
 * Valide + normalise un code de pays de TENDANCE (trim + MAJUSCULES, rejette
 * hors liste). Le Radar saisit son pays en `v.string()` et valide au handler.
 *
 * ⚠️ Vise `TREND_COUNTRIES`, pas la grande liste : un pays que la source ne
 * couvre pas doit être refusé ici, pas répondre vide trois écrans plus loin.
 */
export function assertCountry(countryCode: string): string {
  const cc = countryCode.trim().toUpperCase();
  if (!(TREND_COUNTRIES as readonly string[]).includes(cc)) {
    throw new ConvexError(`Pays non supporté : ${countryCode}.`);
  }
  return cc;
}

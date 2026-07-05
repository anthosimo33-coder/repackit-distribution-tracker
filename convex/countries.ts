import { v, ConvexError } from "convex/values";

/**
 * SOURCE UNIQUE des codes pays supportés (côté convex). Réutilisée par :
 *   - Radar Tendances (SUPPORTED_TREND_COUNTRIES + assertCountry, cf convex/radar) ;
 *   - le PAYS CIBLÉ par compte (label informatif admin, cf comptes.targetCountry).
 * Les LIBELLÉS d'affichage (drapeau + nom FR) vivent dans lib/countries (A6 :
 * un module convex ne peut pas importer lib/ — garder les deux EN PHASE, mêmes
 * clés). Ajouter un pays = 1 ligne ici + 1 ligne dans lib/countries.COUNTRY_LABELS.
 */
export const SUPPORTED_COUNTRIES = [
  "US", "FR", "GB", "DE", "ES", "IT", "CA", "AU", "BR", "AR",
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
 * Valide + normalise un countryCode (trim + MAJUSCULES, rejette hors liste).
 * Conservé pour les chemins dont l'argument est `v.string()` et qui valident au
 * handler (Radar Tendances : countryCode saisi/normalisé côté acteur).
 */
export function assertCountry(countryCode: string): string {
  const cc = countryCode.trim().toUpperCase();
  if (!(SUPPORTED_COUNTRIES as readonly string[]).includes(cc)) {
    throw new ConvexError(`Pays non supporté : ${countryCode}.`);
  }
  return cc;
}

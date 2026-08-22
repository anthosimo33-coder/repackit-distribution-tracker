/**
 * LANGUES LIVRÉES — source unique.
 *
 * Vit dans `convex/` et non dans `i18n/` parce que le runtime Convex n'importe
 * rien hors de `convex/` (règle A6) : les e-mails, qui partent du serveur, ont
 * besoin de normaliser une langue et ne peuvent pas atteindre le module Next.
 * `i18n/locales.ts` réexporte d'ici — la dépendance va donc dans le sens permis
 * (Next → Convex), et il n'y a qu'une liste de langues dans le dépôt.
 *
 * Module SANS dépendance : ni React, ni Next, ni `convex/server`.
 */

export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Langue par défaut du produit. Le français n'est pas « une langue parmi
 * deux » : c'est le défaut, et l'absence de valeur le signifie.
 */
export const DEFAULT_LOCALE: Locale = "fr";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/**
 * Normalise en langue supportée, ou `null`. Tolère les étiquettes régionales
 * (« en-US » → « en ») et la casse : le header Accept-Language et les
 * préférences navigateur en produisent.
 */
export function normalizeLocale(v: unknown): Locale | null {
  if (typeof v !== "string") return null;
  const base = v.trim().toLowerCase().split("-")[0];
  return isLocale(base) ? base : null;
}

/**
 * Valeur à STOCKER sur une fiche : `undefined` pour le défaut, la langue sinon.
 *
 * On ne stocke que la DIVERGENCE — même invariant que `creators.kind` et que
 * `publications.remunere`. Écrire « fr » explicitement sur toutes les fiches
 * ajouterait du bruit et masquerait qui a réellement été invité en anglais.
 */
export function normalizeCreatorLocale(v: unknown): Locale | undefined {
  const loc = normalizeLocale(v);
  return loc === null || loc === DEFAULT_LOCALE ? undefined : loc;
}

/**
 * Langue effective pour un rendu SERVEUR (e-mail) : il n'y a ni cookie ni
 * `Accept-Language` de ce côté, la chaîne de résolution s'arrête donc au premier
 * maillon et le défaut doit être explicite ici.
 */
export function localeOrDefault(v: unknown): Locale {
  return normalizeLocale(v) ?? DEFAULT_LOCALE;
}

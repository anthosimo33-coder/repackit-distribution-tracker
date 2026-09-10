import { utcOffsetMinutes } from "../convex/creatorDay";
import type { RegionKey } from "./creator-region";

/**
 * Libellés FR des fuseaux proposés dans le sélecteur ADMIN.
 *
 * ─── POURQUOI CE FICHIER EXISTE SÉPARÉMENT DE `convex/creatorDay.ts` ─────────
 * `creatorDay` est importé par `lib/warmup`, lui-même importé par le portail
 * créatrice : il est donc DANS le périmètre i18n créateur
 * (`scripts/i18n-creator-scope.json`), où la tolérance aux littéraux en dur est
 * ZÉRO. Y laisser dix-sept noms de villes en français faisait échouer la CI —
 * à juste titre : un module de calcul de dates n'a pas à transporter du texte
 * d'interface.
 *
 * La séparation n'est donc pas cosmétique. Elle garde `creatorDay` purement
 * calculatoire (il ne rend que des nombres et des clés « YYYY-MM-DD »), et
 * confine le français là où il est réellement affiché : un écran ADMIN, qui
 * n'est pas traduit et n'a pas vocation à l'être.
 *
 * ⚠️ Si un jour ces libellés doivent apparaître côté CRÉATRICE (par exemple
 * pour l'invite de confirmation d'AT-005), il faudra les extraire vers
 * `messages/fr.json` + `messages/en.json` et passer par `t()`. Ne pas se
 * contenter de déplacer le fichier.
 */

/**
 * Fuseaux PROPOSÉS dans le sélecteur admin, groupés et ordonnés pour la lecture.
 *
 * ⚠️ Ce n'est PAS la liste des fuseaux acceptés : `isSupportedTimezone` accepte
 * tout identifiant IANA que le runtime sait rendre. Cette liste-ci ne fait que
 * mettre en avant ceux qu'on rencontre réellement — les six fuseaux américains
 * en tête, parce que « États-Unis » ne dit pas lequel et que c'est précisément
 * l'ambiguïté qui a coûté un jour de warmup à des créatrices.
 *
 * ─── `region` : le REGROUPEMENT de l'écran Créateurs ─────────────────────────
 * Portée ICI et pas dans une seconde table parce qu'une seconde table dérive :
 * on ajoute un fuseau au sélecteur, on oublie sa région, et une créatrice tombe
 * silencieusement dans « Autre fuseau ». Le type l'exige, `tsc` le rappelle.
 * Cf `lib/creator-region.ts` pour la résolution (cette liste ne couvre pas tous
 * les fuseaux possibles — le navigateur d'une créatrice peut en confirmer
 * n'importe lequel).
 */
// i18n-exempt: libellés d'un sélecteur ADMIN (écran non traduit) — cf en-tête
export const TIMEZONE_CHOICES: {
  zone: string;
  label: string;
  region: RegionKey;
}[] = [
  { zone: "America/New_York", label: "New York — côte est (US)" , region: "us" },
  { zone: "America/Chicago", label: "Chicago — centre (US)" , region: "us" },
  { zone: "America/Denver", label: "Denver — montagnes (US)" , region: "us" },
  { zone: "America/Phoenix", label: "Phoenix — Arizona (US, sans heure d'été)" , region: "us" },
  { zone: "America/Los_Angeles", label: "Los Angeles — côte ouest (US)" , region: "us" },
  { zone: "America/Anchorage", label: "Anchorage — Alaska (US)" , region: "us" },
  { zone: "Pacific/Honolulu", label: "Honolulu — Hawaï (US)" , region: "us" },
  { zone: "America/Toronto", label: "Toronto (Canada)" , region: "canada" },
  { zone: "America/Vancouver", label: "Vancouver (Canada)" , region: "canada" },
  { zone: "America/Sao_Paulo", label: "São Paulo (Brésil)" , region: "latam" },
  { zone: "America/Argentina/Buenos_Aires", label: "Buenos Aires (Argentine)" , region: "latam" },
  { zone: "Europe/Paris", label: "Paris (France)" , region: "europe" },
  { zone: "Europe/London", label: "Londres (Royaume-Uni)" , region: "europe" },
  { zone: "Europe/Madrid", label: "Madrid (Espagne)" , region: "europe" },
  { zone: "Europe/Berlin", label: "Berlin (Allemagne)" , region: "europe" },
  { zone: "Europe/Rome", label: "Rome (Italie)" , region: "europe" },
  { zone: "Australia/Sydney", label: "Sydney (Australie)" , region: "oceania" },
];

/**
 * Décalage courant d'un fuseau, en « UTC+2 » / « UTC−4 » — pour l'afficher à
 * côté du nom sans faire deviner.
 *
 * Calculé à l'instant `at` et jamais mis en cache : il change deux fois par an.
 * Rend `null` si le fuseau est illisible, plutôt qu'un décalage faux.
 *
 * Le SIGNE est un vrai moins typographique (−, U+2212) et non un trait d'union :
 * aligné sur le reste des libellés de l'écran.
 */
export function utcOffsetLabel(
  timeZone: string,
  at: number = Date.now(),
): string | null {
  const min = utcOffsetMinutes(timeZone, at);
  if (min === null) return null;
  const signe = min < 0 ? "−" : "+";
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  return m === 0
    ? `UTC${signe}${h}`
    : `UTC${signe}${h}:${String(m).padStart(2, "0")}`;
}

/** Libellé lisible d'un fuseau, ou l'identifiant brut s'il est hors liste. */
export function zoneLabel(zone: string): string {
  return TIMEZONE_CHOICES.find((c) => c.zone === zone)?.label ?? zone;
}

/**
 * TOUS les fuseaux IANA que le runtime connaît (~420), triés.
 *
 * ⚠️ AUCUNE LISTE ÉCRITE À LA MAIN. `Intl.supportedValuesOf` est adossé à la
 * base ICU livrée avec le navigateur : elle suit les créations, fusions et
 * renommages de fuseaux sans qu'on y touche. Une liste figée aurait vieilli, et
 * un fuseau manquant se paie en jours de warmup comptés au mauvais endroit.
 *
 * Repli sur les fuseaux mis en avant quand l'API manque (runtime ancien) : mieux
 * vaut le choix d'avant que pas de choix du tout.
 */
export function allTimezones(): string[] {
  try {
    const f = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    const zones = typeof f === "function" ? f.call(Intl, "timeZone") : null;
    if (Array.isArray(zones) && zones.length > 0) return [...zones].sort();
  } catch {
    /* runtime sans supportedValuesOf → repli ci-dessous */
  }
  return TIMEZONE_CHOICES.map((c) => c.zone).sort();
}

/**
 * « Europe/Belgrade » → « Belgrade », « America/Argentina/Buenos_Aires » →
 * « Buenos Aires ». La ville est ce qu'on cherche ; le continent sert de
 * regroupement, pas d'identifiant.
 */
export function zoneCity(zone: string): string {
  const dernier = zone.split("/").pop() ?? zone;
  return dernier.replaceAll("_", " ");
}

/** « Europe/Belgrade » → « Europe ». Vide pour un identifiant sans préfixe (UTC). */
export function zoneArea(zone: string): string {
  const parts = zone.split("/");
  return parts.length > 1 ? parts[0].replaceAll("_", " ") : "";
}

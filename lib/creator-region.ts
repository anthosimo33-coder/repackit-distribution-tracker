import { TIMEZONE_CHOICES } from "./timezone-choices";

/**
 * RÉGION d'une créatrice — l'axe de regroupement de l'écran Créateurs.
 *
 * ─── POURQUOI DÉRIVER PLUTÔT QUE STOCKER ────────────────────────────────────
 * Aucun champ « région » n'existe en base, et il ne faut pas en créer un : ce
 * serait une TROISIÈME horloge à côté de `creators.timezone` (le domicile de la
 * personne) et de `comptes.targetCountry` (le marché visé), donc une troisième
 * occasion de diverger. Le fuseau EST déjà la donnée de localisation, il est
 * validé à l'écriture, servi par `listCreators`, et il porte la seule chose que
 * le regroupement doit dire : « quelle heure est-il chez elle ? ».
 *
 * ─── L'ABSENCE EST UNE RÉGION ───────────────────────────────────────────────
 * `unknown` n'est pas un trou : c'est le groupe des fiches dont les jours de
 * warmup, échéances et relances tournent sur UTC faute de mieux (cf le schéma :
 * « ABSENT ⇒ fuseau INCONNU, et c'est un état LÉGITIME et VISIBLE, jamais un
 * repli silencieux sur Paris »). L'écran le rend visible plutôt que de le
 * ranger avec les autres.
 */
export const REGION_KEYS = [
  "europe",
  "us",
  "canada",
  "latam",
  "africa",
  "asia",
  "oceania",
  "other",
  "unknown",
] as const;

export type RegionKey = (typeof REGION_KEYS)[number];

/**
 * ORDRE d'affichage des groupes. Géographique et FIGÉ, pas trié par effectif :
 * un écran dont les sections changent de place quand quelqu'un publie ne se
 * mémorise pas. `unknown` ferme la marche — c'est la file de travail, pas une
 * région.
 */
export const REGION_ORDER: RegionKey[] = [...REGION_KEYS];

/** Clés de libellé des régions : `admin.creators.region.<clé>`. */
export const REGION_LABEL_KEYS: Record<RegionKey, string> = {
  europe: "europe",
  us: "us",
  canada: "canada",
  latam: "latam",
  africa: "africa",
  asia: "asia",
  oceania: "oceania",
  other: "other",
  unknown: "unknown",
};

/** Index zone → région, construit depuis la liste du sélecteur admin. */
const FROM_CHOICES: Record<string, RegionKey> = Object.fromEntries(
  TIMEZONE_CHOICES.map((c) => [c.zone, c.region]),
);

/**
 * Fuseaux `America/*` COURANTS mais absents du sélecteur admin.
 *
 * Ils arrivent quand même en base : `confirmMyTimezone` accepte le fuseau que le
 * navigateur de la créatrice annonce, et `isSupportedTimezone` laisse passer
 * tout identifiant IANA que le runtime sait rendre. Sans cette table, une
 * créatrice à Mexico ou à Santiago tomberait dans « Autre fuseau » alors que sa
 * région est parfaitement connue.
 *
 * ⚠️ Elle ne couvre pas `America/*` en entier, et c'est délibéré : deviner la
 * région d'un identifiant inconnu (Detroit est aux US, Nassau non) donnerait des
 * réponses fausses avec l'air d'être sûres. Un `America/*` non listé va dans
 * `other`, où il reste VISIBLE avec son fuseau affiché — ajouter la ligne ici
 * est alors une décision d'une seconde.
 */
const EXTRA_AMERICAS: Record<string, RegionKey> = {
  "America/Detroit": "us",
  "America/Indiana/Indianapolis": "us",
  "America/Boise": "us",
  "America/Juneau": "us",
  "America/Montreal": "canada",
  "America/Edmonton": "canada",
  "America/Winnipeg": "canada",
  "America/Halifax": "canada",
  "America/Mexico_City": "latam",
  "America/Santiago": "latam",
  "America/Bogota": "latam",
  "America/Lima": "latam",
  "America/Caracas": "latam",
  "America/Montevideo": "latam",
  "America/Guatemala": "latam",
  "America/Costa_Rica": "latam",
  "America/Panama": "latam",
  "America/Santo_Domingo": "latam",
  "America/Havana": "latam",
  "America/La_Paz": "latam",
  "America/Asuncion": "latam",
  "America/Guayaquil": "latam",
  "America/Recife": "latam",
  "America/Fortaleza": "latam",
  "America/Manaus": "latam",
  "America/Bahia": "latam",
};

/** Régions déductibles du seul PRÉFIXE IANA, sans ambiguïté de pays. */
const BY_PREFIX: [string, RegionKey][] = [
  ["Europe/", "europe"],
  ["Africa/", "africa"],
  ["Asia/", "asia"],
  ["Indian/", "asia"],
  ["Australia/", "oceania"],
  ["Antarctica/", "other"],
];

/**
 * Région d'un fuseau IANA. `null`/`undefined`/chaîne vide ⇒ `unknown`.
 *
 * Résolution, du plus sûr au moins sûr : la liste du sélecteur, puis les
 * `America/*` courants, puis le préfixe continental, puis `other`. Aucune étape
 * ne devine : `other` est une réponse, pas un échec.
 */
export function creatorRegion(
  timezone: string | null | undefined,
): RegionKey {
  if (typeof timezone !== "string" || timezone === "") return "unknown";
  const direct = FROM_CHOICES[timezone] ?? EXTRA_AMERICAS[timezone];
  if (direct) return direct;
  for (const [prefix, region] of BY_PREFIX) {
    if (timezone.startsWith(prefix)) return region;
  }
  // `Pacific/*` couvre Honolulu (traité plus haut, US) et l'Océanie. Le reste
  // — Auckland, Fidji, Tahiti — est océanien.
  if (timezone.startsWith("Pacific/")) return "oceania";
  return "other";
}

/**
 * Libellé court de la ville, pour la LIGNE (le groupe porte la région).
 *
 * « São Paulo (Brésil) » devient « São Paulo » : le pays est déjà dit par le
 * titre de groupe, le répéter à chaque ligne ne fait qu'allonger la colonne.
 * Un fuseau hors liste rend son dernier segment lisible (`America/Santiago` →
 * « Santiago ») plutôt que l'identifiant entier.
 */
export function shortZoneLabel(zone: string, label?: string): string {
  if (label !== undefined) return label.replace(/\s*[—(].*$/, "").trim();
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

/**
 * Heure locale « 14:20 » dans un fuseau, ou `null` si le runtime ne sait pas le
 * rendre. Jamais de repli sur l'heure de l'équipe : une heure fausse à côté d'un
 * nom de ville est pire que pas d'heure du tout.
 */
export function localTimeIn(
  zone: string,
  at: number = Date.now(),
  locale: string = "fr-FR",
): string | null {
  try {
    // L'horloge suit la langue du lecteur : « 14:20 » en français, « 2:20 PM »
    // en anglais.
    return new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(at));
  } catch {
    return null;
  }
}

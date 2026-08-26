import { localeOrDefault } from "./locales";
import { ERR, err } from "./errorCodes";
/**
 * PHASE ET QUOTA d'un compte de CLIPPEUR — source unique de la règle.
 *
 * Module PUR (aucun import `_generated`) → importable côté serveur, côté client
 * ET depuis `lib/` pour les tests, en UNE seule définition. Même patron que
 * `convex/roles.ts` et `convex/rushStatus.ts`.
 *
 * ⚠️ Pourquoi PAS une paire `lib/account-phase.ts` + réplique, contrairement à
 * `lib/warmup.ts` ↔ `convex/warmup.ts` : la règle A6 interdit à `convex/`
 * d'importer `lib/`, PAS l'inverse. Cette paire-là est historique, antérieure au
 * patron ; la reproduire ici reviendrait à surveiller par un test de parité une
 * divergence qu'on peut rendre impossible.
 *
 * ⚠️ COEXISTENCE, PAS REMPLACEMENT (arbitrage D3). Ce modèle — une phase DÉRIVÉE
 * D'UNE DATE — ne s'applique qu'aux comptes dont le propriétaire est un clippeur.
 * Les créateurs partenaires gardent leur warmup compté en CHECKS RÉELLEMENT POSÉS
 * (`lib/warmup.ts`), délibérément découplé du calendrier. Les deux règles sont
 * incompatibles sur le même champ : appliquer celle-ci rétroactivement changerait
 * la publiabilité de chaque compte en prod du jour au lendemain, sans qu'aucun
 * humain n'ait rien fait — et deux gates en dépendent (éligibilité d'une cible,
 * garde de publication).
 *
 * LE QUOTA EST DÉRIVÉ, JAMAIS SAISI. S'il était réglable, un clippeur pressé
 * posterait 4 fois le jour 2 et grillerait le compte.
 */

/** Phases d'un compte de clippeur, dans l'ordre chronologique. */
export const ACCOUNT_PHASES = [
  "chauffe",
  "warmup",
  "demo",
  "croisiere",
] as const;
export type AccountPhase = (typeof ACCOUNT_PHASES)[number];

const DAY_MS = 86_400_000;

/**
 * Barème : phase → premier jour (1-indexé, depuis la validation) et quota de
 * posts par jour. Table ORDONNÉE, lue de la fin vers le début — ajouter une phase
 * n'est qu'une ligne, sans cascade de `if`.
 */
const PHASE_TABLE: ReadonlyArray<{
  phase: AccountPhase;
  fromDay: number;
  postsPerDay: number;
}> = [
  // J1-3 — scroll seul, on ne publie pas.
  { phase: "chauffe", fromDay: 1, postsPerDay: 0 },
  { phase: "warmup", fromDay: 4, postsPerDay: 1 },
  { phase: "demo", fromDay: 7, postsPerDay: 1 },
  { phase: "croisiere", fromDay: 14, postsPerDay: 2 },
];

/**
 * CLÉS des libellés de phase (écran clippeur). Aucun terme technique exposé.
 *
 * Deux tables, et ce n'est pas de la redondance : `PHASE_LABEL_KEYS` sert en
 * TÊTE (« Chauffe »), `PHASE_INLINE_KEYS` sert INCRUSTÉ dans une phrase
 * (« en phase de chauffe »). Le code faisait `.toLowerCase()` sur le libellé —
 * faux dès qu'on traduit : l'anglais ne minusculise pas ses noms de la même
 * façon, et l'ordre des mots change. Cf I18N-TEXTE-AUSSI-DONNEE.md, famille B.
 */
export const PHASE_LABEL_KEYS: Record<AccountPhase, string> = {
  chauffe: "phase.label.chauffe",
  warmup: "phase.label.warmup",
  demo: "phase.label.demo",
  croisiere: "phase.label.croisiere",
};

export const PHASE_INLINE_KEYS: Record<AccountPhase, string> = {
  chauffe: "phase.inline.chauffe",
  warmup: "phase.inline.warmup",
  demo: "phase.inline.demo",
  croisiere: "phase.inline.croisiere",
};

/**
 * Jour de vie du compte, 1-indexé : le jour de la validation est J1.
 *
 * Une date de validation dans le FUTUR (dérive d'horloge, antidatage manuel)
 * retombe sur J1 — jamais sur un jour négatif qui donnerait un quota d'une phase
 * ultérieure. Fermé par défaut, comme partout dans ce chantier.
 */
export function dayOfPhase(validatedAt: number, at: number): number {
  const elapsed = Math.floor((at - validatedAt) / DAY_MS);
  return elapsed < 0 ? 1 : elapsed + 1;
}

/**
 * Phase d'un compte à l'instant `at`. `validatedAt` absent = compte NON VALIDÉ
 * par l'admin → `null` (et non « chauffe ») : l'absence de validation n'est pas
 * un début de parcours, c'est un parcours pas commencé.
 */
export function accountPhaseAt(
  validatedAt: number | null | undefined,
  at: number,
): AccountPhase | null {
  if (validatedAt === null || validatedAt === undefined) return null;
  const day = dayOfPhase(validatedAt, at);
  let current: AccountPhase = PHASE_TABLE[0].phase;
  for (const row of PHASE_TABLE) {
    if (day >= row.fromDay) current = row.phase;
  }
  return current;
}

/**
 * Quota de posts pour CE JOUR-LÀ. Compte non validé → 0 : tant que l'admin n'a
 * pas validé, rien ne sort. Phase de chauffe → 0 également (scroll seul).
 */
export function postsPerDayAt(
  validatedAt: number | null | undefined,
  at: number,
): number {
  const phase = accountPhaseAt(validatedAt, at);
  if (phase === null) return 0;
  return PHASE_TABLE.find((r) => r.phase === phase)!.postsPerDay;
}

/**
 * Clé de JOURNÉE UTC ("YYYY-MM-DD") d'un instant — l'unité du quota.
 *
 * UTC comme partout dans ce dépôt (le warmup compte ses checks en jours UTC via
 * `todayKey`, les relevés Apify sont bucketés en UTC, les crons sont en UTC).
 * ⚠️ EFFET DE BORD ASSUMÉ : un post daté après minuit heure de Paris tombe dans
 * la journée UTC PRÉCÉDENTE (Paris = UTC+1/+2). Un clippeur qui publie à 00h30
 * peut donc, une fois, avoir trois posts dans sa journée vécue. Introduire un
 * fuseau ici — concept absent du dépôt, DST compris — coûterait plus cher que cet
 * écart, qui ne touche que les posts entre minuit et 2 h.
 */
export function utcDayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Réciproque de `utcDayKey` : « YYYY-MM-DD » → un instant DANS cette journée UTC
 * (midi, franchement au milieu du seau). `null` si la clé n'a pas la forme.
 *
 * Existe pour que le champ date de l'écran clippeur et le seau du quota soient
 * convertibles l'un dans l'autre SANS repasser par le fuseau local : un
 * `new Date("2026-08-12")` puis `getMonth()` ferait basculer d'un jour à l'ouest
 * de Greenwich, et l'écran annoncerait alors un autre jour que celui compté.
 * Le test vérifie l'aller-retour, pas des exemples.
 */
export function dayKeyToUtcInstant(key: string): number | null {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = Date.UTC(y, mo - 1, d, 12);
  // Rejette les dates impossibles (« 2026-02-31 » que Date.UTC reporterait en mars).
  return utcDayKey(at) === key ? at : null;
}

/** Bornes [début, fin) de la journée UTC contenant `at` — plage d'index. */
export function utcDayRange(at: number): { start: number; end: number } {
  const start = Date.UTC(
    new Date(at).getUTCFullYear(),
    new Date(at).getUTCMonth(),
    new Date(at).getUTCDate(),
  );
  return { start, end: start + DAY_MS };
}

const JOURS = {
  // i18n-exempt: table de données FR — la table EN est juste à côté, formatUtcDay choisit
  fr: ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"],
  en: ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
} as const;

const MOIS = {
  // i18n-exempt: table de données FR — la table EN est juste à côté, formatUtcDay choisit
  fr: ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"],
  en: ["January","February","March","April","May","June","July","August",
       "September","October","November","December"],
} as const;

/**
 * Journée UTC en toutes lettres — « lundi 10 août ».
 *
 * ⚠️ UN SEUL REPÈRE. Le seau du quota est la journée UTC (`utcDayRange`) : le
 * libellé DOIT l'être aussi. En heure locale, un post parisien de 00h30 se
 * verrait refuser « pour le 11 » par un compteur qui compte le 10 — l'écran et
 * le serveur se contrediraient dans la même vue, et c'est le seul endroit où un
 * clippeur peut perdre confiance dans l'outil d'un coup.
 *
 * ⚠️ Table en dur plutôt que `toLocaleDateString("fr-FR", { month: "long" })` :
 * l'ICU du runtime Convex n'est pas garanti complet, et un repli silencieux
 * rendrait « August » dans un message français. Les seuls formats de date déjà
 * utilisés côté serveur sont numériques, précisément pour cette raison. Ici on
 * veut des lettres — donc on les fournit.
 *
 * Exporté : l'écran clippeur affiche la MÊME chaîne que celle du refus.
 */
export function formatUtcDay(at: number, locale: unknown = "fr"): string {
  const l = localeOrDefault(locale);
  const d = new Date(at);
  const quantieme = d.getUTCDate();
  // L'ORDRE DES MOTS change avec la langue, pas seulement les mots :
  //   fr → « lundi 10 août »        (jour quantième mois)
  //   en → « Monday, August 10 »    (jour, mois quantième)
  // Et l'ordinal « 1er » n'a pas d'équivalent en anglais US courant.
  if (l === "en") {
    return `${JOURS.en[d.getUTCDay()]}, ${MOIS.en[d.getUTCMonth()]} ${quantieme}`;
  }
  return `${JOURS.fr[d.getUTCDay()]} ${quantieme === 1 ? "1er" : quantieme} ${
    MOIS.fr[d.getUTCMonth()]
  }`;
}

/**
 * REFUS DE QUOTA — rejet structuré, lu par le clippeur ET par l'admin.
 *
 * ⚠️ NOMME LA DATE, toujours. Un clippeur qui publie deux posts lundi, les
 * déclare lundi soir, en publie un troisième lundi tard et le déclare mardi
 * matin daté de lundi se voit refuser un mardi où il croit avoir deux créneaux
 * libres. Sans la date dans le message, le refus est incompréhensible et il
 * conclura que l'outil est cassé.
 *
 * Rend un `ConvexError` STRUCTURÉ plutôt qu'une phrase : le serveur ne connaît
 * pas la langue de l'appelant, et ces trois refus sortent d'un cœur partagé.
 * Le client rend `error.<code>` avec les paramètres, dans SA langue — ce qui
 * rétablit l'invariant « l'écran affiche la même chaîne que le refus », qui
 * était rompu depuis A3.
 *
 * Le message français reste dans la charge : repli d'affichage et trace lisible.
 */
export function quotaRefusal(
  handle: string,
  phase: AccountPhase | null,
  postsPerDay: number,
  at: number,
) {
  // `date` porte le rendu FRANÇAIS, pour le message de repli. `at` porte
  // l'instant BRUT : le client le reformate dans sa langue (« lundi 10 août »
  // contre « Monday, August 10 »). Sans lui, une phrase anglaise afficherait
  // une date française au milieu.
  const jour = formatUtcDay(at, "fr");
  const PHASE_FR: Record<AccountPhase, string> = {
    // i18n-exempt: repli FR de la charge d'erreur ; le client rend error.ERR_CLIP_QUOTA_* dans sa langue
    chauffe: "chauffe",
    // i18n-exempt: repli FR de la charge d'erreur
    warmup: "échauffement",
    // i18n-exempt: repli FR de la charge d'erreur
    demo: "démo",
    // i18n-exempt: repli FR de la charge d'erreur
    croisiere: "croisière",
  };
  if (phase === null) {
    return err(
      ERR.CLIP_QUOTA_NOT_VALIDATED,
      `Le compte ${handle} n'était pas encore validé le ${jour} : aucune publication possible à cette date.`,
      { handle, date: jour, at },
    );
  }
  if (postsPerDay === 0) {
    return err(
      ERR.CLIP_QUOTA_PHASE_ZERO,
      `Le compte ${handle} est en phase de ${PHASE_FR[phase]} le ${jour} : aucune publication possible à cette date.`,
      { handle, date: jour, at, phaseKey: PHASE_INLINE_KEYS[phase] },
    );
  }
  return err(
    ERR.CLIP_QUOTA_REACHED,
    `Quota atteint pour le ${jour} sur ${handle} : ${postsPerDay} publication${
      postsPerDay > 1 ? "s" : ""
    } sur ${postsPerDay} en phase de ${PHASE_FR[phase]}.`,
    {
      handle,
      date: jour,
      at,
      count: postsPerDay,
      max: postsPerDay,
      phaseKey: PHASE_INLINE_KEYS[phase],
    },
  );
}

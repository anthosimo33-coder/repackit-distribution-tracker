/**
 * « QUEL JOUR EST-IL POUR CETTE CRÉATRICE ? » — définition UNIQUE du dépôt.
 *
 * Module PUR (aucun import `_generated`) → importable par le serveur, le client
 * ET `lib/` pour les tests, en UNE définition. Même patron que
 * `convex/calendarStatus.ts`, `convex/accountPhase.ts` et `convex/postUrlDate.ts`.
 *
 * ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
 * Le dépôt portait QUATRE définitions concurrentes de « aujourd'hui » :
 *   1. `warmup.todayKey`          → journée UTC
 *   2. `accountPhase.utcDayKey`   → journée UTC
 *   3. `calendarStatus.parisDayIndex` → journée Europe/Paris
 *   4. `creator-schedule.startOfLocalDay` → journée du NAVIGATEUR
 * Une créatrice à New York pouvait donc lire deux jours différents sur deux
 * blocs de la même page, et perdre un jour de warmup en cochant le soir (le
 * check partait dans la journée UTC du LENDEMAIN, et le check du lendemain
 * matin était refusé). Cf `docs/diagnostic-fuseaux.md`.
 *
 * Les quatre convergent ici. Aucune ne doit survivre en doublon.
 *
 * ─── DEUX CONTRAINTES DU RUNTIME CONVEX, TENUES ICI ──────────────────────────
 * 1. Les PARTIES NUMÉRIQUES d'`Intl.DateTimeFormat` avec `timeZone` sont
 *    prouvées dans le runtime Convex (correctif #52, dont dépendent déjà
 *    `convex/dateFr.ts` et `analyticsHub.parisDay`). Les NOMS (mois en toutes
 *    lettres) ne le sont PAS — d'où la table en dur de `accountPhase`. Ce
 *    module n'utilise QUE du numérique : règle du dépôt, fuseau oui, noms non.
 * 2. `formatToParts` n'est utilisé NULLE PART ailleurs dans le dépôt, donc pas
 *    prouvé côté Convex. On s'en tient à `.format()` en "en-CA" (qui rend de
 *    l'ISO, découpable sans ambiguïté) — exactement ce que fait déjà
 *    `calendarStatus.PARIS_YMD`.
 *
 * ─── AUCUN REPLI SILENCIEUX SUR PARIS ────────────────────────────────────────
 * Règle du chantier, sans exception : une créatrice dont le fuseau est inconnu
 * est VISIBLE comme telle (`timezone: null`), jamais traitée comme parisienne.
 * `resolveCreatorTimezone` rend `null` plutôt que de deviner, et le test
 * `lib/creator-day.test.ts` en fait un invariant vérifié sur toutes les entrées
 * dégénérées.
 */

// ─── Table pays → fuseau par défaut ──────────────────────────────────────────

/**
 * Correspondance EXPLICITE et relisible pays → fuseau, alignée sur la liste
 * fermée de `convex/countries.SUPPORTED_COUNTRIES` (mêmes 10 clés).
 *
 * ⚠️ Ce n'est qu'un DÉFAUT DE DÉPART, jamais une vérité : plusieurs de ces pays
 * comptent plusieurs fuseaux (les US en ont six, le Brésil quatre, l'Australie
 * trois, le Canada six). La valeur retenue est le fuseau le plus peuplé du pays,
 * et elle sort TOUJOURS marquée `inferred` — pour qu'on puisse, dans six mois,
 * distinguer un fait d'une supposition en regardant la fiche.
 *
 * Ajouter un pays à `SUPPORTED_COUNTRIES` sans l'ajouter ici ne casse rien : la
 * déduction rendra `null` (pas de fuseau), ce qui est le comportement voulu.
 */
export const TIMEZONE_BY_COUNTRY: Record<string, string> = {
  US: "America/New_York", // 6 fuseaux — défaut sur la côte est
  FR: "Europe/Paris",
  GB: "Europe/London",
  DE: "Europe/Berlin",
  ES: "Europe/Madrid", // hors Canaries
  IT: "Europe/Rome",
  CA: "America/Toronto", // 6 fuseaux — défaut sur l'Ontario/Québec
  AU: "Australia/Sydney", // 3 fuseaux — défaut sur la Nouvelle-Galles du Sud
  BR: "America/Sao_Paulo", // 4 fuseaux — défaut sur le Sudeste
  AR: "America/Argentina/Buenos_Aires",
};

/** Provenance d'un fuseau — de la plus fiable à la moins fiable. */
export type TimezoneSource = "confirmed" | "admin" | "inferred";

/**
 * Fuseau d'une créatrice, ou `null` quand il est inconnu.
 *
 * ⚠️ Partout où ce type apparaît en paramètre, il est OBLIGATOIRE — même
 * contrat que le barème `days` du warmup : un site d'appel qui l'oublie doit
 * casser le typecheck, pas retomber en silence sur une horloge qui n'est pas
 * celle de la créatrice.
 */
export type CreatorZone = string | null;

/**
 * Fuseau à utiliser pour un calcul quand la créatrice n'en a pas.
 *
 * UTC, et surtout PAS Europe/Paris. C'est le repère neutre historique du dépôt :
 * il ne prétend rien sur le domicile de personne, et il laisse une fiche sans
 * fuseau se comporter exactement comme avant ce chantier. Le trou est signalé
 * « fuseau à définir » dans l'admin — il est visible, pas comblé par une
 * supposition. C'est la règle du chantier : aucun repli silencieux sur Paris.
 */
export function zoneOrNeutral(tz: CreatorZone): string {
  return tz ?? "UTC";
}

// ─── Cœur : conversion instant ↔ jour local ──────────────────────────────────

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Cache des formateurs. En construire un par appel coûte cher, et ce module est
 * appelé dans des boucles (listes d'assignments, digests, calendriers).
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      // `hourCycle` explicite : `hour12: false` rend « 24:00 » sur certains
      // moteurs, ce qui décalerait le parsing d'un jour à minuit pile.
      hourCycle: "h23",
    });
    FORMATTERS.set(timeZone, f);
  }
  return f;
}

/** "2026-09-02, 18:00:00" → [2026, 9, 2, 18, 0, 0]. */
function localParts(ms: number, timeZone: string): number[] {
  const s = formatterFor(timeZone).format(new Date(ms));
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})\D+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) {
    // Diagnostic développeur : un fuseau invalide est refusé à l'écriture par
    // isSupportedTimezone, ce throw n'atteint donc jamais un écran.
    // i18n-exempt: message d'erreur interne, jamais rendu
    throw new Error(`Fuseau illisible : ${timeZone} (rendu « ${s} »)`);
  }
  return [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  ];
}

/**
 * Décalage du fuseau à CET instant précis, en ms (positif à l'est de Greenwich).
 * Recalculé à chaque appel : un décalage figé casserait aux changements d'heure,
 * et les US et l'Europe ne basculent pas le même week-end (5 h d'écart Paris↔NY
 * du 8 au 29 mars 2026, et du 25 octobre au 1er novembre, contre 6 h le reste
 * de l'année).
 */
function offsetAt(ms: number, timeZone: string): number {
  const [y, mo, d, h, mi, s] = localParts(ms, timeZone);
  // L'heure murale locale, relue COMME SI elle était UTC. La différence avec
  // l'instant réel est exactement le décalage du fuseau.
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  // `ms` peut porter des millisecondes que le formateur a tronquées.
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

/**
 * Jour vécu par la créatrice, "YYYY-MM-DD".
 *
 * C'EST la fonction qui remplace `warmup.todayKey`, `accountPhase.utcDayKey`,
 * `calendarStatus.parisDayIndex` et `creator-schedule.startOfLocalDay`.
 */
export function dayKey(ms: number, timeZone: string): string {
  const [y, mo, d] = localParts(ms, timeZone);
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Index de jour COMPARABLE (année*10000 + mois*100 + jour). Monotone, donc
 * utilisable pour trier et comparer sans repasser par des chaînes.
 * Reprend le contrat de `calendarStatus.parisDayIndex`, fuseau paramétré.
 */
export function dayIndex(ms: number, timeZone: string): number {
  const [y, mo, d] = localParts(ms, timeZone);
  return y * 10000 + mo * 100 + d;
}

/** true si deux instants tombent le MÊME jour calendaire pour cette créatrice. */
export function isSameDay(a: number, b: number, timeZone: string): boolean {
  return dayIndex(a, timeZone) === dayIndex(b, timeZone);
}

/**
 * Instant UTC où COMMENCE le jour local `key` ("YYYY-MM-DD") — minuit chez elle.
 *
 * ⚠️ DEUX PASSES, et c'est nécessaire. Le décalage à appliquer dépend de
 * l'instant, et l'instant dépend du décalage : on part d'une estimation, puis on
 * relit le décalage RÉEL à cet endroit-là. Sans la seconde passe, les journées
 * de changement d'heure tombent une heure à côté.
 *
 * ⚠️ TROISIÈME GARDE — minuit peut NE PAS EXISTER. Certains pays ont fait
 * basculer leur heure d'été à minuit pile (le Brésil jusqu'en 2019) : la
 * journée commence alors à 01:00. On vérifie donc que l'instant obtenu retombe
 * bien sur le jour demandé, et on avance heure par heure sinon.
 */
export function startOfDayUtc(key: string, timeZone: string): number {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  // i18n-exempt: diagnostic développeur — la clé vient toujours de dayKey().
  if (!m) throw new Error(`Clé de jour invalide : ${key}`);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // Passe 1 : décalage estimé à l'heure murale lue comme UTC.
  let ts = wall - offsetAt(wall, timeZone);
  // Passe 2 : décalage RÉEL à l'instant trouvé.
  ts = wall - offsetAt(ts, timeZone);

  // Garde : si minuit n'existe pas ce jour-là, avancer jusqu'à la première
  // heure qui appartient réellement au jour demandé.
  for (let i = 0; i < 4 && dayKey(ts, timeZone) !== key; i++) {
    ts += HOUR_MS;
  }
  return ts;
}

/**
 * Dernière milliseconde du jour local `key` — l'instant UTC auquel une échéance
 * « le 2 septembre » expire réellement pour cette créatrice.
 *
 * Dérivé du DÉBUT DU JOUR SUIVANT et non de « début + 24 h » : une journée de
 * changement d'heure dure 23 ou 25 heures.
 */
export function endOfDayUtc(key: string, timeZone: string): number {
  const debut = startOfDayUtc(key, timeZone);
  // Le lendemain calendaire, obtenu depuis le milieu de la journée courante
  // (à l'abri des journées de 23 h).
  const lendemain = dayKey(debut + 36 * HOUR_MS, timeZone);
  return startOfDayUtc(lendemain, timeZone) - 1;
}

/** Bornes [début, fin) de la journée locale contenant `ms`. */
export function dayRange(
  ms: number,
  timeZone: string,
): { start: number; end: number } {
  const key = dayKey(ms, timeZone);
  const start = startOfDayUtc(key, timeZone);
  return { start, end: endOfDayUtc(key, timeZone) + 1 };
}

/**
 * Nombre de jours CALENDAIRES locaux écoulés entre deux instants.
 *
 * Compte des changements de date vécus, pas des tranches de 24 h : c'est ce
 * qu'attend « jours écoulés depuis le début du warmup » quand une journée de
 * changement d'heure dure 23 h. `Math.floor((b - a) / 86 400 000)` se trompait
 * d'un jour deux fois par an.
 */
export function daysBetween(a: number, b: number, timeZone: string): number {
  const from = startOfDayUtc(dayKey(a, timeZone), timeZone);
  const to = startOfDayUtc(dayKey(b, timeZone), timeZone);
  // Arrondi : l'écart en ms entre deux minuits locaux est un multiple de 24 h à
  // ±1 h près (DST), jamais assez pour franchir un demi-jour.
  return Math.round((to - from) / DAY_MS);
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Le fuseau est-il un identifiant IANA que le runtime sait rendre ?
 *
 * Validé en TENTANT de construire le formateur plutôt qu'en comparant à une
 * liste : la base IANA bouge, une liste en dur périmerait en silence. Un fuseau
 * refusé ici ne doit jamais atteindre la base — sinon toute lecture de date de
 * cette créatrice lève.
 */
export function isSupportedTimezone(timeZone: unknown): boolean {
  if (typeof timeZone !== "string" || timeZone.trim() === "") return false;
  // Les décalages bruts ("UTC+2", "GMT-5") sont refusés : ils ne portent pas de
  // règle de changement d'heure, donc ils dérivent deux fois par an.
  if (!timeZone.includes("/") && timeZone !== "UTC") return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// ─── Résolution du fuseau d'une créatrice ────────────────────────────────────

/**
 * Déduit un fuseau des pays CIBLÉS par les comptes d'une créatrice.
 *
 * ⚠️ Rend `null` dès qu'il y a le moindre doute — aucun pays, plusieurs pays
 * différents, ou un pays absent de la table. C'est la règle du chantier : on ne
 * devine pas, on rend la fiche visible comme « fuseau à définir ».
 *
 * Le cas « plusieurs pays » existe en prod (une créatrice porte des comptes US
 * ET FR au 2026-08-31) : le pays d'un compte décrit le MARCHÉ VISÉ, pas
 * l'endroit où vit la personne, et deux marchés ne disent rien de son domicile.
 */
export function inferTimezoneFromCountries(
  countries: readonly string[],
): string | null {
  const distincts = [...new Set(countries.filter(Boolean))];
  if (distincts.length !== 1) return null;
  return TIMEZONE_BY_COUNTRY[distincts[0]] ?? null;
}

/**
 * Fuseau EFFECTIF d'une créatrice, avec sa PROVENANCE.
 *
 * Ordre de confiance décroissant :
 *   1. `confirmed` — la créatrice l'a validé elle-même à sa première connexion ;
 *   2. `admin`     — un admin l'a saisi sur sa fiche ;
 *   3. `inferred`  — déduit du pays de ses comptes, en attendant mieux.
 *
 * Une valeur STOCKÉE (confirmed/admin) n'est jamais écrasée par la déduction :
 * une créatrice à Madrid peut animer un compte US, et c'est son domicile qui
 * commande, pas le marché de ses comptes.
 *
 * ⚠️ `{ timezone: null, source: null }` est un RÉSULTAT LÉGITIME, pas une
 * erreur. Tout appelant doit le traiter — c'est ce qui rend le repli sur Paris
 * impossible par construction.
 *
 * ─── `stored` : FIGÉ ou VIVANT ───────────────────────────────────────────────
 * Depuis le gel au premier check, `source: "inferred"` recouvre DEUX états que
 * l'admin doit pouvoir distinguer :
 *   - `stored: true`  — la valeur est ÉCRITE sur la fiche. Elle ne bougera plus,
 *     même si le pays des comptes change. Il faut agir pour la corriger.
 *   - `stored: false` — la valeur est CALCULÉE à la lecture. Elle se corrigera
 *     toute seule le jour où le pays change, et se figera au premier check.
 * Sans ce drapeau, une fiche gelée sur une mauvaise valeur est indiscernable
 * d'une fiche qui va se corriger : l'admin croit n'avoir rien à faire.
 */
export function resolveCreatorTimezone(
  creator: { timezone?: string | null; timezoneSource?: string | null },
  accountCountries: readonly string[] = [],
): {
  timezone: string | null;
  source: TimezoneSource | null;
  stored: boolean;
} {
  const stocke = creator.timezone;
  if (typeof stocke === "string" && isSupportedTimezone(stocke)) {
    // Une valeur stockée sans provenance lisible est traitée comme « admin » :
    // elle a forcément été posée à la main, et la marquer `confirmed` à tort
    // ferait passer une supposition pour un fait.
    const src =
      creator.timezoneSource === "confirmed"
        ? "confirmed"
        : creator.timezoneSource === "inferred"
          ? "inferred"
          : "admin";
    return { timezone: stocke, source: src, stored: true };
  }
  const deduit = inferTimezoneFromCountries(accountCountries);
  if (deduit) return { timezone: deduit, source: "inferred", stored: false };
  return { timezone: null, source: null, stored: false };
}

/**
 * Carte `creatorId → fuseau` construite depuis des collections DÉJÀ CHARGÉES.
 *
 * Pour les traitements de masse (digest, calendriers, listes admin) qui
 * parcourent les comptes de PLUSIEURS créatrices : résoudre le fuseau une
 * requête à la fois y coûterait un aller-retour par ligne, et appliquer un
 * fuseau unique à tout le monde recréerait le défaut qu'on retire.
 *
 * Fonction PURE : elle ne lit pas la base, elle range ce qu'on lui donne.
 */
export function buildZoneMap(
  creators: readonly {
    _id: string;
    timezone?: string | null;
    timezoneSource?: string | null;
  }[],
  comptes: readonly { creatorId?: string | null; targetCountry?: string | null }[],
): Map<string, CreatorZone> {
  const paysParCreatrice = new Map<string, string[]>();
  for (const c of comptes) {
    if (!c.creatorId || !c.targetCountry) continue;
    const liste = paysParCreatrice.get(c.creatorId);
    if (liste) liste.push(c.targetCountry);
    else paysParCreatrice.set(c.creatorId, [c.targetCountry]);
  }
  const out = new Map<string, CreatorZone>();
  for (const cr of creators) {
    out.set(
      cr._id,
      resolveCreatorTimezone(cr, paysParCreatrice.get(cr._id) ?? []).timezone,
    );
  }
  return out;
}


/**
 * Décalage d'un fuseau à un instant donné, en MINUTES (négatif à l'ouest).
 *
 * Rend un NOMBRE et jamais du texte : la mise en forme (« UTC−4 ») est de
 * l'interface, elle vit côté écran — c'est ce qui garde ce module hors de portée
 * du contrôle i18n, alors qu'il est importé par le portail créatrice.
 *
 * `null` si le fuseau est illisible, plutôt qu'un décalage faux.
 */
export function utcOffsetMinutes(
  timeZone: string,
  at: number = Date.now(),
): number | null {
  try {
    return Math.round(offsetAt(at, timeZone) / 60_000);
  } catch {
    return null;
  }
}

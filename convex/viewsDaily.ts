/**
 * « Vues gagnées par jour » — répartition TEMPORELLE des deltas de snapshots.
 *
 * Module PUR (aucun import Convex), donc :
 *  - importable depuis `convex/trackerData.ts` (qui n'importe JAMAIS `lib/`,
 *    contrainte cross-tsconfig A6),
 *  - importable depuis `lib/` pour le client,
 *  - testable en vitest depuis `lib/views-daily.test.ts`.
 * Même arrangement que `convex/dateFr.ts` / `convex/postUrlDate.ts`. Il n'y a
 * donc plus de RÉPLIQUE de cet algorithme à tenir synchrone : l'ancienne paire
 * lib/tracker-data + convex/trackerData a été fusionnée ici.
 *
 * ── Ce qui a changé (et pourquoi) ────────────────────────────────────────────
 * AVANT : le delta entre deux relevés consécutifs était attribué EN ENTIER au
 * jour du relevé le plus RÉCENT (le point d'arrivée). Deux défauts :
 *
 *  1. Biais systématique d'un jour. Les relevés automatiques tombent à heure
 *     fixe (07:00 UTC YouTube, 08:00 UTC TikTok/Insta — cf `convex/crons.ts`) :
 *     l'intervalle J 10:00 → J+1 10:00 (Paris, été) couvre ~14 h du jour J et
 *     ~10 h du jour J+1, mais TOUT était compté sur J+1. Les vues d'un jour
 *     apparaissaient le lendemain, tous les jours.
 *  2. Effondrement sur un point. Un trou de sync de 48 h déversait deux jours
 *     de vues sur une seule date — un pic qui n'a jamais eu lieu, encadré de
 *     deux creux qui n'ont jamais eu lieu non plus.
 *
 * APRÈS : le delta est réparti AU PRORATA du temps couvert par l'intervalle,
 * sur chaque jour calendaire qu'il traverse. C'est approximatif (on suppose un
 * rythme constant entre deux relevés — faux, une vidéo décélère) mais SANS
 * biais systématique, contrairement à l'attribution au point d'arrivée. Le
 * dépassement de `ESTIMATED_SPAN_MS` marque le jour comme estimé pour que
 * l'écran le dise (note en tooltip) au lieu de laisser croire à une mesure.
 *
 * ── Fuseau ───────────────────────────────────────────────────────────────────
 * Les jours sont des jours calendaires EUROPE/PARIS, pas UTC : c'est la journée
 * telle que l'admin la vit, et c'est l'ancre déjà retenue partout où une date
 * est LUE par un humain (cf `convex/dateFr.ts`). Les bornes de découpe sont donc
 * les minuits LOCAUX, DST comprise (une journée de bascule fait 23 h ou 25 h, et
 * le prorata en tient compte tout seul puisqu'il travaille en durées réelles).
 *
 * ⚠️ Le graphe `aggregateTimeseries` (convex/metricSnapshots.ts, `bucketKey`)
 * reste bucketisé en UTC. Les deux axes peuvent donc différer d'un jour sur les
 * relevés de fin de soirée ; ce module n'y touche pas (chantier distinct).
 */

const HOUR_MS = 3_600_000;

/**
 * Écart entre deux relevés au-delà duquel les jours servis par cet intervalle
 * sont marqués « estimés » (note en tooltip).
 *
 * 30 h = un cran au-dessus du rythme nominal d'un relevé par jour : une sync
 * partie en retard de quelques heures ne déclenche pas la note (le prorata sur
 * ~26 h reste une mesure), un vrai trou de sync la déclenche.
 */
export const ESTIMATED_SPAN_MS = 30 * HOUR_MS;

export type SnapshotPoint = {
  publicationId: string;
  capturedAt: number;
  vues: number;
};

export type DailyPoint = {
  /** Jour calendaire EUROPE/PARIS, "YYYY-MM-DD" (lexicographique = chronologique). */
  date: string;
  /** Vues gagnées attribuées à ce jour (entier, cf `roundPreservingTotal`). */
  value: number;
  /**
   * true dès qu'AU MOINS UN intervalle source ayant alimenté ce jour dépasse
   * `ESTIMATED_SPAN_MS` — la valeur est alors une estimation au prorata, pas
   * une mesure. Un jour peut mêler les deux (un post relevé tous les jours, un
   * autre resté 3 jours sans relevé) : le drapeau est alors levé, c'est le sens
   * voulu (« au moins une partie de ce point est estimée »).
   */
  estimated: boolean;
};

/* ── Calendrier Europe/Paris ─────────────────────────────────────────────── */

/** Formateur UNIQUE réutilisé : instancier un Intl.DateTimeFormat par appel
 *  coûterait des dizaines de µs × dizaines de milliers de snapshots. */
const PARIS_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type ParisParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parisParts(ts: number): ParisParts {
  const parts = PARIS_PARTS.formatToParts(new Date(ts));
  const read = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function keyFromParts(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Jour calendaire Europe/Paris d'un instant, "YYYY-MM-DD". */
export function parisDayKey(timestamp: number): string {
  const p = parisParts(timestamp);
  return keyFromParts(p.year, p.month, p.day);
}

/** Décalage Paris↔UTC à un instant donné, en ms (+1 h ou +2 h selon la DST). */
function parisOffsetMs(timestamp: number): number {
  const p = parisParts(timestamp);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // `parisParts` tronque à la seconde → comparer à la seconde, sinon l'offset
  // sort avec des millisecondes parasites.
  return wall - Math.floor(timestamp / 1000) * 1000;
}

/**
 * Mémo des minuits locaux. Le minuit Paris d'une date calendaire donnée est un
 * instant CONSTANT : la mise en cache est exacte, pas une approximation. Bornée
 * de fait par le nombre de jours distincts d'une fenêtre de graphe (~90).
 */
const midnightCache = new Map<string, number>();

/**
 * Instant UTC du minuit LOCAL Paris de la date (year, month, day). `Date.UTC`
 * absorbe les débordements → passer `day + 1` donne le minuit du lendemain, y
 * compris en fin de mois.
 *
 * Deux passes : l'offset lu à l'instant approché suffit, car Paris ne SAUTE
 * jamais minuit (les bascules DST ont lieu à 02:00/03:00 locales). Minuit local
 * existe donc et est unique tous les jours de l'année — pas de cas ambigu.
 */
export function parisMidnightUtc(
  year: number,
  month: number,
  day: number,
): number {
  const key = `${year}-${month}-${day}`;
  const cached = midnightCache.get(key);
  if (cached !== undefined) return cached;

  const naive = Date.UTC(year, month - 1, day);
  const approx = naive - parisOffsetMs(naive);
  const exact = naive - parisOffsetMs(approx);
  midnightCache.set(key, exact);
  return exact;
}

/* ── Agrégation ──────────────────────────────────────────────────────────── */

function addTo(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

/**
 * Arrondi à l'entier des totaux journaliers PAR PLUS FORT RESTE, de sorte que
 * la somme de la série reste EXACTEMENT égale à la somme des deltas (qui sont
 * des entiers). Un arrondi indépendant par jour ferait dériver le total du
 * graphe de plusieurs vues sur une fenêtre de 90 jours.
 *
 * Départage déterministe par clé de jour à reste égal (résultat stable, donc
 * testable).
 */
// i18n-exempt: générique TypeScript, pas du texte
function roundPreservingTotal(exact: Map<string, number>): Map<string, number> {
  const rows = [...exact.entries()].map(([date, value]) => ({
    date,
    whole: Math.floor(value),
    frac: value - Math.floor(value),
  }));
  const total = Math.round(
    [...exact.values()].reduce((sum, v) => sum + v, 0),
  );
  let left = total - rows.reduce((sum, r) => sum + r.whole, 0);

  const byRemainder = [...rows].sort(
    (a, b) => b.frac - a.frac || a.date.localeCompare(b.date),
  );
  for (const row of byRemainder) {
    if (left <= 0) break;
    row.whole += 1;
    left -= 1;
  }

  return new Map(rows.map((r) => [r.date, r.whole]));
}

/* ── Le départ d'une vidéo ───────────────────────────────────────────────── */

export type PublicationDepart = {
  publicationId: string;
  /** Instant de publication (ms) — `publications.datePubli`. */
  publishedAt: number;
};

/**
 * LE DÉPART D'UNE VIDÉO — 0 vue à l'instant de sa publication.
 *
 * La répartition ne compte que les écarts ENTRE relevés : le premier relevé d'un
 * post servait de référence, et tout ce que la vidéo avait fait AVANT lui ne
 * tombait dans aucun jour. Or une vidéo part de zéro, et son premier relevé
 * arrive des heures plus tard — 6,7 h en médiane sur Snytch, 24 h pour un post
 * sur dix. Mesuré sur la prod du 05 au 23/09/2026 : 875 441 vues faites avant le
 * premier relevé contre 1 617 860 comptées ensuite, soit 35 % des vues des
 * nouveaux posts invisibles pour la courbe « vues gagnées ». Sur la semaine du
 * 15 au 21/09, le projet passait de 1 196 078 à 1 551 158 vues (+30 %), et
 * Veljko, dont les vidéos partent dans les premières heures, de 72 674 à 308 007.
 *
 * Ce point est AJOUTÉ aux relevés, puis la répartition fait le reste : les vues
 * du démarrage sont étalées au prorata entre la publication et le premier
 * relevé, sur les jours de Paris qu'elles traversent — comme n'importe quel
 * autre intervalle, estimation comprise au-delà de 30 h.
 *
 * TROIS CONDITIONS, sans lesquelles le départ inventerait des vues :
 *  - `couvertDepuis` : les relevés lus doivent couvrir TOUTE la vie du post. Une
 *    lecture bornée (le pouls lit trois jours) voit le premier relevé DE SA
 *    FENÊTRE, pas celui de la vidéo : lui poser un départ déverserait tout son
 *    historique sur ces trois jours. Un post publié avant la borne n'en reçoit
 *    donc pas — son premier relevé lu reste une référence, comme avant.
 *  - la publication doit PRÉCÉDER le premier relevé. Une date de publication
 *    postérieure (date de confirmation saisie après coup, cf TD-020) ne dit rien
 *    du départ réel : on garde l'ancien comportement.
 *  - un post sans aucun relevé n'a rien à répartir.
 */
export function ajouterDepartsDePublication(
  snaps: readonly SnapshotPoint[],
  publications: Iterable<PublicationDepart>,
  couvertDepuis: number,
): SnapshotPoint[] {
  const premierReleve = new Map<string, number>();
  for (const s of snaps) {
    const t = premierReleve.get(s.publicationId);
    if (t === undefined || s.capturedAt < t) {
      premierReleve.set(s.publicationId, s.capturedAt);
    }
  }
  const out = [...snaps];
  for (const p of publications) {
    const premier = premierReleve.get(p.publicationId);
    if (premier === undefined) continue;
    if (p.publishedAt < couvertDepuis) continue;
    if (p.publishedAt >= premier) continue;
    out.push({ publicationId: p.publicationId, capturedAt: p.publishedAt, vues: 0 });
  }
  return out;
}

/**
 * Vues GAGNÉES par jour (PAS cumulées) : pour chaque publication, le delta de
 * vues entre snapshots CONSÉCUTIFS est réparti AU PRORATA du temps sur les
 * jours calendaires Europe/Paris que l'intervalle traverse ; on somme sur tous
 * les posts, par jour. La courbe montre le rythme réel de génération de vues
 * (pics et creux), pas une somme monotone croissante.
 *
 * Détails :
 *  - Le 1er snapshot in-window de chaque post sert de RÉFÉRENCE (aucun delta
 *    émis) : on ne compte que les vues gagnées À L'INTÉRIEUR de la fenêtre.
 *    Pour un post dont la fenêtre couvre toute la vie, l'appelant ajoute d'abord
 *    son DÉPART (0 vue à la publication, cf `ajouterDepartsDePublication`) —
 *    sans lui, les vues d'avant le premier relevé ne tombent dans aucun jour.
 *  - Deltas négatifs (recomptage plateforme, suppression de vues) ramenés à 0.
 *  - Plusieurs snapshots le même jour pour un même post : leurs contributions
 *    s'additionnent (gain net du jour).
 *  - Jours à 0 après arrondi : absents de la série (contrat inchangé).
 *
 * `snaps` peut arriver dans n'importe quel ordre ; le tri par capturedAt est
 * fait ici, par publication.
 */
export function computeDailyViewDeltas(snaps: SnapshotPoint[]): DailyPoint[] {
  return computeDailyViewDeltasWithEstimate(snaps).map(({ date, value, estimated }) => ({
    date,
    value,
    estimated,
  }));
}

/** Un point du jour, avec la part de ses vues qui est ESTIMÉE (pas mesurée). */
export type DailyPointWithEstimate = DailyPoint & {
  /**
   * Vues du jour venues d'un intervalle de plus de `ESTIMATED_SPAN_MS` entre
   * deux relevés : réparties au prorata des heures, pas mesurées. Toujours
   * ≤ `value`. Le drapeau `estimated` se lève dès qu'UNE vue du jour l'est ;
   * ce montant dit COMBIEN — une vidéo relevée tous les six jours ne rend pas
   * « estimée » la journée de mille vidéos relevées chaque nuit.
   */
  estimatedValue: number;
};

/**
 * `computeDailyViewDeltas` avec la part estimée de chaque jour — même
 * répartition, même arrondi du total, mêmes jours.
 */
export function computeDailyViewDeltasWithEstimate(
  snaps: SnapshotPoint[],
): DailyPointWithEstimate[] {
  const { exact, estimatedDays, estimatedByDay } = repartir(snaps, () => TOUT);
  const parJour = new Map<string, number>();
  for (const [cle, v] of exact) addTo(parJour, jourDe(cle), v);
  return [...roundPreservingTotal(parJour).entries()]
    .filter(([, value]) => value > 0)
    .map(([date, value]) => ({
      date,
      value,
      estimated: estimatedDays.has(date),
      estimatedValue: Math.min(value, Math.round(estimatedByDay.get(date) ?? 0)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Le groupe unique de la série non ventilée. */
const TOUT = "\u0000tout";
/** Sépare le jour du groupe dans une clé `jour|groupe`. */
const SEP = "\u0000";
const cleDe = (jour: string, groupe: string) => `${jour}${SEP}${groupe}`;
const jourDe = (cle: string) => cle.slice(0, cle.indexOf(SEP));
const groupeDe = (cle: string) => cle.slice(cle.indexOf(SEP) + 1);

/**
 * LA RÉPARTITION, une seule fois — le prorata de `computeDailyViewDeltas`,
 * extrait pour servir aussi la ventilation par marché et le détail d'un jour.
 *
 * Ces trois lectures DOIVENT partir du même calcul : une ventilation qui
 * répartirait autrement que le total afficherait des tranches qui ne
 * s'additionnent pas au trait qu'elles décomposent, et personne ne saurait
 * laquelle des deux croire.
 */
function repartir(
  snaps: SnapshotPoint[],
  groupeDeLaPubli: (publicationId: string) => string,
// i18n-exempt: générique TypeScript, pas du texte
): {
  exact: Map<string, number>;
  estimatedDays: Set<string>;
  /** Vues (non arrondies) venues d'intervalles estimés, par jour. */
  estimatedByDay: Map<string, number>;
} {
  const byPub = new Map<string, SnapshotPoint[]>();
  for (const s of snaps) {
    const arr = byPub.get(s.publicationId);
    if (arr) arr.push(s);
    else byPub.set(s.publicationId, [s]);
  }

  const exact = new Map<string, number>();
  const estimatedDays = new Set<string>();
  const estimatedByDay = new Map<string, number>();

  for (const [publicationId, arr] of byPub) {
    const groupe = groupeDeLaPubli(publicationId);
    arr.sort((a, b) => a.capturedAt - b.capturedAt);
    for (let i = 1; i < arr.length; i++) {
      const from = arr[i - 1].capturedAt;
      const to = arr[i].capturedAt;
      const delta = Math.max(0, arr[i].vues - arr[i - 1].vues);
      if (delta === 0) continue;

      const span = to - from;
      if (span <= 0) {
        // Deux relevés au même instant (import, re-saisie) : rien à répartir.
        addTo(exact, cleDe(parisDayKey(to), groupe), delta);
        continue;
      }
      const isEstimated = span > ESTIMATED_SPAN_MS;

      let cursor = from;
      while (cursor < to) {
        const p = parisParts(cursor);
        const key = keyFromParts(p.year, p.month, p.day);
        const nextMidnight = parisMidnightUtc(p.year, p.month, p.day + 1);
        const sliceEnd = Math.min(nextMidnight, to);
        if (sliceEnd <= cursor) {
          // Inatteignable (minuit suivant est strictement postérieur à tout
          // instant du jour) — garde-fou : on solde l'intervalle plutôt que de
          // boucler à l'infini dans une query.
          addTo(exact, cleDe(key, groupe), (delta * (to - cursor)) / span);
          if (isEstimated) {
            estimatedDays.add(key);
            addTo(estimatedByDay, key, (delta * (to - cursor)) / span);
          }
          break;
        }
        addTo(exact, cleDe(key, groupe), (delta * (sliceEnd - cursor)) / span);
        if (isEstimated) {
          estimatedDays.add(key);
          addTo(estimatedByDay, key, (delta * (sliceEnd - cursor)) / span);
        }
        cursor = sliceEnd;
      }
    }
  }

  return { exact, estimatedDays, estimatedByDay };
}

export type DailyByGroup = {
  date: string;
  estimated: boolean;
  /** Total du jour — EXACTEMENT la somme de `parts`. */
  value: number;
  /** Une entrée par groupe ayant gagné des vues ce jour-là. */
  parts: { group: string; value: number }[];
};

/**
 * VUES GAGNÉES PAR JOUR, VENTILÉES — par marché, par plateforme, par ce qu'on
 * veut : le groupe est donné par l'appelant.
 *
 * ⚠️ DEUX INVARIANTS D'ARRONDI, et il en faut DEUX. La somme des jours reste
 * égale au total exact (comme la série simple), ET la somme des tranches d'un
 * jour reste égale au total de ce jour. Sans le second, un graphe empilé
 * afficherait des tranches dont la somme diffère du trait qu'elles décomposent
 * — de quelques vues seulement, mais c'est l'écart que personne ne sait
 * expliquer six mois plus tard.
 */
export function computeDailyViewDeltasBy(
  snaps: SnapshotPoint[],
  groupeDeLaPubli: (publicationId: string) => string,
): DailyByGroup[] {
  const { exact, estimatedDays } = repartir(snaps, groupeDeLaPubli);

  const parJour = new Map<string, number>();
  for (const [cle, v] of exact) addTo(parJour, jourDe(cle), v);
  const totaux = roundPreservingTotal(parJour);

  /** jour → (groupe → exact) */
  const tranches = new Map<string, Map<string, number>>();
  for (const [cle, v] of exact) {
    const jour = jourDe(cle);
    const m = tranches.get(jour) ?? new Map<string, number>();
    tranches.set(jour, m);
    m.set(groupeDe(cle), (m.get(groupeDe(cle)) ?? 0) + v);
  }

  return [...totaux.entries()]
    .filter(([, value]) => value > 0)
    .map(([date, value]) => {
      // Les tranches du jour sont arrondies POUR SOMMER AU TOTAL DU JOUR, pas
      // chacune dans son coin : c'est ce qui fait tenir l'empilement.
      const arrondies = roundToTotal(tranches.get(date) ?? new Map(), value);
      return {
        date,
        value,
        estimated: estimatedDays.has(date),
        parts: [...arrondies.entries()]
          .filter(([, v]) => v > 0)
          .map(([group, v]) => ({ group, value: v }))
          .sort((a, b) => b.value - a.value || a.group.localeCompare(b.group)),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * CE QUI A FAIT LES VUES D'UN JOUR — la contribution de chaque publication.
 *
 * Même répartition que la série : le détail d'un jour somme donc exactement au
 * point du graphe. Rendre ce détail par un autre chemin (un delta brut de
 * snapshots, par exemple) donnerait un total voisin mais différent, et
 * l'écart se lirait comme un bug de l'un ou de l'autre.
 */
export type DayContributions = {
  /** Total du jour — EXACTEMENT la somme des `parts`. */
  total: number;
  /** Une entrée par publication ayant gagné des vues ce jour-là, décroissant. */
  parts: { publicationId: string; value: number }[];
};

export function computeDayContributions(
  snaps: SnapshotPoint[],
  jour: string,
): DayContributions {
  const { exact } = repartir(snaps, (id) => id);
  const duJour = new Map<string, number>();
  let sommeExacte = 0;
  for (const [cle, v] of exact) {
    if (jourDe(cle) !== jour) continue;
    const pub = groupeDe(cle);
    duJour.set(pub, (duJour.get(pub) ?? 0) + v);
    sommeExacte += v;
  }
  const total = Math.round(sommeExacte);
  return {
    total,
    parts: [...roundToTotal(duJour, total).entries()]
      .filter(([, v]) => v > 0)
      .map(([publicationId, value]) => ({ publicationId, value }))
      .sort((a, b) => b.value - a.value || a.publicationId.localeCompare(b.publicationId)),
  };
}

/**
 * Arrondit des parts à l'entier de sorte que leur somme vaille EXACTEMENT
 * `total`. Même méthode du plus fort reste que `roundPreservingTotal`, mais
 * contre une cible IMPOSÉE — celle du jour, déjà arrondie.
 */
function roundToTotal(
  parts: Map<string, number>,
  total: number,
): Map<string, number> {
  const rows = [...parts.entries()].map(([key, value]) => ({
    key,
    whole: Math.floor(value),
    frac: value - Math.floor(value),
  }));
  let left = total - rows.reduce((sum, r) => sum + r.whole, 0);
  const byRemainder = [...rows].sort(
    (a, b) => b.frac - a.frac || a.key.localeCompare(b.key),
  );
  for (const row of byRemainder) {
    if (left <= 0) break;
    row.whole += 1;
    left -= 1;
  }
  return new Map(rows.map((r) => [r.key, r.whole]));
}

/* ── Vues FACTURÉES gagnées par jour ─────────────────────────────────────── */

/** Un post RÉMUNÉRÉ d'une vidéo, et l'instant où son assiette de paie se fige. */
export type PostFacturable = {
  publicationId: string;
  /** `publications.datePubli` — le départ à 0 vue (cf `ajouterDepartsDePublication`). */
  publishedAt: number;
  /**
   * Premier instant EXCLU de l'assiette : J+31 ou le lancement d'une spark ad,
   * le plus tôt des deux (convex/payWindow `payCutoffAt`). Les vues gagnées
   * après ne sont pas payées, donc pas facturées.
   */
  coupure: number;
};

/** Une vidéo (une assignation) telle que le moteur de paie la facture. */
export type VideoFacturable = {
  /**
   * Ses vues FACTURÉES selon le moteur de paie (`billedViews`) : plafond
   * 150 $/vidéo, fenêtre J+30 et assiette d'un cycle déjà réglé y sont déjà
   * appliqués. C'est le PLAFOND de ce qu'on peut dater pour elle.
   */
  plafond: number;
  /** Ses posts RÉMUNÉRÉS — un post non rémunéré ne facture rien. */
  posts: readonly PostFacturable[];
};

export type DailyBilledViews = {
  /** Vues facturées gagnées par jour de Paris (entiers, jours à 0 absents). */
  jours: DailyPoint[];
  /** Σ des plafonds : les vues facturées du moteur, toutes dates confondues. */
  facturees: number;
  /**
   * Vues facturées qu'aucun relevé ne permet de DATER (= `facturees` − Σ jours).
   * Un post payé sans relevé dans sa fenêtre (`unmeasured`), ou dont la date de
   * publication suit son premier relevé (TD-020 : ce qui précède ce relevé ne
   * tombe dans aucun jour). Dit à part, jamais rangé dans un jour inventé.
   */
  nonDatees: number;
};

/**
 * VUES FACTURÉES GAGNÉES PAR JOUR — le dénominateur d'un RPM sur une période
 * quelconque.
 *
 * Le RPM mensuel de la carte Rentabilité range les vues d'une vidéo dans le
 * mois de sa PUBLICATION, alors que le revenu tombe le jour où il est encaissé :
 * un mois n'y est comparable qu'à M+30. Ici les vues sont rangées le jour où
 * elles sont FAITES, comme le revenu — donc comparables sur n'importe quels jours.
 *
 * Pour chaque vidéo :
 *  1. les relevés de ses posts rémunérés, AVANT leur coupure (J+30 / spark ad),
 *     plus le départ à 0 vue à la publication ;
 *  2. la MÊME répartition au prorata que la courbe « vues gagnées » ;
 *  3. les gains, jour après jour dans l'ordre CHRONOLOGIQUE, jusqu'au plafond
 *     de la vidéo — les premières vues sont celles qu'on paie, celles qui
 *     suivent le plafond 150 $ sont gratuites et ne comptent plus.
 *
 * Le plafond vient du moteur (`billedViews`), jamais recalculé ici : le seuil de
 * 150 $ dépend de la part fixe de la vidéo dans son barème, et une vidéo réglée
 * ne facture que l'assiette payée. Couper au plafond du moteur garantit que
 * Σ jours + `nonDatees` = vues facturées de la carte, vidéo par vidéo.
 *
 * ⚠️ L'appelant fournit TOUS les relevés de chaque post antérieurs à sa coupure,
 * sans borne basse : couper au plafond demande de savoir ce que la vidéo avait
 * déjà facturé avant la période lue.
 */
export function computeDailyBilledViews(
  videos: readonly VideoFacturable[],
  snaps: readonly SnapshotPoint[],
): DailyBilledViews {
  const coupureDe = new Map<string, number>();
  const departs: PublicationDepart[] = [];
  for (const v of videos) {
    for (const p of v.posts) {
      if (coupureDe.has(p.publicationId)) continue;
      coupureDe.set(p.publicationId, p.coupure);
      departs.push({ publicationId: p.publicationId, publishedAt: p.publishedAt });
    }
  }
  const dansLaFenetre = snaps.filter((s) => {
    const coupure = coupureDe.get(s.publicationId);
    return coupure !== undefined && s.capturedAt < coupure;
  });
  // Toute la vie du post est lue : le départ s'applique sans borne basse.
  const points = ajouterDepartsDePublication(
    dansLaFenetre,
    departs,
    Number.NEGATIVE_INFINITY,
  );
  const { exact, estimatedDays } = repartir(points, (id) => id);

  /** post → (jour → vues gagnées, exact) */
  const gainsDuPost = new Map<string, Map<string, number>>();
  for (const [cle, v] of exact) {
    const post = groupeDe(cle);
    const m = gainsDuPost.get(post) ?? new Map<string, number>();
    gainsDuPost.set(post, m);
    addTo(m, jourDe(cle), v);
  }

  const parJour = new Map<string, number>();
  let facturees = 0;
  for (const v of videos) {
    const plafond = Math.max(0, v.plafond);
    facturees += plafond;
    const gains = new Map<string, number>();
    const vus = new Set<string>();
    for (const p of v.posts) {
      if (vus.has(p.publicationId)) continue;
      vus.add(p.publicationId);
      for (const [jour, x] of gainsDuPost.get(p.publicationId) ?? []) {
        addTo(gains, jour, x);
      }
    }
    let cumul = 0;
    for (const jour of [...gains.keys()].sort()) {
      const part = Math.min(gains.get(jour) ?? 0, plafond - cumul);
      if (!(part > 0)) break;
      cumul += part;
      addTo(parJour, jour, part);
    }
  }

  const jours = [...roundPreservingTotal(parJour).entries()]
    .filter(([, value]) => value > 0)
    .map(([date, value]) => ({
      date,
      value,
      estimated: estimatedDays.has(date),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const datees = jours.reduce((s, j) => s + j.value, 0);
  return { jours, facturees, nonDatees: Math.max(0, facturees - datees) };
}

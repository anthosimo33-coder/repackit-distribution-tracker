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
 *  - Deltas négatifs (recomptage plateforme, suppression de vues) ramenés à 0.
 *  - Plusieurs snapshots le même jour pour un même post : leurs contributions
 *    s'additionnent (gain net du jour).
 *  - Jours à 0 après arrondi : absents de la série (contrat inchangé).
 *
 * `snaps` peut arriver dans n'importe quel ordre ; le tri par capturedAt est
 * fait ici, par publication.
 */
export function computeDailyViewDeltas(snaps: SnapshotPoint[]): DailyPoint[] {
  const byPub = new Map<string, SnapshotPoint[]>();
  for (const s of snaps) {
    const arr = byPub.get(s.publicationId);
    if (arr) arr.push(s);
    else byPub.set(s.publicationId, [s]);
  }

  const exact = new Map<string, number>();
  const estimatedDays = new Set<string>();

  for (const arr of byPub.values()) {
    arr.sort((a, b) => a.capturedAt - b.capturedAt);
    for (let i = 1; i < arr.length; i++) {
      const from = arr[i - 1].capturedAt;
      const to = arr[i].capturedAt;
      const delta = Math.max(0, arr[i].vues - arr[i - 1].vues);
      if (delta === 0) continue;

      const span = to - from;
      if (span <= 0) {
        // Deux relevés au même instant (import, re-saisie) : rien à répartir.
        addTo(exact, parisDayKey(to), delta);
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
          addTo(exact, key, (delta * (to - cursor)) / span);
          if (isEstimated) estimatedDays.add(key);
          break;
        }
        addTo(exact, key, (delta * (sliceEnd - cursor)) / span);
        if (isEstimated) estimatedDays.add(key);
        cursor = sliceEnd;
      }
    }
  }

  return [...roundPreservingTotal(exact).entries()]
    .filter(([, value]) => value > 0)
    .map(([date, value]) => ({
      date,
      value,
      estimated: estimatedDays.has(date),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

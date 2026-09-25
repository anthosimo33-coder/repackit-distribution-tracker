/**
 * DATES DU HUB ANALYTICS — fenêtres d'analyse et échéances, logique PURE.
 *
 * Déplacé de `lib/analytics-window.ts` et `lib/analytics-hub.ts` (qui les
 * ré-exportent, rien ne change pour l'écran) pour que les outils MCP
 * (convex/mcpTools.ts) fenêtrent EXACTEMENT comme l'écran : le runtime Convex
 * n'importe rien hors de `convex/` (règle A6). Les libellés affichés
 * (préréglages, « aucune donnée ») restent dans `lib/`.
 *
 * ⚠️ La clé de jour est une CHAÎNE "YYYY-MM-DD" en Europe/Paris : une
 * comparaison lexicographique sur ce format EST une comparaison chronologique.
 */

/** Bornes INCLUSIVES, en jours Europe/Paris "YYYY-MM-DD". */
export interface AnalyticsWindow {
  from: string;
  to: string;
}

/** Étendue réellement couverte par les données. */
export interface DataRange {
  first: string;
  last: string;
}

/** Préréglages proposés. `all` = toute la profondeur disponible. */
export type WindowPreset = "7d" | "14d" | "30d" | "all";

/** "YYYY-MM-DD" décalé de `n` jours (n négatif = passé). Calcul en UTC pur : la
 *  clé est déjà un jour civil, il n'y a plus de fuseau à appliquer dessus. */
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Nombre de jours COUVERTS par la fenêtre, bornes comprises (≥ 0). */
export function windowLengthDays(w: AnalyticsWindow): number {
  if (w.to < w.from) return 0;
  const a = Date.parse(`${w.from}T00:00:00Z`);
  const b = Date.parse(`${w.to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Étendue des données à partir des jours PRÉSENTS dans les séries. `null` si
 * aucune donnée — l'écran doit alors le dire, pas afficher une fenêtre vide.
 */
export function dataRangeOf(days: readonly string[]): DataRange | null {
  let first: string | null = null;
  let last: string | null = null;
  for (const d of days) {
    if (!d) continue;
    if (first === null || d < first) first = d;
    if (last === null || d > last) last = d;
  }
  return first !== null && last !== null ? { first, last } : null;
}

/**
 * Ramène une fenêtre dans les bornes des données, en préservant l'intention :
 * on coupe ce qui dépasse, on n'invente jamais de jours absents. Une fenêtre
 * entièrement hors données rend `null` (≠ d'une fenêtre vide silencieuse).
 */
export function clampWindow(
  w: AnalyticsWindow,
  range: DataRange | null,
): AnalyticsWindow | null {
  if (range === null) return null;
  const from = w.from < range.first ? range.first : w.from;
  const to = w.to > range.last ? range.last : w.to;
  return to < from ? null : { from, to };
}

/**
 * Fenêtre d'un préréglage, ancrée sur le DERNIER JOUR DE DONNÉES et non sur
 * « aujourd'hui ».
 *
 * La distinction compte : la synchro PostHog tourne à l'heure, donc le jour
 * courant est presque toujours partiel ou absent. Ancrer sur `now` ferait entrer
 * un jour vide dans « 7 derniers jours » et diviserait par 7 ce qui n'a que 6
 * jours de données — un taux faux, sans rien à l'écran pour le dire.
 */
export function presetWindow(
  preset: WindowPreset,
  range: DataRange,
): AnalyticsWindow {
  if (preset === "all") return { from: range.first, to: range.last };
  const n = preset === "7d" ? 7 : preset === "14d" ? 14 : 30;
  const from = shiftDay(range.last, -(n - 1));
  return { from: from < range.first ? range.first : from, to: range.last };
}

/** Le jour est-il DANS la fenêtre (bornes comprises) ? */
export function inWindow(day: string, w: AnalyticsWindow): boolean {
  return day >= w.from && day <= w.to;
}

/**
 * Σ d'une série datée sur la fenêtre. `null` = fenêtre absente (l'appelant
 * affiche un tiret) ; jamais 0, qui se lirait « mesuré à zéro ».
 */
export function sumInWindow<T>(
  rows: readonly T[],
  w: AnalyticsWindow | null,
  dayOf: (row: T) => string,
  valueOf: (row: T) => number,
): number | null {
  if (w === null) return null;
  let total = 0;
  for (const r of rows) {
    if (inWindow(dayOf(r), w)) total += valueOf(r);
  }
  return total;
}

/** Lignes de la série retenues par la fenêtre, ordre d'entrée préservé. */
export function rowsInWindow<T>(
  rows: readonly T[],
  w: AnalyticsWindow | null,
  dayOf: (row: T) => string,
): T[] {
  if (w === null) return [];
  return rows.filter((r) => inWindow(dayOf(r), w));
}

/**
 * La fenêtre couvre-t-elle TOUTE la profondeur disponible ? Sert à ne pas
 * afficher « sur la période » et « cumulé » comme deux chiffres distincts quand
 * ce sont, ce jour-là, exactement le même.
 */
export function coversEverything(
  w: AnalyticsWindow | null,
  range: DataRange | null,
): boolean {
  if (w === null || range === null) return false;
  return w.from <= range.first && w.to >= range.last;
}

/**
 * Fenêtre PRÉCÉDENTE de même longueur, pour un delta honnête.
 *
 * Rend `null` dès que la période de comparaison n'est PAS entièrement couverte
 * par les données. C'est le point de toute la fonction : comparer les 46 jours
 * disponibles aux 12 jours qui les précèdent produirait un « ▲ 280 % » qui ne
 * mesure que la profondeur d'historique. Mieux vaut aucun delta qu'un delta
 * calculé sur deux durées différentes — c'est exactement ce que faisait le badge
 * « stable », affiché sur neuf tuiles qui ne comparaient rien.
 */
export function previousWindow(
  w: AnalyticsWindow | null,
  range: DataRange | null,
): AnalyticsWindow | null {
  if (w === null || range === null) return null;
  const n = windowLengthDays(w);
  if (n <= 0) return null;
  const to = shiftDay(w.from, -1);
  const from = shiftDay(to, -(n - 1));
  // Couverture COMPLÈTE exigée : une comparaison tronquée n'en est pas une.
  if (from < range.first || to < range.first) return null;
  return { from, to };
}

/**
 * Jours ENTIERS restants (arrondi au supérieur) avant l'échéance `dueAt` depuis
 * `now`. Négatif = dépassé. null si l'échéance est inconnue (jamais un délai
 * inventé). Sert au décompte urgent d'un litige (« X j pour répondre »).
 */
export function daysUntil(dueAt: number | null, now: number): number | null {
  if (dueAt === null || !Number.isFinite(dueAt)) return null;
  return Math.ceil((dueAt - now) / (24 * 60 * 60 * 1000));
}

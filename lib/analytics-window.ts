/**
 * FENÊTRE D'ANALYSE du hub — logique PURE (testée Vitest, aucune dép React/Convex).
 *
 * Le hub ne savait afficher que « 7 / 30 / 90 derniers jours », et le sélecteur ne
 * découpait qu'UNE série : deux tuiles sur dix bougeaient, les huit autres étaient
 * cumulées depuis toujours. Ce module porte la fenêtre elle-même — bornes
 * INCLUSIVES, en jours calendaires Europe/Paris — pour que toutes les cartes
 * partagent la même définition au lieu d'en inventer chacune une.
 *
 * ⚠️ La clé de jour est une CHAÎNE "YYYY-MM-DD" en Europe/Paris, jamais un
 * timestamp : c'est déjà la clé que le serveur émet (`parisDay`), et comparer des
 * chaînes de date évite de re-décider d'un fuseau à chaque comparaison. Une
 * comparaison lexicographique sur ce format EST une comparaison chronologique.
 *
 * ⚠️ Le fenêtrage est BORNÉ AUX DONNÉES : PostHog ne contient rien avant le
 * 2026-07-23 (46 jours au 2026-09-06). Proposer « 90 jours » quand il en existe 46
 * fait croire à une comparaison qui n'a pas lieu — `clampWindow` ramène toujours
 * la fenêtre à ce qui existe, et l'écran DIT ce qu'il a réellement retenu.
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

export const PRESET_LABELS: Record<WindowPreset, string> = {
  "7d": "7 derniers jours",
  "14d": "14 derniers jours",
  "30d": "30 derniers jours",
  all: "Tout",
};

/** Jour Europe/Paris d'un instant → "YYYY-MM-DD" (même clé que le serveur). */
export function parisDayKey(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
    new Date(ts),
  );
}

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

/** "2026-07-23" → "23/07" ; avec l'année si elle diffère de celle de `ref`. */
export function formatDayShort(day: string, ref?: string): string {
  const [y, m, d] = day.split("-");
  if (!y || !m || !d) return day;
  return ref && ref.slice(0, 4) !== y ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}`;
}

/** Libellé d'une fenêtre, tel qu'il s'affiche sous le sélecteur. */
export function formatWindow(w: AnalyticsWindow | null): string {
  if (w === null) return "aucune donnée";
  if (w.from === w.to) return formatDayShort(w.from);
  return `${formatDayShort(w.from, w.to)} → ${formatDayShort(w.to)}`;
}

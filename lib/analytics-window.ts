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

// Le CALCUL (fenêtres, sommes, fenêtre précédente) vit dans convex/analyticsDates.ts,
// partagé avec les outils MCP (le runtime Convex n'importe rien de lib/). Ce
// module garde ce qui s'AFFICHE : libellés et formatage.
import type { AnalyticsWindow, WindowPreset } from "../convex/analyticsDates";
export type { AnalyticsWindow, DataRange, WindowPreset } from "../convex/analyticsDates";
export {
  clampWindow,
  coversEverything,
  dataRangeOf,
  inWindow,
  presetWindow,
  previousWindow,
  rowsInWindow,
  shiftDay,
  sumInWindow,
  windowLengthDays,
} from "../convex/analyticsDates";

/** Préréglages proposés — leur libellé. */
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


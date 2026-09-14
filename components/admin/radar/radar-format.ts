/**
 * RADAR — helpers d'AFFICHAGE (front uniquement, jamais importés côté Convex).
 * Formatage compact des stats, durée, fraîcheur du sync, engagement.
 */

/** 2 300 000 → "2,3 M" ; 45 600 → "45,6 k" ; 980 → "980". */
export function formatCount(n: number, locale: string = "fr-FR"): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sep = isEn(locale) ? "" : " ";
  if (abs >= 1_000_000) return trimDecimal(n / 1_000_000, locale) + sep + "M";
  if (abs >= 1_000) return trimDecimal(n / 1_000, locale) + sep + "k";
  return String(Math.round(n));
}

const isEn = (locale: string) => locale.startsWith("en");

function trimDecimal(x: number, locale: string): string {
  // 1 décimale, sans ",0" superflu (12,0 → 12) ; virgule en français, point en anglais.
  const s = x.toFixed(1).replace(/\.0$/, "");
  return isEn(locale) ? s : s.replace(".", ",");
}

/** Durée vidéo en mm:ss (90 → "1:30"). null/undefined → "". */
export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) {
    return "";
  }
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** Ratio d'engagement (0.123) → "12,3 %". */
export function formatEngagement(ratio: number, locale: string = "fr-FR"): string {
  const pct = isEn(locale) ? "%" : " %";
  if (!Number.isFinite(ratio) || ratio <= 0) return `0${pct}`;
  const v = (ratio * 100).toFixed(1);
  return (isEn(locale) ? v : v.replace(".", ",")) + pct;
}

/** Outlier ratio vues/abonnés → "47×", "3,2×" (< 10 = 1 décimale). */
export function formatOutlierRatio(ratio: number, locale: string = "fr-FR"): string {
  if (!Number.isFinite(ratio) || ratio < 0) return "—";
  if (ratio >= 10) return `${Math.round(ratio)}×`;
  const v = ratio.toFixed(1);
  return `${isEn(locale) ? v : v.replace(".", ",")}×`;
}

/** Date de publication courte (fr-FR) : "25 juin 2026". */
export function formatPublished(ms: number, locale: string = "fr-FR"): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleDateString(isEn(locale) ? "en-US" : "fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Fraîcheur du sync : "à l'instant", "il y a 2 h", "il y a 3 j", sinon date. */
/**
 * Libellés de fraîcheur par langue. Ils vivent ici plutôt que dans le catalogue
 * parce que ce module est un FORMATEUR pur, appelé hors composant (comme
 * `formatBytes`) : la langue est un paramètre, pas un hook.
 */
const RELATIVE = {
  // i18n-exempt: table de formats PAR LANGUE (formateur pur, cf formatBytes) — la langue est choisie par l'appelant
  fr: { never: "jamais", now: "à l'instant", min: (n: number) => `il y a ${n} min`, h: (n: number) => `il y a ${n} h`, d: (n: number) => `il y a ${n} j` },
  en: { never: "never", now: "just now", min: (n: number) => `${n} min ago`, h: (n: number) => `${n}h ago`, d: (n: number) => `${n}d ago` },
};

export function formatRelative(ms: number | null, locale: string = "fr-FR"): string {
  const L = isEn(locale) ? RELATIVE.en : RELATIVE.fr;
  if (ms === null || !Number.isFinite(ms)) return L.never;
  const diff = Date.now() - ms;
  if (diff < 0) return L.now;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return L.now;
  if (min < 60) return L.min(min);
  const h = Math.floor(min / 60);
  if (h < 24) return L.h(h);
  const d = Math.floor(h / 24);
  if (d < 30) return L.d(d);
  return formatPublished(ms, locale);
}

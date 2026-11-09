/**
 * RADAR — CE QUI SORT DU LOT chez les concurrents d'un projet. Sur les vidéos
 * TikTok de leurs comptes publiées il y a 2 à 14 jours (vues mûres), la part
 * qui fait 3× la normale de son compte (`FORMAT_WIN_MULTIPLIER`, la règle des
 * formats qui réussissent), par langue, par app et par façon de faire.
 *
 * Pas de fausse règle : une langue ou une app s'affiche à partir de 20 vidéos,
 * une façon de faire se juge sur 30 vidéos de chaque côté et ne « compte » qu'à
 * 3 points d'écart ou plus (09/11/2026, export prod : texte à l'écran 11 % avec,
 * 11 % sans — aucun écart ; espagnol d'Amérique 15 %, portugais 1 %).
 *
 * Module pur, sans texte : l'écran traduit les clés.
 */
import { FORMAT_WIN_MULTIPLIER } from "./radarNetworkMath";

const DAY = 86_400_000;
export const INSIGHT_MIN_AGE_MS = 2 * DAY;
export const INSIGHT_MAX_AGE_MS = 14 * DAY;
/** Une langue ou une app sous ce nombre de vidéos ne s'affiche pas. */
export const INSIGHT_MIN_ROW = 20;
/** Une façon de faire se juge sur au moins ce nombre de vidéos de chaque côté. */
export const INSIGHT_MIN_SIDE = 30;
/** Sous cet écart (en points), « pas d'écart ». */
export const INSIGHT_MIN_GAP_PTS = 3;
/** La phrase de tête ne compare que des langues assez vues (09/11 : l'espagnol d'Espagne en tête sur 30 vidéos). */
export const INSIGHT_HEADLINE_MIN = 50;
/** Un hook « court » : 8 mots ou moins. */
export const SHORT_HOOK_WORDS = 8;

export type InsightVideo = {
  appId: string;
  appName: string;
  /** Langue du compte (fr | pt | es-am | es-es | en | autre). */
  lang: string;
  publishedAt: number;
  views: number;
  /** Médiane des vues du compte ; absente = vidéo non jugée. */
  median: number | undefined;
  hook?: string;
  musicTitle?: string;
};

export type Bucket = { key: string; label?: string; n: number; wins: number };
export type AttrKey = "texte" | "son" | "longueur";
export type AttrInsight = {
  key: AttrKey;
  a: Bucket;
  b: Bucket;
  verdict: "ecart" | "pasEcart" | "pasAssez";
  /** Le côté qui réussit le plus quand l'écart compte. */
  better: "a" | "b" | null;
  /** Écart en points (a − b), arrondi à l'unité. */
  gapPts: number;
};
export type Insights = { n: number; wins: number; byLang: Bucket[]; byApp: Bucket[]; attrs: AttrInsight[] };

/** Part des vidéos qui sortent du lot, en %. */
export const pctOf = (b: { n: number; wins: number }) => (b.n === 0 ? 0 : (100 * b.wins) / b.n);

/** « original sound - x », « son original », « sonido original »… : le son de la vidéo, pas une musique. */
const ORIGINAL_SOUND = /^(?:original sound|son original|som original|sonido original|suono originale|originalton|оригинальный звук)\b/i;
export const isOriginalSound = (title: string) => ORIGINAL_SOUND.test(title.trim());

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function bucket(key: string, vs: readonly { win: boolean }[], label?: string): Bucket {
  return { key, ...(label !== undefined ? { label } : {}), n: vs.length, wins: vs.filter((v) => v.win).length };
}

function rows(groups: Map<string, { label?: string; vs: { win: boolean }[] }>): Bucket[] {
  return [...groups]
    .map(([key, g]) => bucket(key, g.vs, g.label))
    .filter((b) => b.n >= INSIGHT_MIN_ROW)
    .sort((x, y) => pctOf(y) - pctOf(x) || y.n - x.n || x.key.localeCompare(y.key));
}

function attr(key: AttrKey, a: Bucket, b: Bucket): AttrInsight {
  const gap = pctOf(a) - pctOf(b);
  const gapPts = Math.round(gap);
  if (a.n < INSIGHT_MIN_SIDE || b.n < INSIGHT_MIN_SIDE) return { key, a, b, verdict: "pasAssez", better: null, gapPts };
  if (Math.abs(gap) < INSIGHT_MIN_GAP_PTS) return { key, a, b, verdict: "pasEcart", better: null, gapPts };
  return { key, a, b, verdict: "ecart", better: gap > 0 ? "a" : "b", gapPts };
}

/** Les vidéos jugées : publiées il y a 2 à 14 jours, d'un compte dont la médiane est connue. */
export function judged(videos: readonly InsightVideo[], now: number): (InsightVideo & { win: boolean })[] {
  return videos
    .filter((v) => {
      const age = now - v.publishedAt;
      return age >= INSIGHT_MIN_AGE_MS && age <= INSIGHT_MAX_AGE_MS && v.median !== undefined && v.median > 0;
    })
    .map((v) => ({ ...v, win: v.views / (v.median as number) >= FORMAT_WIN_MULTIPLIER }));
}

export function standout(videos: readonly InsightVideo[], now: number): Insights {
  const vs = judged(videos, now);
  const byLang = new Map<string, { vs: { win: boolean }[] }>();
  const byApp = new Map<string, { label: string; vs: { win: boolean }[] }>();
  for (const v of vs) {
    const lang = v.lang || "autre";
    (byLang.get(lang) ?? byLang.set(lang, { vs: [] }).get(lang)!).vs.push(v);
    (byApp.get(v.appId) ?? byApp.set(v.appId, { label: v.appName, vs: [] }).get(v.appId)!).vs.push(v);
  }
  const hooked = vs.filter((v) => (v.hook ?? "").trim() !== "");
  const unhooked = vs.filter((v) => (v.hook ?? "").trim() === "");
  const withSound = vs.filter((v) => (v.musicTitle ?? "").trim() !== "");
  const music = withSound.filter((v) => !isOriginalSound(v.musicTitle!));
  const original = withSound.filter((v) => isOriginalSound(v.musicTitle!));
  const long = hooked.filter((v) => wordCount(v.hook!) > SHORT_HOOK_WORDS);
  const short = hooked.filter((v) => wordCount(v.hook!) <= SHORT_HOOK_WORDS);
  return {
    n: vs.length,
    wins: vs.filter((v) => v.win).length,
    byLang: rows(byLang),
    byApp: rows(byApp),
    attrs: [
      attr("texte", bucket("avec", hooked), bucket("sans", unhooked)),
      attr("son", bucket("musique", music), bucket("original", original)),
      attr("longueur", bucket("long", long), bucket("court", short)),
    ],
  };
}

/**
 * La phrase de tête : la langue qui réussit le plus face à celle qui réussit
 * le moins, parmi celles d'au moins 50 vidéos (« autre » n'est pas une langue).
 * `ratio` quand la plus faible réussit au moins une fois et que l'écart fait au
 * moins le double ; sinon les deux parts.
 */
export function headline(byLang: readonly Bucket[]): { best: Bucket; worst: Bucket; ratio: number | null } | null {
  const seen = byLang.filter((b) => b.key !== "autre" && b.n >= INSIGHT_HEADLINE_MIN);
  if (seen.length < 2) return null;
  const best = seen[0];
  const worst = seen[seen.length - 1];
  if (pctOf(best) - pctOf(worst) < INSIGHT_MIN_GAP_PTS) return null;
  const ratio = worst.wins > 0 ? pctOf(best) / pctOf(worst) : null;
  return { best, worst, ratio: ratio !== null && ratio >= 2 ? Math.round(ratio) : null };
}

/**
 * RELEVÉ RAPIDE — politique : quels posts relever, et quand.
 *
 * Module PUR (aucun import `_generated`) : importé par `convex/earlyReadings.ts`
 * et testé depuis `lib/early-tracking.test.ts`, même arrangement que
 * `convex/syncScope.ts` pour le relevé nocturne.
 *
 * ── Pourquoi ─────────────────────────────────────────────────────────────────
 * Le relevé nocturne passe une fois par jour. Mesuré en prod le 2026-09-26 sur
 * 786 posts Snytch : premier relevé à 9 h de la publication en médiane, et un
 * trou de plus de 30 h dans les 48 premières heures pour 15 % d'entre eux. Une
 * alerte « ce post décolle » évaluée dans les 36 premières heures ne peut rien
 * voir avec ça. D'où un relevé toutes les 2 h sur cette fenêtre, TikTok ET
 * Instagram.
 *
 * ── Ce qu'il ne touche PAS ───────────────────────────────────────────────────
 * Les relevés rapides vont dans leur propre table (`earlyReadings`), jamais
 * dans `metricSnapshots`. Ce dernier ne garde qu'un relevé par post et par jour
 * UTC : en été, un relevé entre minuit et 2 h de Paris tomberait dans le même
 * jour UTC que celui de 23 h 30 et l'écraserait — décalant les colonnes J+X et
 * relançant les paliers de bonus. Paie, J+X et analytics ignorent ce module.
 */

import { timestampFromInstagramShortcode, timestampFromTikTokVideoId } from "./postUrlDate";
import { instagramShortcode, tiktokPostId } from "./apifyApi";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Fenêtre du relevé rapide, en heures depuis la publication (celle de l'alerte). */
export const EARLY_WINDOW_HOURS = 36;
export const EARLY_WINDOW_MS = EARLY_WINDOW_HOURS * HOUR_MS;

/** Intervalle visé entre deux relevés d'un même post. */
export const EARLY_CADENCE_MS = 2 * HOUR_MS;

/**
 * Marge sous la cadence. Le cron passe toutes les 30 min, et un relevé est
 * horodaté quelques secondes à quelques minutes APRÈS le déclenchement du
 * passage. Sans marge, un post relevé à 10 h 07 ne serait « dû » qu'à 12 h 07,
 * donc relevé au passage de 12 h 35 : 2 h 28 au lieu de 2 h. Avec 20 min, il
 * l'est à 12 h 05 — tant qu'un passage dure moins de 20 min, ce qui tient
 * largement (plafonds ci-dessous).
 */
export const EARLY_DUE_SLACK_MS = 20 * MINUTE_MS;

/**
 * Plafonds par passage : la moyenne mesurée est de 25 posts de moins de 48 h
 * par plateforme (36 et 38 au plus haut). Un pic au-delà est reporté au passage
 * suivant plutôt que de gonfler la facture Apify ou le nombre de pages TikTok
 * lues d'affilée. Les plus jeunes passent d'abord : c'est là que l'alerte se
 * joue.
 */
export const EARLY_MAX_TIKTOK_PER_PASS = 60;
export const EARLY_MAX_INSTAGRAM_PER_PASS = 50;

/**
 * Marge de recherche sur `datePubli`. La date enregistrée est celle de la
 * CONFIRMATION (TD-020), en général quelques minutes après la mise en ligne,
 * mais parfois avant (les anciennes publications datées à minuit de Paris). On
 * lit donc large, puis on filtre sur l'âge réel lu dans l'URL.
 */
export const EARLY_CANDIDATE_MARGIN_MS = 24 * HOUR_MS;

/**
 * Suspension du relevé rapide TikTok après un coupe-circuit : TikTok a servi
 * des pages illisibles d'affilée (blocage, captcha). Insister toutes les
 * 30 min sur une IP qu'on vient de signaler, c'est risquer de faire tomber le
 * relevé NOCTURNE avec lui — qui, lui, porte la paie.
 */
export const EARLY_TIKTOK_SUSPEND_MS = 6 * HOUR_MS;

/**
 * Fenêtre de silence autour du relevé nocturne (23 h 30 Paris), en minutes
 * depuis minuit PARIS. Le nocturne lit les pages TikTok une à une, jamais en
 * parallèle : deux relevés qui frappent TikTok en même temps depuis la même IP
 * défont ce rythme. De 23 h 25 à 0 h 25 — la chaîne actuelle dure une dizaine
 * de minutes. Le post est relevé au passage suivant, et le relevé de 23 h 30
 * compte comme un relevé (cf `lastReadingAt`).
 */
export const NIGHTLY_QUIET_START_MIN = 23 * 60 + 25;
export const NIGHTLY_QUIET_END_MIN = 25;

export type EarlyPlatform = "TikTok" | "Instagram";

export type PostedAt = { at: number; source: "url" | "datePubli" };

/** Plancher de plausibilité d'un horodatage décodé (id tronqué ⇒ 1970). */
const DECODE_FLOOR_MS = Date.UTC(2016, 0, 1);
const DECODE_FUTURE_TOLERANCE_MS = 5 * MINUTE_MS;

/** Clé du post (id TikTok, code Instagram), ou null si l'URL n'en porte pas. */
export function earlyPostKey(plateforme: EarlyPlatform, url: string): string | null {
  return plateforme === "TikTok" ? tiktokPostId(url) : instagramShortcode(url);
}

/**
 * Instant de MISE EN LIGNE, lu dans l'URL. Repli sur `datePubli` quand l'URL
 * ne le porte pas (lien court) ou que le décodage est invraisemblable — et le
 * repli est DIT (`source`), pour qu'un âge approximatif ne passe pas pour exact.
 */
export function postedAtOf(
  plateforme: EarlyPlatform,
  url: string,
  datePubli: number,
  now: number,
): PostedAt {
  const key = earlyPostKey(plateforme, url);
  const decoded =
    key === null
      ? null
      : plateforme === "TikTok"
        ? timestampFromTikTokVideoId(key)
        : timestampFromInstagramShortcode(key);
  if (
    decoded !== null &&
    decoded >= DECODE_FLOOR_MS &&
    decoded <= now + DECODE_FUTURE_TOLERANCE_MS
  ) {
    return { at: decoded, source: "url" };
  }
  return { at: datePubli, source: "datePubli" };
}

export type EarlyCandidate = {
  _id: string;
  projectId: string;
  compte: string;
  plateforme: EarlyPlatform;
  postUrl: string;
  datePubli: number;
  isWarmup?: boolean;
  /**
   * Dernier point de mesure, TOUTES sources : dernière tentative du relevé
   * rapide (même ratée : un post privé ne doit pas être retenté toutes les
   * 30 min) ou relevé de nuit. Le relevé de 23 h 30 vaut un relevé — le refaire
   * à 0 h 35 serait payer Instagram deux fois pour rien.
   */
  lastReadingAt?: number;
};

/** Une vidéo à relever. Plusieurs publications peuvent pointer la même. */
export type EarlyTarget = {
  plateforme: EarlyPlatform;
  key: string;
  url: string;
  postedAt: number;
  postedAtSource: PostedAt["source"];
  publications: { publicationId: string; projectId: string; compte: string }[];
};

export type EarlyPlan = {
  tiktok: EarlyTarget[];
  instagram: EarlyTarget[];
  /** Vidéos dues mais reportées au passage suivant (plafond atteint). */
  deferred: { tiktok: number; instagram: number };
};

/**
 * Les vidéos à relever à ce passage.
 *
 * - Périmètre : TikTok et Instagram, hors posts de chauffe (`isWarmup === true`),
 *   publiés depuis moins de 36 h (âge réel, cf `postedAtOf`).
 * - Une VIDÉO est relevée une fois, même rattachée à deux publications : 25
 *   liens de prod pointent deux publications (2026-09-26). Le relevé est écrit
 *   sur chacune.
 * - Due quand son dernier point de mesure a au moins 2 h (moins la marge) ou
 *   qu'elle n'en a aucun : le premier relevé part au passage qui suit la saisie
 *   du lien.
 * - Les plus jeunes d'abord, dans la limite du plafond par plateforme.
 */
export function selectEarlyTargets(
  candidates: readonly EarlyCandidate[],
  now: number,
): EarlyPlan {
  const groups = new Map<string, EarlyTarget>();
  /** Dernier point de mesure de la VIDÉO : le plus récent de ses publications. */
  const lastReading = new Map<string, number>();
  for (const c of candidates) {
    if (c.isWarmup === true) continue;
    const key = earlyPostKey(c.plateforme, c.postUrl);
    if (key === null) continue;
    const posted = postedAtOf(c.plateforme, c.postUrl, c.datePubli, now);
    const age = now - posted.at;
    if (age < 0 || age >= EARLY_WINDOW_MS) continue;

    const groupKey = `${c.plateforme}::${key}`;
    const pub = { publicationId: c._id, projectId: c.projectId, compte: c.compte };
    const g = groups.get(groupKey);
    if (g === undefined) {
      groups.set(groupKey, {
        plateforme: c.plateforme,
        key,
        url: c.postUrl,
        postedAt: posted.at,
        postedAtSource: posted.source,
        publications: [pub],
      });
    } else {
      g.publications.push(pub);
    }
    if (c.lastReadingAt !== undefined) {
      lastReading.set(groupKey, Math.max(lastReading.get(groupKey) ?? 0, c.lastReadingAt));
    }
  }

  const due = [...groups.entries()]
    .filter(([groupKey]) => {
      const last = lastReading.get(groupKey);
      return last === undefined || now - last >= EARLY_CADENCE_MS - EARLY_DUE_SLACK_MS;
    })
    .map(([, target]) => target);
  const cap = (plateforme: EarlyPlatform, max: number) => {
    const all = due
      .filter((g) => g.plateforme === plateforme)
      .sort((a, b) => b.postedAt - a.postedAt);
    return { kept: all.slice(0, max), deferred: Math.max(0, all.length - max) };
  };
  const tiktok = cap("TikTok", EARLY_MAX_TIKTOK_PER_PASS);
  const instagram = cap("Instagram", EARLY_MAX_INSTAGRAM_PER_PASS);
  return {
    tiktok: tiktok.kept,
    instagram: instagram.kept,
    deferred: { tiktok: tiktok.deferred, instagram: instagram.deferred },
  };
}

/**
 * Minutes écoulées depuis minuit à PARIS, ou `null` si l'heure n'est pas
 * calculable. `en-GB` + `h23` : minuit rend « 00 », jamais « 24 », et aucun
 * suffixe « h » ne vient casser la conversion (piège déjà rencontré avec la
 * locale française).
 */
export function parisMinutesOfDay(ms: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  } catch {
    return null;
  }
}

/** Vrai pendant la fenêtre de silence du relevé nocturne (elle chevauche minuit). */
export function isNightlyQuietWindow(parisMinutes: number): boolean {
  return (
    parisMinutes >= NIGHTLY_QUIET_START_MIN || parisMinutes < NIGHTLY_QUIET_END_MIN
  );
}

/** Le relevé rapide TikTok est-il encore suspendu par un coupe-circuit récent ? */
export function tiktokSuspended(lastTripAt: number | undefined, now: number): boolean {
  return lastTripAt !== undefined && now - lastTripAt < EARLY_TIKTOK_SUSPEND_MS;
}

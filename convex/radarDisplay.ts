/**
 * RADAR — règles d'AFFICHAGE de la refonte du 09/11/2026, PURES et sans texte
 * d'interface (l'écran traduit). Importées par les écrans du Radar (Aujourd'hui,
 * Regarder une par une, Concurrents, Explorer) et testées (lib/radar-display.test.ts).
 *
 *  - un seul score affiché : vues ÷ médiane du compte (« × sa normale ») quand
 *    on la connaît, sinon vues ÷ abonnés — c'est l'ordre du tri par défaut
 *    (radarSignalFilters, « mediane »), la carte ne contredit plus la liste ;
 *  - « à regarder » : au plus 12 vidéos des 7 derniers jours que l'équipe du projet
 *    n'a pas encore traitées — les fraîches (moins de 48 h, déjà 10 fois leur
 *    normale) d'abord, puis les plus fortes, une seule par compte — et jusqu'à 2
 *    trouvailles hors des comptes suivis ;
 *  - les pubs d'une même créa (même app, annonceur et texte) ne font qu'une
 *    ligne ; un texte de catalogue (« {{product.brand}} ») n'est pas un texte.
 */
import { dayKeyParis } from "./dateFr";
import { applyFilters, defaultFilters, type FilterableSignal } from "./radarSignalFilters";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ─── Le score ────────────────────────────────────────────────────────────────

export type ScoreBasis = "normale" | "abonnes";

/** Le score d'une vidéo : × sa normale (médiane du compte) quand on l'a, sinon × ses abonnés. */
export function scoreOf(s: { multiplier?: number | null; ratio: number }): { value: number; basis: ScoreBasis } {
  return typeof s.multiplier === "number" ? { value: s.multiplier, basis: "normale" } : { value: s.ratio, basis: "abonnes" };
}

/** Ce que le compte fait d'habitude (sa médiane), quand le score la donne. */
export function usualViews(s: { views: number; multiplier?: number | null }): number | null {
  return typeof s.multiplier === "number" && s.multiplier > 0 ? Math.round(s.views / s.multiplier) : null;
}

// ─── Texte sur plan ──────────────────────────────────────────────────────────

/**
 * « Texte sur plan » : une vidéo de 12 secondes ou moins — un seul plan, une
 * phrase à l'écran, personne ne parle, l'app n'est pas montrée (le style
 * RecentFollow / FollowSpy). Décidé le 09/11/2026 : « ça n'amène pas de
 * conversion, ce n'est pas un format qui m'intéresse » — 10 passées sur 10, alors
 * qu'elles faisaient 41 des 53 vidéos de concurrents de Snytch de la semaine.
 * Elles sortent d'Aujourd'hui, d'« En train de partir », des alertes et des
 * transcriptions ; Explorer les garde. Une durée inconnue n'est pas « courte ».
 */
export const TEXT_ON_SHOT_MAX_SEC = 12;
export function isTextOnShot(v: { durationSec?: number | null }): boolean {
  // Écrit « 0 < d » : la garde i18n lit « > 0 && … < » comme du texte JSX.
  const d = v.durationSec;
  return typeof d === "number" && 0 < d && d <= TEXT_ON_SHOT_MAX_SEC;
}

// ─── À regarder aujourd'hui ──────────────────────────────────────────────────

/** Vidéos proposées chaque jour, au plus ; dont celles des concurrents du projet, au plus. */
export const TODAY_LIMIT = 12;
export const TODAY_RIVAL_SLOTS = 6;

/**
 * Une vidéo « fraîche » : publiée il y a moins de 48 h et déjà à 10 fois la
 * normale de son compte (le seuil d'« En train de partir »). Au plus la moitié
 * de la file leur revient : le reste garde les plus fortes de la semaine.
 */
export const FRESH_WINDOW_MS = 48 * HOUR;
export const FRESH_MULTIPLIER = 10;
export const TODAY_FRESH_SLOTS = 6;
/**
 * Trouvailles hors des comptes suivis (`isFind`) montrées EN PLUS des 12, au
 * plus. En plus, et non à leur place : rejoué sur la prod du 10/11/2026, deux
 * places prises sur les 12 sortaient de la file de BLUSH sa vidéo la plus forte
 * de la semaine (Snitchy, 353 fois sa normale).
 */
export const TODAY_FIND_SLOTS = 2;

export function isFresh(v: { publishedAt: number; multiplier?: number | null }, now: number): boolean {
  return now - v.publishedAt < FRESH_WINDOW_MS && (v.multiplier ?? 0) >= FRESH_MULTIPLIER;
}

/** Une vidéo par compte : la première de la liste, les suivantes attendent qu'elle soit traitée. */
export function onePerAccount<T extends { handle: string; platform: string }>(videos: readonly T[]): T[] {
  const seen = new Set<string>();
  return videos.filter((v) => {
    const key = `${v.platform}:${v.handle.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Ce que la file lit d'un signal, en plus des filtres. */
type QueueSignal = FilterableSignal & {
  elsewhere?: boolean;
  network?: string | null;
  durationSec?: number | null;
  /** Vidéo d'un compte suivi (sa normale est connue, ou le sera). */
  tracked?: boolean;
  /** Trouvée par une recherche « app pour couple » (radarDiscoveryQueries.isRelationFind). */
  niche?: boolean;
  /** Devenue invisible sur TikTok (convex/radarAvailability) : hors de la file. */
  unavailable?: unknown;
};

/**
 * Une « trouvaille » : une vidéo d'un compte PAS ENCORE SUIVI (donc sans
 * normale : on ne sait la juger qu'à ses vues par abonné), qui cite une app
 * suivie ou sort d'une recherche « app pour couple ». Le reste de la découverte
 * n'entre pas dans la file : lu le 10/11/2026, 9 vidéos sur 10 y sont hors
 * sujet (foot, fonds d'écran, tutoriels de code) ; Explorer les garde.
 */
export function isFind(s: { tracked?: boolean; multiplier?: number | null; niche?: boolean; app: string | null }): boolean {
  return !s.tracked && typeof s.multiplier !== "number" && (s.niche === true || s.app !== null);
}

/**
 * La file « à regarder », PROPRE AU PROJET (décidé le 09/11/2026 : BLUSH et
 * Snytch avaient le même fil) : 7 derniers jours, jamais traitées par l'équipe
 * du projet ;
 *  - D'ABORD les vidéos fraîches (`isFresh` : moins de 48 h, déjà 10 fois la
 *    normale du compte), 6 au plus, PUIS les plus fortes de la semaine dans
 *    l'ordre du tri par défaut (× sa normale, puis × ses abonnés). Décidé le
 *    10/11/2026 : classée au seul score, une vidéo de 4 jours passe toujours
 *    devant celle d'hier, qui n'a pas fini de monter — la file de Snytch avait
 *    99 h d'âge médian et 2 vidéos de moins de 48 h quand 5 fraîches attendaient ;
 *  - UNE SEULE vidéo par compte (sa fraîche, sinon sa plus forte) : la suivante
 *    du même compte arrive quand celle-ci est traitée ;
 *  - EN PLUS de ces 12, au plus 2 TROUVAILLES hors des comptes suivis (`isFind`),
 *    une par compte, aux vues par abonné : la seule découverte qui entre (décidé
 *    le 10/11/2026) ;
 *  - au plus 6 vidéos des concurrents DU projet ;
 *  - le reste : les autres apps, et, quand la file n'est pas pleine, les vidéos
 *    sans normale connue (× ses abonnés) ;
 *  - jamais les concurrents d'un AUTRE projet (`elsewhere`, The Ick pour BLUSH),
 *    ni ce qu'un compte suivi publie sans citer d'app (`network` : « TURN OFF
 *    THESE ROKU SETTINGS » d'un compte du réseau Finch), ni les « texte sur plan »
 *    de 12 secondes ou moins (`isTextOnShot`) : ils restent dans Explorer ;
 *  - jamais une vidéo devenue invisible sur TikTok (`unavailable` : compte passé
 *    en privé, vidéo supprimée…) : on ne peut plus la regarder (10/11/2026).
 * Une part trop courte est complétée par l'autre. Une vidéo traitée en sort ;
 * la suivante prend sa place.
 */
export function todayGroups<T extends QueueSignal>(
  signals: readonly T[],
  now: number,
  limit = TODAY_LIMIT,
  rivalSlots = TODAY_RIVAL_SLOTS,
  freshSlots = TODAY_FRESH_SLOTS,
  findSlots = TODAY_FIND_SLOTS,
): { fresh: T[]; strongest: T[]; finds: T[] } {
  const f = defaultFilters();
  f.sel.statut = ["nouveau"];
  const ranked = applyFilters(signals, f, now).filter((s) => !s.elsewhere && !s.network && !isTextOnShot(s) && !s.unavailable);
  // Les trouvailles sont servies à part : classées au score, elles passaient derrière
  // toute vidéo à normale connue et n'entraient jamais (la 1re au rang 76 chez Snytch).
  const finds = onePerAccount(ranked.filter(isFind)).slice(0, findSlots);
  const found = new Set(finds);
  const pool = ranked.filter((s) => !found.has(s));
  const kept = new Set(onePerAccount([...finds, ...pool.filter((s) => isFresh(s, now)), ...pool.filter((s) => !isFresh(s, now))]));
  const byScore = pool.filter((s) => kept.has(s));
  const fresh = new Set(byScore.filter((s) => isFresh(s, now)).slice(0, freshSlots));
  // L'ordre de la file : les fraîches, puis le reste au score (une fraîche en trop y garde son rang).
  const order = [...fresh, ...byScore.filter((s) => !fresh.has(s))];
  const rivals = order.filter((s) => s.competitor);
  const others = order.filter((s) => !s.competitor);
  const nRivals = Math.min(rivals.length, Math.max(rivalSlots, limit - others.length));
  const picked = new Set([...rivals.slice(0, nRivals), ...others.slice(0, limit - nRivals)]);
  const queue = order.filter((s) => picked.has(s));
  return { fresh: queue.filter((s) => fresh.has(s)), strongest: queue.filter((s) => !fresh.has(s)), finds };
}

/**
 * Les vidéos qu'Aujourd'hui aurait pu montrer et qui ne sont plus visibles sur
 * TikTok : mêmes règles que la file (semaine, jamais traitées, du projet), pour
 * dire à l'équipe combien ont été écartées et pourquoi.
 */
export function hiddenToday<T extends QueueSignal>(signals: readonly T[], now: number): T[] {
  const f = defaultFilters();
  f.sel.statut = ["nouveau"];
  return applyFilters(signals, f, now).filter((s) => !s.elsewhere && !s.network && !isTextOnShot(s) && !!s.unavailable);
}

/** La file dans l'ordre où on la regarde : les fraîches, les plus fortes de la semaine, puis les trouvailles. */
export function todayQueue<T extends QueueSignal>(
  signals: readonly T[],
  now: number,
  limit = TODAY_LIMIT,
  rivalSlots = TODAY_RIVAL_SLOTS,
  freshSlots = TODAY_FRESH_SLOTS,
  findSlots = TODAY_FIND_SLOTS,
): T[] {
  const g = todayGroups(signals, now, limit, rivalSlots, freshSlots, findSlots);
  return [...g.fresh, ...g.strongest, ...g.finds];
}

/** Vidéos traitées (gardée, à adapter, passée) aujourd'hui, jour de Paris. */
export function handledToday(signals: readonly { status: string; markedAt: number | null }[], now: number): number {
  const today = dayKeyParis(now);
  return signals.filter((s) => s.status !== "nouveau" && s.markedAt !== null && dayKeyParis(s.markedAt) === today).length;
}

// ─── La courbe ───────────────────────────────────────────────────────────────

export type CurvePoint = { h: number; views: number };

/** Les relevés d'une vidéo, en heures après sa publication. */
export function curveOf(snapshots: readonly { at: number; views: number }[], publishedAt: number): CurvePoint[] {
  return snapshots.map((p) => ({ h: Math.max(0, Math.round((p.at - publishedAt) / HOUR)), views: p.views }));
}

/** La pente entre les deux derniers relevés : « +73 % entre H+22 et H+47 ». `null` avec un seul relevé. */
export function lastGrowth(points: readonly CurvePoint[]): { fromH: number; toH: number; pct: number } | null {
  if (points.length < 2) return null;
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  if (a.views <= 0) return null;
  return { fromH: a.h, toH: b.h, pct: Math.round(((b.views - a.views) / a.views) * 100) };
}

/**
 * Les points d'une petite courbe SVG (`polyline`), de la publication (0 vue) au
 * dernier relevé, dans un cadre `w` × `h` avec une marge de 2.
 */
export function sparklinePoints(points: readonly CurvePoint[], w: number, h: number): string {
  if (points.length === 0) return "";
  const all: CurvePoint[] = [{ h: 0, views: 0 }, ...points];
  const maxH = Math.max(1, ...all.map((p) => p.h));
  const maxV = Math.max(1, ...all.map((p) => p.views));
  const pad = 2;
  return all
    .map((p) => `${(pad + (p.h / maxH) * (w - 2 * pad)).toFixed(1)},${(h - pad - (p.views / maxV) * (h - 2 * pad)).toFixed(1)}`)
    .join(" ");
}

// ─── Ce qui se partage ───────────────────────────────────────────────────────

/**
 * « Se partage » : au moins 2 % des vues partagées — les 10 % les plus partagées
 * des vidéos relevées (p90 mesuré le 09/11/2026 : 2,07 %). Le partage porte la
 * portée organique.
 */
export const SHARE_TOP = 0.02;

export function sharesWell(s: { views: number; shares?: number }): boolean {
  return s.views > 0 && (s.shares ?? 0) / s.views >= SHARE_TOP;
}

// ─── En train de partir ──────────────────────────────────────────────────────

/**
 * Une vidéo « en train de partir » : publiée il y a moins de 24 h et déjà à 10×
 * la normale de son compte (avec au moins 10 000 vues). Montrée en tête
 * d'Aujourd'hui, et signalée sur Telegram quand elle vient d'un concurrent.
 */
export const EARLY_WINDOW_MS = 24 * HOUR;
export const EARLY_MULTIPLIER = 10;
export const EARLY_MIN_VIEWS = 10_000;

export function isEarlyHit(v: { publishedAt: number; views: number; multiplier?: number | null }, now: number): boolean {
  return now - v.publishedAt <= EARLY_WINDOW_MS && v.views >= EARLY_MIN_VIEWS && (v.multiplier ?? 0) >= EARLY_MULTIPLIER;
}


/**
 * Les vidéos du projet qui partent tôt (radarNetworkMath.isEarlyHit : moins de 24 h,
 * 10× la normale, 10 000 vues), jamais traitées, sans les concurrents d'un autre
 * projet, ni ce qu'un compte publie sans citer d'app, ni les « texte sur plan »
 * de 12 secondes ou moins — les plus fortes d'abord, une seule par compte.
 */
export function earlyHits<T extends FilterableSignal & { elsewhere?: boolean; network?: string | null; durationSec?: number | null; unavailable?: unknown }>(signals: readonly T[], now: number, limit = 4): T[] {
  const hits = signals
    .filter((s) => s.status === "nouveau" && !s.elsewhere && !s.network && !isTextOnShot(s) && !s.unavailable && isEarlyHit(s, now))
    .sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0));
  return onePerAccount(hits).slice(0, limit);
}

// ─── Formats ─────────────────────────────────────────────────────────────────

/** « original sound - georgiaspamming » → « georgiaspamming » ; une vraie musique → null. */
export function originalSoundOf(label: string): string | null {
  const m = /^(?:original sound|son original|som original|sonido original|suono originale|originalton)\s*[-–]\s*(.+)$/i.exec(label.trim());
  return m ? m[1].trim() : null;
}

// ─── Pubs ────────────────────────────────────────────────────────────────────

/** Un texte de catalogue Meta (« {{product.brand}} · {{product.name}} ») ne dit rien de la créa. */
export function isTemplateText(text: string | null): boolean {
  return !!text && /\{\{\s*product\./.test(text);
}

export type AdLike = {
  id: string;
  platform: string;
  app: string | null;
  rival: boolean;
  advertiser: string;
  text: string | null;
  active: boolean;
  runDays: number | null;
  firstShownAt: number | null;
  url: string;
  videoUrl: string | null;
};

export type AdGroup<A extends AdLike> = {
  key: string;
  /** L'annonce qui tourne depuis le plus longtemps : son lien, sa vidéo. */
  lead: A;
  text: string | null;
  ads: A[];
  activeCount: number;
  runDays: number | null;
  firstShownAt: number | null;
};

const textKey = (t: string | null) => (t && !isTemplateText(t) ? t.toLowerCase().replace(/\s+/g, " ").trim() : "");

/**
 * Les annonces d'une même créa (même plateforme, app, annonceur et texte) en
 * une ligne : 12 annonces Snitchy « Sauras-tu résoudre les affaires ? » n'en
 * font qu'une. Concurrentes d'abord, actives d'abord, puis les plus longues.
 */
export function groupAds<A extends AdLike>(ads: readonly A[]): AdGroup<A>[] { // i18n-exempt: signature générique TypeScript, pas du texte
  const byKey = new Map<string, A[]>();
  for (const a of ads) {
    const key = [a.platform, a.app ?? "", a.advertiser.toLowerCase(), textKey(a.text)].join("|");
    const list = byKey.get(key);
    if (list) list.push(a);
    else byKey.set(key, [a]);
  }
  const groups = [...byKey.entries()].map(([key, list]) => {
    const lead = [...list].sort((x, y) => Number(y.active) - Number(x.active) || (y.runDays ?? -1) - (x.runDays ?? -1))[0];
    const runs = list.map((a) => a.runDays).filter((d): d is number => d !== null);
    const firsts = list.map((a) => a.firstShownAt).filter((d): d is number => d !== null);
    return {
      key,
      lead,
      text: isTemplateText(lead.text) ? null : lead.text,
      ads: list,
      activeCount: list.filter((a) => a.active).length,
      runDays: runs.length ? Math.max(...runs) : null,
      firstShownAt: firsts.length ? Math.min(...firsts) : null,
    };
  });
  return groups.sort(
    (x, y) =>
      Number(y.lead.rival) - Number(x.lead.rival) ||
      Number(y.activeCount > 0) - Number(x.activeCount > 0) ||
      (y.runDays ?? -1) - (x.runDays ?? -1) ||
      y.ads.length - x.ads.length,
  );
}

// ─── Concurrents ─────────────────────────────────────────────────────────────

/**
 * Ce qu'une app a fait cette semaine : ses vidéos qui sortent du lot (7 jours,
 * hors passées) et ses pubs actives (une créa comptée une fois).
 */
export function appWeek<S extends FilterableSignal & { durationSec?: number | null; unavailable?: unknown }>(
  appName: string,
  signals: readonly S[],
  ads: readonly AdLike[],
  now: number,
): { hits: S[]; activeAds: number } {
  const f = defaultFilters();
  f.sel.app = [appName];
  // Les « texte sur plan » de 12 secondes ou moins APRÈS les autres : on ne les
  // propose pas à regarder, mais la fiche d'un concurrent dit tout ce qu'il fait
  // (09/11/2026 : 46 des 50 vidéos de concurrents de Snytch en sont).
  // Et les vidéos devenues invisibles sur TikTok tout à la fin : elles ont compté, mais « sa meilleure » doit
  // pouvoir se regarder (10/11/2026).
  const ranked = applyFilters(signals, f, now);
  const seen = ranked.filter((s) => !s.unavailable);
  const hits = [...seen.filter((s) => !isTextOnShot(s)), ...seen.filter((s) => isTextOnShot(s)), ...ranked.filter((s) => !!s.unavailable)];
  const activeAds = groupAds(ads.filter((a) => a.app === appName)).filter((g) => g.activeCount > 0).length;
  return { hits, activeAds };
}

/** Âge d'une vidéo en heures (arrondi), pour « publiée il y a ». */
export const ageHours = (publishedAt: number, now: number) => Math.max(0, Math.round((now - publishedAt) / HOUR));
/** Âge en jours entiers (« il y a 4 j »). */
export const ageDays = (publishedAt: number, now: number) => Math.floor(Math.max(0, now - publishedAt) / DAY);

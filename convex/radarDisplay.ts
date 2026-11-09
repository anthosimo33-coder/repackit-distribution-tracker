/**
 * RADAR — règles d'AFFICHAGE de la refonte du 09/11/2026, PURES et sans texte
 * d'interface (l'écran traduit). Importées par les écrans du Radar (Aujourd'hui,
 * Regarder une par une, Concurrents, Explorer) et testées (lib/radar-display.test.ts).
 *
 *  - un seul score affiché : vues ÷ médiane du compte (« × sa normale ») quand
 *    on la connaît, sinon vues ÷ abonnés — c'est l'ordre du tri par défaut
 *    (radarSignalFilters, « mediane »), la carte ne contredit plus la liste ;
 *  - « à regarder » : les plus fortes des 7 derniers jours que l'équipe du projet
 *    n'a pas encore traitées, au plus 12 ;
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

// ─── À regarder aujourd'hui ──────────────────────────────────────────────────

/** Vidéos proposées chaque jour, au plus ; dont celles des concurrents du projet, au plus. */
export const TODAY_LIMIT = 12;
export const TODAY_RIVAL_SLOTS = 6;

/**
 * La file « à regarder », PROPRE AU PROJET (décidé le 09/11/2026 : BLUSH et
 * Snytch avaient le même fil) : 7 derniers jours, jamais traitées par l'équipe
 * du projet, dans l'ordre du tri par défaut (× sa normale, puis × ses abonnés) ;
 *  - au plus 6 vidéos des concurrents DU projet ;
 *  - le reste : les autres apps et la découverte (ce qui marche partout) ;
 *  - jamais les concurrents d'un AUTRE projet (`elsewhere`, The Ick pour BLUSH),
 *    ni ce qu'un compte suivi publie sans citer d'app (`network` : « TURN OFF
 *    THESE ROKU SETTINGS » d'un compte du réseau Finch) : ils restent dans Explorer.
 * Une part trop courte est complétée par l'autre. Une vidéo traitée en sort ;
 * la suivante prend sa place.
 */
export function todayQueue<T extends FilterableSignal & { elsewhere?: boolean; network?: string | null }>(
  signals: readonly T[],
  now: number,
  limit = TODAY_LIMIT,
  rivalSlots = TODAY_RIVAL_SLOTS,
): T[] {
  const f = defaultFilters();
  f.sel.statut = ["nouveau"];
  const ranked = applyFilters(signals, f, now).filter((s) => !s.elsewhere && !s.network);
  const rivals = ranked.filter((s) => s.competitor);
  const others = ranked.filter((s) => !s.competitor);
  const nRivals = Math.min(rivals.length, Math.max(rivalSlots, limit - others.length));
  const picked = new Set([...rivals.slice(0, nRivals), ...others.slice(0, limit - nRivals)]);
  // Dans l'ordre du score, pour que la carte et la liste se lisent pareil.
  return ranked.filter((s) => picked.has(s));
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
export function appWeek<S extends FilterableSignal>(
  appName: string,
  signals: readonly S[],
  ads: readonly AdLike[],
  now: number,
): { hits: S[]; activeAds: number } {
  const f = defaultFilters();
  f.sel.app = [appName];
  const hits = applyFilters(signals, f, now);
  const activeAds = groupAds(ads.filter((a) => a.app === appName)).filter((g) => g.activeCount > 0).length;
  return { hits, activeAds };
}

/** Âge d'une vidéo en heures (arrondi), pour « publiée il y a ». */
export const ageHours = (publishedAt: number, now: number) => Math.max(0, Math.round((now - publishedAt) / HOUR));
/** Âge en jours entiers (« il y a 4 j »). */
export const ageDays = (publishedAt: number, now: number) => Math.floor(Math.max(0, now - publishedAt) / DAY);

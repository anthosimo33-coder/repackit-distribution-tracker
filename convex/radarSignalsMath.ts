/**
 * NOUVEAU RADAR — calculs PURS des signaux et du budget (aucun accès base, aucun
 * réseau). Partagé par les tâches de collecte (convex/radarSignals.ts), l'écran
 * Budget et l'outil MCP `signaux` : une règle n'existe qu'ici.
 *
 * Source : ScrapeCreators, payé au crédit (1 requête = 1 crédit, quel que soit le
 * nombre de vidéos renvoyées). Vérifié le 06/11/2026 : une recherche par mot-clé
 * renvoie 30 vidéos, « infos d'une vidéo » 1 vidéo, chacune pour 1 crédit.
 */

/** Prix d'un crédit : pack « Freelance » à 47 $ pour 25 000 crédits (06/11/2026). */
export const SC_PRICE_PER_CREDIT = 47 / 25_000;
/** Devise de facturation de ScrapeCreators : celle de tout le budget du Radar. */
export const SC_CURRENCY = "USD";
export const SC_PACK_CREDITS = 25_000;

/** Un mois de budget compte 30 jours (les postes se règlent « par jour »). */
export const DAYS_PER_MONTH = 30;

/** Relevés de courbe, en heures après la publication. */
export const CURVE_CHECKPOINTS_H = [6, 24, 48] as const;

/** Une vidéo n'est gardée qu'au-dessus de ces deux seuils. */
export const KEEP_MIN_VIEWS = 10_000;
export const KEEP_MIN_RATIO = 10;

/** Admise dans la courbe : jeune, et nettement au-dessus de son compte. */
export const CURVE_MAX_AGE_H = 48;
export const CURVE_MIN_RATIO = 20;
export const CURVE_MIN_VIEWS_PER_HOUR = 1_000;

/** Les abonnés comptent au moins pour 100 : un compte neuf ne fait pas un ratio infini. */
export const RATIO_FLOOR_FANS = 100;

/** Deux relevés d'une même vidéo sont espacés d'au moins 2 h ; 12 au plus. */
export const SNAPSHOT_MIN_GAP_MS = 2 * 3_600_000;
export const SNAPSHOTS_MAX = 12;

/** La découverte tourne 4 fois par jour (cron toutes les 6 h). */
export const DISCOVERY_RUNS_PER_DAY = 4;

/** Durée de vie d'un signal en base (la période « Tout » de l'écran). */
export const RETENTION_DAYS = 180;

/** Signaux renvoyés au plus par l'écran (les plus récents d'abord). */
export const SIGNALS_LIST_CAP = 3_000;

const HOUR = 3_600_000;

// ─── Langues ─────────────────────────────────────────────────────────────────

export type LangBucket = "fr" | "pt" | "es-am" | "es-es" | "en" | "autre";
export const LANG_BUCKETS: readonly LangBucket[] = ["fr", "pt", "es-am", "es-es", "en", "autre"];

/**
 * Langue de la vidéo (`desc_language` de TikTok), repliée sur la langue de la
 * recherche quand TikTok n'en donne pas. L'espagnol se coupe en deux marchés :
 * Espagne (région ES) et Amérique (tout le reste).
 */
export function langBucket(lang: string | undefined, region: string | undefined, fallback?: string): LangBucket {
  const code = (lang && lang.length >= 2 && lang !== "un" ? lang : fallback ?? "").toLowerCase().slice(0, 2);
  if (code === "fr") return "fr";
  if (code === "pt") return "pt";
  if (code === "en") return "en";
  if (code === "es") return (region ?? "").toUpperCase() === "ES" ? "es-es" : "es-am";
  return "autre";
}

// ─── Recherches de découverte ────────────────────────────────────────────────

/** Une recherche de la rotation (liste : convex/radarDiscoveryQueries.ts, serveur seul). */
export type DiscoveryQuery = { query: string; region: string; lang: string };

/** Les recherches d'un passage : `count` à partir du curseur, en boucle. */
export function nextQueries(cursor: number, count: number, all: readonly DiscoveryQuery[]) {
  const n = all.length;
  if (n === 0 || count <= 0) return { queries: [] as DiscoveryQuery[], cursor };
  const start = ((cursor % n) + n) % n;
  const queries = Array.from({ length: Math.min(count, n) }, (_, i) => all[(start + i) % n]);
  return { queries, cursor: (start + queries.length) % n };
}

export const foundByLabel = (d: DiscoveryQuery) => `${d.query}·${d.region.toLowerCase()}`;

// ─── Lecture d'une vidéo ScrapeCreators ──────────────────────────────────────

export type SignalInput = {
  videoId: string;
  url: string;
  authorId: string;
  authorHandle: string;
  authorFans: number;
  caption: string;
  lang: LangBucket;
  region?: string;
  publishedAt: number;
  durationSec?: number;
  coverUrl?: string;
  isAd: boolean;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
};

const obj = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const str = (x: unknown): string | undefined => (typeof x === "string" && x !== "" ? x : undefined);

/**
 * Une vidéo de la réponse (`search_item_list[i]`, `aweme_list[i]` ou
 * `aweme_detail`), ou `null` si l'essentiel manque. `aweme_info` est déballé :
 * la réponse non allégée l'emboîte, la réponse `trim=true` non.
 */
export function parseScVideo(raw: unknown, fallbackLang?: string): SignalInput | null {
  const top = obj(raw);
  const v = obj(top?.aweme_info) ?? top;
  if (!v) return null;
  const videoId = str(v.aweme_id);
  const author = obj(v.author);
  const handle = str(author?.unique_id);
  const createTime = num(v.create_time);
  if (!videoId || !handle || createTime <= 0) return null;
  const stats = obj(v.statistics) ?? {};
  const video = obj(v.video) ?? {};
  const durationMs = num(video.duration);
  const cover = obj(video.cover) ?? obj(video.origin_cover);
  const coverList = Array.isArray(cover?.url_list) ? cover?.url_list : [];
  const region = str(v.region);
  return {
    videoId,
    url: str(v.url) ?? `https://www.tiktok.com/@${handle}/video/${videoId}`,
    authorId: str(author?.uid) ?? handle,
    authorHandle: handle,
    authorFans: num(author?.follower_count),
    caption: str(v.desc) ?? "",
    lang: langBucket(str(v.desc_language), region, fallbackLang),
    ...(region ? { region } : {}),
    publishedAt: createTime * 1000,
    ...(durationMs > 0 ? { durationSec: Math.round(durationMs / 100) / 10 } : {}),
    ...(typeof coverList?.[0] === "string" ? { coverUrl: coverList[0] as string } : {}),
    isAd: v.is_ad === true,
    views: num(stats.play_count),
    likes: num(stats.digg_count),
    comments: num(stats.comment_count),
    shares: num(stats.share_count),
    saves: num(stats.collect_count),
  };
}

// ─── Tri à la découverte et courbe ───────────────────────────────────────────

/** Vues ÷ abonnés, les abonnés comptant au moins pour 100. */
export const ratioOf = (views: number, fans: number) => views / Math.max(fans, RATIO_FLOOR_FANS);

/** Vues par heure depuis la publication (au moins une heure). */
export const viewsPerHour = (views: number, publishedAt: number, now: number) =>
  views / Math.max(1, (now - publishedAt) / HOUR);

/** Gardée : pas une pub, assez de vues, assez au-dessus de son compte. */
export function keepSignal(s: Pick<SignalInput, "views" | "authorFans" | "isAd">): boolean {
  return !s.isAd && s.views >= KEEP_MIN_VIEWS && ratioOf(s.views, s.authorFans) >= KEEP_MIN_RATIO;
}

/** Admise dans la courbe : moins de 48 h, et 20× ses abonnés ou 1 000 vues/h. */
export function curveCandidate(s: Pick<SignalInput, "views" | "authorFans" | "publishedAt">, now: number): boolean {
  if (now - s.publishedAt > CURVE_MAX_AGE_H * HOUR) return false;
  return (
    ratioOf(s.views, s.authorFans) >= CURVE_MIN_RATIO ||
    viewsPerHour(s.views, s.publishedAt, now) >= CURVE_MIN_VIEWS_PER_HOUR
  );
}

/** Prochain relevé de courbe après `now` (au moins 30 min plus tard), ou undefined. */
export function nextCheckpointAt(publishedAt: number, now: number): number | undefined {
  for (const h of CURVE_CHECKPOINTS_H) {
    const at = publishedAt + h * HOUR;
    if (at > now + 30 * 60_000) return at;
  }
  return undefined;
}

/** Ajoute un relevé s'il est assez loin du précédent ; garde les 12 derniers. */
export function addSnapshot(
  snapshots: readonly { at: number; views: number }[],
  at: number,
  views: number,
  force = false,
): { at: number; views: number }[] {
  const last = snapshots[snapshots.length - 1];
  if (!force && last && at - last.at < SNAPSHOT_MIN_GAP_MS) {
    // Trop proche : on rafraîchit le dernier plutôt que d'en empiler un.
    return [...snapshots.slice(0, -1), { at: last.at, views: Math.max(last.views, views) }];
  }
  return [...snapshots, { at, views }].slice(-SNAPSHOTS_MAX);
}

// ─── Budget ──────────────────────────────────────────────────────────────────

export type PosteKey = "search" | "curve" | "tiktok" | "network" | "insta" | "transcript" | "ai";

export type PosteDef = {
  key: PosteKey;
  /** Branché : la collecte le consomme. Les autres arrivent aux phases suivantes. */
  live: boolean;
  /** Dépense en dollars plutôt qu'en crédits (l'analyse IA). */
  dollars?: boolean;
  step: number;
  max: number;
  /** Crédits par mois pour une quantité réglée. */
  monthlyCredits: (qty: number) => number;
};

export const POSTES: readonly PosteDef[] = [
  { key: "search", live: true, step: 10, max: 300, monthlyCredits: (n) => n * DAYS_PER_MONTH },
  { key: "curve", live: true, step: 20, max: 400, monthlyCredits: (n) => n * CURVE_CHECKPOINTS_H.length * DAYS_PER_MONTH },
  // Relevés de comptes suivis par jour (1 crédit = les 9 dernières vidéos d'un compte).
  { key: "tiktok", live: true, step: 50, max: 1_500, monthlyCredits: (n) => n * DAYS_PER_MONTH },
  // Recherche du réseau des apps (mots-clés, hashtags), en crédits par mois.
  { key: "network", live: true, step: 300, max: 9_000, monthlyCredits: (n) => n },
  { key: "insta", live: false, step: 20, max: 300, monthlyCredits: (n) => n * DAYS_PER_MONTH },
  { key: "transcript", live: false, step: 5, max: 100, monthlyCredits: (n) => n * DAYS_PER_MONTH },
  { key: "ai", live: false, dollars: true, step: 2, max: 30, monthlyCredits: () => 0 },
];

/**
 * Version des réglages. En version 1 (phase 1), `tiktok` comptait des COMPTES et
 * était forcé éteint (pas encore branché), `network` n'existait pas : des
 * réglages v1 relus prennent pour ces deux postes les valeurs par défaut, au lieu
 * de garder un « éteint » que personne n'a choisi.
 */
export const BUDGET_VERSION = 2;
const NEW_IN_V2: readonly PosteKey[] = ["tiktok", "network"];

export const POSTE_KEYS = POSTES.map((p) => p.key);
export const isPosteKey = (k: string): k is PosteKey => (POSTE_KEYS as string[]).includes(k);
export const posteDef = (k: PosteKey) => POSTES.find((p) => p.key === k)!;

export const CAP_CHOICES = [50, 60, 70] as const;

export type BudgetSettings = {
  capUsd: number;
  postes: { key: PosteKey; qty: number; on: boolean }[];
  cutOrder: PosteKey[];
  alert80: boolean;
};

// 600 relevés/jour suivent 1 000 comptes au rythme adaptatif (actifs chaque jour,
// calmes tous les 3 jours) ; la courbe passe à 40 vidéos/jour, les relevés de
// comptes donnant déjà celle de leurs vidéos.
// La recherche des réseaux (3 000 crédits/mois, ~100/jour) fait le premier tour
// des 5 apps de départ en une demi-journée, puis les revisite chaque semaine.
const DEFAULT_QTY: Record<PosteKey, number> = { search: 60, curve: 40, tiktok: 600, network: 3_000, insta: 60, transcript: 25, ai: 12 };

export const DEFAULT_BUDGET: BudgetSettings = {
  capUsd: 60,
  postes: POSTES.map((p) => ({ key: p.key, qty: DEFAULT_QTY[p.key], on: p.live })),
  cutOrder: ["search", "transcript", "curve", "insta", "ai", "network", "tiktok"],
  alert80: true,
};

/**
 * Réglages lus en base (ou saisis) ramenés à une forme sûre : un poste par clé,
 * quantité entière bornée, poste non branché toujours éteint, ordre de coupure
 * complet et sans doublon. Un réglage illisible retombe sur le défaut.
 */
export function normalizeBudget(
  raw: Partial<{ capUsd: number; postes: { key: string; qty: number; on: boolean }[]; cutOrder: string[]; alert80: boolean; budgetVersion: number }> | null | undefined,
): BudgetSettings {
  const cap = raw?.capUsd;
  // Écrit « 0 < cap » : la garde i18n lit « > 0 && cap < » comme du texte JSX.
  const capUsd = typeof cap === "number" && 0 < cap && cap <= 1_000 ? Math.round(cap * 100) / 100 : DEFAULT_BUDGET.capUsd;
  const isV2 = raw?.budgetVersion === BUDGET_VERSION;
  const postes = POSTES.map((def) => {
    const stale = !isV2 && NEW_IN_V2.includes(def.key);
    const got = stale ? undefined : raw?.postes?.find((p) => p.key === def.key);
    const qty = typeof got?.qty === "number" && Number.isFinite(got.qty) ? Math.min(def.max, Math.max(0, Math.round(got.qty))) : DEFAULT_QTY[def.key];
    return { key: def.key, qty, on: def.live && (got ? got.on === true : true) };
  });
  const cutOrder: PosteKey[] = [];
  for (const k of [...(raw?.cutOrder ?? []), ...DEFAULT_BUDGET.cutOrder]) {
    if (isPosteKey(k) && !cutOrder.includes(k)) cutOrder.push(k);
  }
  return { capUsd, postes, cutOrder, alert80: raw?.alert80 ?? DEFAULT_BUDGET.alert80 };
}

const posteOf = (s: BudgetSettings, k: PosteKey) => s.postes.find((p) => p.key === k)!;

/** Enveloppe du mois d'un poste, en dollars (0 s'il est éteint). */
export function envelopeUsd(s: BudgetSettings, k: PosteKey): number {
  const p = posteOf(s, k);
  if (!p.on) return 0;
  const def = posteDef(k);
  return def.dollars ? p.qty : def.monthlyCredits(p.qty) * SC_PRICE_PER_CREDIT;
}

export const envelopeCredits = (s: BudgetSettings, k: PosteKey) => {
  const p = posteOf(s, k);
  return p.on ? posteDef(k).monthlyCredits(p.qty) : 0;
};

/** Total prévu du mois, en dollars. */
export const plannedUsd = (s: BudgetSettings) => POSTE_KEYS.reduce((sum, k) => sum + envelopeUsd(s, k), 0);

export type UsageRow = { poste: string; credits: number; day?: string };

export type BudgetState = {
  spentCredits: number;
  spentUsd: number;
  byPoste: Record<PosteKey, { credits: number; usd: number; envelopeUsd: number }>;
  /** Dépense déjà faite + reste des enveloppes des postes encore ouverts. */
  projectedUsd: number;
  /** Postes coupés pour tenir le plafond. */
  cut: PosteKey[];
  /** Plafond atteint : tout s'arrête jusqu'au 1er du mois suivant. */
  capReached: boolean;
  /** 80 % du plafond dépassés. */
  over80: boolean;
};

/**
 * L'état du budget du mois. Chaque poste a son enveloppe ; au plafond, tout
 * s'arrête. Entre 80 % et 100 %, si la projection du mois dépasse le plafond, on
 * coupe dans l'ORDRE DE COUPURE jusqu'à ce qu'elle repasse dessous.
 */
export function budgetState(s: BudgetSettings, monthUsage: readonly UsageRow[]): BudgetState {
  const byPoste = {} as BudgetState["byPoste"];
  for (const k of POSTE_KEYS) byPoste[k] = { credits: 0, usd: 0, envelopeUsd: envelopeUsd(s, k) };
  let spentCredits = 0;
  for (const u of monthUsage) {
    spentCredits += u.credits;
    if (isPosteKey(u.poste)) byPoste[u.poste].credits += u.credits;
  }
  for (const k of POSTE_KEYS) byPoste[k].usd = byPoste[k].credits * SC_PRICE_PER_CREDIT;
  const spentUsd = spentCredits * SC_PRICE_PER_CREDIT;
  const remainingOf = (k: PosteKey) => Math.max(0, byPoste[k].envelopeUsd - byPoste[k].usd);
  const capReached = spentUsd >= s.capUsd;
  const over80 = spentUsd >= s.capUsd * 0.8;
  const open = POSTES.filter((d) => d.live && posteOf(s, d.key).on).map((d) => d.key);
  let projectedUsd = spentUsd + open.reduce((sum, k) => sum + remainingOf(k), 0);
  const cut: PosteKey[] = [];
  if (capReached) {
    cut.push(...open);
    projectedUsd = spentUsd;
  } else if (over80 && projectedUsd > s.capUsd) {
    for (const k of s.cutOrder) {
      if (projectedUsd <= s.capUsd) break;
      if (!open.includes(k)) continue;
      cut.push(k);
      projectedUsd -= remainingOf(k);
    }
  }
  return { spentCredits, spentUsd, byPoste, projectedUsd, cut, capReached, over80 };
}

/**
 * Crédits qu'un poste a le droit de dépenser MAINTENANT : la part d'un passage
 * (jour ÷ passages), bornée par le reste du jour et le reste de l'enveloppe du
 * mois ; 0 si le poste est éteint, non branché, coupé, ou le plafond atteint.
 */
export function allowance(
  s: BudgetSettings,
  state: BudgetState,
  k: PosteKey,
  todayCredits: number,
  runsPerDay: number,
): number {
  const def = posteDef(k);
  const p = posteOf(s, k);
  if (!def.live || !p.on || state.capReached || state.cut.includes(k)) return 0;
  const perDay = def.monthlyCredits(p.qty) / DAYS_PER_MONTH;
  const leftToday = Math.max(0, Math.floor(perDay - todayCredits));
  const leftMonth = Math.max(0, Math.floor(def.monthlyCredits(p.qty) - state.byPoste[k].credits));
  const leftCap = Math.max(0, Math.floor((s.capUsd - state.spentUsd) / SC_PRICE_PER_CREDIT));
  return Math.min(Math.ceil(perDay / Math.max(1, runsPerDay)), leftToday, leftMonth, leftCap);
}

/** Admissions dans la courbe encore possibles aujourd'hui (le poste se règle en vidéos/jour). */
export function curveAdmissionsLeft(s: BudgetSettings, admittedToday: number): number {
  const p = posteOf(s, "curve");
  return p.on ? Math.max(0, p.qty - admittedToday) : 0;
}

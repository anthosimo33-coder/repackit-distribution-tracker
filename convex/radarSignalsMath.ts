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
  /** Absent = TikTok. Un Reel Instagram a un videoId « ig:<code> ». */
  platform?: "tiktok" | "instagram";
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
  /** Texte incrusté à l'écran (le hook), absent des réponses `trim=true`. */
  hook?: string;
  /** Le son : id stable, titre, pseudo de qui l'a créé. */
  musicId?: string;
  musicTitle?: string;
  musicOwner?: string;
  /** Comptes mentionnés dans la légende (id TikTok, libellé tel qu'écrit). */
  mentions?: { id: string; label: string }[];
  /** Bio du compte, au moment du relevé. */
  authorBio?: string;
};

/**
 * Un texte sans moitié d'emoji. Couper « 😭 » au milieu (une coupe à n unités
 * UTF-16 tombe entre ses deux moitiés) laisse une valeur que Convex refuse
 * (« invalid json: unexpected end of hex escape ») : le passage entier tombe.
 * Vu en prod le 07/11/2026 sur la recherche des réseaux. Les moitiés seules
 * restantes deviennent « � ».
 */
export function cleanText(s: string, max?: number): string {
  let out = max !== undefined && s.length > max ? s.slice(0, max) : s;
  if (max !== undefined && /[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1);
  return out.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
}

const obj = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const str = (x: unknown): string | undefined => (typeof x === "string" && x !== "" ? cleanText(x) : undefined);

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
  const caption = str(v.desc) ?? "";
  const extra = readExtras(v, caption, str(author?.uid));
  const bio = str(author?.signature);
  return {
    videoId,
    url: str(v.url) ?? `https://www.tiktok.com/@${handle}/video/${videoId}`,
    authorId: str(author?.uid) ?? handle,
    authorHandle: handle,
    authorFans: num(author?.follower_count),
    caption,
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
    ...extra,
    ...(bio ? { authorBio: cleanText(bio, 300) } : {}),
  };
}

/**
 * Hook, son et mentions d'une vidéo non allégée. Le hook = les textes incrustés
 * (autocollants de type 18) ; une mention = `text_extra` de type 0, son libellé
 * lu dans la légende à ses positions (`@Voca AI`).
 */
function readExtras(v: Record<string, unknown>, caption: string, authorUid: string | undefined) {
  const texts = (Array.isArray(v.interaction_stickers) ? v.interaction_stickers : [])
    .map((x) => obj(x))
    .filter((x) => x?.type === 18)
    .map((x) => str(x?.text_info)?.replace(/\s+/g, " ").trim())
    .filter((x): x is string => !!x);
  const hook = cleanText(texts.join(" · "), 200);
  const music = obj(v.music);
  const musicId = str(music?.id_str) ?? (typeof music?.id === "string" ? music.id : undefined);
  const title = str(music?.title);
  const musicTitle = title ? cleanText(title, 120) : undefined;
  const musicOwner = str(music?.owner_handle);
  const mentions: { id: string; label: string }[] = [];
  for (const t of Array.isArray(v.text_extra) ? v.text_extra : []) {
    const e = obj(t);
    const id = str(e?.user_id);
    if (e?.type !== 0 || !id || id === authorUid || mentions.some((m) => m.id === id)) continue;
    const label = cleanText(caption.slice(num(e.start), num(e.end))).trim();
    if (label.startsWith("@") && label.length >= 3) mentions.push({ id, label: cleanText(label, 60) });
  }
  return {
    ...(hook ? { hook } : {}),
    ...(musicId ? { musicId } : {}),
    ...(musicTitle ? { musicTitle } : {}),
    ...(musicOwner ? { musicOwner } : {}),
    ...(mentions.length ? { mentions: mentions.slice(0, 10) } : {}),
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

export type PosteKey = "search" | "curve" | "tiktok" | "network" | "insta" | "transcript" | "ads" | "ai";

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
  { key: "tiktok", live: true, step: 100, max: 5_000, monthlyCredits: (n) => n * DAYS_PER_MONTH },
  // Recherche du réseau des apps (mots-clés, hashtags), en crédits par mois.
  { key: "network", live: true, step: 500, max: 30_000, monthlyCredits: (n) => n },
  // Relevés Instagram par jour (1 crédit = les ~12 derniers Reels d'un compte).
  { key: "insta", live: true, step: 50, max: 3_000, monthlyCredits: (n) => n * DAYS_PER_MONTH },
  // Vidéos transcrites par jour (1 crédit, 0 s'il n'y a rien à transcrire).
  { key: "transcript", live: true, step: 10, max: 300, monthlyCredits: (n) => n * DAYS_PER_MONTH },
  // Bibliothèques de pubs TikTok et Meta, en crédits par mois.
  { key: "ads", live: true, step: 250, max: 10_000, monthlyCredits: (n) => n },
  // Claude Haiku (familles de hooks d'une langue à l'autre), en dollars par mois.
  { key: "ai", live: true, dollars: true, step: 1, max: 30, monthlyCredits: () => 0 },
];

/**
 * Version des réglages. En version 1 (phase 1), `tiktok` comptait des COMPTES et
 * était forcé éteint (pas encore branché), `network` n'existait pas. En version 3
 * (06/11/2026), le fondateur veut le plus de données possible : relevés, réseaux,
 * courbe et plafond passent au cran au-dessus. Des réglages plus anciens relus
 * prennent pour ces postes, et pour le plafond, les valeurs par défaut.
 */
export const BUDGET_VERSION = 6;
// v4 : Instagram, transcriptions et pubs branchés (éteints tant qu'ils ne l'étaient pas).
// v5 : l'analyse IA branchée (familles de hooks) ; le plafond et les autres postes d'une v4 sont gardés.
const RESETS: readonly { before: number; postes: readonly PosteKey[] }[] = [
  { before: 4, postes: ["tiktok", "network", "curve", "insta", "transcript", "ads"] },
  { before: 5, postes: ["ai"] },
  // v6 : découverte à 20 recherches/jour (les tournures de niche chaque jour, les autres en rotation).
  { before: 6, postes: ["search"] },
];
/** Le plafond se garde à partir de cette version. */
const CAP_KEPT_FROM = 4;

export const POSTE_KEYS = POSTES.map((p) => p.key);
export const isPosteKey = (k: string): k is PosteKey => (POSTE_KEYS as string[]).includes(k);
export const posteDef = (k: PosteKey) => POSTES.find((p) => p.key === k)!;

export const CAP_CHOICES = [150, 200, 300, 400] as const;

export type BudgetSettings = {
  capUsd: number;
  postes: { key: PosteKey; qty: number; on: boolean }[];
  cutOrder: PosteKey[];
  alert80: boolean;
};

// 2 000 relevés/jour suivent 3 000 comptes au rythme adaptatif (actifs chaque
// jour, calmes tous les 3 jours, dormants chaque semaine) ; la courbe suit 100
// vidéos/jour. La recherche des réseaux (12 000 crédits/mois, ~400/jour) fait le
// premier tour des ~40 apps de départ dans la journée, puis revisite les
// concurrentes tous les 3 jours et les autres chaque semaine (~2 000 crédits/mois).
// Ce sont des PLAFONDS : sans comptes à relever ni apps à chercher, rien n'est
// dépensé. Instagram : 300 relevés/jour (les comptes dont la bio donne l'Instagram) ;
// 50 transcriptions/jour ; pubs 1 500 crédits/mois (concurrentes tous les 3 jours,
// les autres chaque semaine). Prévu au plus : ~178 $/mois sous un plafond de 300 $.
// Analyse IA : ~1 $ par mois prévu (Claude Haiku, quelques centaines de hooks), 2 $ au plus.
// Découverte : 20 recherches/jour depuis le 09/11/2026 (60 avant) — 170 de ses 190 signaux étaient hors niche.
const DEFAULT_QTY: Record<PosteKey, number> = { search: 20, curve: 100, tiktok: 2_000, network: 12_000, insta: 300, transcript: 50, ads: 1_500, ai: 2 };

export const DEFAULT_BUDGET: BudgetSettings = {
  capUsd: 300,
  postes: POSTES.map((p) => ({ key: p.key, qty: DEFAULT_QTY[p.key], on: p.live })),
  // L'analyse IA est coupée la première : la veille marche sans elle.
  cutOrder: ["ai", "search", "transcript", "curve", "ads", "insta", "network", "tiktok"],
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
  const version = raw?.budgetVersion ?? 0;
  const capUsd = version >= CAP_KEPT_FROM && typeof cap === "number" && 0 < cap && cap <= 1_000 ? Math.round(cap * 100) / 100 : DEFAULT_BUDGET.capUsd;
  const postes = POSTES.map((def) => {
    const stale = RESETS.some((r) => version < r.before && r.postes.includes(def.key));
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

/** `usd` : la dépense d'un poste en dollars (l'analyse IA), hors crédits. */
export type UsageRow = { poste: string; credits: number; day?: string; usd?: number };

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
  let dollars = 0;
  for (const u of monthUsage) {
    spentCredits += u.credits;
    dollars += u.usd ?? 0;
    if (isPosteKey(u.poste)) {
      byPoste[u.poste].credits += u.credits;
      byPoste[u.poste].usd += u.usd ?? 0;
    }
  }
  for (const k of POSTE_KEYS) byPoste[k].usd += byPoste[k].credits * SC_PRICE_PER_CREDIT;
  const spentUsd = spentCredits * SC_PRICE_PER_CREDIT + dollars;
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

/**
 * Dollars qu'un poste payé en dollars (l'analyse IA) peut encore dépenser ce
 * mois : le reste de son enveloppe, borné par le reste du plafond ; 0 s'il est
 * éteint, coupé, ou le plafond atteint.
 */
export function allowanceUsd(s: BudgetSettings, state: BudgetState, k: PosteKey): number {
  const def = posteDef(k);
  const p = posteOf(s, k);
  if (!def.live || !def.dollars || !p.on || state.capReached || state.cut.includes(k)) return 0;
  return Math.max(0, Math.min(p.qty - state.byPoste[k].usd, s.capUsd - state.spentUsd));
}

/** Admissions dans la courbe encore possibles aujourd'hui (le poste se règle en vidéos/jour). */
export function curveAdmissionsLeft(s: BudgetSettings, admittedToday: number): number {
  const p = posteOf(s, "curve");
  return p.on ? Math.max(0, p.qty - admittedToday) : 0;
}

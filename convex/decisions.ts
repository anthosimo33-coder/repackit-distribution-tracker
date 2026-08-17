/**
 * MOTEUR DE DÉCISION du dashboard — « qu'est-ce que je décide ce soir ».
 *
 * Module PUR, testable en vitest via `lib/decisions.test.ts`. Tous les seuils
 * viennent de `convex/decisionThresholds.ts` ; aucun nombre en dur ici.
 *
 * ── Le principe qui gouverne tout ────────────────────────────────────────────
 * UNE MESURE ABSENTE NE SATISFAIT JAMAIS UN SEUIL. Les saves ne sont collectées
 * que depuis peu et seulement sur TikTok ; le delta d'abonnés demande deux
 * nuits. Traiter `null` comme « seuil franchi » ferait proposer des décisions
 * sur du vide ; le traiter comme zéro ferait afficher des contre-performances
 * qui n'ont pas été mesurées. Les deux erreurs se paient en décisions prises à
 * tort, donc : absent = la décision ne se déclenche pas, et l'écran le DIT.
 *
 * Conséquence assumée : PORTE OUVERTE et GRADUATION restent dormantes tant que
 * la donnée ne peuple pas. C'est le comportement voulu, pas un défaut.
 */

import {
  OPEN_DOOR_MAX_AGE_MS,
  OPEN_DOOR_MIN_VIEWS,
  OPEN_DOOR_MIN_LIKE_RATE,
  OPEN_DOOR_MIN_SAVES,
  DEAD_HOOK_MIN_RUNS,
  DEAD_HOOK_MAX_VIEWS,
  ACCOUNT_ALARM_RUN_LENGTH,
  ACCOUNT_ALARM_MAX_VIEWS,
  ACCOUNT_ALARM_MAX_LIKE_RATE,
  ACCOUNT_ALARM_RESCUE_VIEWS,
  PENDING_POST_MAX_AGE_MS,
  RISING_DELTA_SHARE,
  FADING_DELTA_SHARE,
  LIKE_RATE_BAD,
  LIKE_RATE_GOOD,
  SAVE_RATE_GOOD,
} from "./decisionThresholds";

/** Taux rapporté aux vues ; `null` si non mesurable. */
export function rateOf(count: number | null, vues: number): number | null {
  if (count === null || vues <= 0) return null;
  return count / vues;
}

/* ── Le post, tel que le moteur le lit ────────────────────────────────────── */

export type PostSignal = {
  publicationId: string;
  compte: string;
  plateforme: string;
  creatorId: string | null;
  creatorName: string | null;
  /** Instant de publication (ms). */
  postedAt: number;
  vues: number;
  likes: number;
  /** `null` = non mesuré (plateforme sans saves, ou post antérieur à la collecte). */
  saves: number | null;
  /** Vues gagnées sur les 24 dernières heures ; `null` = pas encore calculable. */
  delta24h: number | null;
  /** Abonnés gagnés par le COMPTE sur la fenêtre ; `null` = pas encore deux relevés. */
  followersDelta: number | null;
  /** Famille d'angle du hook du combo, si connue. */
  angleFamily: string | null;
  /** Hook du combo — sert aux décisions par hook. */
  hookBrickId: string | null;
};

/* ── PORTE OUVERTE ────────────────────────────────────────────────────────── */

export type OpenDoor = {
  kind: "open-door";
  post: PostSignal;
  likeRate: number;
};

/**
 * Un post récent qui explose ET dont le compte gagne des abonnés : la fenêtre
 * est ouverte, on reprogramme une frappe sur ce compte.
 *
 * Les quatre conditions sont exigées ENSEMBLE. Des vues sans engagement sont une
 * poussée d'algorithme ; un engagement sans abonnés gagnés est un post qui
 * plaît sans convertir. C'est la conjonction qui fait la fenêtre.
 */
export function detectOpenDoor(
  post: PostSignal,
  now: number,
): OpenDoor | null {
  if (now - post.postedAt > OPEN_DOOR_MAX_AGE_MS) return null;
  if (post.vues < OPEN_DOOR_MIN_VIEWS) return null;

  const likeRate = rateOf(post.likes, post.vues);
  if (likeRate === null || likeRate < OPEN_DOOR_MIN_LIKE_RATE) return null;

  // Saves et abonnés : NON MESURÉ ≠ satisfait. Tant que la collecte ne peuple
  // pas, la décision reste dormante — voulu.
  if (post.saves === null || post.saves < OPEN_DOOR_MIN_SAVES) return null;
  if (post.followersDelta === null || post.followersDelta <= 0) return null;

  return { kind: "open-door", post, likeRate };
}

/* ── HOOK MORT ────────────────────────────────────────────────────────────── */

export type DeadHook = {
  kind: "dead-hook";
  hookBrickId: string;
  runs: number;
  bestViews: number;
};

/**
 * Un hook dont TOUS les runs publiés plafonnent sous le seuil : il ne prend pas,
 * on le désactive.
 *
 * Il faut au moins `DEAD_HOOK_MIN_RUNS` runs — condamner sur un seul essai
 * confondrait le hook et le hasard d'une sortie.
 */
export function detectDeadHooks(
  posts: readonly PostSignal[],
): DeadHook[] {
  const parHook = new Map<string, PostSignal[]>();
  for (const p of posts) {
    if (p.hookBrickId === null) continue;
    const arr = parHook.get(p.hookBrickId) ?? [];
    arr.push(p);
    parHook.set(p.hookBrickId, arr);
  }
  const out: DeadHook[] = [];
  for (const [hookBrickId, runs] of parHook) {
    if (runs.length < DEAD_HOOK_MIN_RUNS) continue;
    const bestViews = runs.reduce((m, r) => Math.max(m, r.vues), 0);
    if (bestViews >= DEAD_HOOK_MAX_VIEWS) continue;
    out.push({ kind: "dead-hook", hookBrickId, runs: runs.length, bestViews });
  }
  return out;
}

/* ── ALARME COMPTE ────────────────────────────────────────────────────────── */

export type AccountAlarm = {
  kind: "account-alarm";
  compte: string;
  creatorName: string | null;
  /** Nombre de posts consécutifs sous les seuils. */
  streak: number;
};

/**
 * Un compte dont les N derniers posts CONSÉCUTIFS sont sous les seuils, SANS
 * post au-dessus du seuil de sauvetage en parallèle.
 *
 * Ce n'est pas une action mais un avertissement : stop promos, warmup prouvé
 * pendant 5-7 jours.
 *
 * La garde de sauvetage compte : un compte qui cartonne sur une vidéo et rame
 * sur cinq autres n'est pas en train de mourir, il a une fenêtre ouverte —
 * l'arrêter serait exactement la mauvaise décision.
 *
 * `posts` doit être trié du PLUS RÉCENT au plus ancien : « consécutifs » se lit
 * en partant du dernier post.
 */
export function detectAccountAlarms(
  postsByCompteDesc: ReadonlyMap<string, readonly PostSignal[]>,
): AccountAlarm[] {
  const out: AccountAlarm[] = [];
  for (const [compte, posts] of postsByCompteDesc) {
    if (posts.length < ACCOUNT_ALARM_RUN_LENGTH) continue;
    // Garde de sauvetage AVANT tout : une fenêtre ouverte annule l'alarme.
    if (posts.some((p) => p.vues >= ACCOUNT_ALARM_RESCUE_VIEWS)) continue;

    let streak = 0;
    for (const p of posts) {
      const likeRate = rateOf(p.likes, p.vues);
      const sousLesSeuils =
        p.vues < ACCOUNT_ALARM_MAX_VIEWS &&
        likeRate !== null &&
        likeRate < ACCOUNT_ALARM_MAX_LIKE_RATE;
      if (!sousLesSeuils) break;
      streak += 1;
    }
    if (streak >= ACCOUNT_ALARM_RUN_LENGTH) {
      out.push({
        kind: "account-alarm",
        compte,
        creatorName: posts[0].creatorName,
        streak,
      });
    }
  }
  return out;
}

/* ── Verdict d'un post (colonne de la section 48 h) ───────────────────────── */

export type Verdict =
  | "pending"
  | "open-door"
  | "rising"
  | "fading"
  | "below";

/**
 * Verdict textuel court d'un post.
 *
 * Ordre de lecture : trop jeune d'abord (on ne juge pas un post de 3 h), puis
 * la fenêtre ouverte (l'information la plus actionnable), puis la tendance, et
 * « sous les seuils » en dernier — c'est le constat par défaut, pas un
 * diagnostic.
 *
 * ⚠️ « à graduer » n'est PAS produit ici : la graduation se juge sur le HOOK et
 * sa campagne, pas sur un post isolé. Elle apparaît dans « À décider ».
 */
export function verdictOf(post: PostSignal, now: number): Verdict {
  if (now - post.postedAt < PENDING_POST_MAX_AGE_MS) return "pending";
  if (detectOpenDoor(post, now) !== null) return "open-door";

  if (post.delta24h !== null && post.vues > 0) {
    const share = post.delta24h / post.vues;
    if (share >= RISING_DELTA_SHARE) return "rising";
    if (share <= FADING_DELTA_SHARE) return "fading";
    // Entre les deux : ni montée ni extinction franches → on retombe sur le
    // constat de niveau ci-dessous.
  }
  return "below";
}

/* ── Couleurs de lecture ──────────────────────────────────────────────────── */

export type RateTone = "bad" | "neutral" | "good" | "unknown";

/** Teinte du like rate selon le playbook (rouge < 5 %, vert > 8 %). */
export function likeRateTone(rate: number | null): RateTone {
  if (rate === null) return "unknown";
  if (rate < LIKE_RATE_BAD) return "bad";
  if (rate > LIKE_RATE_GOOD) return "good";
  return "neutral";
}

/** Teinte du save rate (vert > 1 %). Pas de seuil « mauvais » : donnée rare. */
export function saveRateTone(rate: number | null): RateTone {
  if (rate === null) return "unknown";
  return rate > SAVE_RATE_GOOD ? "good" : "neutral";
}

/* ── État d'un compte (en-tête de la section 48 h) ────────────────────────── */

export type AccountState = "window" | "cruise" | "alarm";

/**
 * État d'un compte tel qu'affiché en en-tête : fenêtre active (un post au-dessus
 * du seuil de sauvetage tourne), alarme (série sous les seuils), sinon croisière.
 *
 * La fenêtre PRIME sur l'alarme — c'est la même garde que `detectAccountAlarms`,
 * énoncée une seule fois ici pour que l'en-tête et la décision ne puissent pas
 * se contredire à l'écran.
 */
export function accountStateOf(
  postsDesc: readonly PostSignal[],
  alarmed: boolean,
): AccountState {
  if (postsDesc.some((p) => p.vues >= ACCOUNT_ALARM_RESCUE_VIEWS)) {
    return "window";
  }
  return alarmed ? "alarm" : "cruise";
}

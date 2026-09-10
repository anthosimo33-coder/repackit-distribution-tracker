/**
 * SEUILS du dashboard décisionnel — un seul endroit, commenté, parce qu'ils
 * vont bouger.
 *
 * Module PUR, testable en vitest via `lib/decision-thresholds.test.ts`. Les
 * seuils de GRADUATION ne sont PAS redéfinis ici : ils vivent déjà dans
 * `convex/graduation.ts` (la mutation les applique), et les dupliquer ferait
 * diverger ce que le dashboard propose de ce que la graduation accepte.
 *
 * ⚠️ Toucher un seuil change ce que l'écran PROPOSE, jamais ce qui a déjà été
 * décidé — les graduations passées figent leurs scores.
 */

const HOUR_MS = 3_600_000;

/* ── Fenêtres ─────────────────────────────────────────────────────────────── */

/** Fenêtre glissante de la section « Posts des dernières 48 h ». */
export const RECENT_WINDOW_MS = 48 * HOUR_MS;

/**
 * En dessous de cet âge, un post n'a pas encore de lecture exploitable : il est
 * « en attente », pas « sous les seuils ». Juger un post de 3 h le condamnerait
 * avant qu'il ait vécu.
 */
export const PENDING_POST_MAX_AGE_MS = 12 * HOUR_MS;

/* ── PORTE OUVERTE ────────────────────────────────────────────────────────── */

/** Un post de moins de 48 h qui explose : le compte est en fenêtre, on frappe. */
export const OPEN_DOOR_MAX_AGE_MS = 48 * HOUR_MS;
export const OPEN_DOOR_MIN_VIEWS = 15_000;
export const OPEN_DOOR_MIN_LIKE_RATE = 0.08;
/** Strictement plus de zéro save — une mesure, pas une absence. */
export const OPEN_DOOR_MIN_SAVES = 1;

/* ── HOOK MORT ────────────────────────────────────────────────────────────── */

/** Nombre de runs PUBLIÉS nécessaires pour conclure qu'un hook est mort. */
export const DEAD_HOOK_MIN_RUNS = 2;
/** Tous les runs sous ce seuil → le hook ne prend pas. */
export const DEAD_HOOK_MAX_VIEWS = 1_000;

/* ── ALARME COMPTE ────────────────────────────────────────────────────────── */

/** Nombre de posts CONSÉCUTIFS sous les seuils qui déclenche l'alarme. */
export const ACCOUNT_ALARM_RUN_LENGTH = 5;
export const ACCOUNT_ALARM_MAX_VIEWS = 3_000;
export const ACCOUNT_ALARM_MAX_LIKE_RATE = 0.08;
/**
 * Un post ACTIF au-dessus de ce seuil annule l'alarme : le compte n'est pas
 * mort, il a une fenêtre ouverte en parallèle. Sans cette garde, un compte qui
 * cartonne sur une vidéo et rame sur cinq autres serait mis à l'arrêt.
 */
export const ACCOUNT_ALARM_RESCUE_VIEWS = 15_000;

/* ── Couleurs de lecture (playbook) ───────────────────────────────────────── */

/** Like rate : rouge en dessous, vert au-dessus (entre les deux : neutre). */
export const LIKE_RATE_BAD = 0.05;
export const LIKE_RATE_GOOD = 0.08;
/** Save rate : vert au-dessus. Pas de seuil « mauvais » — la donnée est rare. */
export const SAVE_RATE_GOOD = 0.01;

/* ── Verdicts de tendance ─────────────────────────────────────────────────── */

/**
 * Part des vues totales gagnée sur les dernières 24 h au-delà de laquelle un
 * post « monte » encore, et en dessous de laquelle il « s'éteint ».
 *
 * Un RATIO et non un nombre absolu : 2 000 vues gagnées sur un post à 5 000,
 * c'est une montée ; sur un post à 400 000, c'est l'extinction.
 */
export const RISING_DELTA_SHARE = 0.2;
export const FADING_DELTA_SHARE = 0.05;

/**
 * Niveau de disponibilité d'une mesure. Le dashboard doit distinguer
 * « pas encore collecté » d'un vrai zéro — sinon on lit une contre-performance
 * là où il n'y a pas encore de donnée.
 *
 *  - `measured`  : la valeur est une mesure, exploitable ;
 *  - `collecting`: la collecte existe mais n'a pas encore produit ce point
 *                  (saves branchées récemment, delta d'abonnés qui demande deux
 *                  nuits) → à afficher « en cours de collecte » ;
 *  - `unavailable`: la plateforme n'expose pas la métrique (saves Instagram/
 *                  YouTube) → à afficher « — », définitivement.
 */
export type MetricAvailability = "measured" | "collecting" | "unavailable";

/** Plateformes qui n'exposent AUCUNE métrique de saves — limite de plateforme. */
export function savesUnavailableOn(plateforme: string): boolean {
  return plateforme === "Instagram" || plateforme === "YouTube";
}

/**
 * Statut d'une mesure de saves pour un post donné.
 *
 * `null` sur une plateforme qui n'expose pas la métrique = définitif ;
 * `null` sur TikTok = la collecte vient d'être branchée et ce post est
 * antérieur, donc « en cours ». Confondre les deux ferait promettre une donnée
 * qui n'arrivera jamais.
 */
export function savesAvailability(
  saves: number | null | undefined,
  plateforme: string,
): MetricAvailability {
  if (saves !== null && saves !== undefined) return "measured";
  return savesUnavailableOn(plateforme) ? "unavailable" : "collecting";
}

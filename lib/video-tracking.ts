/**
 * SNYTCH — suivi des vidéos publiées créatrice : dérivations PURES (statut de
 * suivi, ancienneté, agrégation du récap dashboard), testées Vitest. Le calcul
 * du GAIN par vidéo (plafonné 150 $) vit dans le moteur de paie (lib/pricing-
 * engine + convex, source unique) — PAS ici. `aggregateVideoStats` /
 * `videoTrackingStatus` sont RÉPLIQUÉS côté serveur (convex/creatorVideos, A6).
 */

/** Statut de suivi affiché à la créatrice. */
export type VideoTrackingStatus = "active" | "pending";

/**
 * Statut de suivi dérivé : « suivi actif » dès qu'au moins une métrique est
 * remontée (un snapshot relevé), sinon « vues en cours de calcul » (vidéo
 * fraîche, aucune métrique encore récupérée). C'est la réponse au besoin
 * créatrice : sa vidéo EST enregistrée/suivie même avant l'arrivée des vues.
 */
export function videoTrackingStatus(hasMetrics: boolean): VideoTrackingStatus {
  return hasMetrics ? "active" : "pending";
}

/** Vidéo minimale pour l'agrégation du récap (shape du retour serveur). */
export type TrackedVideoLike = {
  publishedAt: number;
  views: number | null;
  gain: number;
};

export type VideoStats = {
  onlineCount: number;
  totalViews: number;
  totalGain: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Récap dashboard : agrège les vidéos dont `publishedAt` tombe dans la période
 * (prédicat `inPeriod`, typiquement le mois courant). Vues nulles (en cours de
 * calcul) comptées 0. Le total des gains est la SOMME des gains PAR VIDÉO déjà
 * plafonnés à 150 $ (cohérent avec la liste et Mes paiements).
 */
export function aggregateVideoStats(
  videos: readonly TrackedVideoLike[],
  inPeriod: (publishedAt: number) => boolean,
): VideoStats {
  const scoped = videos.filter((v) => inPeriod(v.publishedAt));
  return {
    onlineCount: scoped.length,
    totalViews: scoped.reduce((s, v) => s + (v.views ?? 0), 0),
    totalGain: round2(scoped.reduce((s, v) => s + v.gain, 0)),
  };
}

/**
 * Ancienneté d'une publication, calculée par rapport à `now`. Pur et
 * déterministe (les deux timestamps sont fournis) → testable.
 *
 * Rend une UNITÉ et un COMPTE, jamais une phrase : la phrase vit dans le
 * catalogue (`portal.videos.publishedAgo`). L'ancienne version rendait
 * « il y a 3 jours », que l'écran préfixait de « Published » en anglais.
 */
export type PublishedAgo = {
  unit: "today" | "yesterday" | "days" | "weeks" | "months" | "years";
  count: number;
};

export function publishedAgo(publishedAt: number, now: number): PublishedAgo {
  const days = Math.floor(Math.max(0, now - publishedAt) / 86_400_000);
  if (days <= 0) return { unit: "today", count: 0 };
  if (days === 1) return { unit: "yesterday", count: 1 };
  if (days < 7) return { unit: "days", count: days };
  if (days < 30) return { unit: "weeks", count: Math.floor(days / 7) };
  if (days < 365) return { unit: "months", count: Math.max(1, Math.floor(days / 30)) };
  return { unit: "years", count: Math.floor(days / 365) };
}

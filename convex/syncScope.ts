/**
 * Politique de PÉRIMÈTRE et de CADENCE du relevé de vues nocturne.
 *
 * Module PUR (aucun import Convex) : importable depuis `convex/` et testable en
 * vitest depuis `lib/sync-scope.test.ts`, même arrangement que
 * `convex/viewsDaily.ts` / `convex/dateFr.ts`.
 *
 * Toutes les décisions coûteuses du cron nocturne vivent ici, séparées des
 * actions qui les exécutent : qui on relève, dans quel ordre, à quel rythme, et
 * quand on alerte. Une politique testable au lieu d'un `if` perdu dans une
 * action qui appelle une API payante.
 */

import { PAY_WINDOW_DAYS } from "./payWindow";

const DAY_MS = 86_400_000;

/** Heure PARIS du relevé nocturne (cf `convex/crons.ts`). */
export const NIGHTLY_HOUR_PARIS = 23;
/** Minute UTC du cron horaire qui porte la garde d'heure — donc minute Paris. */
export const NIGHTLY_MINUTE_PARIS = 30;

/**
 * Un compte est ACTIF s'il a publié dans les 30 derniers jours. Les comptes
 * dormants ne sont plus relevés : leurs vidéos ne bougent plus assez pour
 * justifier un run Apify par nuit, et chaque run est facturé.
 *
 * ⚠️ C'est un filtre de COMPTE, pas de publication : un compte actif fait
 * relever TOUTES ses vidéos encore dans la fenêtre de tracking (90 j), y compris
 * celles de plus de 30 jours.
 */
export const ACTIVE_ACCOUNT_WINDOW_DAYS = 30;

/**
 * Un compte relevé il y a MOINS de 2 h est sauté par le cron.
 *
 * ⚠️ Le marqueur `lastApifySyncAt` ne dit PAS d'où venait le relevé — la sync
 * manuelle et le cron l'écrivent tous les deux. La garde lit donc « un relevé
 * quelconque », pas « un relevé manuel » : un sur-ensemble de ce qui était
 * demandé, et le sens sûr (on ne saute jamais un compte qu'on aurait dû relever
 * ET on ne paie jamais deux fois en 2 h). Sans conséquence sur le cron lui-même,
 * qui ne repasse que 24 h plus tard.
 */
export const MANUAL_SYNC_GUARD_MS = 2 * 60 * 60 * 1000;

/**
 * Taille d'un lot. Instagram : `MAX_URLS_PER_RUN` d'apifyApi, 1 lot = 1 run
 * facturé. TikTok : 25 pages publiques lues d'affilée, puis une pause.
 */
export const MAX_URLS_PER_LOT = 25;

/**
 * Fenêtre de TRACKING : au-delà, une publication ne fait plus l'objet de
 * relevés. Distincte de `ACTIVE_ACCOUNT_WINDOW_DAYS` (30 j), qui qualifie le
 * COMPTE. Source unique partagée par les deux syncs (Apify et YouTube), qui
 * portaient jusqu'ici deux constantes identiques « à garder synchrones ».
 */
export const TRACKING_WINDOW_DAYS = 90;

/** Fenêtre de temporisation entre deux lots (tirée au hasard dans l'intervalle). */
export const JITTER_MIN_MS = 30_000;
export const JITTER_MAX_MS = 60_000;

/** Au-delà de cette part de comptes en échec sur un run, l'admin est notifié. */
export const FAILURE_ALERT_RATIO = 0.5;

export type ScopedPublication = {
  compte: string;
  datePubli: number;
  /** Dernier relevé connu pour cette publication (`lastApifySyncAt`). */
  lastSyncAt?: number;
};

/** Comptes ayant AU MOINS une publication dans les 30 derniers jours. */
export function activeComptes(
  pubs: readonly ScopedPublication[],
  now: number,
): Set<string> {
  const cutoff = now - ACTIVE_ACCOUNT_WINDOW_DAYS * DAY_MS;
  const actifs = new Set<string>();
  for (const p of pubs) {
    if (p.datePubli >= cutoff) actifs.add(p.compte);
  }
  return actifs;
}

/**
 * Comptes dont AU MOINS une publication a été relevée il y a moins de 2 h. Le
 * compte entier est sauté : relever la moitié de ses vidéos parce que l'autre
 * moitié vient d'être synchronisée ne produirait qu'une série incohérente.
 */
export function freshlySyncedComptes(
  pubs: readonly ScopedPublication[],
  now: number,
): Set<string> {
  const seuil = now - MANUAL_SYNC_GUARD_MS;
  const frais = new Set<string>();
  for (const p of pubs) {
    if (p.lastSyncAt !== undefined && p.lastSyncAt >= seuil) {
      frais.add(p.compte);
    }
  }
  return frais;
}

/**
 * Périmètre du relevé nocturne : les publications des comptes ACTIFS, moins les
 * comptes relevés dans les 2 dernières heures.
 *
 * L'ordre d'entrée est conservé — `planLots` s'appuie dessus pour regrouper.
 */
export function selectNightlyPublications<T extends ScopedPublication>(
  pubs: readonly T[],
  now: number,
): T[] {
  const actifs = activeComptes(pubs, now);
  const frais = freshlySyncedComptes(pubs, now);
  return pubs.filter((p) => actifs.has(p.compte) && !frais.has(p.compte));
}

/**
 * Jusqu'à cet âge INCLUS, une vidéo TikTok/Instagram est relevée chaque nuit.
 * C'est la période où elle prend l'essentiel de ses vues, et celle que lisent
 * les colonnes J+1 à J+14 et le quadrant (fenêtre de 14 jours).
 */
export const DAILY_RESYNC_MAX_AGE_DAYS = 14;

/**
 * Au-delà de 14 jours : un relevé par SEMAINE — 45 % des posts relevés chaque
 * nuit avaient plus de 14 jours le 2026-09-12, pour des vues qui ne bougent
 * presque plus.
 *
 * ⚠️ 7 j MOINS 6 h, pas 7 j pile. `lastSyncAt` est l'heure de la CAPTURE (entre
 * 23h30 et ~00h30 Paris selon la longueur de la chaîne), `now` celle du
 * DÉMARRAGE du run : sept nuits plus tard, l'écart vaut 7 j moins quelques
 * minutes, et une borne à 7 j pile repousserait chaque vieille vidéo à la
 * huitième nuit. Six nuits restent sous la borne (6 j < 6 j 18 h).
 *
 * La cadence se lit sur le DERNIER RELEVÉ, pas sur l'âge modulo 7 : une nuit
 * ratée (crédit épuisé, TikTok qui refuse) est rattrapée dès la nuit suivante
 * au lieu d'attendre la semaine d'après.
 */
export const WEEKLY_RESYNC_MS = 7 * DAY_MS - 6 * 60 * 60 * 1000;

/**
 * Âges relevés quelle que soit la cadence : la veille et le jour de clôture de
 * la fenêtre de PAIE (`PAY_WINDOW_DAYS`).
 *
 * La paie retient les vues du DERNIER relevé dont `daysSincePublication ≤ 30`
 * (cf `convex/payWindow.ts`). En hebdomadaire seul, ce dernier relevé pourrait
 * tomber à J+24 : six jours de vues perdus pour la créatrice. Deux jours et non
 * un : un relevé capturé après minuit Paris est horodaté J+31 et sort de la
 * fenêtre — celui de J+29 garde alors l'assiette à un jour près.
 */
export const PAY_WINDOW_CLOSING_AGES: readonly number[] = [
  PAY_WINDOW_DAYS - 1,
  PAY_WINDOW_DAYS,
];

/** Âge d'une publication en jours entiers au moment `now`. */
export function ageInDays(datePubli: number, now: number): number {
  return Math.floor((now - datePubli) / DAY_MS);
}

/** Pourquoi une publication est relevée cette nuit — ou pas. */
export type ResyncReason =
  | "recent"
  | "pay-window-closing"
  | "challenge"
  | "never-synced"
  | "weekly"
  | "not-due";

/**
 * Cadence d'UNE publication TikTok/Instagram. YouTube n'est pas concerné : son
 * API est gratuite, rien ne justifie de relever moins souvent.
 *
 * `liveChallengePubs` : publications rattachées à un défi ACTIF. Un défi se
 * joue au relevé (« la première à franchir ») — relever ses vidéos une fois par
 * semaine fausserait le départage, quel que soit leur âge.
 */
export function resyncReason(
  p: ScopedPublication & { _id: string },
  now: number,
  liveChallengePubs: ReadonlySet<string>,
): ResyncReason {
  const age = ageInDays(p.datePubli, now);
  if (age <= DAILY_RESYNC_MAX_AGE_DAYS) return "recent";
  if (PAY_WINDOW_CLOSING_AGES.includes(age)) return "pay-window-closing";
  if (liveChallengePubs.has(p._id)) return "challenge";
  if (p.lastSyncAt === undefined) return "never-synced";
  return now - p.lastSyncAt >= WEEKLY_RESYNC_MS ? "weekly" : "not-due";
}

/** Publications à relever cette nuit selon leur cadence (ordre conservé). */
export function selectDueTonight<T extends ScopedPublication & { _id: string }>(
  pubs: readonly T[],
  now: number,
  liveChallengePubs: ReadonlySet<string>,
): T[] {
  return pubs.filter(
    (p) => resyncReason(p, now, liveChallengePubs) !== "not-due",
  );
}

/**
 * Découpe en lots de `max` URLs, un lot = un run Apify = une unité de coût.
 *
 * Les cibles d'un même compte sont RASSEMBLÉES (regroupement par compte avant
 * découpe) pour qu'un lot en erreur s'impute au minimum de comptes possible.
 * Les lots sont remplis À RAS BORD : un compte de 3 vidéos ne réserve pas un run
 * pour lui seul, il partage. C'est l'arbitrage retenu — un lot par compte
 * doublerait la facture Apify pour une isolation d'erreur marginalement
 * meilleure. Conséquence assumée : un gros compte peut chevaucher deux lots, et
 * n'est alors « en échec » que si les DEUX échouent (cf `failedComptes`).
 */
export function planLots<T extends { compte: string }>(
  targets: readonly T[],
  max: number = MAX_URLS_PER_LOT,
): T[][] {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`planLots: taille de lot invalide (${max})`);
  }
  const byCompte = new Map<string, T[]>();
  for (const t of targets) {
    const arr = byCompte.get(t.compte);
    if (arr) arr.push(t);
    else byCompte.set(t.compte, [t]);
  }

  const lots: T[][] = [];
  let courant: T[] = [];
  for (const items of byCompte.values()) {
    for (const item of items) {
      if (courant.length === max) {
        lots.push(courant);
        courant = [];
      }
      courant.push(item);
    }
  }
  if (courant.length > 0) lots.push(courant);
  return lots;
}

/**
 * Temporisation avant le lot suivant : 30 à 60 s, tirées au hasard.
 *
 * `random` ∈ [0, 1) est INJECTÉ (le tirage appartient à l'appelant) — sinon la
 * fonction ne serait pas testable. Le jitter évite qu'une flotte de projets
 * frappe l'API sur la même seconde ; l'intervalle vaut pour un enchaînement
 * séquentiel, jamais parallèle.
 */
export function jitterMs(random: number): number {
  const borne = Math.min(Math.max(random, 0), 0.999_999_999);
  return (
    JITTER_MIN_MS + Math.floor(borne * (JITTER_MAX_MS - JITTER_MIN_MS + 1))
  );
}

export type CompteTally = {
  /**
   * Projet propriétaire du compte. L'alerte est PAR PROJET — le canal de
   * notification l'est (un projet ne doit jamais être alerté de la panne d'un
   * autre). Optionnel pour les usages mono-projet.
   */
  projectId?: string;
  compte: string;
  /** Publications relevées avec succès. */
  ok: number;
  /** Publications non relevées (post indisponible, lot en erreur). */
  ko: number;
};

/** Un même handle peut exister dans deux projets : la clé porte les deux. */
function tallyKey(t: CompteTally): string {
  // Séparateur NUL ÉCHAPPÉ (jamais un octet brut dans la source, il est
  // invisible et casse grep/diff) : aucun handle ne peut le contenir.
  return `${t.projectId ?? ""}\u0000${t.compte}`;
}

/**
 * Fusionne deux relevés de comptage (l'ordre d'apparition est conservé).
 * Indispensable : un compte peut être servi par PLUSIEURS lots (chevauchement)
 * et par plusieurs plateformes.
 */
export function mergeTallies(
  base: readonly CompteTally[],
  ajout: readonly CompteTally[],
): CompteTally[] {
  const out = new Map<string, CompteTally>();
  for (const t of [...base, ...ajout]) {
    const k = tallyKey(t);
    const cur = out.get(k);
    if (cur) {
      cur.ok += t.ok;
      cur.ko += t.ko;
    } else {
      out.set(k, { ...t });
    }
  }
  return [...out.values()];
}

/** Répartit le comptage par projet, pour décider et adresser l'alerte. */
export function groupByProject(
  tally: readonly CompteTally[],
): Map<string, CompteTally[]> {
  const out = new Map<string, CompteTally[]>();
  for (const t of tally) {
    const k = t.projectId ?? "";
    const arr = out.get(k);
    if (arr) arr.push(t);
    else out.set(k, [t]);
  }
  return out;
}

/**
 * Comptes en ÉCHEC : aucune de leurs vidéos n'a pu être relevée. Un compte
 * partiellement relevé (une vidéo indisponible sur dix) n'est PAS un échec —
 * sinon la moindre vidéo supprimée déclencherait l'alerte toutes les nuits.
 */
export function failedComptes(tally: readonly CompteTally[]): string[] {
  return tally.filter((t) => t.ok === 0 && t.ko > 0).map((t) => t.compte);
}

/**
 * Faut-il alerter l'admin ? Oui si PLUS DE la moitié des comptes tentés sont en
 * échec — un incident de plateforme ou de token, pas un aléa. Un run sans aucun
 * compte tenté n'alerte jamais (rien ne s'est passé, ce n'est pas une panne).
 */
export function shouldAlert(tally: readonly CompteTally[]): boolean {
  if (tally.length === 0) return false;
  return failedComptes(tally).length > tally.length * FAILURE_ALERT_RATIO;
}

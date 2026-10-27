/**
 * MOTIFS DE RÉSILIATION — le questionnaire que l'app pose avant d'annuler, ses
 * contre-offres (pause, changement de cible) et la part des résiliations qui n'y
 * passent pas. Logique PURE, partagée par l'onglet Rétention et l'outil MCP
 * `retention` : Claude lit exactement ce que l'écran affiche.
 *
 * (Vit dans convex/ : l'outil MCP le lit tel quel, le runtime Convex n'important
 * rien de lib/. Aucun libellé ici — le module est dans le périmètre i18n de
 * l'espace d'équipe ; l'écran et l'outil nomment les codes chacun de leur côté.)
 *
 * Source : events PostHog de l'app, PAS Whop. Whop ne connaît ni le motif ni la
 * pause (aucun statut « paused » dans les memberships ingérés).
 *
 * UNE PERSONNE = UNE LIGNE, rangée au jour de son DERNIER passage. Les payloads
 * sont des comptes de personnes déjà regroupés par attributs (cf
 * QUERIES.cancelFlow / cancelServer) : chaque personne n'appartient qu'à un seul
 * groupe, la somme sur une période est donc un nombre de personnes DISTINCTES,
 * jamais un nombre de passages.
 */

/** Motif « question passée » : la personne a vu la question sans répondre. */
export const REASON_SKIPPED = "(skipped)";
/** Motif vide : partie du parcours avant même la question. */
export const REASON_NONE = "";

/** Ce qui est sorti du parcours — le DERNIER des deux dénouements s'il y en a eu deux. */
export type CancelOutcome = "canceled" | "retained" | "abandoned";

export interface CancelFlowRow {
  /** Jour de Paris (AAAA-MM-JJ) du dernier passage de la personne par le parcours. */
  day: string;
  /**
   * Dernier motif DONNÉ. Une question passée ensuite ne l'efface pas ;
   * `REASON_SKIPPED` seulement si la personne n'en a jamais donné,
   * `REASON_NONE` si elle n'a pas atteint la question.
   */
  reason: string;
  outcome: CancelOutcome;
  /** A cliqué la contre-offre (même sans l'accepter ensuite). */
  selectedPause: boolean;
  selectedSwap: boolean;
  /** Contre-offre acceptée : "pause", "swap" ou "". */
  accepted: string;
  /** Durée de la pause posée, en mois ; 0 = aucune pause. */
  pauseMonths: number;
  persons: number;
}

export interface CancelServerRow {
  /** Jour de Paris de la dernière résiliation enregistrée par le serveur. */
  day: string;
  /** La personne est passée par le parcours (quel qu'en soit le dénouement). */
  inFlow: boolean;
  /** Cette résiliation suit une pause acceptée. */
  pausedBefore: boolean;
  persons: number;
}

export interface CancelFlowPayload {
  rows: CancelFlowRow[];
}
export interface CancelServerPayload {
  rows: CancelServerRow[];
}

export interface CancelReasonLine {
  reason: string;
  persons: number;
  canceled: number;
  retained: number;
  abandoned: number;
}

export interface CancelReasonsSummary {
  /** Personnes passées par le parcours sur la période. */
  persons: number;
  /** Dont celles qui ont donné un vrai motif (ni passé, ni parties avant). */
  answered: number;
  /** Vrais motifs par nombre décroissant, puis « passé », puis « parti avant ». */
  reasons: CancelReasonLine[];
  outcomes: { canceled: number; retained: number; abandoned: number };
  offers: {
    selectedPause: number;
    selectedSwap: number;
    acceptedPause: number;
    acceptedSwap: number;
    /** Pauses posées par durée, mois croissants. */
    pauseMonths: { months: number; persons: number }[];
  };
  server: {
    /** Personnes dont le serveur a enregistré une résiliation sur la période. */
    canceled: number;
    inFlow: number;
    /** Borne HAUTE : PostHog ne relie pas toujours la personne du serveur à celle de l'app. */
    withoutFlow: number;
    pausedBefore: number;
  };
}

/** Une période en jours de Paris, bornes incluses ; null = toute la profondeur du cache. */
export interface CancelReasonsWindow {
  from: string;
  to: string;
}

function inWindow(day: string, w: CancelReasonsWindow | null): boolean {
  return w === null || (day >= w.from && day <= w.to);
}

/** Rang d'affichage : vrais motifs d'abord, puis la question passée, puis le départ avant la question. */
function reasonRank(reason: string): number {
  if (reason === REASON_NONE) return 2;
  if (reason === REASON_SKIPPED) return 1;
  return 0;
}

export function summarizeCancelReasons(
  flow: CancelFlowPayload,
  server: CancelServerPayload,
  window: CancelReasonsWindow | null,
): CancelReasonsSummary {
  const byReason = new Map<string, CancelReasonLine>();
  const outcomes = { canceled: 0, retained: 0, abandoned: 0 };
  const offers = { selectedPause: 0, selectedSwap: 0, acceptedPause: 0, acceptedSwap: 0 };
  const months = new Map<number, number>();
  let persons = 0;

  for (const r of flow.rows) {
    if (!inWindow(r.day, window) || r.persons <= 0) continue;
    persons += r.persons;
    const line = byReason.get(r.reason) ?? {
      reason: r.reason,
      persons: 0,
      canceled: 0,
      retained: 0,
      abandoned: 0,
    };
    line.persons += r.persons;
    line[r.outcome] += r.persons;
    byReason.set(r.reason, line);
    outcomes[r.outcome] += r.persons;
    // Une offre acceptée a forcément été cliquée. `cancel_offer_selected` n'est
    // émis que depuis le 15/09 : sans ce « ou », août afficherait des pauses
    // acceptées sans un seul clic.
    if (r.selectedPause || r.accepted === "pause") offers.selectedPause += r.persons;
    if (r.selectedSwap || r.accepted === "swap") offers.selectedSwap += r.persons;
    if (r.accepted === "pause") offers.acceptedPause += r.persons;
    if (r.accepted === "swap") offers.acceptedSwap += r.persons;
    if (r.pauseMonths > 0) months.set(r.pauseMonths, (months.get(r.pauseMonths) ?? 0) + r.persons);
  }

  const srv = { canceled: 0, inFlow: 0, withoutFlow: 0, pausedBefore: 0 };
  for (const r of server.rows) {
    if (!inWindow(r.day, window) || r.persons <= 0) continue;
    srv.canceled += r.persons;
    if (r.inFlow) srv.inFlow += r.persons;
    else srv.withoutFlow += r.persons;
    if (r.pausedBefore) srv.pausedBefore += r.persons;
  }

  const reasons = [...byReason.values()].sort(
    (a, b) =>
      reasonRank(a.reason) - reasonRank(b.reason) ||
      b.persons - a.persons ||
      a.reason.localeCompare(b.reason),
  );
  return {
    persons,
    answered: reasons
      .filter((l) => reasonRank(l.reason) === 0)
      .reduce((s, l) => s + l.persons, 0),
    reasons,
    outcomes,
    offers: {
      ...offers,
      pauseMonths: [...months.entries()]
        .sort(([a], [b]) => a - b)
        .map(([m, n]) => ({ months: m, persons: n })),
    },
    server: srv,
  };
}

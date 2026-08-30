import type { CoherenceInputs } from "./analytics-hub";

/**
 * TRADUCTION UNIQUE du payload `getReliability.coherence` vers les entrées des
 * contrôles de cohérence.
 *
 * POURQUOI CE MODULE. La Vue d'ensemble et Fiabilité recopiaient chacune la
 * même vingtaine de lignes de mapping — et elles ont divergé. La Vue d'ensemble
 * ne passait ni `subsByMembership` ni `whopFirstPaidDay` : le contrôle croisé
 * par jour y retombait donc sur l'écart BRUT, sans réconciliation, et affichait
 * « 2 jour(s) divergent(s) — pire : 2026-07-28 … (écart 3) » en VIOLATION,
 * bandeau rouge compris, pendant que Fiabilité affichait « 2 jour(s)
 * réconcilié(s), aucun divergent » pour exactement la même journée.
 *
 * Un contrôle qui rend deux verdicts opposés selon l'onglet est pire que le
 * défaut qu'il surveille. Le mapping vit donc ICI, une fois : ajouter une
 * entrée aux contrôles ne peut plus n'en servir qu'un écran sur deux.
 *
 * Ce défaut a survécu à trois contre-épreuves sur données de prod parce
 * qu'elles nourrissaient le MODULE du jeu d'entrées complet. Elles testaient le
 * calcul, jamais le câblage — d'où la garde de lib/coherence-inputs.test.ts,
 * qui interdit à un composant de construire ces entrées à la main.
 */

/** La forme du champ `coherence` rendu par getReliability. */
type CoherencePayload = {
  sequentialSteps: readonly { key: string; count: number }[];
  reachSteps: readonly { key: string; count: number }[];
  currencyCount: number;
  dashboardClients: number | null;
  whopMembers: number | null;
  whopClients: number | null;
  whopClientsTotal: number | null;
  whopMembersTotal: number | null;
  whopExcludedPre: number;
  whopExcludedAfter: number;
  dailyClientsSum: number | null;
  dailySignupsSum: number | null;
  dailySubs: { day: string; subs: number }[];
  dailyPaidClients: { day: string; clients: number }[];
  subsByMembership: { day: string; membershipId: string; persons: number }[];
  whopFirstPaidDay: { membershipId: string; day: string }[];
  windowReconciliation: CoherenceInputs["windowReconciliation"] | null;
  todayParis: string;
  payDue: CoherenceInputs["payDue"];
};

/**
 * `unitCostDenominator` est le SEUL réglage par écran, et il doit le rester :
 * c'est le diviseur RÉELLEMENT utilisé par les cartes d'éco unitaire, que seule
 * la Vue d'ensemble connaît. Un écran qui ne divise rien ne le passe pas — le
 * renseigner depuis la même source qu'il vérifie en ferait une tautologie.
 */
export type CoherenceScreenOptions = {
  unitCostDenominator?: number | null;
};

export function coherenceInputsFrom(
  c: CoherencePayload,
  options: CoherenceScreenOptions = {},
): CoherenceInputs {
  return {
    sequentialSteps: c.sequentialSteps.map((s) => ({
      key: s.key,
      label: s.key,
      count: s.count,
    })),
    reachSteps: c.reachSteps.map((s) => ({
      key: s.key,
      label: s.key,
      count: s.count,
    })),
    currencyCount: c.currencyCount,
    dashboardClients: c.dashboardClients,
    // Whop dans les DEUX unités : `whopClients` (personnes) est ce que le
    // contrôle compare à PostHog, `whopMembers` (abonnements) n'est que le
    // contexte affiché.
    whopMembers: c.whopMembers,
    whopClients: c.whopClients,
    whopClientsTotal: c.whopClientsTotal,
    whopMembersTotal: c.whopMembersTotal,
    whopExcludedPre: c.whopExcludedPre,
    whopExcludedAfter: c.whopExcludedAfter,
    dailyClientsSum: c.dailyClientsSum,
    dailySignupsSum: c.dailySignupsSum,
    dailySubs: c.dailySubs,
    dailyPaidClients: c.dailyPaidClients,
    // LES DEUX ENTRÉES QUI MANQUAIENT à la Vue d'ensemble.
    subsByMembership: c.subsByMembership,
    whopFirstPaidDay: c.whopFirstPaidDay,
    windowReconciliation: c.windowReconciliation ?? undefined,
    todayParis: c.todayParis,
    payDue: c.payDue,
    unitCostDenominator: options.unitCostDenominator,
  };
}

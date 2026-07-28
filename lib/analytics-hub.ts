/**
 * Math PURE du hub Analytics — funnel, deltas, conversions, rétention, éco
 * unitaire, et LE garde-fou statistique commun.
 *
 * Ce module ne connaît ni Convex ni React : il transforme des agrégats déjà
 * calculés (cache PostHog + queries Jarvia) en chiffres d'affichage. Il est
 * consommé CÔTÉ CLIENT par les composants du hub — le serveur n'en a pas besoin
 * (il ne fait que collecter/cacher), donc AUCUNE réplique convex/ n'est requise
 * ici (pas de duplication A6 à maintenir pour ce module).
 *
 * Convention de null : `null` = « non calculable » (effectif nul, division par
 * zéro, event pas encore émis). L'UI doit afficher « — », JAMAIS 0 — un zéro
 * inventé se lit comme une mesure et ment.
 */

/**
 * Effectif minimal sous lequel une comparaison n'est PAS concluante. À faible
 * volume une différence est du bruit : sous ce seuil l'UI grise la barre et
 * affiche un badge d'avertissement (garde-fou non négociable du chantier).
 */
export const MIN_SAMPLE_SIZE = 30;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Arrondi d'un pourcentage à 1 décimale (les taux du hub sont en %). */
function roundPct(n: number): number {
  return Math.round(n * 10) / 10;
}

/** true si l'effectif autorise une lecture ; false = à signaler non concluant. */
export function isConclusive(n: number): boolean {
  return n >= MIN_SAMPLE_SIZE;
}

// ─── Funnel ──────────────────────────────────────────────────────────────────

export interface FunnelStepInput {
  key: string;
  label: string;
  /** Effectif ARRIVÉ à cette étape. */
  count: number;
}

export interface FunnelStep extends FunnelStepInput {
  /** % des entrants (étape 1) encore présents ici. null si étape 1 vide. */
  shareOfStart: number | null;
  /** % PERDU depuis l'étape précédente. null à l'étape 1. */
  dropPct: number | null;
  /** Effectif perdu depuis l'étape précédente. null à l'étape 1. */
  droppedCount: number | null;
  /** Effectif suffisant pour conclure sur CETTE étape. */
  conclusive: boolean;
}

/**
 * Décore les étapes d'un funnel : part des entrants, perte vs étape précédente,
 * verdict d'effectif. Les counts ne sont PAS re-triés ni forcés décroissants —
 * un funnel non monotone (données incohérentes) doit rester visible tel quel
 * plutôt que d'être maquillé.
 */
export function buildFunnel(steps: FunnelStepInput[]): FunnelStep[] {
  const start = steps[0]?.count ?? 0;
  return steps.map((s, i) => {
    const prev = i === 0 ? null : steps[i - 1].count;
    const dropped = prev === null ? null : Math.max(0, prev - s.count);
    return {
      ...s,
      shareOfStart: start > 0 ? roundPct((s.count / start) * 100) : null,
      droppedCount: dropped,
      dropPct:
        prev === null || prev <= 0 || dropped === null
          ? null
          : roundPct((dropped / prev) * 100),
      conclusive: isConclusive(s.count),
    };
  });
}

// ─── Cohérence des funnels (garde A6, sans FORCER la monotonie) ───────────────

export interface MonotonicityReport {
  monotone: boolean;
  /** Étapes dont le compte DÉPASSE l'étape précédente (rupture de monotonie). */
  breaks: {
    key: string;
    count: number;
    prevKey: string;
    prevCount: number;
    excess: number;
  }[];
}

/**
 * Repère les ruptures de monotonie d'un funnel (étape > étape précédente). Deux
 * usages OPPOSÉS — on ne force JAMAIS la monotonie, on la CONTRÔLE :
 *  - tunnel SÉQUENTIEL : `monotone` DOIT être true (sinon bug de calcul) ;
 *  - atteinte BRUTE : les ruptures sont ATTENDUES et porteuses de sens (ex.
 *    paywall > inscription = visiteurs anonymes voyant l'offre) → info, jamais
 *    masquée sous un compte raboté.
 */
export function checkMonotonicity(steps: FunnelStepInput[]): MonotonicityReport {
  const breaks: MonotonicityReport["breaks"] = [];
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const cur = steps[i];
    if (cur.count > prev.count) {
      breaks.push({
        key: cur.key,
        count: cur.count,
        prevKey: prev.key,
        prevCount: prev.count,
        excess: cur.count - prev.count,
      });
    }
  }
  return { monotone: breaks.length === 0, breaks };
}

export type CoherenceStatus = "ok" | "info" | "violation";

/** Un contrôle de cohérence (spine réutilisée par la carte Fiabilité, phase C). */
export interface CoherenceCheck {
  key: string;
  label: string;
  status: CoherenceStatus;
  /** Détail chiffré, ou "" si rien à signaler. */
  detail: string;
}

function describeBreaks(r: MonotonicityReport): string {
  return r.breaks
    .map((b) => `${b.key} dépasse ${b.prevKey} de ${b.excess}`)
    .join(" ; ");
}

/**
 * Contrôles de cohérence des DEUX vues de funnel. Le séquentiel monotone est une
 * garantie (violation = bug) ; la non-monotonie de l'atteinte brute est signalée
 * en info (elle documente les anonymes), pas corrigée.
 */
export function funnelCoherenceChecks(
  sequential: FunnelStepInput[],
  reach: FunnelStepInput[],
): CoherenceCheck[] {
  const checks: CoherenceCheck[] = [];
  const seq = checkMonotonicity(sequential);
  checks.push({
    key: "funnel_sequential_monotone",
    label: "Tunnel séquentiel monotone",
    status: seq.monotone ? "ok" : "violation",
    detail: seq.monotone ? "" : describeBreaks(seq),
  });
  const reachReport = checkMonotonicity(reach);
  if (reachReport.breaks.length > 0) {
    checks.push({
      key: "funnel_reach_nonmonotone",
      label: "Atteinte brute non monotone (attendu)",
      status: "info",
      detail: describeBreaks(reachReport),
    });
  }
  return checks;
}

/** Entrées des contrôles de cohérence globaux (spine Fiabilité, phase C). */
export interface CoherenceInputs {
  sequentialSteps: FunnelStepInput[];
  reachSteps: FunnelStepInput[];
  /** Nb de devises encaissées (>1 ⇒ jamais sommées). */
  currencyCount: number;
  /** Clients selon le dashboard (PostHog subscription_completed). null si absent. */
  dashboardClients: number | null;
  /** Membres payants Whop. null si Whop non configuré. */
  whopMembers: number | null;
}

/** Écart relatif toléré (points de %) entre clients dashboard et Whop. */
export const DASHBOARD_WHOP_TOLERANCE_PCT = 5;

/**
 * Assemble TOUS les contrôles de cohérence du hub. Un écart ne « corrige » rien :
 * il est signalé (info/violation) pour que la carte remplace le chiffre par son
 * état plutôt que d'afficher un nombre douteux.
 */
export function buildCoherenceChecks(i: CoherenceInputs): CoherenceCheck[] {
  const checks = funnelCoherenceChecks(i.sequentialSteps, i.reachSteps);

  // Somme attribuée ≤ total réel : les jours solo forment un sous-ensemble
  // DISJOINT des jours réels → l'attribution ne peut pas dépasser le total.
  checks.push({
    key: "attributed_le_total",
    label: "Somme attribuée ≤ total réel",
    status: "ok",
    detail: "jours solo = sous-ensemble des jours réels (garanti par construction)",
  });

  // Aucune addition inter-devises (on ne somme jamais ; info si multi-devise).
  checks.push({
    key: "no_cross_currency",
    label: "Aucune addition inter-devises",
    status: i.currencyCount > 1 ? "info" : "ok",
    detail:
      i.currencyCount > 1
        ? `${i.currencyCount} devises — affichées séparément, jamais sommées`
        : "",
  });

  // Clients dashboard vs Whop : deux sources indépendantes du même nombre.
  if (i.dashboardClients !== null && i.whopMembers !== null) {
    const diff = Math.abs(i.dashboardClients - i.whopMembers);
    const pct = Math.round((diff / Math.max(1, i.whopMembers)) * 1000) / 10;
    checks.push({
      key: "dashboard_vs_whop",
      label: "Clients dashboard vs Whop",
      status: pct <= DASHBOARD_WHOP_TOLERANCE_PCT ? "ok" : "violation",
      detail:
        diff === 0
          ? "écart 0"
          : `${i.dashboardClients} vs ${i.whopMembers} (écart ${pct} %)`,
    });
  } else {
    checks.push({
      key: "dashboard_vs_whop",
      label: "Clients dashboard vs Whop",
      status: "info",
      detail: "en attente (PostHog et/ou Whop)",
    });
  }

  return checks;
}

// ─── Évolution vs période précédente ─────────────────────────────────────────

export interface Delta {
  abs: number;
  /** Variation en %. null si la base précédente est nulle (pas de % depuis 0). */
  pct: number | null;
  direction: "up" | "down" | "flat";
}

/**
 * Évolution d'un KPI vs la période précédente. Une base précédente à 0 ne donne
 * PAS +100 % (division par zéro maquillée) mais `pct: null` → l'UI affiche la
 * variation absolue et « — » en relatif.
 */
export function computeDelta(current: number, previous: number): Delta {
  const abs = round2(current - previous);
  return {
    abs,
    pct: previous > 0 ? roundPct((abs / previous) * 100) : null,
    direction: abs > 0 ? "up" : abs < 0 ? "down" : "flat",
  };
}

// ─── Taux de conversion par segment (paywalls, sources, formats, prédicteurs) ─

export interface ConversionInput {
  key: string;
  label: string;
  /** Effectif exposé (dénominateur). */
  n: number;
  /** Effectif converti (numérateur). */
  converted: number;
}

export interface ConversionStat extends ConversionInput {
  /** Taux en %. null si n = 0. */
  rate: number | null;
  conclusive: boolean;
}

/** Décore des lignes de conversion (taux + verdict d'effectif). Ordre conservé. */
export function computeConversion(rows: ConversionInput[]): ConversionStat[] {
  return rows.map((r) => ({
    ...r,
    rate: r.n > 0 ? roundPct((r.converted / r.n) * 100) : null,
    conclusive: isConclusive(r.n),
  }));
}

/**
 * Facteur de conversion d'un segment VS une référence (× la moyenne). 1 = pile
 * la moyenne, 2 = convertit deux fois mieux. null si l'un des deux taux manque
 * ou si la référence est nulle. NB : c'est une CORRÉLATION — l'UI doit le dire.
 */
export function conversionLift(
  rate: number | null,
  baseline: number | null,
): number | null {
  if (rate === null || baseline === null || baseline <= 0) return null;
  return round2(rate / baseline);
}

/** Taux de conversion global d'un ensemble de lignes (référence des lifts). */
export function overallRate(rows: ConversionInput[]): number | null {
  const n = rows.reduce((s, r) => s + r.n, 0);
  const c = rows.reduce((s, r) => s + r.converted, 0);
  return n > 0 ? roundPct((c / n) * 100) : null;
}

// ─── Time-to-value ───────────────────────────────────────────────────────────

export type DelayStatus = "ok" | "warn" | "alert" | "unknown";

/**
 * Statut d'un délai médian face à un budget attendu. C'est l'insight que le
 * funnel ne donne pas : une étape peut convertir et pourtant traîner.
 * `> budget` → warn, `> 2× budget` → alert. Délai inconnu → "unknown" (event
 * pas encore émis) et non "ok" — l'absence de mesure n'est pas une réussite.
 */
export function delayStatus(
  medianMs: number | null,
  budgetMs: number,
): DelayStatus {
  if (medianMs === null || budgetMs <= 0) return "unknown";
  if (medianMs > budgetMs * 2) return "alert";
  if (medianMs > budgetMs) return "warn";
  return "ok";
}

/**
 * Queue longue : le p90 décroche de la médiane (une minorité met beaucoup plus
 * longtemps). Signalé à part du statut médian — les deux problèmes sont distincts.
 */
export function hasLongTail(
  medianMs: number | null,
  p90Ms: number | null,
): boolean {
  if (medianMs === null || p90Ms === null || medianMs <= 0) return false;
  return p90Ms > medianMs * 4;
}

// ─── Rétention par cohorte ───────────────────────────────────────────────────

export interface CohortInput {
  /** Libellé de la cohorte d'inscription (ex. "2026-W28"). */
  cohort: string;
  /** Effectif de la cohorte à S+0. */
  size: number;
  /** Effectif encore actif à S+0, S+1, … (index = n° de semaine). */
  retainedByWeek: number[];
}

export interface RetentionCell {
  week: number;
  retained: number;
  /** % de la cohorte. null si la cohorte est vide. */
  pct: number | null;
}

export interface RetentionRow {
  cohort: string;
  size: number;
  conclusive: boolean;
  cells: RetentionCell[];
}

/**
 * Grille de rétention (une ligne par cohorte). `weeks` borne la largeur pour que
 * toutes les lignes s'alignent, même les cohortes récentes qui n'ont pas encore
 * de S+n : les semaines non encore atteintes sont ABSENTES (cells plus courtes),
 * pas remplies de 0 — un 0 se lirait comme « tout le monde est parti ».
 */
export function buildRetentionGrid(
  cohorts: CohortInput[],
  weeks: number,
): RetentionRow[] {
  return cohorts.map((c) => ({
    cohort: c.cohort,
    size: c.size,
    conclusive: isConclusive(c.size),
    cells: c.retainedByWeek.slice(0, weeks).map((retained, week) => ({
      week,
      retained,
      pct: c.size > 0 ? roundPct((retained / c.size) * 100) : null,
    })),
  }));
}

/**
 * Intensité 0→1 d'une cellule de heatmap (pilote l'opacité de l'accent projet).
 * Bornée à [0,1] ; null → 0 (cellule neutre).
 */
export function retentionIntensity(pct: number | null): number {
  if (pct === null || !Number.isFinite(pct)) return 0;
  return Math.min(1, Math.max(0, pct / 100));
}

// ─── Attribution / éco unitaire ──────────────────────────────────────────────

/**
 * Coût d'acquisition unitaire (coût / nb acquis). null si aucun acquis — un
 * « ∞ » ou un 0 seraient tous deux faux. Sert au coût par abonné (post,
 * créatrice) ET au CAC projet.
 */
export function costPerAcquisition(
  cost: number,
  count: number,
): number | null {
  if (!(count > 0)) return null;
  return round2(cost / count);
}

/** Effectif ramené à 1 000 vues (abonnés/1k vues d'un format). null si 0 vue. */
export function per1kViews(count: number, views: number): number | null {
  if (!(views > 0)) return null;
  return round2((count / views) * 1000);
}

export interface UnitEconomicsInput {
  /** Coût créateurs RÉEL de la période (moteur de paie, warmup exclu). */
  creatorCost: number;
  /** Abonnés attribués sur la période (fenêtre 24 h). */
  attributedSubs: number;
  /** Revenu net moyen cumulé par abonné (LTV réalisée). */
  ltv: number | null;
  /** Revenu net moyen par abonné et par mois (pour le délai de récupération). */
  monthlyArpu: number | null;
}

export interface UnitEconomics {
  /** Coût d'acquisition d'un abonné. null si aucun abonné attribué. */
  cac: number | null;
  ltv: number | null;
  /** LTV / CAC. null si l'un des deux manque. */
  ltvCacRatio: number | null;
  /** Mois pour rembourser le CAC. null si ARPU mensuel inconnu ou nul. */
  paybackMonths: number | null;
}

/**
 * Éco unitaire du projet. Chaque sortie est indépendamment nullable : le CAC
 * peut exister (coût Jarvia + abonnés attribués) alors que la LTV attend encore
 * les events d'abonnement — la carte affiche alors le CAC seul.
 */
export function computeUnitEconomics(i: UnitEconomicsInput): UnitEconomics {
  const cac = costPerAcquisition(i.creatorCost, i.attributedSubs);
  const ltv = i.ltv !== null && Number.isFinite(i.ltv) ? round2(i.ltv) : null;
  return {
    cac,
    ltv,
    ltvCacRatio: cac !== null && cac > 0 && ltv !== null ? round2(ltv / cac) : null,
    paybackMonths:
      cac !== null && i.monthlyArpu !== null && i.monthlyArpu > 0
        ? round2(cac / i.monthlyArpu)
        : null,
  };
}

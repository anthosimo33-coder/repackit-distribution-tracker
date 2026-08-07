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

// ─── Jour « métier » Europe/Paris (source unique courbe ⇄ tableau) ───────────

/**
 * Le hub raisonne en jours EUROPE/PARIS : la série PostHog est bucketisée Paris
 * (toStartOfDay …, 'Europe/Paris') et le net Whop est joint par jour Paris. Toute
 * étiquette de date DOIT donc ancrer le fuseau explicitement — sinon un même
 * timestamp de bucket tombe la VEILLE lu dans le fuseau du navigateur (l'instant
 * « minuit Paris » est encore la veille en UTC/aux Amériques). C'est le bug qui
 * décalait la courbe d'un jour par rapport au tableau : la courbe formatait en
 * fuseau LOCAL, le tableau en Paris. Ces deux fonctions sont la SOURCE UNIQUE
 * partagée par la courbe (HubTrendChart) et le tableau « Détail par jour ».
 */

/** Jour Europe/Paris d'un ts (ms) → "YYYY-MM-DD" (clé de jointure, tri). */
export function parisDayKey(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
    new Date(ts),
  );
}

/**
 * Étiquette d'axe/infobulle : jour Europe/Paris d'un ts → "28 juil.". Ancrée
 * Europe/Paris (jamais le fuseau du navigateur) pour coïncider AU JOUR PRÈS avec
 * le tableau, quel que soit le fuseau du lecteur.
 */
export function parisShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Paris",
  });
}

/**
 * Jours ENTIERS restants (arrondi au supérieur) avant l'échéance `dueAt` depuis
 * `now`. Négatif = dépassé. null si l'échéance est inconnue (jamais un délai
 * inventé). Sert au décompte urgent d'un litige (« X j pour répondre »).
 */
export function daysUntil(dueAt: number | null, now: number): number | null {
  if (dueAt === null || !Number.isFinite(dueAt)) return null;
  return Math.ceil((dueAt - now) / (24 * 60 * 60 * 1000));
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
  /**
   * Membres payants Whop COMPARABLES : ancrés sur la MÊME fenêtre que le cache
   * PostHog (paiement ≤ dernière synchro) et hors memberships antérieurs à
   * l'instrumentation → un écart n'est plus de la latence de cron ni un artefact.
   */
  whopMembers: number | null;
  /** Memberships exclus car antérieurs à l'instrumentation (cause explicable). */
  whopExcludedPre?: number;
  /** Memberships exclus car postérieurs au dernier cron (latence, pas incohérence). */
  whopExcludedAfter?: number;
  /** Σ des clients quotidiens (uniq/jour) — contrôle « ne dépasse pas le total ». */
  dailyClientsSum?: number | null;
  /** Σ des inscrits quotidiens (uniq/jour). */
  dailySignupsSum?: number | null;
  /** subs PostHog par jour Paris — contrôle CROISÉ avec Whop (par jour, pas Σ). */
  dailySubs?: { day: string; subs: number }[];
  /** Nouveaux clients payants Whop par jour Paris — l'autre côté du contrôle croisé. */
  dailyPaidClients?: { day: string; clients: number }[];
  /**
   * Renouvellements Whop par jour Paris. Sert à RECONNAÎTRE la cause connue d'un
   * écart PostHog↔Whop (cf `pushDailyCrossCheck`) : sans eux, tous les jours
   * divergents restent « inexpliqués » et le contrôle alerte comme avant.
   */
  dailyRenewals?: { day: string; renewals: number }[];
  /** Jour Paris courant — exclu du contrôle croisé (partiel des deux côtés). */
  todayParis?: string;
}

/** Écart relatif toléré (points de %) entre clients dashboard et Whop. */
export const DASHBOARD_WHOP_TOLERANCE_PCT = 5;
/** Écart ABSOLU toléré (clients). Le masquage exige de franchir % ET absolu. */
export const DASHBOARD_WHOP_TOLERANCE_ABS = 5;

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

  // Compteurs de vues : payables et promo sont calculés comme SOUS-ENSEMBLES de
  // totales (computeViewCounters) → ne peuvent pas la dépasser. Documenté ici pour
  // que la couverture soit visible.
  checks.push({
    key: "view_counters_subset",
    label: "Vues payables & promo ≤ totales",
    status: "ok",
    detail: "sous-ensembles de totales (garanti par construction)",
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

  // Clients dashboard vs Whop, sur une base COMPARABLE (même fenêtre, memberships
  // pré-instrumentation exclus). Masquage SEULEMENT si les DEUX seuils sont
  // franchis (% ET absolu) : sur petits nombres, ±1-2 clients ne suspend rien.
  if (i.dashboardClients !== null && i.whopMembers !== null) {
    const diff = Math.abs(i.dashboardClients - i.whopMembers);
    const pct = Math.round((diff / Math.max(1, i.whopMembers)) * 1000) / 10;
    const masks =
      pct > DASHBOARD_WHOP_TOLERANCE_PCT && diff > DASHBOARD_WHOP_TOLERANCE_ABS;
    const causes: string[] = [];
    if (i.whopExcludedPre && i.whopExcludedPre > 0) {
      causes.push(`${i.whopExcludedPre} antérieur(s) à l'instrumentation exclu(s)`);
    }
    if (i.whopExcludedAfter && i.whopExcludedAfter > 0) {
      causes.push(`${i.whopExcludedAfter} après le dernier cron (latence)`);
    }
    const base =
      diff === 0
        ? "écart 0"
        : `${i.dashboardClients} vs ${i.whopMembers} (écart ${diff}, ${pct} %)`;
    checks.push({
      key: "dashboard_vs_whop",
      label: "Clients dashboard vs Whop",
      status: masks ? "violation" : diff === 0 ? "ok" : "info",
      detail: causes.length > 0 ? `${base} · ${causes.join(" · ")}` : base,
    });
  } else {
    checks.push({
      key: "dashboard_vs_whop",
      label: "Clients dashboard vs Whop",
      status: "info",
      detail: "en attente (PostHog et/ou Whop)",
    });
  }

  // Défaut d'instrumentation : subscription_completed compté DEUX FOIS (client +
  // serveur). L'atteinte brute dépasse le séquentiel — on l'EXPOSE (le garde-fou
  // s'ancre sur le séquentiel, mais on ne masque pas le vrai problème).
  const reachClients = stepBy(i.reachSteps, "subscription_completed");
  const seqClients = stepBy(i.sequentialSteps, "subscription_completed");
  if (reachClients !== null && seqClients !== null && reachClients > seqClients) {
    checks.push({
      key: "subscription_double_instrumentation",
      label: "subscription_completed compté en double",
      status: "info",
      detail: `atteinte brute ${reachClients} vs séquentiel ${seqClients} (écart ${reachClients - seqClients}) — émis côté client ET serveur, à dédupliquer côté app`,
    });
  }

  // Σ des valeurs quotidiennes ≤ total sur la même période. Une somme de jours qui
  // dépasse le total = double comptage inter-jours (le défaut qui gonflait 25 en 54).
  pushSumCheck(checks, "sum_daily_clients_le_total", "Σ clients/jour ≤ total", i.dailyClientsSum, reachClients);
  pushSumCheck(checks, "sum_daily_signups_le_total", "Σ inscrits/jour ≤ total", i.dailySignupsSum, stepBy(i.reachSteps, "signup_completed"));

  // Cohérence CROISÉE PAR JOUR entre deux CARTES qui montrent la même notion
  // (nouveaux abonnés/jour) depuis deux sources : PostHog subs vs Whop clients.
  // Le contrôle par TOTAUX ne voit PAS un écart d'un seul jour (la Σ peut concorder).
  pushDailyCrossCheck(
    checks,
    i.dailySubs,
    i.dailyPaidClients,
    i.dailyRenewals,
    i.todayParis,
  );

  return checks;
}

/**
 * Écart SIGNIFICATIF entre deux comptes d'un même jour : ≥ 3 en absolu, OU ≥ 2
 * avec forte proportion (petits jours). Un ±2 sur ~13 (bruit
 * checkout↔encaissement) n'alerte pas.
 */
function significantGap(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  const rel = Math.max(a, b) > 0 ? diff / Math.max(a, b) : 0;
  return diff >= 2 && (diff >= 3 || rel >= 0.5);
}

/** Un jour divergent du contrôle croisé. */
interface DailyMismatch {
  day: string;
  subs: number;
  clients: number;
  diff: number;
}

/**
 * Contrôle CROISÉ PAR JOUR — PostHog `subs` vs Whop nouveaux clients payants, jour
 * Paris par jour Paris. Les deux mesurent « nouveaux abonnés/jour » ; un écart un
 * jour donné = trou/latence (ex. cache PostHog en retard sur un paiement Whop). On
 * exclut le jour COURANT (partiel des deux côtés).
 *
 * CAUSE CONNUE, écartée de l'alerte : `subscription_completed` est RÉÉMIS à chaque
 * cycle par le lot serveur, donc PostHog compte les renouvellements comme des
 * conversions et dépasse structurellement Whop TOUS LES JOURS. Un jour dont l'excès
 * PostHog disparaît une fois les renouvellements Whop ajoutés est classé EXPLIQUÉ
 * (statut info, cause écrite) : sans ça, le bandeau rouge sonne en permanence pour
 * un motif su, et on apprend à ne plus le lire. Un écart NON couvert par les
 * renouvellements (ou en sens inverse, PostHog sous Whop) reste une violation :
 * c'est justement ce que l'alerte doit encore attraper. À retirer quand l'app
 * émettra `is_renewal` et que le cache pourra filtrer les réabonnements à la source.
 */
function pushDailyCrossCheck(
  checks: CoherenceCheck[],
  dailySubs: { day: string; subs: number }[] | undefined,
  dailyClients: { day: string; clients: number }[] | undefined,
  dailyRenewals: { day: string; renewals: number }[] | undefined,
  today: string | undefined,
): void {
  if (!dailySubs || !dailyClients) return;
  const subsBy = new Map(dailySubs.map((d) => [d.day, d.subs]));
  const cliBy = new Map(dailyClients.map((d) => [d.day, d.clients]));
  const renBy = new Map((dailyRenewals ?? []).map((d) => [d.day, d.renewals]));
  const days = [...new Set([...subsBy.keys(), ...cliBy.keys()])];
  const explained: DailyMismatch[] = [];
  const unexplained: DailyMismatch[] = [];
  for (const day of days) {
    if (today && day >= today) continue; // jour courant/futur = partiel → ignoré
    const subs = subsBy.get(day) ?? 0;
    const clients = cliBy.get(day) ?? 0;
    if (!significantGap(subs, clients)) continue;
    const renewals = renBy.get(day) ?? 0;
    const m = { day, subs, clients, diff: Math.abs(subs - clients) };
    // Excès PostHog absorbé par les renouvellements du même jour ⇒ cause connue.
    const knownCause =
      subs > clients && renewals > 0 && !significantGap(subs, clients + renewals);
    (knownCause ? explained : unexplained).push(m);
  }
  explained.sort((a, b) => b.diff - a.diff);
  unexplained.sort((a, b) => b.diff - a.diff);

  const key = "daily_clients_posthog_vs_whop";
  const label = "Clients/jour PostHog vs Whop";
  if (unexplained.length === 0) {
    checks.push({
      key,
      label,
      status: explained.length === 0 ? "ok" : "info",
      detail:
        explained.length === 0
          ? "concordent jour par jour"
          : `${explained.length} jour(s) où PostHog dépasse Whop, expliqués par les renouvellements du jour : subscription_completed est réémis à chaque cycle par le lot serveur, donc un réabonnement compte comme une conversion. Alerte levée tant que la propriété is_renewal n'est pas émise par l'app.`,
    });
    return;
  }
  const worst = unexplained[0];
  checks.push({
    key,
    label,
    status: worst.diff >= 3 ? "violation" : "info",
    detail:
      `${unexplained.length} jour(s) divergent(s) hors renouvellements — pire : ${worst.day} PostHog ${worst.subs} vs Whop ${worst.clients} (écart ${worst.diff})` +
      (explained.length > 0
        ? ` · ${explained.length} autre(s) jour(s) expliqués par les renouvellements comptés comme des conversions`
        : ""),
  });
}

/** Compte d'une étape par clé (null si absente). */
function stepBy(steps: FunnelStepInput[], key: string): number | null {
  return steps.find((s) => s.key === key)?.count ?? null;
}

// ─── Garde-fou de la carte Test A/B ──────────────────────────────────────────

/**
 * Une ligne du tableau par bras, avec les valeurs RÉELLEMENT AFFICHÉES. Le
 * contrôle compare l'affiché au recalculé : c'est la seule façon d'attraper une
 * erreur d'UNITÉ. Cas vécu : la complétion passait un ratio (0,5) à un
 * formateur attendant des points de % → « 0,5 % » à l'écran pour 50 % réels.
 * Un contrôle qui recalcule sans comparer à l'affiché ne l'aurait jamais vu.
 */
export interface AbArmRateInput {
  variant: string;
  /** Assignés au bras (unité de randomisation). */
  exposed: number;
  /** Sous-ensemble ayant vu un paywall. */
  paywallViewers: number;
  /** Personnes ayant ouvert un checkout. */
  checkouts: number;
  /** NOUVEAUX clients (renouvellements exclus). */
  paid: number;
  /** Nouveaux clients sans checkout_started (numérateur hors dénominateur). */
  paidWithoutCheckout: number;
  /** Cibles ajoutées par les clients APRÈS paiement. */
  clientTargets: number;
  /** Cibles ajoutées par tout le bras (0 ⇒ non instrumenté ici). */
  armTargets: number;
  /** Complétion telle qu'affichée, en POINTS DE % (null = tiret). */
  shownCompletionPct: number | null;
  /** Cibles par client telles qu'affichées (null = tiret). */
  shownTargetsPerClient: number | null;
}

/** Écart toléré entre un taux affiché et son recalcul (arrondis d'affichage). */
const RATE_MATCH_EPSILON = 0.05;

/**
 * Contrôles de la carte Test A/B, un jeu par bras. Chaque taux doit (a) avoir un
 * numérateur inclus dans son dénominateur, (b) porter sur la colonne annoncée.
 * Une complétion > 100 % ou différente du ratio réel est une VIOLATION : le
 * chiffre doit être remplacé par son état, pas montré faux.
 */
export function abArmCoherenceChecks(rows: AbArmRateInput[]): CoherenceCheck[] {
  const checks: CoherenceCheck[] = [];
  if (rows.length === 0) return checks;

  // (a) Numérateur ⊆ dénominateur : payer sans checkout_started rend la
  // « complétion » ininterprétable, même quand le total reste sous 100 %.
  const overflow = rows.filter((r) => r.paid > r.checkouts);
  const outside = rows.filter((r) => r.paidWithoutCheckout > 0);
  checks.push({
    key: "ab_completion_subset",
    label: "Complétion : payés ⊆ checkouts",
    status: overflow.length > 0 ? "violation" : outside.length > 0 ? "info" : "ok",
    detail:
      overflow.length > 0
        ? overflow
            .map((r) => `${r.variant} : ${r.paid} payé(s) pour ${r.checkouts} checkout(s) — taux > 100 %`)
            .join(" ; ")
        : outside.length > 0
          ? outside
              .map((r) => `${r.variant} : ${r.paidWithoutCheckout} client(s) sans checkout_started`)
              .join(" ; ")
          : "chaque payé a ouvert un checkout",
  });

  // (b) Le taux affiché porte bien sur la colonne annoncée (payés / checkouts).
  const mismatched = rows
    .map((r) => ({ r, expected: rateOf(r.paid, r.checkouts) }))
    .filter(({ r, expected }) => !sameRate(r.shownCompletionPct, expected));
  checks.push({
    key: "ab_completion_matches_columns",
    label: "Complétion = payés ÷ checkouts",
    status: mismatched.length > 0 ? "violation" : "ok",
    detail:
      mismatched.length > 0
        ? mismatched
            .map(({ r, expected }) => {
              const shown = r.shownCompletionPct;
              const unit =
                shown !== null && expected !== null && sameRate(shown * 100, expected)
                  ? " (ratio affiché à la place d'un pourcentage : ×100 manquant)"
                  : "";
              return `${r.variant} : ${shown === null ? "—" : shown} % affiché pour ${
                expected === null ? "—" : expected
              } % réel (${r.paid}/${r.checkouts})${unit}`;
            })
            .join(" ; ")
        : "affiché = recalculé sur toutes les lignes",
  });

  // Monotonie des colonnes : checkouts ⊆ ayant vu le paywall ⊆ assignés.
  const breaks = rows.flatMap((r) => {
    const b: string[] = [];
    if (r.paywallViewers > r.exposed) {
      b.push(`${r.variant} : ${r.paywallViewers} ont vu le paywall pour ${r.exposed} assignés`);
    }
    if (r.checkouts > r.paywallViewers) {
      b.push(`${r.variant} : ${r.checkouts} checkouts pour ${r.paywallViewers} ayant vu le paywall`);
    }
    return b;
  });
  checks.push({
    key: "ab_columns_monotone",
    label: "Colonnes emboîtées (checkouts ≤ paywall ≤ assignés)",
    status: breaks.length > 0 ? "violation" : "ok",
    detail: breaks.length > 0 ? breaks.join(" ; ") : "",
  });

  // Cibles par client : numérateur = cibles DES CLIENTS, donc ≤ cibles du bras ;
  // et un bras sans aucun target_added ne vaut pas « 0 cible » mais « pas mesuré ».
  const targetIssues = rows.flatMap((r) => {
    const b: string[] = [];
    if (r.clientTargets > r.armTargets) {
      b.push(`${r.variant} : ${r.clientTargets} cibles clients pour ${r.armTargets} sur le bras`);
    }
    if (r.armTargets === 0 && r.shownTargetsPerClient !== null) {
      b.push(`${r.variant} : ratio affiché alors qu'aucun target_added n'est émis`);
    }
    const expected = r.paid > 0 && r.armTargets > 0 ? round2(r.clientTargets / r.paid) : null;
    if (!sameRate(r.shownTargetsPerClient, expected)) {
      b.push(
        `${r.variant} : ${r.shownTargetsPerClient ?? "—"} affiché pour ${expected ?? "—"} recalculé`,
      );
    }
    return b;
  });
  checks.push({
    key: "ab_targets_per_client",
    label: "Cibles / client = cibles des clients ÷ clients",
    status: targetIssues.length > 0 ? "violation" : "ok",
    detail: targetIssues.length > 0 ? targetIssues.join(" ; ") : "",
  });

  return checks;
}

/** Taux en points de %, null si le dénominateur est nul. */
function rateOf(num: number, den: number): number | null {
  return den > 0 ? roundPct((num / den) * 100) : null;
}

/** Deux valeurs affichables égales à l'arrondi près (null compris). */
function sameRate(shown: number | null, expected: number | null): boolean {
  if (shown === null || expected === null) return shown === expected;
  return Math.abs(shown - expected) <= RATE_MATCH_EPSILON;
}

/** Contrôle « Σ jours ≤ total » : ratio > 1,5 = violation, > 1,05 = info, sinon ok. */
function pushSumCheck(
  checks: CoherenceCheck[],
  key: string,
  label: string,
  sum: number | null | undefined,
  total: number | null,
): void {
  if (sum == null || total == null) return;
  const ratio = total > 0 ? sum / total : sum > 0 ? Infinity : 1;
  checks.push({
    key,
    label,
    status: ratio > 1.5 ? "violation" : ratio > 1.05 ? "info" : "ok",
    detail:
      sum > total
        ? `Σ jours ${sum} > total ${total} (double comptage inter-jours)`
        : `Σ jours ${sum} ≤ total ${total}`,
  });
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

// ─── RPM promo (revenu, coût, écart) ─────────────────────────────────────────

export interface PromoRpmInput {
  /** Revenu Whop NET cumulé, devise du REVENU (€). null = Whop non configuré. */
  revenueNet: number | null;
  /**
   * Paie des PUBLICATIONS PROMO cumulée (fixe + CPM), devise de la PAIE ($) —
   * MÊME PÉRIMÈTRE que `promoViews` ci-dessous, c'est ce qui rend l'écart
   * lisible. Le warmup en est absent des DEUX côtés : il n'est pas rémunéré,
   * hors exception historique (champ `remunere`) dont la paie est retirée en
   * amont, puisque ses vues sont hors promo. Le bonus de paliers n'y est pas non
   * plus : il est attaché à la CRÉATRICE, pas à une publication.
   */
  creatorCost: number | null;
  /** Vues PROMO cumulées (hors warmup) — dénominateur COMMUN aux trois valeurs. */
  promoViews: number | null;
  /** Taux paie→revenu EFFECTIF (1 si même devise, null si non reliées). */
  fxRateToRevenue: number | null;
}

export interface PromoRpm {
  /** Revenu net pour 1 000 vues promo, devise du REVENU. null si aucune vue promo. */
  revenue: number | null;
  /** Coût créatrices pour 1 000 vues promo, devise de la PAIE. null si aucune vue. */
  cost: number | null;
  /** Le MÊME coût converti dans la devise du revenu. null sans taux de change. */
  costConverted: number | null;
  /** Écart = marge par millier de vues promo, devise du revenu. null si l'un manque. */
  margin: number | null;
  /** Vues promo retenues (0 ⇒ tout est null, jamais un RPM infini). */
  promoViews: number;
}

/**
 * RPM promo — les trois chiffres qui disent si le moteur UGC gagne de l'argent :
 * ce que mille vues promo RAPPORTENT, ce qu'elles COÛTENT, et l'écart entre les
 * deux. Dénominateur commun aux trois : les vues PROMO (hors warmup), les seules
 * vidéos qui mentionnent l'app.
 *
 * Deux devises : le revenu est en euros, la paie en dollars. L'écart n'existe donc
 * que si le taux du projet les relie — sans lui `margin` est `null` (on ne
 * soustrait jamais deux devises sans conversion), les deux RPM restant chacun
 * lisible dans sa propre devise.
 *
 * L'écart est calculé sur les valeurs AFFICHÉES (déjà arrondies) : à l'écran,
 * revenu − coût donne exactement l'écart montré.
 */
export function computePromoRpm(i: PromoRpmInput): PromoRpm {
  const views = i.promoViews !== null && i.promoViews > 0 ? i.promoViews : 0;
  const per1k = (amount: number | null): number | null =>
    amount !== null && Number.isFinite(amount) && views > 0
      ? round2(amount / (views / 1000))
      : null;
  const revenue = per1k(i.revenueNet);
  const cost = per1k(i.creatorCost);
  const fx = i.fxRateToRevenue;
  const costConverted =
    cost !== null && fx !== null && fx > 0 ? round2(cost * fx) : null;
  return {
    revenue,
    cost,
    costConverted,
    margin:
      revenue !== null && costConverted !== null
        ? round2(revenue - costConverted)
        : null,
    promoViews: views,
  };
}

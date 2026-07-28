import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { adminMutation, adminQuery } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  runHogQL,
  cellNum,
  cellStr,
  cellTimeMs,
  type PosthogTarget,
} from "./posthogApi";
import {
  CONTRACT_EVENTS,
  CONTRACT_PROPERTIES,
  eventAlias,
} from "./analyticsContract";
import {
  internalAccountsFor,
  internalMarkerHogQL,
  notInternalClause,
} from "./internalAccounts";

/**
 * Ingestion des AGRÉGATS PostHog par projet (hub Analytics). Un cron horaire
 * (convex/crons.ts) exécute, pour CHAQUE projet configuré (projects.posthog), un
 * jeu de requêtes HogQL et stocke leur résultat dans posthogCache. Les queries
 * lues par l'UI ne tapent JAMAIS l'API (lente + rate-limitée) : elles servent le
 * cache. Un bouton « Actualiser » replanifie la même action à la demande.
 *
 * 🔐 La clé API n'est JAMAIS en base : projects.posthog.apiKeyEnvVar NOMME la
 * variable d'env (Convex) qui la porte ; l'action la lit via process.env et la
 * passe à posthogApi (en-tête Authorization uniquement, jamais loguée).
 *
 * ⚠️ ROBUSTESSE — chaque requête est indépendante : un event pas encore émis
 * côté produit rend 0 ligne, ce qui donne un agrégat VIDE (et non une erreur).
 * Une requête en échec n'écrase PAS la dernière valeur connue (on écrit alors
 * seulement `error`) et n'empêche pas les autres d'aboutir → une carte ne casse
 * jamais à cause d'une autre.
 *
 * ⚠️ Les requêtes ci-dessous sont écrites CONTRE LE CONTRAT D'EVENTS attendu
 * (signup_completed, target_added, …) qui n'est pas encore émis par Snytch :
 * elles sont donc NON VÉRIFIÉES en conditions réelles. Tant qu'aucun event
 * n'arrive, toutes les cartes PostHog affichent leur état vide.
 *
 * ⚠️ TS7022 — runHourlySync appelle ctx.runQuery/runMutation(internal.*) et est
 * référencée par le scheduler : son type de retour est ANNOTÉ (PosthogSyncSummary).
 */

/** Profondeur d'historique des requêtes d'agrégat (jours). */
const WINDOW_DAYS = 90;
/** Largeur de la grille de rétention (S+0 → S+8). */
const RETENTION_WEEKS = 9;
/** Borne des segments listés (sources, variants, langues) — anti-explosion d'UI. */
const SEGMENT_LIMIT = 20;

/** Clés d'agrégat stockées dans posthogCache (une row par (projet, key)). */
export const POSTHOG_CACHE_KEYS = {
  overview: "overview",
  funnelGlobal: "funnel:global",
  funnelSequential: "funnel:sequential",
  funnelSource: "funnel:source",
  funnelLanguage: "funnel:language",
  timeToValue: "timeToValue",
  paywall: "paywall",
  paywallById: "paywallById",
  sources: "sources",
  cohorts: "cohorts",
  predictors: "predictors",
  // ─── C1 — Contrat d'events élargi (phase B consommera ces agrégats) ────────
  instrumentation: "instrumentation",
  checkoutReliability: "checkoutReliability",
  checkoutCauses: "checkoutCauses",
  searchResults: "searchResults",
  scanReliability: "scanReliability",
  scanLatency: "scanLatency",
  friction: "friction",
  // ─── C2 — Compteur A4 (personnes internes exclues) ─────────────────────────
  internalExcluded: "internalExcluded",
  // ─── Phase B — agrégats des nouveaux onglets ──────────────────────────────
  activation: "activation",
  abVariants: "abVariants",
  freePlan: "freePlan",
} as const;

// ─── Formes des agrégats cachés ──────────────────────────────────────────────

export interface OverviewPayload {
  daily: { ts: number; visitors: number; signups: number; subs: number }[];
}
export interface FunnelSegment {
  key: string;
  steps: { key: string; count: number }[];
}
export interface FunnelPayload {
  segments: FunnelSegment[];
}
export interface TimeToValuePayload {
  steps: { key: string; medianMs: number | null; p90Ms: number | null; n: number }[];
}
export interface ConversionPayload {
  rows: { key: string; n: number; converted: number }[];
}
export interface CohortsPayload {
  segments: {
    key: string;
    cohorts: { cohort: string; size: number; retainedByWeek: number[] }[];
  }[];
}
export interface PredictorsPayload {
  total: number;
  totalConverted: number;
  behaviors: { key: string; n: number; converted: number }[];
}

// ─── C1 — Formes des agrégats du contrat élargi ──────────────────────────────

/** État d'instrumentation : un item par event du contrat + sondes de propriétés. */
export interface InstrumentationPayload {
  events: {
    name: string;
    category: string;
    persons: number;
    /** null quand l'event n'a JAMAIS été émis (pas d'epoch-0 trompeur). */
    firstSeenMs: number | null;
    /** Déclaré au contrat mais pas attendu émis (règle A1). */
    notYetEmitted: boolean;
    note?: string;
  }[];
  props: {
    key: string;
    onEvent: string;
    /** Nb d'events portant la propriété (0 = jamais vue). */
    present: number;
    notYetEmitted: boolean;
  }[];
}

/** Fiabilité du checkout par appareil + pertes (règle : question → décision). */
export interface CheckoutReliabilityPayload {
  rows: {
    device: string;
    checkouts: number;
    paid: number;
    divertedFree: number;
    disappeared: number;
    medPayMs: number | null;
    p90PayMs: number | null;
  }[];
}

/** Motifs d'échec de paiement (payment_failed groupé par `cause`). */
export interface CheckoutCausesPayload {
  rows: { cause: string; n: number }[];
}

/** Résultats de recherche de compte (handle_search_result groupé par `result`). */
export interface SearchResultsPayload {
  rows: { result: string; persons: number }[];
}

/** Fiabilité des scans (scan_completed groupé par mode × result). */
export interface ScanReliabilityPayload {
  rows: { mode: string; result: string; runs: number }[];
}

/** Latence perçue des scans par tranche d'abonnés du compte scanné. */
export interface ScanLatencyPayload {
  rows: { bucket: string; medianMs: number | null; p90Ms: number | null; n: number }[];
}

/** Points de friction : rageclicks par page. */
export interface FrictionPayload {
  rows: { page: string; persons: number }[];
}

/** Compteur A4 : personnes internes exclues (marqueur is_internal / handles). */
export interface InternalExcludedPayload {
  persons: number;
  totalPersons: number;
}

/** B0a — activation produit par TYPE d'utilisateur (payant / gratuit / autre). */
export interface ActivationPayload {
  rows: {
    segment: string;
    persons: number;
    targetAdded: number;
    firstAlert: number;
    usernameEntered: number;
  }[];
}

/** B3 — test A/B par variante de paywall (une personne = sa DERNIÈRE variante vue). */
export interface AbVariantsPayload {
  rows: {
    variant: string;
    exposed: number;
    checkouts: number;
    paid: number;
    /** Σ cibles ajoutées par les CLIENTS de la variante (→ cibles/client). */
    clientTargets: number;
  }[];
}

/** B3 — plan gratuit : usage réel, passage au payant, délai gratuit→checkout. */
export interface FreePlanPayload {
  signups: number;
  /** A fait ≥ 1 action produit (recherche / scan / cible). */
  used: number;
  /** Passés au payant (subscription_completed). */
  convertedPaid: number;
  /** Avaient ouvert le checkout AVANT le gratuit. */
  checkoutBefore: number;
  /** Délai médian gratuit→checkout (ms, SIGNÉ : négatif = checkout avant). null si aucun. */
  medFreeToCheckoutMs: number | null;
}

/**
 * Étapes du funnel de CONVERSION (chemin de monétisation), dans l'ORDRE ÉTABLI
 * EMPIRIQUEMENT (diagnostic A6, médiane des délais depuis l'inscription) :
 * paywall (1 s) précède le checkout (18 s) et l'abonnement (97 s). L'ancien
 * ordre plaçait target_added (64 s) et first_alert (~14 h) AVANT le paywall —
 * les taux séquentiels calculés dessus étaient faux. Les jalons d'activation
 * (recherche, cible, alerte) ne sont PAS sur le chemin de monétisation : ils
 * vivent dans predictors / timeToValue, pas ici. Mêmes clés pour l'atteinte
 * brute (funnelGlobal) et le séquentiel (funnelSequential) → comparables côte à côte.
 */
export const FUNNEL_STEP_KEYS = [
  "visit",
  "signup_completed",
  "paywall_viewed",
  "checkout_started",
  "subscription_completed",
] as const;

/** Étapes de time-to-value (l'UI mappe ces clés vers des libellés + budgets). */
export const TTV_STEP_KEYS = [
  "signup_to_target",
  "target_to_alert",
  "alert_to_payment",
] as const;

/** Comportements testés comme prédicteurs d'abonnement. */
export const PREDICTOR_KEYS = [
  "squad",
  "alerts_3",
  "targets_2",
  "push_enabled",
  "referral_shared",
] as const;

// ─── Requêtes HogQL ──────────────────────────────────────────────────────────
// Toutes AGRÉGÉES (count/uniq/quantile + group by) : aucun event brut, aucune
// propriété nominative ne sort de PostHog.

/**
 * Colonnes `uniqIf` d'ATTEINTE BRUTE d'étape (personnes distinctes ayant réalisé
 * l'étape, indépendamment des autres), réutilisées par les 3 variantes de funnel
 * de reach. NON monotone par nature — le paywall peut dépasser l'inscription
 * (visiteurs anonymes voyant l'offre sans signup). C'est une INFORMATION, pas une
 * erreur ; le tunnel séquentiel (funnelSequential) sert, lui, aux taux.
 */
const FUNNEL_COLUMNS = `
    uniqIf(person_id, event = '$pageview') AS visit,
    uniqIf(person_id, event = 'signup_completed') AS signup_completed,
    uniqIf(person_id, event = 'paywall_viewed') AS paywall_viewed,
    uniqIf(person_id, event = 'checkout_started') AS checkout_started,
    uniqIf(person_id, event = 'subscription_completed') AS subscription_completed`;

/** Expression de segment robuste au vide/null (→ libellé explicite). */
function segExpr(prop: string): string {
  return `coalesce(nullIf(toString(${prop}), ''), '(inconnu)')`;
}

// ─── C1 — Instrumentation générée DEPUIS le contrat (aucune dérive) ───────────

/** Une paire (personnes, première émission) par event du contrat. */
const INSTRUMENTATION_EVENT_COLUMNS = CONTRACT_EVENTS.map((e) => {
  const a = eventAlias(e.name);
  return `    uniqIf(person_id, event = '${e.name}') AS n_${a},\n    minIf(timestamp, event = '${e.name}') AS f_${a}`;
}).join(",\n");

/**
 * Sondes de PRÉSENCE de propriétés — les 3 « pas encore émises » (règle A1) +
 * deux cas signalés par la maquette (result muet, distinct_id manquant). L'ordre
 * est stable : la shape lit par index.
 */
export const INSTRUMENTATION_PROP_PROBES: {
  key: string;
  onEvent: string;
  cond: string;
  notYetEmitted: boolean;
}[] = [
  // isNotNull (et NON `toString(x) != ''`) : `toString(NULL)` rend 'null' (non
  // vide) et ferait passer une propriété ABSENTE pour présente (faux positif
  // vérifié en prod : app_version « présente » sur 30k events alors qu'absente).
  ...CONTRACT_PROPERTIES.map((p) => ({
    key: p.name,
    onEvent: p.onEvent,
    cond:
      p.onEvent === "*"
        ? `isNotNull(properties.${p.name})`
        : `event = '${p.onEvent}' AND isNotNull(properties.${p.name})`,
    notYetEmitted: p.notYetEmitted === true,
  })),
];
const INSTRUMENTATION_PROP_COLUMNS = INSTRUMENTATION_PROP_PROBES.map(
  (p, i) => `    countIf(${p.cond}) AS p_${i}`,
).join(",\n");

/**
 * Jeu de requêtes HogQL construit PAR PROJET. `notInternal` (clause d'exclusion
 * des comptes internes — règle A4) et `internalMarker` (l'expression POSITIVE,
 * pour compter les exclus) sont injectés ici, en UN seul endroit : toute requête
 * exclut les internes, sauf `internalExcluded` qui les dénombre exprès.
 */
function buildQueries(notInternal: string, internalMarker: string) {
  return {
  /**
   * Série quotidienne : visiteurs uniques, inscriptions, abonnements. Bucketisée
   * sur le fuseau EUROPE/PARIS (et non UTC) : c'est le jour « métier » de l'équipe
   * et surtout la base des JOURS SOLO (attribution A3), où le jour de publication
   * (postDate à minuit UTC+1) DOIT coïncider avec le jour des inscriptions.
   */
  overview: `
SELECT toStartOfDay(timestamp, 'Europe/Paris') AS d,
       uniqIf(person_id, event = '$pageview') AS visitors,
       uniqIf(person_id, event = 'signup_completed') AS signups,
       uniqIf(person_id, event = 'subscription_completed') AS subs
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
GROUP BY d
ORDER BY d`,

  /**
   * Funnel GLOBAL — atteinte d'étape (personnes distinctes ayant réalisé chaque
   * étape), pas un funnel séquentiel strict : une étape peut donc dépasser la
   * précédente si le produit permet de la court-circuiter. L'UI le dit.
   */
  funnelGlobal: `
SELECT 'global' AS seg,${FUNNEL_COLUMNS}
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}`,

  /**
   * Funnel SÉQUENTIEL (chemin de monétisation) — sous-ensemble STRICT : l'étape k
   * ne compte que les personnes ayant franchi TOUTES les étapes amont. Monotone
   * PAR CONSTRUCTION (aucune étape ne peut dépasser la précédente) → c'est LUI qui
   * porte les taux de conversion. Diffère de l'atteinte brute (funnelGlobal) : les
   * abonnés sans checkout/paywall tracké n'y figurent pas — l'écart entre les deux
   * vues est justement l'information (ex. paiement sans checkout tracké).
   */
  funnelSequential: `
SELECT 'global' AS seg,
  countIf(b_visit) AS visit,
  countIf(b_visit AND b_signup) AS signup_completed,
  countIf(b_visit AND b_signup AND b_paywall) AS paywall_viewed,
  countIf(b_visit AND b_signup AND b_paywall AND b_checkout) AS checkout_started,
  countIf(b_visit AND b_signup AND b_paywall AND b_checkout AND b_sub) AS subscription_completed
FROM (
  SELECT person_id,
    countIf(event = '$pageview') > 0 AS b_visit,
    countIf(event = 'signup_completed') > 0 AS b_signup,
    countIf(event = 'paywall_viewed') > 0 AS b_paywall,
    countIf(event = 'checkout_started') > 0 AS b_checkout,
    countIf(event = 'subscription_completed') > 0 AS b_sub
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
  GROUP BY person_id
)`,

  funnelSource: `
SELECT ${segExpr("person.properties.source")} AS seg,${FUNNEL_COLUMNS}
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
GROUP BY seg
ORDER BY visit DESC
LIMIT ${SEGMENT_LIMIT}`,

  funnelLanguage: `
SELECT ${segExpr("person.properties.language")} AS seg,${FUNNEL_COLUMNS}
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
GROUP BY seg
ORDER BY visit DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * Délais médians/p90 (en secondes) entre les jalons d'activation, par personne.
   * Un delta n'entre dans le quantile que si les DEUX jalons existent pour la
   * personne ET que l'aval suit l'amont (delta > 0).
   *
   * ⚠️ Le garde-fou de PRÉSENCE (has_*) est indispensable : `minIf` rend l'epoch 0
   * (1970-01-01), et NON null, quand aucun event ne matche. Un jalon AMONT manquant
   * donnerait alors `dateDiff(1970, aujourd'hui)` ≈ 20 000 j — un delta faussement
   * POSITIF que le seul filtre `> 0` laisserait passer (il n'exclut que le jalon
   * AVAL manquant, qui rend un delta négatif). On gate donc chaque delta à NULL
   * hors des deux jalons présents, puis on conserve `> 0` pour l'ordre chronologique.
   */
  timeToValue: `
SELECT
  quantileIf(0.5)(d_signup_target, d_signup_target > 0) AS m_signup_target,
  quantileIf(0.9)(d_signup_target, d_signup_target > 0) AS p_signup_target,
  countIf(d_signup_target > 0) AS n_signup_target,
  quantileIf(0.5)(d_target_alert, d_target_alert > 0) AS m_target_alert,
  quantileIf(0.9)(d_target_alert, d_target_alert > 0) AS p_target_alert,
  countIf(d_target_alert > 0) AS n_target_alert,
  quantileIf(0.5)(d_alert_payment, d_alert_payment > 0) AS m_alert_payment,
  quantileIf(0.9)(d_alert_payment, d_alert_payment > 0) AS p_alert_payment,
  countIf(d_alert_payment > 0) AS n_alert_payment
FROM (
  SELECT
    if(has_signup > 0 AND has_target > 0, dateDiff('second', t_signup, t_target), NULL) AS d_signup_target,
    if(has_target > 0 AND has_alert > 0, dateDiff('second', t_target, t_alert), NULL) AS d_target_alert,
    if(has_alert > 0 AND has_sub > 0, dateDiff('second', t_alert, t_sub), NULL) AS d_alert_payment
  FROM (
    SELECT person_id,
      minIf(timestamp, event = 'signup_completed') AS t_signup,
      minIf(timestamp, event = 'target_added') AS t_target,
      minIf(timestamp, event = 'first_alert_received') AS t_alert,
      minIf(timestamp, event = 'subscription_completed') AS t_sub,
      countIf(event = 'signup_completed') AS has_signup,
      countIf(event = 'target_added') AS has_target,
      countIf(event = 'first_alert_received') AS has_alert,
      countIf(event = 'subscription_completed') AS has_sub
    FROM events
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
    GROUP BY person_id
  )
)`,

  /**
   * Conversion par variante de paywall : population = personnes ayant VU un
   * paywall ; variante = la DERNIÈRE vue (argMax) ; converti = a un
   * subscription_completed sur la fenêtre.
   */
  paywall: `
SELECT ${segExpr("variant")} AS seg, count() AS n, countIf(subscribed > 0) AS converted
FROM (
  SELECT person_id,
    argMaxIf(properties.variant, timestamp, event = 'paywall_viewed') AS variant,
    countIf(event = 'subscription_completed') AS subscribed,
    countIf(event = 'paywall_viewed') AS viewed
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
    AND event IN ('paywall_viewed', 'subscription_completed')
  GROUP BY person_id
)
WHERE viewed > 0
GROUP BY seg
ORDER BY n DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * Conversion par PAYWALL (paywall_id) — l'app a 6 paywalls mais `variant` n'en
   * distingue que 2. Tant que paywall_id n'est pas émis, tout tombe en '(inconnu)'
   * et la carte affiche un tiret (elle s'allumera seule quand la propriété arrivera).
   */
  paywallById: `
SELECT ${segExpr("paywall_id")} AS seg, count() AS n, countIf(subscribed > 0) AS converted
FROM (
  SELECT person_id,
    argMaxIf(properties.paywall_id, timestamp, event = 'paywall_viewed') AS paywall_id,
    countIf(event = 'subscription_completed') AS subscribed,
    countIf(event = 'paywall_viewed') AS viewed
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
    AND event IN ('paywall_viewed', 'subscription_completed')
  GROUP BY person_id
)
WHERE viewed > 0
GROUP BY seg
ORDER BY n DESC
LIMIT ${SEGMENT_LIMIT}`,

  /** Sources → inscrits / abonnés (une personne compte une fois par source). */
  sources: `
SELECT seg, countIf(signed > 0) AS signups, countIf(subbed > 0) AS subs
FROM (
  SELECT person_id, ${segExpr("person.properties.source")} AS seg,
    countIf(event = 'signup_completed') AS signed,
    countIf(event = 'subscription_completed') AS subbed
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
  GROUP BY person_id, seg
)
GROUP BY seg
HAVING signups > 0 OR subs > 0
ORDER BY signups DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * Rétention par cohorte HEBDO d'inscription, ventilée par comportement
   * (squad / nombre de cibles). « Retenu à S+k » = la personne a encore une
   * activité au moins k semaines après son inscription.
   */
  cohorts: `
SELECT
  toString(toStartOfWeek(t_signup)) AS cohort,
  segment,
  count() AS size,
  ${Array.from(
    { length: RETENTION_WEEKS },
    (_, k) => `countIf(weeks_span >= ${k}) AS w${k}`,
  ).join(",\n  ")}
FROM (
  SELECT person_id, t_signup, t_last,
    dateDiff('week', toStartOfWeek(t_signup), toStartOfWeek(t_last)) AS weeks_span,
    arrayJoin([
      if(squads > 0, 'squad', 'no_squad'),
      if(targets > 1, 'multi_target', 'single_target')
    ]) AS segment
  FROM (
    SELECT person_id,
      minIf(timestamp, event = 'signup_completed') AS t_signup,
      max(timestamp) AS t_last,
      countIf(event IN ('squad_created', 'squad_joined')) AS squads,
      countIf(event = 'target_added') AS targets
    FROM events
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
    GROUP BY person_id
    HAVING countIf(event = 'signup_completed') > 0
  )
)
GROUP BY cohort, segment
ORDER BY cohort DESC`,

  /**
   * Prédicteurs d'abonnement : pour chaque comportement, effectif et convertis,
   * plus la base globale (référence du facteur). Une seule ligne — l'UI la
   * découpe en lignes de comparaison.
   */
  predictors: `
SELECT
  count() AS total,
  countIf(subbed > 0) AS total_converted,
  countIf(squads > 0) AS n_squad,
  countIf(squads > 0 AND subbed > 0) AS c_squad,
  countIf(alerts >= 3) AS n_alerts_3,
  countIf(alerts >= 3 AND subbed > 0) AS c_alerts_3,
  countIf(targets >= 2) AS n_targets_2,
  countIf(targets >= 2 AND subbed > 0) AS c_targets_2,
  countIf(push > 0) AS n_push_enabled,
  countIf(push > 0 AND subbed > 0) AS c_push_enabled,
  countIf(referrals > 0) AS n_referral_shared,
  countIf(referrals > 0 AND subbed > 0) AS c_referral_shared
FROM (
  SELECT person_id,
    countIf(event = 'subscription_completed') AS subbed,
    countIf(event IN ('squad_created', 'squad_joined')) AS squads,
    countIf(event = 'first_alert_received') AS alerts,
    countIf(event = 'target_added') AS targets,
    countIf(event = 'push_enabled') AS push,
    countIf(event = 'referral_link_shared') AS referrals
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
  GROUP BY person_id
  HAVING countIf(event = 'signup_completed') > 0
)`,

  // ─── C1 — Contrat élargi : instrumentation + fiabilité checkout/scan/friction ─

  /** État d'instrumentation : personnes + première émission pour CHAQUE event. */
  instrumentation: `
SELECT
${INSTRUMENTATION_EVENT_COLUMNS},
${INSTRUMENTATION_PROP_COLUMNS}
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}`,

  /**
   * Fiabilité du checkout, par appareil (webview vs natif). Une personne = un
   * checkout ; `paid` a un subscription_completed, `divertedFree` bascule au
   * gratuit sans payer, `disappeared` ne fait plus rien. Délai checkout→paiement
   * en secondes (médiane/p90) chez ceux qui paient.
   */
  checkoutReliability: `
SELECT
  device,
  count() AS checkouts,
  sum(paid) AS paid,
  sum(diverted) AS diverted_free,
  sum(disappeared) AS disappeared,
  quantileIf(0.5)(pay_delay, pay_delay > 0) AS med_pay_s,
  quantileIf(0.9)(pay_delay, pay_delay > 0) AS p90_pay_s
FROM (
  SELECT
    device,
    if(paid_c > 0, 1, 0) AS paid,
    if(paid_c = 0 AND freed_c > 0, 1, 0) AS diverted,
    if(paid_c = 0 AND freed_c = 0, 1, 0) AS disappeared,
    if(paid_c > 0, pay_delay_c, 0) AS pay_delay
  FROM (
    SELECT person_id,
      multiIf(
        max(if(event = 'checkout_started' AND isNotNull(properties.is_webview), 1, 0)) = 0, 'inconnu',
        max(if(event = 'checkout_started' AND (properties.is_webview = true OR toString(properties.is_webview) = 'true'), 1, 0)) > 0, 'webview',
        'natif') AS device,
      countIf(event = 'subscription_completed') AS paid_c,
      countIf(event = 'free_tier_started') AS freed_c,
      dateDiff('second', minIf(timestamp, event = 'checkout_started'), minIf(timestamp, event = 'subscription_completed')) AS pay_delay_c
    FROM events
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
      AND event IN ('checkout_started', 'subscription_completed', 'free_tier_started')
    GROUP BY person_id
    HAVING countIf(event = 'checkout_started') > 0
  )
)
GROUP BY device
ORDER BY checkouts DESC`,

  /** Motifs d'échec de paiement (payment_failed groupé par `cause`). */
  checkoutCauses: `
SELECT coalesce(nullIf(toString(properties.cause), ''), '(sans cause)') AS cause,
       count() AS n
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
  AND event = 'payment_failed'
GROUP BY cause
ORDER BY n DESC
LIMIT ${SEGMENT_LIMIT}`,

  /** Résultats de recherche de compte (handle_search_result groupé par result). */
  searchResults: `
SELECT coalesce(nullIf(toString(properties.result), ''), '(sans result)') AS result,
       uniq(person_id) AS persons
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
  AND event = 'handle_search_result'
GROUP BY result
ORDER BY persons DESC
LIMIT ${SEGMENT_LIMIT}`,

  /** Fiabilité des scans (scan_completed groupé par mode × result). */
  scanReliability: `
SELECT coalesce(nullIf(toString(properties.mode), ''), '(sans mode)') AS mode,
       coalesce(nullIf(toString(properties.result), ''), '(sans result)') AS result,
       count() AS runs
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
  AND event = 'scan_completed'
GROUP BY mode, result
ORDER BY runs DESC
LIMIT 40`,

  /** Latence perçue des scans par tranche d'abonnés du compte scanné. */
  scanLatency: `
SELECT bucket,
       quantile(0.5)(dur) AS med_ms,
       quantile(0.9)(dur) AS p90_ms,
       count() AS n
FROM (
  SELECT
    multiIf(fc < 1000, '<1k', fc < 10000, '1k-10k', fc < 100000, '10k-100k', '100k+') AS bucket,
    multiIf(fc < 1000, 0, fc < 10000, 1, fc < 100000, 2, 3) AS bidx,
    dur
  FROM (
    SELECT toFloatOrZero(toString(properties.follower_count)) AS fc,
           toFloatOrNull(toString(properties.duration_ms)) AS dur
    FROM events
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
      AND event = 'scan_completed'
  )
  WHERE dur IS NOT NULL
)
GROUP BY bucket, bidx
ORDER BY bidx`,

  /** Points de friction : rageclicks distincts par page. */
  friction: `
SELECT coalesce(
         nullIf(toString(properties['$pathname']), ''),
         coalesce(nullIf(toString(properties['$current_url']), ''), '(sans page)')
       ) AS page,
       uniq(person_id) AS persons
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
  AND event = '$rageclick'
GROUP BY page
ORDER BY persons DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * B0a — activation produit par TYPE d'utilisateur : payant (a un abonnement),
   * gratuit (a démarré le plan gratuit sans payer), autre. Un target_added d'un
   * payant et d'un gratuit ne racontent pas la même chose → on les sépare.
   */
  activation: `
SELECT segment,
  count() AS persons,
  countIf(has_target > 0) AS target_added,
  countIf(has_alert > 0) AS first_alert,
  countIf(has_username > 0) AS username_entered
FROM (
  SELECT person_id,
    multiIf(countIf(event = 'subscription_completed') > 0, 'payant',
            countIf(event = 'free_tier_started') > 0, 'gratuit', 'autre') AS segment,
    countIf(event = 'target_added') AS has_target,
    countIf(event = 'first_alert_received') AS has_alert,
    countIf(event = 'username_entered') AS has_username
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
  GROUP BY person_id
)
GROUP BY segment
ORDER BY persons DESC`,

  /**
   * B3 — test A/B par variante de paywall. Variante = la DERNIÈRE vue (argMax).
   * Niveau intermédiaire (flags) pour éviter l'agrégat-dans-agrégat.
   */
  abVariants: `
SELECT variant,
  count() AS exposed,
  sum(is_checkout) AS checkouts,
  sum(is_paid) AS paid,
  sum(client_targets) AS client_targets
FROM (
  SELECT variant,
    if(checkout > 0, 1, 0) AS is_checkout,
    if(paid > 0, 1, 0) AS is_paid,
    if(paid > 0, targets, 0) AS client_targets
  FROM (
    SELECT person_id,
      coalesce(nullIf(toString(argMaxIf(properties.variant, timestamp, event = 'paywall_viewed')), ''), '(sans variante)') AS variant,
      countIf(event = 'paywall_viewed') AS viewed,
      countIf(event = 'checkout_started') AS checkout,
      countIf(event = 'subscription_completed') AS paid,
      countIf(event = 'target_added') AS targets
    FROM events
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
      AND event IN ('paywall_viewed', 'checkout_started', 'subscription_completed', 'target_added')
    GROUP BY person_id
    HAVING countIf(event = 'paywall_viewed') > 0
  )
)
GROUP BY variant
ORDER BY exposed DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * B3 — plan gratuit : usage réel (≥1 action produit), passage au payant, et
   * délai gratuit→checkout (signé : négatif = le checkout précédait le gratuit).
   */
  freePlan: `
SELECT
  count() AS signups,
  countIf(used > 0) AS used,
  countIf(paid > 0) AS converted_paid,
  countIf(checkout_before > 0) AS checkout_before,
  countIf(has_checkout > 0) AS n_delay,
  quantileIf(0.5)(free_to_checkout, has_checkout > 0) AS med_free_to_checkout_s
FROM (
  SELECT person_id,
    countIf(event = 'checkout_started') AS has_checkout,
    countIf(event = 'subscription_completed') AS paid,
    countIf(event IN ('handle_search_result', 'scan_completed', 'target_added')) AS used,
    if(countIf(event = 'checkout_started') > 0 AND minIf(timestamp, event = 'checkout_started') < minIf(timestamp, event = 'free_tier_started'), 1, 0) AS checkout_before,
    if(countIf(event = 'checkout_started') > 0, dateDiff('second', minIf(timestamp, event = 'free_tier_started'), minIf(timestamp, event = 'checkout_started')), NULL) AS free_to_checkout
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notInternal}
    AND event IN ('free_tier_started', 'checkout_started', 'subscription_completed', 'handle_search_result', 'scan_completed', 'target_added')
  GROUP BY person_id
  HAVING countIf(event = 'free_tier_started') > 0
)`,

  /**
   * Compteur A4 : personnes INTERNES (marqueur positif) vs total, sur la fenêtre.
   * SEULE requête sans exclusion — c'est elle qui dénombre les exclus.
   */
  internalExcluded: `
SELECT uniqIf(person_id, ${internalMarker}) AS internal,
       uniq(person_id) AS total
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY`,
  } as const;
}

// ─── Config projet ↔ PostHog (opérateur, via `npx convex run`) ───────────────

/**
 * Configure (ou retire) le mapping projet → projet PostHog. La CLÉ n'est PAS
 * passée ici (secret env) : seulement le NOM de sa variable d'env
 * (`apiKeyEnvVar`, défaut dérivé du slug). Exemple Snytch :
 *   1. npx convex env set POSTHOG_API_KEY_SNYTCH <clé perso PostHog>  (--prod pour la prod)
 *   2. npx convex run posthogSync:setPosthogConfigBySlug '{"slug":"snytch","posthogProjectId":"12345","host":"eu"}'
 * Retirer : '{"slug":"snytch","clear":true}'.
 */
export const setPosthogConfigBySlug = internalMutation({
  args: {
    slug: v.string(),
    posthogProjectId: v.optional(v.string()),
    host: v.optional(v.union(v.literal("eu"), v.literal("us"))),
    apiKeyEnvVar: v.optional(v.string()),
    clear: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { slug, posthogProjectId, host, apiKeyEnvVar, clear },
  ): Promise<{ updated: boolean; apiKeyEnvVar?: string }> => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!project) return { updated: false };
    if (clear) {
      await ctx.db.patch(project._id, { posthog: undefined });
      return { updated: true };
    }
    if (!posthogProjectId || posthogProjectId.trim() === "") {
      throw new Error(
        "posthogProjectId requis (l'ID numérique du projet PostHog) pour configurer PostHog.",
      );
    }
    const envVar =
      apiKeyEnvVar && apiKeyEnvVar.trim() !== ""
        ? apiKeyEnvVar.trim()
        : `POSTHOG_API_KEY_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    await ctx.db.patch(project._id, {
      posthog: {
        posthogProjectId: posthogProjectId.trim(),
        host: host ?? "eu",
        apiKeyEnvVar: envVar,
      },
    });
    return { updated: true, apiKeyEnvVar: envVar };
  },
});

// ─── Sync (cron + manuel) ────────────────────────────────────────────────────

type PosthogProjectConfig = {
  _id: Id<"projects">;
  slug: string;
  posthogProjectId: string;
  host: "eu" | "us";
  apiKeyEnvVar: string;
};

/** Projets configurés pour PostHog (config non secrète : NOM de la var d'env). */
export const listPosthogProjects = internalQuery({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<PosthogProjectConfig[]> => {
    const projects = projectId
      ? [await ctx.db.get(projectId)].filter(
          (p): p is Doc<"projects"> => p !== null,
        )
      : await ctx.db.query("projects").collect();
    return projects
      .filter((p) => p.posthog !== undefined)
      .map((p) => ({
        _id: p._id,
        slug: p.slug,
        posthogProjectId: p.posthog!.posthogProjectId,
        host: p.posthog!.host,
        apiKeyEnvVar: p.posthog!.apiKeyEnvVar,
      }));
  },
});

/**
 * Écrit les agrégats d'un projet. Une entrée EN ERREUR ne remplace pas la
 * dernière valeur connue : on ne patche que `error` + `computedAt` → l'UI peut
 * continuer à servir la donnée précédente en l'horodatant.
 */
export const upsertPosthogCache = internalMutation({
  args: {
    projectId: v.id("projects"),
    computedAt: v.number(),
    entries: v.array(
      v.object({
        key: v.string(),
        json: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { projectId, computedAt, entries }) => {
    for (const e of entries) {
      const existing = await ctx.db
        .query("posthogCache")
        .withIndex("by_project_key", (q) =>
          q.eq("projectId", projectId).eq("key", e.key),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("posthogCache", {
          projectId,
          key: e.key,
          json: e.json ?? "",
          computedAt,
          error: e.error,
        });
        continue;
      }
      await ctx.db.patch(existing._id, {
        // json conservé si la requête a échoué (dernière valeur connue).
        json: e.json ?? existing.json,
        computedAt,
        error: e.error,
      });
    }
    return { written: entries.length };
  },
});

export interface PosthogSyncSummary {
  ok: boolean;
  projectsSynced: number;
  aggregates: number;
  errors: string[];
}

/** Une entrée d'agrégat prête pour le cache. */
type CacheEntry = { key: string; json?: string; error?: string };

/**
 * Exécute une requête HogQL et façonne son résultat. Toute erreur est capturée
 * dans l'entrée (pas de throw) → les autres agrégats du projet aboutissent.
 */
async function collect<T>(
  key: string,
  apiKey: string,
  target: PosthogTarget,
  query: string,
  shape: (rows: unknown[][]) => T,
): Promise<CacheEntry> {
  const res = await runHogQL(apiKey, target, query);
  if (res.error !== null) return { key, error: res.error };
  try {
    return { key, json: JSON.stringify(shape(res.rows)) };
  } catch (e) {
    return { key, error: `shape: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Lignes de funnel (seg + 7 étapes) → segments. */
function shapeFunnel(rows: unknown[][]): FunnelPayload {
  return {
    segments: rows.map((r) => ({
      key: cellStr(r, 0),
      steps: FUNNEL_STEP_KEYS.map((k, i) => ({ key: k, count: cellNum(r, i + 1) })),
    })),
  };
}

/** Lignes (seg, n, converted) → lignes de conversion. */
function shapeConversion(rows: unknown[][]): ConversionPayload {
  return {
    rows: rows.map((r) => ({
      key: cellStr(r, 0),
      n: cellNum(r, 1),
      converted: cellNum(r, 2),
    })),
  };
}

// ─── C1 — Shapes du contrat élargi ───────────────────────────────────────────

/** Ligne unique → état par event du contrat + présence des propriétés sondées. */
function shapeInstrumentation(rows: unknown[][]): InstrumentationPayload {
  const r = rows[0] ?? [];
  const events = CONTRACT_EVENTS.map((e, i) => {
    const persons = cellNum(r, i * 2);
    // minIf rend l'epoch 0 (1970) si l'event n'a jamais matché → null si 0 pers.
    const firstSeenMs = persons > 0 ? cellTimeMs(r, i * 2 + 1) : null;
    return {
      name: e.name,
      category: e.category as string,
      persons,
      firstSeenMs,
      notYetEmitted: e.notYetEmitted === true,
      ...(e.note ? { note: e.note } : {}),
    };
  });
  const base = CONTRACT_EVENTS.length * 2;
  const props = INSTRUMENTATION_PROP_PROBES.map((p, i) => ({
    key: p.key,
    onEvent: p.onEvent,
    present: cellNum(r, base + i),
    notYetEmitted: p.notYetEmitted,
  }));
  return { events, props };
}

function shapeCheckoutReliability(rows: unknown[][]): CheckoutReliabilityPayload {
  return {
    rows: rows.map((r) => {
      const paid = cellNum(r, 2);
      const med = cellNum(r, 5);
      const p90 = cellNum(r, 6);
      return {
        device: cellStr(r, 0),
        checkouts: cellNum(r, 1),
        paid,
        divertedFree: cellNum(r, 3),
        disappeared: cellNum(r, 4),
        // Quantiles en SECONDES → ms. Pas de payeur ⇒ pas de délai (null, pas 0).
        medPayMs: paid > 0 && med > 0 ? med * 1000 : null,
        p90PayMs: paid > 0 && p90 > 0 ? p90 * 1000 : null,
      };
    }),
  };
}

/**
 * Sync horaire de TOUS les projets configurés (ou d'un seul, pour le bouton
 * « Actualiser »). Une clé d'env absente ⇒ projet SAUTÉ (log clair, pas de
 * throw) ; une requête en échec ⇒ agrégat marqué en erreur, les autres passent.
 */
export const runHourlySync = internalAction({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<PosthogSyncSummary> => {
    const projects: PosthogProjectConfig[] = await ctx.runQuery(
      internal.posthogSync.listPosthogProjects,
      { projectId },
    );
    const errors: string[] = [];
    let aggregates = 0;
    let projectsSynced = 0;

    for (const proj of projects) {
      const apiKey = process.env[proj.apiKeyEnvVar];
      if (!apiKey) {
        console.warn(
          `[posthog] ${proj.slug}: variable d'env ${proj.apiKeyEnvVar} absente — projet sauté.`,
        );
        errors.push(`${proj.slug}: missing-api-key`);
        continue;
      }
      const target: PosthogTarget = {
        posthogProjectId: proj.posthogProjectId,
        host: proj.host,
      };

      // A4 — requêtes construites AVEC l'exclusion interne de CE projet (une
      // seule source : convex/internalAccounts). `QUERIES` est donc local au
      // projet, pas un const de module.
      const internalCfg = internalAccountsFor(proj.slug);
      const QUERIES = buildQueries(
        notInternalClause(internalCfg),
        internalMarkerHogQL(internalCfg),
      );

      const entries: CacheEntry[] = [
        await collect(
          POSTHOG_CACHE_KEYS.overview,
          apiKey,
          target,
          QUERIES.overview,
          (rows): OverviewPayload => ({
            daily: rows
              .map((r) => ({
                ts: cellTimeMs(r, 0),
                visitors: cellNum(r, 1),
                signups: cellNum(r, 2),
                subs: cellNum(r, 3),
              }))
              .filter((d): d is OverviewPayload["daily"][number] => d.ts !== null),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.funnelGlobal,
          apiKey,
          target,
          QUERIES.funnelGlobal,
          shapeFunnel,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.funnelSequential,
          apiKey,
          target,
          QUERIES.funnelSequential,
          shapeFunnel,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.funnelSource,
          apiKey,
          target,
          QUERIES.funnelSource,
          shapeFunnel,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.funnelLanguage,
          apiKey,
          target,
          QUERIES.funnelLanguage,
          shapeFunnel,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.timeToValue,
          apiKey,
          target,
          QUERIES.timeToValue,
          (rows): TimeToValuePayload => {
            const r = rows[0] ?? [];
            return {
              steps: TTV_STEP_KEYS.map((k, i) => {
                const median = cellNum(r, i * 3);
                const p90 = cellNum(r, i * 3 + 1);
                const n = cellNum(r, i * 3 + 2);
                // Quantiles rendus en SECONDES par HogQL → ms. n = 0 ⇒ pas de
                // mesure (et non « 0 seconde »).
                return {
                  key: k,
                  medianMs: n > 0 ? median * 1000 : null,
                  p90Ms: n > 0 ? p90 * 1000 : null,
                  n,
                };
              }),
            };
          },
        ),
        await collect(
          POSTHOG_CACHE_KEYS.paywall,
          apiKey,
          target,
          QUERIES.paywall,
          shapeConversion,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.paywallById,
          apiKey,
          target,
          QUERIES.paywallById,
          shapeConversion,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.sources,
          apiKey,
          target,
          QUERIES.sources,
          (rows): ConversionPayload => ({
            // n = inscrits, converted = abonnés → taux d'abonnement par source.
            rows: rows.map((r) => ({
              key: cellStr(r, 0),
              n: cellNum(r, 1),
              converted: cellNum(r, 2),
            })),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.cohorts,
          apiKey,
          target,
          QUERIES.cohorts,
          (rows): CohortsPayload => {
            const bySegment = new Map<
              string,
              { cohort: string; size: number; retainedByWeek: number[] }[]
            >();
            for (const r of rows) {
              const cohort = cellStr(r, 0);
              const segment = cellStr(r, 1);
              const size = cellNum(r, 2);
              const retainedByWeek = Array.from(
                { length: RETENTION_WEEKS },
                (_, k) => cellNum(r, 3 + k),
              );
              const list = bySegment.get(segment) ?? [];
              list.push({ cohort, size, retainedByWeek });
              bySegment.set(segment, list);
            }
            return {
              segments: [...bySegment.entries()].map(([key, cohorts]) => ({
                key,
                cohorts,
              })),
            };
          },
        ),
        await collect(
          POSTHOG_CACHE_KEYS.predictors,
          apiKey,
          target,
          QUERIES.predictors,
          (rows): PredictorsPayload => {
            const r = rows[0] ?? [];
            return {
              total: cellNum(r, 0),
              totalConverted: cellNum(r, 1),
              behaviors: PREDICTOR_KEYS.map((k, i) => ({
                key: k,
                n: cellNum(r, 2 + i * 2),
                converted: cellNum(r, 3 + i * 2),
              })),
            };
          },
        ),
        await collect(
          POSTHOG_CACHE_KEYS.instrumentation,
          apiKey,
          target,
          QUERIES.instrumentation,
          shapeInstrumentation,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.checkoutReliability,
          apiKey,
          target,
          QUERIES.checkoutReliability,
          shapeCheckoutReliability,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.checkoutCauses,
          apiKey,
          target,
          QUERIES.checkoutCauses,
          (rows): CheckoutCausesPayload => ({
            rows: rows.map((r) => ({ cause: cellStr(r, 0), n: cellNum(r, 1) })),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.searchResults,
          apiKey,
          target,
          QUERIES.searchResults,
          (rows): SearchResultsPayload => ({
            rows: rows.map((r) => ({ result: cellStr(r, 0), persons: cellNum(r, 1) })),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.scanReliability,
          apiKey,
          target,
          QUERIES.scanReliability,
          (rows): ScanReliabilityPayload => ({
            rows: rows.map((r) => ({
              mode: cellStr(r, 0),
              result: cellStr(r, 1),
              runs: cellNum(r, 2),
            })),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.scanLatency,
          apiKey,
          target,
          QUERIES.scanLatency,
          (rows): ScanLatencyPayload => ({
            rows: rows.map((r) => {
              const n = cellNum(r, 3);
              return {
                bucket: cellStr(r, 0),
                // duration_ms déjà en ms. n = 0 ⇒ pas de mesure (null, pas 0).
                medianMs: n > 0 ? cellNum(r, 1) : null,
                p90Ms: n > 0 ? cellNum(r, 2) : null,
                n,
              };
            }),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.friction,
          apiKey,
          target,
          QUERIES.friction,
          (rows): FrictionPayload => ({
            rows: rows.map((r) => ({ page: cellStr(r, 0), persons: cellNum(r, 1) })),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.activation,
          apiKey,
          target,
          QUERIES.activation,
          (rows): ActivationPayload => ({
            rows: rows.map((r) => ({
              segment: cellStr(r, 0),
              persons: cellNum(r, 1),
              targetAdded: cellNum(r, 2),
              firstAlert: cellNum(r, 3),
              usernameEntered: cellNum(r, 4),
            })),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.abVariants,
          apiKey,
          target,
          QUERIES.abVariants,
          (rows): AbVariantsPayload => ({
            rows: rows.map((r) => ({
              variant: cellStr(r, 0),
              exposed: cellNum(r, 1),
              checkouts: cellNum(r, 2),
              paid: cellNum(r, 3),
              clientTargets: cellNum(r, 4),
            })),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.freePlan,
          apiKey,
          target,
          QUERIES.freePlan,
          (rows): FreePlanPayload => {
            const r = rows[0] ?? [];
            const nDelay = cellNum(r, 4);
            return {
              signups: cellNum(r, 0),
              used: cellNum(r, 1),
              convertedPaid: cellNum(r, 2),
              checkoutBefore: cellNum(r, 3),
              // délai en SECONDES (signé) → ms. Pas de free-user avec checkout ⇒ null.
              medFreeToCheckoutMs: nDelay > 0 ? cellNum(r, 5) * 1000 : null,
            };
          },
        ),
        await collect(
          POSTHOG_CACHE_KEYS.internalExcluded,
          apiKey,
          target,
          QUERIES.internalExcluded,
          (rows): InternalExcludedPayload => {
            const r = rows[0] ?? [];
            return { persons: cellNum(r, 0), totalPersons: cellNum(r, 1) };
          },
        ),
      ];

      await ctx.runMutation(internal.posthogSync.upsertPosthogCache, {
        projectId: proj._id,
        computedAt: Date.now(),
        entries,
      });
      projectsSynced += 1;
      aggregates += entries.filter((e) => e.error === undefined).length;
      for (const e of entries) {
        if (e.error) errors.push(`${proj.slug}/${e.key}: ${e.error}`);
      }
    }

    return { ok: errors.length === 0, projectsSynced, aggregates, errors };
  },
});

/**
 * Bouton « Actualiser » — replanifie la sync POUR CE PROJET. Court-circuit si le
 * projet n'a pas de config PostHog (aucun appel API).
 */
export const requestPosthogSync = adminMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: boolean; reason?: string }> => {
    const project = await ctx.db.get(ctx.projectId);
    if (!project?.posthog) return { scheduled: false, reason: "not-configured" };
    await ctx.scheduler.runAfter(0, internal.posthogSync.runHourlySync, {
      projectId: ctx.projectId,
    });
    return { scheduled: true };
  },
});

/**
 * Purge des clés de cache ORPHELINES — une row posthogCache dont la `key` n'est
 * plus dans POSTHOG_CACHE_KEYS (ex. `attributionHourly` retirée en C5, jamais
 * réécrite mais persistante). À lancer une fois via `npx convex run --prod
 * posthogSync:purgeStalePosthogCache '{}'`. Idempotent (rien à supprimer = []).
 */
export const purgeStalePosthogCache = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: string[] }> => {
    const valid = new Set<string>(Object.values(POSTHOG_CACHE_KEYS));
    const rows = await ctx.db.query("posthogCache").collect();
    const deleted: string[] = [];
    for (const r of rows) {
      if (!valid.has(r.key)) {
        await ctx.db.delete(r._id);
        deleted.push(r.key);
      }
    }
    return { deleted };
  },
});

// ─── Lecture (UI) — CACHE UNIQUEMENT ─────────────────────────────────────────

function safeParse<T>(json: string, fallback: T): T {
  if (json === "") return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export interface ProductAnalytics {
  /** false ⇒ projet sans config PostHog : la section affiche « non configuré ». */
  configured: boolean;
  /** Horodatage du dernier passage de sync (null = jamais synchronisé). */
  computedAt: number | null;
  /** Erreurs de la dernière sync, par clé d'agrégat (affichage discret). */
  errors: { key: string; message: string }[];
  overview: OverviewPayload;
  funnels: {
    /** Atteinte BRUTE par étape (peut être non monotone — information). */
    global: FunnelPayload;
    /** Chemin séquentiel strict (monotone) — porte les taux de conversion. */
    sequential: FunnelPayload;
    source: FunnelPayload;
    language: FunnelPayload;
  };
  timeToValue: TimeToValuePayload;
  paywall: ConversionPayload;
  /** Conversion par paywall_id (vide/'(inconnu)' tant que paywall_id n'est pas émis). */
  paywallById: ConversionPayload;
  sources: ConversionPayload;
  cohorts: CohortsPayload;
  predictors: PredictorsPayload;
  // ─── C1 — Contrat élargi (phase B) ─────────────────────────────────────────
  instrumentation: InstrumentationPayload;
  checkoutReliability: CheckoutReliabilityPayload;
  checkoutCauses: CheckoutCausesPayload;
  searchResults: SearchResultsPayload;
  scanReliability: ScanReliabilityPayload;
  scanLatency: ScanLatencyPayload;
  friction: FrictionPayload;
  /** A4 — personnes internes exclues de tous les agrégats ci-dessus (compteur). */
  internalExcluded: InternalExcludedPayload;
  /** B0a — activation par type d'utilisateur. */
  activation: ActivationPayload;
  /** B3 — test A/B par variante de paywall. */
  abVariants: AbVariantsPayload;
  /** B3 — plan gratuit. */
  freePlan: FreePlanPayload;
}

const EMPTY_FUNNEL: FunnelPayload = { segments: [] };
const EMPTY_CONVERSION: ConversionPayload = { rows: [] };
const EMPTY_INSTRUMENTATION: InstrumentationPayload = { events: [], props: [] };
const EMPTY_INTERNAL_EXCLUDED: InternalExcludedPayload = {
  persons: 0,
  totalPersons: 0,
};

/**
 * Agrégats PostHog du projet, servis DEPUIS LE CACHE (jamais d'appel API dans le
 * rendu). Un projet non configuré rend `configured:false` et des payloads vides
 * → chaque carte bascule sur son état vide sans jamais afficher un 0 trompeur.
 */
export const getProductAnalytics = adminQuery({
  args: {},
  handler: async (ctx): Promise<ProductAnalytics> => {
    const project = await ctx.db.get(ctx.projectId);
    const empty: ProductAnalytics = {
      configured: project?.posthog !== undefined,
      computedAt: null,
      errors: [],
      overview: { daily: [] },
      funnels: {
        global: EMPTY_FUNNEL,
        sequential: EMPTY_FUNNEL,
        source: EMPTY_FUNNEL,
        language: EMPTY_FUNNEL,
      },
      timeToValue: { steps: [] },
      paywall: EMPTY_CONVERSION,
      paywallById: EMPTY_CONVERSION,
      sources: EMPTY_CONVERSION,
      cohorts: { segments: [] },
      predictors: { total: 0, totalConverted: 0, behaviors: [] },
      instrumentation: EMPTY_INSTRUMENTATION,
      checkoutReliability: { rows: [] },
      checkoutCauses: { rows: [] },
      searchResults: { rows: [] },
      scanReliability: { rows: [] },
      scanLatency: { rows: [] },
      friction: { rows: [] },
      internalExcluded: EMPTY_INTERNAL_EXCLUDED,
      activation: { rows: [] },
      abVariants: { rows: [] },
      freePlan: {
        signups: 0,
        used: 0,
        convertedPaid: 0,
        checkoutBefore: 0,
        medFreeToCheckoutMs: null,
      },
    };
    if (!empty.configured) return empty;

    const rows = await ctx.db
      .query("posthogCache")
      .withIndex("by_project_key", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const read = <T,>(key: string, fallback: T): T => {
      const row = byKey.get(key);
      return row ? safeParse<T>(row.json, fallback) : fallback;
    };

    return {
      configured: true,
      computedAt:
        rows.length > 0 ? Math.max(...rows.map((r) => r.computedAt)) : null,
      errors: rows
        .filter((r) => r.error !== undefined)
        .map((r) => ({ key: r.key, message: r.error! })),
      overview: read(POSTHOG_CACHE_KEYS.overview, empty.overview),
      funnels: {
        global: read(POSTHOG_CACHE_KEYS.funnelGlobal, EMPTY_FUNNEL),
        sequential: read(POSTHOG_CACHE_KEYS.funnelSequential, EMPTY_FUNNEL),
        source: read(POSTHOG_CACHE_KEYS.funnelSource, EMPTY_FUNNEL),
        language: read(POSTHOG_CACHE_KEYS.funnelLanguage, EMPTY_FUNNEL),
      },
      timeToValue: read(POSTHOG_CACHE_KEYS.timeToValue, empty.timeToValue),
      paywall: read(POSTHOG_CACHE_KEYS.paywall, EMPTY_CONVERSION),
      paywallById: read(POSTHOG_CACHE_KEYS.paywallById, EMPTY_CONVERSION),
      sources: read(POSTHOG_CACHE_KEYS.sources, EMPTY_CONVERSION),
      cohorts: read(POSTHOG_CACHE_KEYS.cohorts, empty.cohorts),
      predictors: read(POSTHOG_CACHE_KEYS.predictors, empty.predictors),
      instrumentation: read(
        POSTHOG_CACHE_KEYS.instrumentation,
        EMPTY_INSTRUMENTATION,
      ),
      checkoutReliability: read(POSTHOG_CACHE_KEYS.checkoutReliability, {
        rows: [],
      }),
      checkoutCauses: read(POSTHOG_CACHE_KEYS.checkoutCauses, { rows: [] }),
      searchResults: read(POSTHOG_CACHE_KEYS.searchResults, { rows: [] }),
      scanReliability: read(POSTHOG_CACHE_KEYS.scanReliability, { rows: [] }),
      scanLatency: read(POSTHOG_CACHE_KEYS.scanLatency, { rows: [] }),
      friction: read(POSTHOG_CACHE_KEYS.friction, { rows: [] }),
      internalExcluded: read(
        POSTHOG_CACHE_KEYS.internalExcluded,
        EMPTY_INTERNAL_EXCLUDED,
      ),
      activation: read(POSTHOG_CACHE_KEYS.activation, { rows: [] }),
      abVariants: read(POSTHOG_CACHE_KEYS.abVariants, { rows: [] }),
      freePlan: read(POSTHOG_CACHE_KEYS.freePlan, empty.freePlan),
    };
  },
});

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
  cellStrArr,
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
  notForcedExperimentClause,
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

/**
 * DOUBLE ÉMISSION client + serveur — déduplication de LECTURE.
 *
 * Depuis le lot d'instrumentation serveur de l'app (semaine du 02/08/2026),
 * `target_added` part DEUX FOIS pour un seul ajout de cible : une copie serveur
 * (`server_side='true'`, porteuse de `slot_type`) puis une copie client ~0,1 s
 * après. Les deux ne partagent PAS d'`$insert_id` (la copie serveur n'en a pas)
 * → la déduplication native de PostHog ne joue pas. Mesuré en prod le 22/08 :
 * 339 events post-rupture pour 173 copies serveur et 166 copies client, chaque
 * copie client ayant son jumeau serveur. Conséquence : tout compteur de
 * MAGNITUDE valait le double (la carte affichait 1,85 cible/client pour 0,93).
 *
 * `dedupedCount` garde la copie SERVEUR quand elle existe pour cette personne,
 * et retombe sur le comptage brut sinon — ce qui préserve l'historique
 * ANTÉRIEUR au 02/08 (100 % client, aucune copie serveur) et survivra au jour
 * où l'app retirera la copie client.
 *
 * ⚠️ NE PAS l'appliquer à un test de PRÉSENCE (`countIf(...) > 0`) : il est
 * insensible au doublon, et le filtrer ne ferait que perdre de l'historique.
 * ⚠️ NE PAS l'appliquer à `target_removed` : sa copie serveur est INCOMPLÈTE
 * (18 serveur pour 48 client sur la semaine du 16/08) — dédupliquer y
 * supprimerait des faits réels.
 */
const SERVER_COPY = `toString(properties.server_side) = 'true'`;

/**
 * Compte les occurrences d'un event en neutralisant la double émission.
 * `extra` ajoute une condition (ex. une borne de fenêtre) aux deux branches.
 */
function dedupedCount(event: string, extra = ""): string {
  const srv = `event = '${event}' AND ${SERVER_COPY}${extra}`;
  const all = `event = '${event}'${extra}`;
  return `if(countIf(${srv}) > 0, countIf(${srv}), countIf(${all}))`;
}

/**
 * Idem pour un tableau d'horodatages (`groupArrayIf`) : la branche serveur si
 * elle existe pour cette personne, le tableau brut sinon.
 */
function dedupedTimestamps(event: string, extra = ""): string {
  const srv = `event = '${event}' AND ${SERVER_COPY}${extra}`;
  const all = `event = '${event}'${extra}`;
  return `if(countIf(${srv}) > 0, groupArrayIf(timestamp, ${srv}), groupArrayIf(timestamp, ${all}))`;
}

/**
 * EXPÉRIENCE COURANTE — les requêtes d'A/B test se bornent à l'`experiment_id`
 * le plus récent, pas à « toute émission d'`experiment_variant` sur 90 jours ».
 * Sans cette borne, une personne passée de `paywall_ab_2026_08` à `…_v2` (les
 * bras sont RE-TIRÉS à chaque nouvelle expérience) comptait comme instable :
 * mesuré en prod le 22/08, 52 personnes écartées dont ~24 par ce seul artefact.
 * Le début de fenêtre affiché par la carte devient celui de l'expérience EN
 * COURS (2026-08-08 10:18:56) au lieu de celui de la précédente (03/08 15:02).
 */
const AB_EXPERIMENT_CTE = `(SELECT argMax(toString(properties.experiment_id), timestamp) FROM events
      WHERE isNotNull(properties.experiment_id)
        AND timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY) AS ab_exp,
     (SELECT min(timestamp) FROM events
      WHERE toString(properties.experiment_id) = ab_exp
        AND timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY) AS ab_start`;

/** Vrai si l'event porte un bras DE L'EXPÉRIENCE COURANTE. */
const AB_ARMED = `isNotNull(properties.experiment_variant) AND toString(properties.experiment_id) = ab_exp`;

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
  frictionByStep: "frictionByStep",
  firstSearchAfterPay: "firstSearchAfterPay",
  scanCost: "scanCost",
  // ─── C2 — Compteur A4 (personnes internes exclues) ─────────────────────────
  internalExcluded: "internalExcluded",
  // ─── Phase B — agrégats des nouveaux onglets ──────────────────────────────
  activation: "activation",
  abVariants: "abVariants",
  abArms: "abArms",
  abPersonArms: "abPersonArms",
  abFlippers: "abFlippers",
  freePlan: "freePlan",
  // ─── Réconciliation clients PostHog ↔ Whop par membership_id ──────────────
  subsByMembership: "subsByMembership",
} as const;

// ─── Formes des agrégats cachés ──────────────────────────────────────────────

/**
 * Un `subscription_completed` NON-renouvellement par (jour Paris, membership_id)
 * — la matière du contrôle croisé « Clients/jour PostHog vs Whop ». Depuis le
 * 28/07 l'event porte `membership_id` : on peut donc APPARIER chaque sub au
 * jour du 1er paiement Whop du même membership au lieu de comparer deux
 * agrégats que rien ne relie. `membership_id` vide = event antérieur à la
 * bascule d'instrumentation (ou schéma non respecté) → inappariable.
 */
export interface SubsByMembershipPayload {
  rows: { day: string; membershipId: string; persons: number }[];
}

export interface OverviewPayload {
  daily: {
    ts: number;
    visitors: number;
    signups: number;
    /** Personnes ayant ouvert le checkout ce jour-là (colonne « Détail par jour »). */
    checkouts: number;
    subs: number;
  }[];
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
  /**
   * Début de la fenêtre analysée (ms), quand l'agrégat est ANCRÉ sur la première
   * émission de sa propriété plutôt que sur les 90 jours (cf. paywallById). null
   * = fenêtre standard. L'UI l'affiche : un taux calculé sur une fenêtre
   * différente de celle annoncée est un chiffre faux.
   */
  startMs?: number | null;
}
/**
 * TEST A/B par BRAS — une ligne par valeur d'`experiment_variant`. Sessions à
 * bras FORCÉ exclues (elles ne sont pas du trafic : les compter fausserait
 * autant la répartition que les taux). Fenêtre ancrée sur la première émission
 * de la propriété, pas sur les 90 jours.
 */
export interface AbArmsPayload {
  rows: {
    variant: string;
    /**
     * Personnes ASSIGNÉES au bras (assignation naturelle). C'est l'unité de
     * randomisation, pas une exposition au paywall : la moitié d'entre elles
     * n'en verra jamais. Dénominateur des taux « par assigné » (intention de
     * traiter), JAMAIS d'un taux de complétion.
     */
    exposed: number;
    /** Sous-ensemble d'`exposed` ayant réellement VU un paywall. */
    paywallViewers: number;
    /** Personnes ayant ouvert un checkout. */
    checkouts: number;
    /**
     * NOUVEAUX clients : personnes dont le PREMIER `subscription_completed` de
     * la fenêtre 90 j tombe après le début du test. Un renouvellement n'est pas
     * une conversion — l'event est émis à chaque cycle, côté serveur.
     */
    paid: number;
    /** Personnes payantes du bras dont l'abonnement PRÉCÈDE le test (renouvellements). */
    renewals: number;
    /**
     * Nouveaux clients SANS `checkout_started` — le numérateur de la complétion
     * n'est alors pas un sous-ensemble de son dénominateur (garde-fou de carte).
     */
    paidWithoutCheckout: number;
    /** Cibles ajoutées par les nouveaux clients APRÈS leur paiement (= cibles payantes). */
    clientTargets: number;
    /**
     * Cibles ajoutées par TOUT le bras (payants ou non). Sert uniquement à savoir
     * si `target_added` est instrumenté ici : 0 sur tout un bras ⇒ le ratio par
     * client n'est pas mesurable, il ne vaut pas « zéro cible ».
     */
    armTargets: number;
    /**
     * Personnes ÉCARTÉES de toutes les colonnes ci-dessus faute de bras stable
     * (deux valeurs d'`experiment_variant` sur la même personne), rangées sous
     * leur dernier bras. Compteur VISIBLE : une exclusion silencieuse se lit
     * comme un bras qui recrute mal.
     */
    excludedFlippers: number;
    /**
     * Sous-total des flippers vus sur PLUSIEURS `$device_id` : c'est la fusion
     * d'identités PostHog (un même humain sur deux navigateurs, chacun tiré de
     * son côté), attendue et non actionnable côté app.
     */
    excludedFlippersMultiDevice: number;
    /**
     * Sous-total des flippers vus sur UN SEUL `$device_id` : là, l'app a
     * re-tiré le bras d'une personne déjà assignée. C'est le SEUL signal d'un
     * défaut applicatif — un total agrégé ne permet pas de le distinguer.
     */
    excludedFlippersSameDevice: number;
  }[];
  /**
   * Début de la fenêtre = 1re émission de l'`experiment_id` COURANT (ms). Ce
   * n'est PAS la 1re émission d'`experiment_variant` tous tests confondus : une
   * expérience précédente décalerait la borne vers le passé et ferait entrer sa
   * cohorte dans les colonnes de celle-ci.
   */
  startMs: number | null;
}

/**
 * `distinct_id` des personnes à bras INSTABLE, pour appliquer la garde
 * anti-flipper sur les DEUX voies de rattachement (cf convex/abAttribution.ts).
 * Liste plate : le test est une APPARTENANCE, pas une jointure.
 */
export interface AbFlippersPayload {
  distinctIds: string[];
}

/**
 * Recale une charge `abArms` lue du cache sur la forme COURANTE. Un cache écrit
 * par la version précédente n'a ni `paywallViewers`, ni `renewals`, ni la
 * séparation cibles-du-bras / cibles-des-clients : on rend 0 au lieu de laisser
 * passer un `undefined` qui deviendrait NaN à l'écran.
 *
 * Fenêtre de transition ≤ 1 h (le cron horaire réécrit la charge complète) :
 * pendant ce temps les nouvelles colonnes sont à 0 et le garde-fou de la carte
 * peut signaler « colonnes non emboîtées ». C'est assumé — un contrôle qui
 * s'allume à tort se voit et se résorbe seul, un NaN se lit comme un chiffre.
 */
export function normalizeAbArms(payload: AbArmsPayload): AbArmsPayload {
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    startMs: payload.startMs,
    rows: payload.rows.map((r) => ({
      variant: r.variant,
      exposed: num(r.exposed),
      paywallViewers: num(r.paywallViewers),
      checkouts: num(r.checkouts),
      paid: num(r.paid),
      renewals: num(r.renewals),
      paidWithoutCheckout: num(r.paidWithoutCheckout),
      clientTargets: num(r.clientTargets),
      armTargets: num(r.armTargets),
      excludedFlippers: num(r.excludedFlippers),
      excludedFlippersMultiDevice: num(r.excludedFlippersMultiDevice),
      excludedFlippersSameDevice: num(r.excludedFlippersSameDevice),
    })),
  };
}

/**
 * Table `distinct_id → bras` — VOIE DE REPLI du rattachement revenu ↔ bras.
 * La voie primaire est `metadata.abVariant` sur le membership Whop ; ce repli
 * sert aux abonnements qui n'en portent pas, et sert surtout à DÉTECTER une
 * divergence entre les deux sources (un rattachement silencieusement faux est
 * pire qu'un rattachement absent).
 * Volume borné : une ligne par personne assignée, quelques dizaines.
 */
export interface AbPersonArmsPayload {
  rows: { distinctId: string; variant: string }[];
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
    /** Non payeurs restés sans suite APRÈS un échec de paiement (sous-ensemble de disparus). */
    failedPayment: number;
    /** Non payeurs disparus SANS aucune tentative de paiement. */
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

/**
 * Fiabilité des scans (scan_completed groupé par déclenchement × mode × result).
 * `reason` = baseline / scheduled_light / scheduled_full / manual_refresh (émis
 * server-side depuis le 28/07). scheduled_full détecte les désabonnements.
 */
export interface ScanReliabilityPayload {
  rows: { reason: string; mode: string; result: string; runs: number }[];
}

/** Latence perçue des scans par tranche d'abonnés du compte scanné. */
export interface ScanLatencyPayload {
  rows: { bucket: string; medianMs: number | null; p90Ms: number | null; n: number }[];
}

/**
 * Coût d'infrastructure des scans, ventilé LÉGER vs COMPLET (cost_usd, en $). Une
 * cible gratuite ne déclenche QUE des scans légers → son coût est le tarif léger,
 * pas le tarif complet, et il est en dollars, pas en euros. `withCost` = scans
 * portant un cost_usd exploitable : si 0, l'app n'émet pas encore le coût et la
 * carte le dit au lieu d'inventer un chiffre.
 */
export interface ScanCostPayload {
  rows: {
    kind: string;
    runs: number;
    withCost: number;
    sumCostUsd: number;
    avgCostUsd: number | null;
  }[];
}

/** Points de friction : rageclicks par page. */
export interface FrictionPayload {
  rows: { page: string; persons: number }[];
}

/**
 * Ventilation des rageclicks d'onboarding par ÉTAPE (onboarding_step). En attente
 * de l'émission côté app : tout tombe en '(inconnu)' tant que la propriété n'est
 * pas envoyée. La carte s'allume d'elle-même le jour où le numéro d'étape arrive.
 */
export interface FrictionByStepPayload {
  rows: { step: string; persons: number }[];
}

/** Compteur A4 : personnes internes exclues (marqueur is_internal / handles). */
export interface InternalExcludedPayload {
  persons: number;
  totalPersons: number;
}

/** B0a — activation produit par TYPE d'inscrit (payant / gratuit / sans accès). */
export interface ActivationPayload {
  rows: {
    segment: string;
    /** 1 = inscrit le 28/07 ou après (période où les trois groupes sont comparables). */
    recent: number;
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
  /**
   * Personnes ayant REÇU la semaine offerte (`free_tier_started`). Ce n'est PAS
   * « ont choisi le gratuit » : l'event marque un octroi, émis aussi sur le
   * chemin des payants (cf QUERIES.freePlan).
   */
  signups: number;
  /** A fait ≥ 1 action produit (recherche / scan / cible). */
  used: number;
  /** Passés au payant (subscription_completed). */
  convertedPaid: number;
}

/**
 * La demande la plus importante : que vit un client à sa PREMIÈRE recherche
 * après paiement. Le paywall bloque la recherche AVANT paiement, donc le
 * premier `handle_search_result` d'un payant EST déjà sa recherche post-accès
 * (pas de fenêtre à calculer). Par personne payante : résultat de cette 1re
 * recherche + délai paiement→recherche. La ventilation dit combien tombent sur
 * un résultat exploitable (`found`) vs un mur (private / not_found / error).
 *
 * PAS mesurable ici : le taux de résiliation dans l'heure qui suit un échec.
 * `subscription_cancelled` n'est émis que pour 3 personnes (les vraies
 * résiliations vivent côté Whop, non rattachables à la personne PostHog). Le
 * champ `cancelJoinable` porte ce compte pour que la carte le dise au lieu de
 * bâtir un taux sur 3 cas. Voir [[churn-and-acquisition-bonus]].
 */
export interface FirstSearchAfterPayPayload {
  /** Payants MESURABLES : 1er paiement >= instr_start (recherche instrumentée). */
  paid: number;
  /** Payants EXCLUS : payés avant l'instrumentation → recherche non mesurable. */
  paidExcluded: number;
  /** Début d'instrumentation (1er handle_search_result), ms epoch. null si aucun. */
  instrStartMs: number | null;
  /** …payants mesurables avec au moins une recherche après paiement. */
  searched: number;
  /** Ventilation du résultat de la 1re recherche (exploitable = `found`). */
  results: { result: string; persons: number }[];
  /** Délai paiement→1re recherche, secondes. null si aucun couple valide. */
  medDelaySec: number | null;
  p90DelaySec: number | null;
  /** Payants rattachables à un subscription_cancelled (mesure la faisabilité, pas un taux). */
  cancelJoinable: number;
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
 * Jeu de requêtes HogQL construit PAR PROJET. `notCounted` (clauses d'exclusion
 * cumulées : comptes internes — règle A4 — ET sessions à bras d'A/B forcé) et
 * `internalMarker` (l'expression POSITIVE, pour compter les exclus) sont injectés
 * ici, en UN seul endroit : toute requête écarte les deux, sauf `internalExcluded`
 * qui dénombre les internes exprès.
 *
 * `internalMarker` ne couvre QUE les internes : le compteur « comptes internes
 * exclus » resterait honnête si on y ajoutait les sessions forcées, il mentirait
 * sur ce qu'il compte.
 */
export function buildQueries(notCounted: string, internalMarker: string) {
  return {
  /**
   * Série quotidienne : visiteurs uniques, inscriptions, abonnements. Bucketisée
   * sur le fuseau EUROPE/PARIS (et non UTC) : c'est le jour « métier » de l'équipe
   * et surtout la base des JOURS SOLO (attribution A3), où le jour de publication
   * (postDate à minuit UTC+1) DOIT coïncider avec le jour des inscriptions.
   *
   * `subs` = NOUVEAUX abonnés seulement. `subscription_completed` est réémis à
   * CHAQUE cycle par le lot serveur ; la propriété `is_renewal` (émise depuis le
   * 28/07 01:09 UTC, présente sur 100 % des events depuis) sépare les deux. Sans
   * ce filtre, une journée faite de renouvellements affichait des « nouveaux
   * clients » qui n'en étaient pas, et la série divergeait de Whop (04/08 : 8
   * personnes côté PostHog pour 2 nouveaux clients Whop).
   *
   * `!= 'true'` et NON `= 'false'` : les events antérieurs au 28/07 n'ont pas la
   * propriété et sont tous des premiers paiements — un `= 'false'` effacerait
   * tout l'historique d'avant l'instrumentation.
   *
   * ⚠️ Défaut résiduel MESURÉ en prod le 08/08 (jointure `properties.membership_id`
   * ↔ `whopPayments.billingReason`) : le chemin TEMPS RÉEL a étiqueté
   * `is_renewal=false` deux renouvellements (06/08 05:27 et 07/08 20:15) ; le lot
   * de 06:00 UTC, lui, étiquette juste. Reste donc ≤ 1 faux « nouveau » par jour,
   * sous le seuil du contrôle croisé et sans effet sur la courbe « Clients
   * payants », qui vient de Whop.
   */
  overview: `
SELECT toStartOfDay(timestamp, 'Europe/Paris') AS d,
       uniqIf(person_id, event = '$pageview') AS visitors,
       uniqIf(person_id, event = 'signup_completed') AS signups,
       uniqIf(person_id, event = 'checkout_started') AS checkouts,
       uniqIf(person_id, event = 'subscription_completed'
              AND ifNull(toString(properties.is_renewal), '') != 'true') AS subs
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
GROUP BY d
ORDER BY d
LIMIT 10000`,
  // Subs par (jour Paris, membership_id) — la clé qui rend l'écart EXPLICABLE.
  // Personnes distinctes par membership : un retry serveur qui ré-émet l'event
  // pour le même membership compte 1 ici et se réconcilie ensuite au jour de
  // son paiement Whop (module pur lib/analytics-hub).
  //
  // ⚠️ Le `LIMIT` explicite n'est pas décoratif. Sans lui, PostHog tronque
  // SILENCIEUSEMENT à 100 lignes, et l'`ORDER BY d` étant ascendant, ce sont les
  // jours RÉCENTS qui tombent. Relevé en prod le 2026-08-29 : exactement 100
  // lignes, dernier jour 2026-08-24 — la réconciliation ne voyait plus aucun sub
  // depuis le 25/08 et rangeait TOUS les clients Whop en « paiement sans event »
  // (2 le 25/08, 6 le 26, 8 le 27, 16 le 28), fabriquant un jour divergent de
  // plus chaque jour. Le piège est tenu par lib/posthog-person-counters.test.ts.
  subsByMembership: `
SELECT formatDateTime(toStartOfDay(timestamp, 'Europe/Paris'), '%Y-%m-%d') AS d,
       ifNull(toString(properties.membership_id), '') AS membership_id,
       uniq(person_id) AS persons
FROM events
WHERE event = 'subscription_completed'
  AND ifNull(toString(properties.is_renewal), '') != 'true'
  AND timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
GROUP BY d, membership_id
ORDER BY d
LIMIT 10000`,

  /**
   * Funnel GLOBAL — atteinte d'étape (personnes distinctes ayant réalisé chaque
   * étape), pas un funnel séquentiel strict : une étape peut donc dépasser la
   * précédente si le produit permet de la court-circuiter. L'UI le dit.
   */
  funnelGlobal: `
SELECT 'global' AS seg,${FUNNEL_COLUMNS}
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}`,

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
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
  GROUP BY person_id
)`,

  funnelSource: `
SELECT ${segExpr("person.properties.source")} AS seg,${FUNNEL_COLUMNS}
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
GROUP BY seg
ORDER BY visit DESC
LIMIT ${SEGMENT_LIMIT}`,

  funnelLanguage: `
SELECT ${segExpr("person.properties.language")} AS seg,${FUNNEL_COLUMNS}
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
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
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
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
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
    AND event IN ('paywall_viewed', 'subscription_completed')
  GROUP BY person_id
)
WHERE viewed > 0
GROUP BY seg
ORDER BY n DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * Conversion par PAYWALL (paywall_id) — l'app a 7 emplacements mais `variant`
   * n'en distingue que 2.
   *
   * FENÊTRE ANCRÉE SUR LA PREMIÈRE ÉMISSION de `paywall_id` (vérifié prod :
   * 29/07 16:24 Paris). Sans cet ancrage, les 90 jours ramènent tout
   * l'historique d'avant l'instrumentation en '(inconnu)' — 649 personnes sur
   * 814, soit une carte à 80 % illisible qui donne l'impression d'un défaut
   * d'émission alors que la propriété marche. Même parti que
   * `firstSearchAfterPay`, qui s'ancre déjà sur son début d'instrumentation.
   * `started` remonte l'horodatage pour que l'UI DISE sur quoi elle porte.
   */
  paywallById: `
SELECT ${segExpr("paywall_id")} AS seg, count() AS n, countIf(subscribed > 0) AS converted, min(started) AS started
FROM (
  SELECT person_id,
    argMaxIf(properties.paywall_id, timestamp, event = 'paywall_viewed') AS paywall_id,
    countIf(event = 'subscription_completed') AS subscribed,
    countIf(event = 'paywall_viewed') AS viewed,
    (SELECT min(timestamp) FROM events
      WHERE isNotNull(properties.paywall_id)
        AND timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY) AS started
  FROM events
  WHERE timestamp >= (SELECT min(timestamp) FROM events
      WHERE isNotNull(properties.paywall_id)
        AND timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY)${notCounted}
    AND event IN ('paywall_viewed', 'subscription_completed')
  GROUP BY person_id
)
WHERE viewed > 0
GROUP BY seg
ORDER BY n DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * TEST A/B par BRAS. `notCounted` écarte déjà les internes ET les sessions à
   * bras forcé (cf internalAccounts.notForcedExperimentClause) : une session de
   * QA n'est pas du trafic. Fenêtre ancrée sur la 1re émission de la propriété.
   * Le revenu par bras n'est PAS ici : la metadata `abVariant` du membership Whop
   * EXISTE (cf convex/whopApi) mais n'est quasiment jamais posée — 1 membership
   * sur 47 en prod au 08/08 (mem_9DufjkSMZ6ipdb, créé le 04/08, bras soft). Le
   * rattachement d'un paiement à un bras reste donc l'exception, via cette
   * metadata ou le repli `distinctId` ; un bras sans abonnement rattaché affiche
   * un tiret plutôt qu'un revenu inventé.
   *
   * Trois pièges, tous corrigés ici et à ne pas réintroduire :
   *   1. `exposed` compte les ASSIGNÉS, pas les gens qui ont vu un paywall (en
   *      prod : 24 assignés pour 11 qui l'ont vu). Bon dénominateur d'un taux
   *      « par assigné » (intention de traiter), faux pour un taux de complétion
   *      — d'où `paywall_viewers`, exposé à côté.
   *   2. `subscription_completed` est réémis à CHAQUE cycle par le serveur : sans
   *      distinguer le 1er abonnement, un renouvellement comptait comme une
   *      conversion du bras (cas réel : un abonné du 29/07 « converti » le 05/08).
   *   3. Les cibles doivent être celles des CLIENTS après paiement, pas celles de
   *      tout le bras : mélanger les deux donnait 14 cibles pour 1 client.
   *   4. Une personne dont le bras a CHANGÉ en cours de route est écartée de tous
   *      les compteurs (`stable`) et comptée à part (`excluded_flippers`). Le
   *      bras était tiré DEUX fois — client sur le distinct_id anonyme, serveur à
   *      la création du compte (cf `experiment_source` : anonymous / account) — et
   *      les deux tirages divergeaient : 15 personnes sur 28 avant le correctif
   *      serveur du 08/08 10:24 UTC, 0 sur 47 après. Une personne exposée au
   *      paywall d'un bras et comptée dans l'autre casse la randomisation, seule
   *      chose qui rend les deux colonnes comparables. Critère de DÉTECTION, pas
   *      liste ni fenêtre de date : la liste grossit (18 → 21 en 24 h) et une
   *      fenêtre jetterait aussi la cohorte saine.
   * L'inner scanne 90 j (il faut le 1er abonnement historique) et chaque compteur
   * est borné à la fenêtre du test par `timestamp >= ab_start`.
   */
  abArms: `
WITH ${AB_EXPERIMENT_CTE}
SELECT bras AS variant, uniqIf(person_id, stable) AS exposed,
  uniqIf(person_id, stable AND n_paywalls > 0) AS paywall_viewers,
  uniqIf(person_id, stable AND n_checkouts > 0) AS checkouts,
  uniqIf(person_id, stable AND n_subs > 0 AND t_first_sub >= ab_start) AS paid,
  uniqIf(person_id, stable AND n_subs > 0 AND t_first_sub < ab_start) AS renewals,
  uniqIf(person_id, stable AND n_subs > 0 AND t_first_sub >= ab_start AND n_checkouts = 0) AS paid_without_checkout,
  sum(if(stable AND n_subs > 0 AND t_first_sub >= ab_start, arrayCount(x -> x >= t_first_sub, target_ts), 0)) AS client_targets,
  sum(if(stable, length(target_ts), 0)) AS arm_targets,
  -- Écartées faute de bras stable. Rangées sous leur DERNIER bras (argMaxIf) :
  -- c'est celui que la carte leur aurait attribué, donc la ligne qu'elles
  -- auraient faussée. Ventilées par NOMBRE D'APPAREILS : un bras qui diverge
  -- entre deux $device_id est une fusion d'identités PostHog (attendue) ; sur un
  -- SEUL appareil, c'est l'app qui re-tire le bras — le seul signal actionnable.
  uniqIf(person_id, NOT stable) AS excluded_flippers,
  uniqIf(person_id, NOT stable AND n_devices > 1) AS excluded_flippers_multi_device,
  uniqIf(person_id, NOT stable AND n_devices <= 1) AS excluded_flippers_same_device,
  min(started) AS started
FROM (
  SELECT person_id,
    argMaxIf(toString(properties.experiment_variant), timestamp, ${AB_ARMED}) AS bras,
    -- Un seul bras vu sur L'EXPÉRIENCE COURANTE = tirage tenu. Sans la borne
    -- par experiment_id, un passage v1 → v2 (bras re-tirés) comptait comme
    -- une bascule : ~24 des 52 exclusions mesurées le 22/08 étaient cet artefact.
    uniqIf(toString(properties.experiment_variant), ${AB_ARMED}) = 1 AS stable,
    uniq(toString(properties.$device_id)) AS n_devices,
    countIf(event = 'paywall_viewed' AND timestamp >= ab_start) AS n_paywalls,
    countIf(event = 'checkout_started' AND timestamp >= ab_start) AS n_checkouts,
    countIf(event = 'subscription_completed' AND timestamp >= ab_start) AS n_subs,
    -- 1er abonnement sur TOUTE la fenêtre 90 j (pas seulement depuis le test) :
    -- c'est ce qui sépare un nouveau client d'un renouvellement. minIf sans
    -- correspondance rend l'epoch 0, jamais null → toujours gardé par n_subs > 0.
    minIf(timestamp, event = 'subscription_completed') AS t_first_sub,
    -- Cibles DÉDUPLIQUÉES : la double émission client+serveur doublait
    -- client_targets et arm_targets (1,85 cible/client affiché pour 0,93 réel).
    ${dedupedTimestamps("target_added", " AND timestamp >= ab_start")} AS target_ts,
    ab_start AS started
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
  GROUP BY person_id
  HAVING countIf(${AB_ARMED}) > 0
)
WHERE isNotNull(bras) AND bras != '' AND bras != 'NULL'
GROUP BY variant
ORDER BY exposed DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * `distinct_id → bras` pour le REPLI de rattachement (cf AbPersonArmsPayload).
   * Même fenêtre et mêmes exclusions que `abArms` : internes et sessions à bras
   * forcé écartés, ancrage sur la 1re émission de la propriété — PLUS les
   * personnes à bras instable (même critère que `stable` dans abArms, appliqué au
   * niveau PERSONNE : une même personne peut avoir plusieurs distinct_id, chacun
   * stable de son côté). Sans ça, le revenu d'une personne écartée du tableau
   * serait quand même rattaché à un bras — l'argent dirait ce que les colonnes
   * refusent de dire.
   */
  abPersonArms: `
WITH ${AB_EXPERIMENT_CTE}
SELECT distinct_id, bras AS variant FROM (
  SELECT distinct_id,
    argMaxIf(toString(properties.experiment_variant), timestamp, ${AB_ARMED}) AS bras
  FROM events
  WHERE timestamp >= ab_start${notCounted}
    AND NOT (person_id IN (
      SELECT person_id FROM events
      WHERE ${AB_ARMED}
        AND timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
      GROUP BY person_id
      HAVING uniq(toString(properties.experiment_variant)) > 1
    ))
  GROUP BY distinct_id
)
WHERE isNotNull(bras) AND bras != '' AND bras != 'NULL'
LIMIT 10000`,

  /**
   * `distinct_id` des personnes à bras INSTABLE — la garde anti-flipper rendue
   * EXPLICITE, en test POSITIF.
   *
   * Sans elle, la seule matérialisation de la garde était l'ABSENCE d'une ligne
   * dans `abPersonArms` : elle ne pouvait donc mordre que sur la voie de repli,
   * et `metadata.abVariant ?? repli` la court-circuitait (cf convex/abAttribution.ts).
   * Une absence est de surcroît AMBIGUË — flipper écarté, jamais assigné, ou
   * payload tronqué ? Ici la présence dans la liste est un fait, pas une déduction.
   *
   * Volume borné (prod 22/08 : 130 distinct_id pour 28 personnes) — une liste
   * plate suffit, et le `LIMIT` explicite évite la troncature silencieuse à 100.
   */
  abFlippers: `
WITH ${AB_EXPERIMENT_CTE}
SELECT distinct_id FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
  AND person_id IN (
    SELECT person_id FROM events
    WHERE ${AB_ARMED}
      AND timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
    GROUP BY person_id
    HAVING uniq(toString(properties.experiment_variant)) > 1
  )
GROUP BY distinct_id
LIMIT 10000`,

  /** Sources → inscrits / abonnés (une personne compte une fois par source). */
  sources: `
SELECT seg, countIf(signed > 0) AS signups, countIf(subbed > 0) AS subs
FROM (
  SELECT person_id, ${segExpr("person.properties.source")} AS seg,
    countIf(event = 'signup_completed') AS signed,
    countIf(event = 'subscription_completed') AS subbed
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
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
      -- Seuil targets > 1 : la double émission faisait basculer en
      -- « multi_target » toute personne n'ayant qu'UNE cible réelle.
      ${dedupedCount("target_added")} AS targets
    FROM events
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
    GROUP BY person_id
    HAVING countIf(event = 'signup_completed') > 0
  )
)
GROUP BY cohort, segment
ORDER BY cohort DESC
LIMIT 10000`,

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
    -- Seuil targets >= 2 : idem, la double émission le franchissait toute seule.
    ${dedupedCount("target_added")} AS targets,
    countIf(event = 'push_enabled') AS push,
    countIf(event = 'referral_link_shared') AS referrals
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
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
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}`,

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
  sum(failed_payment) AS failed_payment,
  sum(disappeared) AS disappeared,
  quantileIf(0.5)(pay_delay, pay_delay > 0) AS med_pay_s,
  quantileIf(0.9)(pay_delay, pay_delay > 0) AS p90_pay_s
FROM (
  SELECT
    device,
    if(paid_c > 0, 1, 0) AS paid,
    if(paid_c = 0 AND freed_c > 0, 1, 0) AS diverted,
    -- Ventilation des NON payeurs, mutuellement exclusive (total = non payeurs) :
    -- échec de paiement resté sans suite, puis disparition sans aucune tentative.
    -- payment_failed n'est donc PLUS ajouté depuis un autre agrégat (double compte).
    if(paid_c = 0 AND freed_c = 0 AND failed_c > 0, 1, 0) AS failed_payment,
    if(paid_c = 0 AND freed_c = 0 AND failed_c = 0, 1, 0) AS disappeared,
    if(paid_c > 0, pay_delay_c, 0) AS pay_delay
  FROM (
    SELECT person_id,
      multiIf(
        max(if(event = 'checkout_started' AND isNotNull(properties.is_webview), 1, 0)) = 0, 'inconnu',
        max(if(event = 'checkout_started' AND (properties.is_webview = true OR toString(properties.is_webview) = 'true'), 1, 0)) > 0, 'webview',
        'natif') AS device,
      countIf(event = 'subscription_completed') AS paid_c,
      countIf(event = 'free_tier_started') AS freed_c,
      countIf(event = 'payment_failed') AS failed_c,
      dateDiff('second', minIf(timestamp, event = 'checkout_started'), minIf(timestamp, event = 'subscription_completed')) AS pay_delay_c
    FROM events
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
      AND event IN ('checkout_started', 'subscription_completed', 'free_tier_started', 'payment_failed')
    GROUP BY person_id
    HAVING countIf(event = 'checkout_started') > 0
  )
)
GROUP BY device
ORDER BY checkouts DESC`,

  /**
   * Motifs d'échec de paiement (payment_failed groupé par `cause`). `n` = nombre
   * de PERSONNES (uniq), PAS d'events : une personne qui retente échoue plusieurs
   * fois (20 personnes pour 29 events) — la carte « Où se perdent les checkouts »
   * compte des gens, pas des tentatives.
   */
  checkoutCauses: `
SELECT coalesce(nullIf(toString(properties.cause), ''), '(sans cause)') AS cause,
       uniq(person_id) AS n
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
  AND event = 'payment_failed'
GROUP BY cause
ORDER BY n DESC
LIMIT ${SEGMENT_LIMIT}`,

  /** Résultats de recherche de compte (handle_search_result groupé par result). */
  searchResults: `
SELECT coalesce(nullIf(toString(properties.result), ''), '(sans result)') AS result,
       uniq(person_id) AS persons
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
  AND event = 'handle_search_result'
GROUP BY result
ORDER BY persons DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * Fiabilité des scans (scan_completed groupé par DÉCLENCHEMENT × mode × result).
   * `reason` (émis server-side depuis le 28/07) porte le déclenchement : baseline /
   * scheduled_light / scheduled_full / manual_refresh. scheduled_full est le scan
   * qui détecte les désabonnements → la carte le met en évidence.
   */
  scanReliability: `
SELECT coalesce(nullIf(toString(properties.reason), ''), '(sans reason)') AS reason,
       coalesce(nullIf(toString(properties.mode), ''), '(sans mode)') AS mode,
       coalesce(nullIf(toString(properties.result), ''), '(sans result)') AS result,
       count() AS runs
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
  AND event = 'scan_completed'
GROUP BY reason, mode, result
ORDER BY runs DESC
LIMIT 80`,

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
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
      AND event = 'scan_completed'
  )
  WHERE dur IS NOT NULL
)
GROUP BY bucket, bidx
ORDER BY bidx`,

  /**
   * Coût d'infrastructure des scans, ventilé LÉGER vs COMPLET via `reason`. Le scan
   * complet (scheduled_full) détecte les désabonnements et coûte cher ; le léger
   * (scheduled_light / baseline / manual_refresh) est ce que subit une cible
   * gratuite. cost_usd est en DOLLARS (agrégat d'events, admis par le garde-fou #156).
   */
  scanCost: `
SELECT
  multiIf(
    coalesce(nullIf(toString(properties.reason), ''), '') = 'scheduled_full', 'full',
    coalesce(nullIf(toString(properties.reason), ''), '') IN ('scheduled_light', 'baseline', 'manual_refresh'), 'light',
    '(autre)'
  ) AS kind,
  count() AS runs,
  countIf(toFloatOrNull(toString(properties.cost_usd)) IS NOT NULL) AS with_cost,
  round(sum(toFloatOrZero(toString(properties.cost_usd))), 4) AS sum_cost,
  round(avgIf(toFloatOrZero(toString(properties.cost_usd)), toFloatOrNull(toString(properties.cost_usd)) IS NOT NULL), 5) AS avg_cost
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
  AND event = 'scan_completed'
GROUP BY kind
ORDER BY runs DESC`,

  /** Points de friction : rageclicks distincts par page. */
  friction: `
SELECT coalesce(
         nullIf(toString(properties['$pathname']), ''),
         coalesce(nullIf(toString(properties['$current_url']), ''), '(sans page)')
       ) AS page,
       uniq(person_id) AS persons
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
  AND event = '$rageclick'
GROUP BY page
ORDER BY persons DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * Friction d'onboarding par ÉTAPE (onboarding_step). Les 9 écrans partagent la
   * même URL → sans le numéro d'étape, tout tombe en '(inconnu)'. Provisionné pour
   * s'allumer seul quand l'app émettra la propriété (comme paywallById).
   */
  frictionByStep: `
SELECT ${segExpr("properties.onboarding_step")} AS step, uniq(person_id) AS persons
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
  AND event = '$rageclick'
  AND coalesce(nullIf(toString(properties['$pathname']), ''), toString(properties['$current_url'])) LIKE '%/onboarding%'
GROUP BY step
ORDER BY persons DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * B0a — activation produit par TYPE d'INSCRIT : payant (a un abonnement),
   * gratuit (a le plan gratuit sans payer), « sans accès » (inscrit mais ni
   * gratuit ni payant). Restreint aux INSCRITS (signup_completed) : les visiteurs
   * anonymes ne sont pas des inscrits et gonflaient à tort le groupe « sans accès »
   * (segment 'hors_inscription', écarté à l'affichage). Le drapeau `recent`
   * marque les inscriptions du 28/07 ou après, seule période où les trois groupes
   * sont comparables (handle_submitted émis depuis le 28/07, plan gratuit depuis le
   * 27/07 16 h). L'UI propose une vue « tous » et une vue restreinte au récent.
   */
  activation: `
SELECT segment, recent,
  count() AS persons,
  countIf(has_target > 0) AS target_added,
  countIf(has_alert > 0) AS first_alert,
  countIf(has_username > 0) AS username_entered
FROM (
  SELECT person_id,
    multiIf(
      countIf(event = 'subscription_completed') > 0, 'payant',
      countIf(event = 'free_tier_started') > 0, 'gratuit',
      countIf(event = 'signup_completed') > 0, 'sans_acces',
      'hors_inscription') AS segment,
    if(minIf(timestamp, event = 'signup_completed') >= toDateTime('2026-07-28 00:00:00', 'Europe/Paris'), 1, 0) AS recent,
    countIf(event = 'target_added') AS has_target,
    countIf(event = 'first_alert_received') AS has_alert,
    countIf(event = 'username_entered') AS has_username
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
  GROUP BY person_id
)
GROUP BY segment, recent
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
      -- client_targets est une SOMME : la double émission la doublait.
      ${dedupedCount("target_added")} AS targets
    FROM events
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
      AND event IN ('paywall_viewed', 'checkout_started', 'subscription_completed', 'target_added')
    GROUP BY person_id
    HAVING countIf(event = 'paywall_viewed') > 0
  )
)
GROUP BY variant
ORDER BY exposed DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * B3 — plan gratuit : population ayant REÇU la semaine offerte, usage réel
   * (≥ 1 action produit) et passage au payant.
   *
   * ⚠️ CE QUE `free_tier_started` DIT, ET CE QU'IL NE DIT PAS. L'event marque
   * un OCTROI (plan `snytch_free_week`), pas un CHOIX : côté serveur il part
   * ~1 s après `onboarding_completed` pour toute personne du bras soft qui
   * termine l'onboarding — y compris celles qui paient 3 s plus tard (mesuré le
   * 22/08 : 22 payants soft sur 22 l'émettent). On ne peut donc PAS en tirer
   * « la personne a préféré le gratuit ».
   *
   * Deux colonnes ont été RETIRÉES pour cette raison, et ne doivent pas être
   * réintroduites : `checkout_before` (« avait ouvert le checkout avant le
   * gratuit ») et `med_free_to_checkout_s` (délai signé gratuit→checkout,
   * médiane mesurée −21 s, 83 % de valeurs négatives). Elles ne mesuraient pas
   * un comportement mais l'ORDRE D'ÉMISSION de l'instrumentation : l'octroi part
   * sur le chemin de RETOUR du checkout, donc après lui, mécaniquement. Il
   * faudrait un event émis au CHOIX explicite du plan gratuit pour répondre à
   * « porte de sortie ou porte de découverte ? » — il n'existe pas encore (cf
   * `free_tier_chosen`, déclaré `notYetEmitted` dans convex/analyticsContract).
   */
  freePlan: `
SELECT
  count() AS signups,
  countIf(used > 0) AS used,
  countIf(paid > 0) AS converted_paid
FROM (
  SELECT person_id,
    countIf(event = 'subscription_completed') AS paid,
    countIf(event IN ('handle_search_result', 'scan_completed', 'target_added')) AS used
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
    AND event IN ('free_tier_started', 'subscription_completed', 'handle_search_result', 'scan_completed', 'target_added')
  GROUP BY person_id
  HAVING countIf(event = 'free_tier_started') > 0
)`,

  /**
   * Première recherche APRÈS paiement (la demande la plus importante). Le paywall
   * bloque la recherche avant paiement → le 1er handle_search_result d'un payant
   * est déjà post-accès. Par personne payante : résultat de cette recherche +
   * délai paiement→recherche.
   *
   * PIÈGE D'INSTRUMENTATION : handle_search_result n'existe que depuis son 1er
   * event (~28/07). Un payant qui a payé AVANT n'a aucune recherche MESURABLE :
   * l'absence n'est pas « il n'a pas cherché ». On borne donc le dénominateur aux
   * payants dont le 1er paiement est >= instr_start (= min timestamp du 1er
   * handle_search_result, dérivé de la donnée, pas codé en dur) et on remonte
   * `paid_excluded` (payés avant) + `instr_start_s` pour que la carte l'affiche.
   *
   * `result_list` collecte le 1er résultat de chaque payant MESURABLE qui a cherché
   * → le shaper le ventile. `cancel_joinable` = payants rattachables à un
   * subscription_cancelled : mesure la FAISABILITÉ du taux de résiliation
   * post-échec, pas le taux (event sous-émis). count()/countIf agrègent la
   * sous-requête GROUP BY person_id (forme freePlan, admise par le garde-fou #156).
   */
  firstSearchAfterPay: `
WITH (SELECT min(timestamp) FROM events WHERE event = 'handle_search_result'${notCounted}) AS instr_start
SELECT
  countIf(t_paid >= instr_start) AS paid,
  countIf(t_paid < instr_start) AS paid_excluded,
  countIf(t_paid >= instr_start AND has_search > 0) AS searched,
  quantileIf(0.5)(delay_s, t_paid >= instr_start AND delay_s > 0) AS med_delay_s,
  quantileIf(0.9)(delay_s, t_paid >= instr_start AND delay_s > 0) AS p90_delay_s,
  countIf(t_paid >= instr_start AND has_cancel > 0) AS cancel_joinable,
  groupArrayIf(first_result, t_paid >= instr_start AND has_search > 0) AS result_list,
  toUnixTimestamp(instr_start) AS instr_start_s
FROM (
  SELECT person_id,
    minIf(timestamp, event = 'subscription_completed') AS t_paid,
    countIf(event = 'handle_search_result') AS has_search,
    countIf(event = 'subscription_cancelled') AS has_cancel,
    argMinIf(coalesce(nullIf(toString(properties.result), ''), '(sans result)'), timestamp, event = 'handle_search_result') AS first_result,
    if(countIf(event = 'handle_search_result') > 0,
       dateDiff('second', minIf(timestamp, event = 'subscription_completed'), minIf(timestamp, event = 'handle_search_result')),
       NULL) AS delay_s
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY${notCounted}
    AND event IN ('subscription_completed', 'handle_search_result', 'subscription_cancelled')
  GROUP BY person_id
  HAVING countIf(event = 'subscription_completed') > 0
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
      const med = cellNum(r, 6);
      const p90 = cellNum(r, 7);
      return {
        device: cellStr(r, 0),
        checkouts: cellNum(r, 1),
        paid,
        divertedFree: cellNum(r, 3),
        failedPayment: cellNum(r, 4),
        disappeared: cellNum(r, 5),
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
        // Deux exclusions cumulées, même fenêtre que les requêtes : les comptes
        // internes (A4) et les sessions dont le bras d'A/B a été FORCÉ en QA.
        // Une session forcée n'est pas du trafic : la compter fausserait autant
        // la répartition des bras que les taux de conversion.
        notInternalClause(internalCfg) + notForcedExperimentClause(WINDOW_DAYS),
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
                checkouts: cellNum(r, 3),
                subs: cellNum(r, 4),
              }))
              .filter((d): d is OverviewPayload["daily"][number] => d.ts !== null),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.subsByMembership,
          apiKey,
          target,
          QUERIES.subsByMembership,
          (rows): SubsByMembershipPayload => ({
            rows: rows.map((r) => ({
              day: cellStr(r, 0),
              membershipId: cellStr(r, 1),
              persons: cellNum(r, 2),
            })),
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
          // Colonne 3 = début de fenêtre (première émission de paywall_id),
          // identique sur chaque ligne → on la lit une fois.
          (rows): ConversionPayload => ({
            ...shapeConversion(rows),
            startMs: rows.length > 0 ? cellTimeMs(rows[0], 3) : null,
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.abArms,
          apiKey,
          target,
          QUERIES.abArms,
          (rows): AbArmsPayload => ({
            rows: rows.map((r) => ({
              variant: cellStr(r, 0),
              exposed: cellNum(r, 1),
              paywallViewers: cellNum(r, 2),
              checkouts: cellNum(r, 3),
              paid: cellNum(r, 4),
              renewals: cellNum(r, 5),
              paidWithoutCheckout: cellNum(r, 6),
              clientTargets: cellNum(r, 7),
              armTargets: cellNum(r, 8),
              excludedFlippers: cellNum(r, 9),
              excludedFlippersMultiDevice: cellNum(r, 10),
              excludedFlippersSameDevice: cellNum(r, 11),
            })),
            startMs: rows.length > 0 ? cellTimeMs(rows[0], 12) : null,
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.abPersonArms,
          apiKey,
          target,
          QUERIES.abPersonArms,
          (rows): AbPersonArmsPayload => ({
            rows: rows.map((r) => ({
              distinctId: cellStr(r, 0),
              variant: cellStr(r, 1),
            })),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.abFlippers,
          apiKey,
          target,
          QUERIES.abFlippers,
          (rows): AbFlippersPayload => ({
            distinctIds: rows.map((r) => cellStr(r, 0)).filter((d) => d !== ""),
          }),
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
              reason: cellStr(r, 0),
              mode: cellStr(r, 1),
              result: cellStr(r, 2),
              runs: cellNum(r, 3),
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
          POSTHOG_CACHE_KEYS.scanCost,
          apiKey,
          target,
          QUERIES.scanCost,
          (rows): ScanCostPayload => ({
            rows: rows.map((r) => {
              const withCost = cellNum(r, 2);
              return {
                kind: cellStr(r, 0),
                runs: cellNum(r, 1),
                withCost,
                sumCostUsd: cellNum(r, 3),
                // avg n'a de sens que si des scans portent un cost_usd.
                avgCostUsd: withCost > 0 ? cellNum(r, 4) : null,
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
          POSTHOG_CACHE_KEYS.frictionByStep,
          apiKey,
          target,
          QUERIES.frictionByStep,
          (rows): FrictionByStepPayload => ({
            rows: rows.map((r) => ({ step: cellStr(r, 0), persons: cellNum(r, 1) })),
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
              recent: cellNum(r, 1),
              persons: cellNum(r, 2),
              targetAdded: cellNum(r, 3),
              firstAlert: cellNum(r, 4),
              usernameEntered: cellNum(r, 5),
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
            return {
              signups: cellNum(r, 0),
              used: cellNum(r, 1),
              convertedPaid: cellNum(r, 2),
            };
          },
        ),
        await collect(
          POSTHOG_CACHE_KEYS.firstSearchAfterPay,
          apiKey,
          target,
          QUERIES.firstSearchAfterPay,
          (rows): FirstSearchAfterPayPayload => {
            const r = rows[0] ?? [];
            const searched = cellNum(r, 2);
            const tally = new Map<string, number>();
            for (const res of cellStrArr(r, 6)) {
              tally.set(res, (tally.get(res) ?? 0) + 1);
            }
            const instrStartS = cellNum(r, 7);
            return {
              paid: cellNum(r, 0),
              paidExcluded: cellNum(r, 1),
              // secondes epoch → ms ; 0 ⇒ pas d'instrumentation (null).
              instrStartMs: instrStartS > 0 ? instrStartS * 1000 : null,
              searched,
              // délais en secondes ; searched = 0 ⇒ pas de couple valide (null).
              medDelaySec: searched > 0 ? cellNum(r, 3) : null,
              p90DelaySec: searched > 0 ? cellNum(r, 4) : null,
              cancelJoinable: cellNum(r, 5),
              results: [...tally.entries()]
                .map(([result, persons]) => ({ result, persons }))
                .sort((a, b) => b.persons - a.persons),
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
  /** Test A/B par bras (sessions forcées exclues). */
  abArms: AbArmsPayload;
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
  /** Coût d'infrastructure des scans, léger vs complet (cost_usd, $). */
  scanCost: ScanCostPayload;
  friction: FrictionPayload;
  /** Point 10 — friction d'onboarding par étape (en attente de onboarding_step). */
  frictionByStep: FrictionByStepPayload;
  /** A4 — personnes internes exclues de tous les agrégats ci-dessus (compteur). */
  internalExcluded: InternalExcludedPayload;
  /** B0a — activation par type d'utilisateur. */
  activation: ActivationPayload;
  /** B3 — test A/B par variante de paywall. */
  abVariants: AbVariantsPayload;
  /** B3 — plan gratuit. */
  freePlan: FreePlanPayload;
  /** Première recherche après paiement (la demande la plus importante). */
  firstSearchAfterPay: FirstSearchAfterPayPayload;
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
      abArms: { rows: [], startMs: null },
      sources: EMPTY_CONVERSION,
      cohorts: { segments: [] },
      predictors: { total: 0, totalConverted: 0, behaviors: [] },
      instrumentation: EMPTY_INSTRUMENTATION,
      checkoutReliability: { rows: [] },
      checkoutCauses: { rows: [] },
      searchResults: { rows: [] },
      scanReliability: { rows: [] },
      scanLatency: { rows: [] },
      scanCost: { rows: [] },
      friction: { rows: [] },
      frictionByStep: { rows: [] },
      internalExcluded: EMPTY_INTERNAL_EXCLUDED,
      activation: { rows: [] },
      abVariants: { rows: [] },
      freePlan: {
        signups: 0,
        used: 0,
        convertedPaid: 0,
      },
      firstSearchAfterPay: {
        paid: 0,
        paidExcluded: 0,
        instrStartMs: null,
        searched: 0,
        results: [],
        medDelaySec: null,
        p90DelaySec: null,
        cancelJoinable: 0,
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
      // Colonnes ajoutées après coup (vues du paywall, renouvellements, cibles
      // des clients) : entre le déploiement et le prochain cron, le cache porte
      // encore l'ANCIENNE forme. Sans ce recalage, l'écran afficherait NaN sur
      // des champs absents — un chiffre faux plutôt qu'un chiffre en attente.
      abArms: normalizeAbArms(
        read<AbArmsPayload>(POSTHOG_CACHE_KEYS.abArms, {
          rows: [],
          startMs: null,
        }),
      ),
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
      scanCost: read(POSTHOG_CACHE_KEYS.scanCost, { rows: [] }),
      friction: read(POSTHOG_CACHE_KEYS.friction, { rows: [] }),
      frictionByStep: read(POSTHOG_CACHE_KEYS.frictionByStep, { rows: [] }),
      internalExcluded: read(
        POSTHOG_CACHE_KEYS.internalExcluded,
        EMPTY_INTERNAL_EXCLUDED,
      ),
      activation: read(POSTHOG_CACHE_KEYS.activation, { rows: [] }),
      abVariants: read(POSTHOG_CACHE_KEYS.abVariants, { rows: [] }),
      freePlan: read(POSTHOG_CACHE_KEYS.freePlan, empty.freePlan),
      firstSearchAfterPay: read(
        POSTHOG_CACHE_KEYS.firstSearchAfterPay,
        empty.firstSearchAfterPay,
      ),
    };
  },
});

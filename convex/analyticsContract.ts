/**
 * CONTRAT D'EVENTS du hub Analytics Snytch — SOURCE UNIQUE de vérité.
 *
 * Décrit CE QUE le dashboard attend de PostHog : la liste complète des events du
 * parcours produit + leurs propriétés attendues. Deux consommateurs :
 *  - convex/posthogSync.ts génère la requête d'instrumentation À PARTIR de cette
 *    liste (une colonne par event) → aucune dérive entre « ce qu'on attend » et
 *    « ce qu'on mesure » ;
 *  - la carte Fiabilité (phase C) affiche l'état de CHAQUE event du contrat, y
 *    compris ceux à `notYetEmitted` : leur absence est AFFICHÉE explicitement
 *    (« pas encore émis côté app »), jamais masquée sous un 0.
 *
 * Règle A1 : `app_version`, `plan_shown`, `price` n'existent pas encore côté
 * Snytch. On les DÉCLARE quand même (CONTRACT_PROPERTIES, `notYetEmitted`) pour
 * que leur arrivée allume la carte d'elle-même, sans redéploiement du contrat.
 *
 * Module PUR (aucune dépendance Convex/React). Vit dans convex/ car un module
 * convex/ NE PEUT PAS importer lib/ (le bundler Convex ne suit que convex/) et
 * c'est posthogSync qui le consomme ; le client, lui, lit le payload DÉJÀ mis en
 * forme (InstrumentationPayload porte name/category/notYetEmitted) → aucune
 * réplique lib/ à maintenir. Testable côté lib via `import ../convex/analyticsContract`.
 */

export type EventCategory =
  | "acquisition"
  | "activation"
  | "monetization"
  | "growth"
  | "engagement"
  | "quality";

export interface ContractEvent {
  /** Nom exact de l'event PostHog (peut commencer par `$` — auto-events). */
  name: string;
  category: EventCategory;
  /** Propriétés attendues sur cet event (sondées par la carte instrumentation). */
  props: string[];
  /**
   * true = event DÉCLARÉ mais PAS ENCORE émis côté app. La carte fiabilité
   * affiche « attendu, absent » (et non « sain à 0 »). Bascule seule dès qu'une
   * ligne arrive.
   */
  notYetEmitted?: boolean;
  /** Note courte affichée sur la carte (anomalie connue). */
  note?: string;
}

/**
 * Les 28 events du contrat. L'ordre est thématique (catégorie), PAS l'ordre du
 * parcours — l'ordre séquentiel du tunnel vit dans posthogSync (CONVERSION_STEP_KEYS),
 * établi empiriquement (cf diagnostic A6), pas ici.
 */
export const CONTRACT_EVENTS: ContractEvent[] = [
  // ─── Acquisition ───────────────────────────────────────────────────────────
  { name: "$pageview", category: "acquisition", props: [] },
  { name: "signup_completed", category: "acquisition", props: ["method", "server_side", "distinct_id"] },
  { name: "free_tier_started", category: "acquisition", props: ["is_free_tier"] },

  // ─── Activation produit ──────────────────────────────────────────────────
  { name: "username_entered", category: "activation", props: ["account_id"] },
  { name: "handle_submitted", category: "activation", props: ["account_id"] },
  {
    name: "handle_search_result",
    category: "activation",
    props: ["result", "account_id", "follower_count", "following_count"],
    note: "les gens sans accès sont bloqués par le paywall AVANT la recherche (result « paywalled » à venir)",
  },
  { name: "scan_started", category: "activation", props: ["mode", "account_id"], notYetEmitted: true },
  {
    name: "scan_completed",
    category: "activation",
    // `reason` (émis server-side depuis le 28/07) porte le DÉCLENCHEMENT du scan :
    // baseline / scheduled_light / scheduled_full / manual_refresh. scheduled_full
    // est le scan qui détecte les désabonnements (valeur du produit).
    props: ["result", "mode", "reason", "duration_ms", "cost_usd", "api_requests", "follower_count", "account_id", "distinct_id"],
  },
  { name: "target_added", category: "activation", props: ["account_id", "follower_count"] },
  { name: "target_removed", category: "activation", props: ["account_id", "reason"] },
  { name: "first_alert_received", category: "activation", props: ["account_id"] },

  // ─── Monétisation ────────────────────────────────────────────────────────
  { name: "paywall_viewed", category: "monetization", props: ["variant", "plan_shown", "price", "paywall_id"] },
  { name: "checkout_started", category: "monetization", props: ["is_webview", "webview_source", "plan_name", "method", "variant"] },
  { name: "checkout_handoff", category: "monetization", props: ["is_webview", "webview_source", "reason"] },
  { name: "payment_failed", category: "monetization", props: ["cause", "reason", "is_webview"] },
  { name: "confirmation_pending", category: "monetization", props: ["duration_ms"] },
  { name: "subscription_completed", category: "monetization", props: ["plan_name", "method", "server_side"] },
  { name: "subscription_cancelled", category: "monetization", props: ["reason", "plan_name"] },
  { name: "purchase_celebrated", category: "monetization", props: [] },

  // ─── Croissance / viralité ────────────────────────────────────────────────
  { name: "referral_link_shared", category: "growth", props: ["method"] },
  { name: "squad_created", category: "growth", props: [] },
  { name: "squad_joined", category: "growth", props: [] },
  { name: "squad_invite_sent", category: "growth", props: ["method"] },

  // ─── Engagement / rétention technique ─────────────────────────────────────
  { name: "push_enabled", category: "engagement", props: [] },
  { name: "pwa_installed", category: "engagement", props: [] },
  { name: "pwa_install_prompt", category: "engagement", props: ["result"] },

  // ─── Qualité (auto-events PostHog) ────────────────────────────────────────
  { name: "$exception", category: "quality", props: [] },
  { name: "$rageclick", category: "quality", props: [] },
];

export interface ContractProperty {
  name: string;
  /** Event porteur, ou "*" pour « attendue sur tous les events ». */
  onEvent: string;
  /** true = propriété PAS ENCORE émise côté app (règle A1). */
  notYetEmitted?: boolean;
}

/**
 * Propriétés SONDÉES à part — surtout les trois que l'app n'émet pas encore
 * (`app_version`, `plan_shown`, `price`). Sondées quand même : leur présence
 * bascule de « absente » à « présente » sans toucher au contrat.
 */
export const CONTRACT_PROPERTIES: ContractProperty[] = [
  // Émises depuis le 28/07 (vérifié prod : app_version dès ~14:43 sur la plupart
  // des events ; plan_shown/price 106 events, dernière 17:33) → flags retournés.
  { name: "app_version", onEvent: "*" },
  { name: "plan_shown", onEvent: "paywall_viewed" },
  { name: "price", onEvent: "paywall_viewed" },
  // paywall_id : l'app a 6 paywalls distincts mais `variant` n'a que 2 valeurs
  // (gate/upsell) → 4 paywalls indistinguables. Demandée au dev, PAS encore émise
  // (vérifié : 0 occurrence sur 7 j ET 90 j). La carte « conversion par paywall »
  // affiche un tiret tant qu'elle n'arrive pas.
  { name: "paywall_id", onEvent: "paywall_viewed", notYetEmitted: true },
  // onboarding_step : l'onboarding fait 9 écrans qui PARTAGENT la même URL
  // (/onboarding), de la saisie du handle jusqu'au paywall. Les clics de rage ne
  // disent donc pas QUELLE étape frustre. Demandée au dev, PAS encore émise : la
  // ventilation par étape (carte Points de friction) s'allumera d'elle-même dès
  // que l'app enverra le numéro d'étape sur $rageclick.
  { name: "onboarding_step", onEvent: "$rageclick", notYetEmitted: true },
  // experiment_id : marqueur d'un VRAI test A/B. Aujourd'hui `variant` ne distingue
  // que les DEUX types de paywall émis (gate/upsell), ce ne sont pas les bras d'un
  // test. La carte « Test A/B » reste « aucun test en cours » tant que cette
  // propriété est absente, et s'allume dès qu'un test démarre.
  { name: "experiment_id", onEvent: "*", notYetEmitted: true },
];

/**
 * VALEURS de result attendues sur handle_search_result mais PAS encore émises.
 * « paywalled » : aujourd'hui la recherche des gens sans accès n'émet aucun result
 * (le hard paywall intercepte après handle_submitted, la recherche ne s'exécute
 * jamais) → on les DÉDUIT par soustraction (handle_submitted − handle_search_result).
 * Le dev va émettre un result explicite « paywalled » depuis le gate : dès qu'il
 * arrive, la carte l'affiche MESURÉ au lieu de déduit. Une VALEUR n'est pas une
 * propriété (pas de sonde isNotNull) : on la déclare ici, la carte compare la
 * déduction à la mesure.
 */
export const EXPECTED_RESULT_VALUES: { event: string; value: string; notYetEmitted: boolean }[] = [
  { event: "handle_search_result", value: "paywalled", notYetEmitted: true },
];

/** Alias SQL sûr pour un nom d'event (`$pageview` → `pageview`, etc.). */
export function eventAlias(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "");
}

/** Noms d'events du contrat (ordre stable). */
export const CONTRACT_EVENT_NAMES: string[] = CONTRACT_EVENTS.map((e) => e.name);

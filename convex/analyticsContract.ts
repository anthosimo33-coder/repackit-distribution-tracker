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
    note: "chemin d'erreur potentiellement muet (result absent)",
  },
  { name: "scan_started", category: "activation", props: ["mode", "account_id"], notYetEmitted: true },
  {
    name: "scan_completed",
    category: "activation",
    props: ["result", "mode", "duration_ms", "cost_usd", "api_requests", "follower_count", "account_id", "distinct_id"],
  },
  { name: "target_added", category: "activation", props: ["account_id", "follower_count"] },
  { name: "target_removed", category: "activation", props: ["account_id", "reason"] },
  { name: "first_alert_received", category: "activation", props: ["account_id"] },

  // ─── Monétisation ────────────────────────────────────────────────────────
  { name: "paywall_viewed", category: "monetization", props: ["variant", "plan_shown", "price"] },
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
  { name: "app_version", onEvent: "*", notYetEmitted: true },
  { name: "plan_shown", onEvent: "paywall_viewed", notYetEmitted: true },
  { name: "price", onEvent: "paywall_viewed", notYetEmitted: true },
];

/** Alias SQL sûr pour un nom d'event (`$pageview` → `pageview`, etc.). */
export function eventAlias(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "");
}

/** Noms d'events du contrat (ordre stable). */
export const CONTRACT_EVENT_NAMES: string[] = CONTRACT_EVENTS.map((e) => e.name);

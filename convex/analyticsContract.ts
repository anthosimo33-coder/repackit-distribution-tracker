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
 * Règle A1 : une propriété attendue se DÉCLARE même quand l'app ne l'émet pas
 * encore (CONTRACT_PROPERTIES, `notYetEmitted`) — son arrivée allume la carte
 * d'elle-même, sans redéploiement du contrat. Le flux inverse est manuel : quand
 * une propriété se met à arriver, on retire le drapeau ici (fait le 03/08 pour
 * `experiment_id` et la valeur `paywalled`).
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
 * Les events du contrat. L'ordre est thématique (catégorie), PAS l'ordre du
 * parcours — l'ordre séquentiel du tunnel vit dans posthogSync (CONVERSION_STEP_KEYS),
 * établi empiriquement (cf diagnostic A6), pas ici.
 */
export const CONTRACT_EVENTS: ContractEvent[] = [
  // ─── Acquisition ───────────────────────────────────────────────────────────
  { name: "$pageview", category: "acquisition", props: [] },
  { name: "signup_completed", category: "acquisition", props: ["method", "server_side", "distinct_id"] },
  {
    name: "free_tier_started",
    category: "acquisition",
    props: ["is_free_tier", "plan_id", "server_side", "trigger"],
    // Marque un OCTROI de la semaine offerte, pas un CHOIX : la copie serveur
    // part ~1 s après `onboarding_completed` pour toute personne du bras soft
    // qui termine l'onboarding, y compris celles qui paient 3 s plus tard
    // (22 payants soft sur 22 l'émettent, mesuré le 22/08). Ne PAS en tirer
    // « a préféré le gratuit » — cf `free_tier_chosen` ci-dessous.
    note: "octroi, pas choix : émis aussi sur le chemin des payants (22/22) ; double émission client+serveur depuis le 02/08",
  },
  {
    name: "free_tier_chosen",
    category: "acquisition",
    props: ["plan_id", "server_side"],
    notYetEmitted: true,
    // La question « le gratuit est-il une porte de SORTIE ou de DÉCOUVERTE ? »
    // n'a aucune réponse mesurable tant que l'octroi et le choix partagent le
    // même event : le délai gratuit→checkout mesuré (médiane −21 s, 83 % de
    // valeurs négatives) ne décrit que l'ordre d'émission. Il faut un event émis
    // au TAP sur « continuer gratuitement », distinct de l'octroi d'accès.
    note: "attendu : émission au CHOIX explicite du plan gratuit, distincte de l'octroi (free_tier_started)",
  },

  // ─── Activation produit ──────────────────────────────────────────────────
  { name: "username_entered", category: "activation", props: ["account_id"] },
  { name: "handle_submitted", category: "activation", props: ["account_id"] },
  {
    name: "handle_search_result",
    category: "activation",
    props: ["result", "account_id", "follower_count", "following_count"],
    note: "result « paywalled » émis depuis le 03/08 : les gens sans accès sont désormais MESURÉS, plus déduits",
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
  // Première recherche APRÈS l'achat — l'agrégat firstSearchAfterPay le consomme
  // déjà (cf posthogSync.QUERIES). Émis server-side : ne porte pas les
  // super-propriétés client (plan, targets_count, bras du test).
  {
    name: "first_search_after_payment",
    category: "activation",
    props: ["result", "reason", "is_first_search", "delay_since_access_ms", "target_size_bucket", "server_side"],
  },

  // ─── Monétisation ────────────────────────────────────────────────────────
  {
    name: "paywall_viewed",
    category: "monetization",
    // Depuis le 03/08 l'event porte les DEUX cadences séparément (price_weekly /
    // price_monthly + plan_weekly / plan_monthly) : `price` seul ne disait qu'un
    // montant sur deux plans affichés, et un mensuel a pu sortir avec le montant
    // hebdo (cf journal des changements d'offre, correctif du routage de plan).
    props: [
      "experiment_variant", "experiment_id",
      "price_weekly", "price_monthly", "plan_weekly", "plan_monthly",
      "plan_preselected", "plan_preselected_period", "max_targets",
      "variant", "plan_shown", "price", "paywall_id",
    ],
  },
  { name: "checkout_started", category: "monetization", props: ["is_webview", "webview_source", "plan_name", "method", "variant"] },
  { name: "checkout_handoff", category: "monetization", props: ["is_webview", "webview_source", "reason"] },
  { name: "payment_failed", category: "monetization", props: ["cause", "reason", "is_webview"] },
  { name: "confirmation_pending", category: "monetization", props: ["duration_ms"] },
  {
    name: "subscription_completed",
    category: "monetization",
    // `membership_id` est la CLÉ DE JOINTURE avec Whop (whopPayments.membershipId) :
    // c'est elle qui permet de confronter un event à son `billingReason` et donc de
    // vérifier `is_renewal` au lieu de le croire. Sans elle, un event n'est
    // rattachable à aucun encaissement (cas des events antérieurs au 28/07).
    // `is_renewal` sépare premier paiement et renouvellement — l'event est réémis à
    // chaque cycle par le lot serveur ; la série quotidienne (QUERIES.overview) la
    // filtre pour ne compter que les nouveaux clients.
    //
    // ⚠️ L'EVENT NE DIT PAS SI LE PAIEMENT A ABOUTI. Mesuré le 22/08 sur la
    // fenêtre du test : 35 events `is_renewal=true` pour 27 cycles réellement
    // ENCAISSÉS côté Whop — l'app émet aussi sur les cycles ÉCHOUÉS (6, dont 4
    // `past_due`) et REMBOURSÉS (2). Ce n'est PAS un doublon d'ingestion (0
    // whopId dupliqué, appariement 1:1 avec les cycles Whop, écart médian 2 s) :
    // c'est un PÉRIMÈTRE différent, et l'arithmétique se referme exactement
    // (35/27 = +30 %, 35/30 = +17 %). Aucune des 10 propriétés ci-dessous ne
    // sépare les deux cas — `amount` porte le prix du PLAN, identique sur un
    // échec. D'où les trois propriétés déclarées `notYetEmitted` plus bas
    // (payment_status, payment_id, paid_at). Tant qu'elles manquent, tout
    // comptage de renouvellements doit venir de Whop, jamais de PostHog.
    props: [
      "plan_name", "method", "server_side",
      "is_renewal", "membership_id",
      "amount", "currency", "plan_id", "cadence", "slot_type",
    ],
    note: "is_renewal émise depuis le 28/07 ; émise AUSSI sur les cycles échoués et remboursés (35 events pour 27 encaissements sur la fenêtre du test) → compter les renouvellements depuis Whop",
  },
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
  /** Nom affiché sur la carte. Sert aussi de nom de propriété par défaut. */
  name: string;
  /** Event porteur, ou "*" pour « attendue sur tous les events ». */
  onEvent: string;
  /** true = propriété PAS ENCORE émise côté app (règle A1). */
  notYetEmitted?: boolean;
  /**
   * Condition HogQL EXPLICITE, quand le gabarit par défaut ne suffit pas.
   *
   * Le gabarit sonde `properties.<name>` — une propriété d'EVENT. Il ne sait pas
   * exprimer une propriété de PERSONNE (`person.properties.X`), ni un nom qui
   * demande la notation entre crochets. Or la distinction event/personne est
   * précisément ce qui décide si un segment est exploitable ici : `source` et
   * `language`, lus sur la personne, rendent 100 % et 84 % d'« inconnu » parce
   * que l'app les pose à l'inscription, après les pageviews.
   */
  cond?: string;
}

/**
 * Propriétés SONDÉES à part. Une propriété se déclare ici même quand l'app ne
 * l'émet pas encore (`notYetEmitted`) : sa présence bascule de « absente » à
 * « présente » sans toucher au contrat. Le retour du drapeau, lui, est MANUEL —
 * il se fait après vérification en prod, jamais sur annonce.
 */
export const CONTRACT_PROPERTIES: ContractProperty[] = [
  // Émises depuis le 28/07 (vérifié prod : app_version dès ~14:43 sur la plupart
  // des events ; plan_shown/price 106 events, dernière 17:33) → flags retournés.
  { name: "app_version", onEvent: "*" },
  { name: "plan_shown", onEvent: "paywall_viewed" },
  { name: "price", onEvent: "paywall_viewed" },
  // paywall_id : l'app a 7 emplacements de paywall (cf. EXPECTED_PAYWALL_IDS) mais
  // `variant` n'a que 2 valeurs (gate/upsell) → sans lui la plupart sont
  // indistinguables. ÉMISE depuis le 29/07 (388 occurrences vérifiées en prod).
  // Attention : les valeurs réelles débordent d'EXPECTED_PAYWALL_IDS (onboarding_notarget,
  // gate, subscription arrivent en plus, search_first n'arrive jamais).
  { name: "paywall_id", onEvent: "paywall_viewed" },
  // onboarding_step : l'onboarding fait 9 écrans qui PARTAGENT la même URL
  // (/onboarding), de la saisie du handle jusqu'au paywall. Sans lui, les clics de
  // rage ne disent pas QUELLE étape frustre. ÉMISE sur $rageclick depuis le 03/08
  // (12 occurrences vérifiées) → la ventilation par étape de la carte Points de
  // friction s'alimente.
  { name: "onboarding_step", onEvent: "$rageclick" },
  // experiment_id : marqueur d'un VRAI test A/B. Émis depuis le 03/08 17:02, avec
  // experiment_variant (soft/hard) — à ne pas confondre avec `variant`, qui ne
  // distingue que les deux types de paywall (gate/upsell). ATTENTION : la sonde
  // exclut les comptes internes (règle A4), donc une propriété émise UNIQUEMENT
  // par un compte de test prod compte pour 0 ici — et la carte reste éteinte.
  { name: "experiment_id", onEvent: "*" },
  { name: "experiment_variant", onEvent: "*" },
  // Prix et plans PAR CADENCE sur le paywall. `price` seul est ambigu :
  // `plan_shown` liste deux plans, le montant n'en couvrait qu'un — et un plan
  // mensuel a pu sortir avec le montant hebdo (cf. EXPECTED_ARM_PRICING).
  { name: "price_weekly", onEvent: "paywall_viewed" },
  { name: "price_monthly", onEvent: "paywall_viewed" },
  { name: "plan_weekly", onEvent: "paywall_viewed" },
  { name: "plan_monthly", onEvent: "paywall_viewed" },
  // Le plan pré-sélectionné à l'ouverture + sa cadence : c'est lui qui part au
  // checkout si la personne ne touche à rien.
  { name: "plan_preselected", onEvent: "paywall_viewed" },
  { name: "plan_preselected_period", onEvent: "paywall_viewed" },
  // Nombre de cibles incluses dans l'offre affichée (1 en soft, 3 en hard) :
  // sans lui, deux prix ne sont pas comparables.
  { name: "max_targets", onEvent: "paywall_viewed" },
  // ─── Issue du paiement sur subscription_completed — ATTENDUES, ABSENTES ────
  // L'event part sur CHAQUE cycle de renouvellement, encaissé ou non : sur la
  // fenêtre du test, 35 events pour 27 encaissements (6 échecs + 2 remboursés).
  // Aucune propriété actuelle ne les sépare. Ces trois-là suffisent, et la carte
  // Fiabilité les affichera « attendues, absentes » jusqu'à leur arrivée (A1).
  //
  // `payment_status` — l'issue réelle du prélèvement (succeeded / failed /
  // refunded). C'est LA propriété manquante : sans elle un cycle échoué est
  // indistinguable d'un encaissement.
  { name: "payment_status", onEvent: "subscription_completed", notYetEmitted: true },
  // `payment_id` — l'identifiant Whop `pay_*`. Clé d'IDEMPOTENCE (un même
  // paiement ne doit produire qu'un event, quel que soit le nombre de livraisons
  // du webhook) ET clé de jointure EXACTE avec whopPayments.whopId : aujourd'hui
  // la jointure passe par membership_id, qui identifie l'abonnement, pas le CYCLE.
  { name: "payment_id", onEvent: "subscription_completed", notYetEmitted: true },
  // `paid_at` — l'instant de l'encaissement, distinct du timestamp d'émission.
  // Le lot serveur de 06:00 UTC rapporte les paiements de la veille : sans lui,
  // la série quotidienne PostHog est décalée d'un jour par rapport à Whop.
  { name: "paid_at", onEvent: "subscription_completed", notYetEmitted: true },
  // ─── Pays du visiteur (GeoIP) — SONDES du chantier « trafic par pays » ─────
  // On ne peut pas savoir depuis le tracker si GeoIP est actif sur le projet
  // PostHog : c'est un réglage d'INGESTION, invisible d'ici, et la clé API ne
  // quitte pas le runtime Convex. Ces trois sondes répondent au cron suivant.
  //
  //   `$geoip_country_name`        > 0 ⇒ GeoIP écrit sur les EVENTS ;
  //   `… (bas de funnel)`          > 0 ⇒ et il tient jusqu'à la vente ;
  //   `… (personne)` SEULE  > 0    ⇒ GeoIP n'écrit que sur la PERSONNE, donc
  //     inexploitable pour segmenter — même piège que `source` et `language`,
  //     posées à l'inscription, qui rendent 100 % et 84 % d'« inconnu » sur les
  //     visiteurs (relevé de prod du 30/08).
  //
  // Notation entre CROCHETS : le nom commence par `$`, l'accès par point est
  // ambigu en HogQL. `notYetEmitted` marque « déclarée, pas encore vérifiée » —
  // le retour du drapeau est MANUEL, après lecture de la carte (règle A1).
  {
    name: "$geoip_country_name",
    onEvent: "*",
    notYetEmitted: true,
    cond: "isNotNull(properties['$geoip_country_name'])",
  },
  {
    name: "$geoip_country_name (bas de funnel)",
    onEvent: "subscription_completed",
    notYetEmitted: true,
    cond:
      "event = 'subscription_completed' AND isNotNull(properties['$geoip_country_name'])",
  },
  // Le CODE ISO, sondé pour la même raison que le nom : le tracker ne peut pas
  // savoir si GeoIP l'écrit. S'il est peuplé, la segmentation bascule dessus et
  // les pays s'affichent en français des deux côtés de l'écran (Intl.DisplayNames
  // ne sait traduire qu'un code) ; sinon on reste sur le nom anglais de PostHog.
  // La requête prend le code AVEC REPLI sur le nom, donc aucun état cassé
  // possible : la sonde dit seulement lequel des deux a servi.
  {
    name: "$geoip_country_code",
    onEvent: "*",
    notYetEmitted: true,
    cond: "isNotNull(properties['$geoip_country_code'])",
  },
  {
    name: "$geoip_country_name (personne)",
    onEvent: "*",
    notYetEmitted: true,
    cond: "isNotNull(person.properties['$geoip_country_name'])",
  },
];

/**
 * VALEURS de result attendues sur handle_search_result. Une VALEUR n'est pas une
 * propriété (pas de sonde isNotNull) : on la déclare ici, la carte compare la
 * déduction à la mesure.
 * « paywalled » : la recherche des gens sans accès n'émettait AUCUN result (le
 * paywall intercepte après handle_submitted, la recherche ne s'exécute jamais)
 * → on les déduisait par soustraction (handle_submitted − handle_search_result).
 * ÉMIS depuis le 03/08 (96 occurrences) : la carte l'affiche MESURÉ, et la
 * déduction devient un contrôle de cohérence au lieu d'une estimation.
 */
export const EXPECTED_RESULT_VALUES: { event: string; value: string; notYetEmitted: boolean }[] = [
  { event: "handle_search_result", value: "paywalled", notYetEmitted: false },
];

/**
 * OFFRE ATTENDUE PAR BRAS du test paywall_ab_2026_08. Sert de RÉFÉRENCE au
 * contrôle « le bras sert-il bien son offre » : un bras qui affiche les plans ou
 * les montants de l'autre invalide la comparaison, et l'écart ne se voit pas
 * dans un agrégat (les deux prix existent tous les deux au catalogue).
 *
 * Prix vérifiés côté Whop le 03/08 — les quatre existent avec la BONNE cadence
 * (4,99 €/7 j, 16,99 €/30 j, 9,99 €/7 j, 29,99 €/30 j). Le piège : 9,99 € existe
 * AUSSI en mensuel au catalogue, donc un montant seul ne prouve pas la cadence —
 * c'est le couple (plan, prix) qui fait foi.
 */
export const EXPECTED_ARM_PRICING: {
  variant: "soft" | "hard";
  label: string;
  planWeekly: string;
  planMonthly: string;
  priceWeekly: number;
  priceMonthly: number;
  maxTargets: number;
  freeTier: boolean;
}[] = [
  {
    variant: "soft",
    label: "A — paywall souple",
    planWeekly: "snytch_target_weekly",
    planMonthly: "snytch_target_monthly",
    priceWeekly: 4.99,
    priceMonthly: 16.99,
    maxTargets: 1,
    // Le plan gratuit N'EXISTE QUE dans ce bras : un free_tier_started portant
    // experiment_variant=hard signale une fuite d'offre, pas un choix produit.
    freeTier: true,
  },
  {
    variant: "hard",
    label: "B — paywall bloquant",
    planWeekly: "snytch_trio_weekly",
    planMonthly: "snytch_trio_monthly",
    priceWeekly: 9.99,
    priceMonthly: 29.99,
    maxTargets: 3,
    freeTier: false,
  },
];

/**
 * VALEURS attendues de `paywall_id` : les 7 emplacements de paywall de l'app, PAS
 * encore émis. `variant` ne distingue que gate/upsell, donc les paywalls forcés
 * sont aujourd'hui indistinguables. `forced` sépare les paywalls SUBIS (l'app
 * bloque tant qu'on n'a pas payé) du seul paywall VOLONTAIRE, menu_upsell, où la
 * personne clique délibérément sur une offre depuis le menu.
 *
 * RÈGLE DURE : ne JAMAIS mettre menu_upsell dans le même tableau de conversion que
 * les paywalls forcés. Son dénominateur n'a pas le même sens (un clic choisi n'est
 * pas un mur subi), les comparer donnerait un taux trompeur. L'UI le range à part.
 */
export const EXPECTED_PAYWALL_IDS: { id: string; label: string; forced: boolean }[] = [
  { id: "onboarding_target", label: "Onboarding — ajout de cible", forced: true },
  { id: "search_first", label: "Première recherche", forced: true },
  { id: "search_second_target", label: "Deuxième cible en recherche", forced: true },
  { id: "event_locked", label: "Événement verrouillé", forced: true },
  { id: "see_who", label: "Voir qui a fait quoi", forced: true },
  { id: "expired", label: "Accès expiré", forced: true },
  { id: "menu_upsell", label: "Menu — offre (clic volontaire)", forced: false },
];

/** Alias SQL sûr pour un nom d'event (`$pageview` → `pageview`, etc.). */
export function eventAlias(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "");
}

/** Noms d'events du contrat (ordre stable). */
export const CONTRACT_EVENT_NAMES: string[] = CONTRACT_EVENTS.map((e) => e.name);

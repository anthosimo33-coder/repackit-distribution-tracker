/**
 * DÉCLENCHEURS des deux notifications Whop — fonctions PURES, testées par
 * lib/whop-notify-triggers.test.ts. `convex/whopSync.ts` ne fait que les appeler
 * au moment de l'upsert.
 *
 * Aucune intégration nouvelle n'est nécessaire : la synchro horaire ingère DÉJÀ
 * tout ce qu'il faut (`disputeDueAt`/`disputeReason` via
 * whopApi.extractOpenDispute, et `status`/`billingReason`/`failureMessage`/
 * `retryable` sur chaque paiement). On se contente de repérer les TRANSITIONS.
 *
 * ─── POURQUOI DES TRANSITIONS, ET PAS UN ÉTAT ────────────────────────────────
 * La synchro repasse sur les mêmes paiements toutes les heures. Notifier sur un
 * ÉTAT (« ce paiement est en litige ») produirait une alerte par heure tant que
 * le litige est ouvert. On notifie donc au PASSAGE dans l'état, une seule fois.
 *
 * ─── LE PIÈGE DE LA PREMIÈRE SYNCHRO ─────────────────────────────────────────
 * Un paiement vu pour la première fois (INSERT) n'a pas d'état précédent. Le
 * traiter comme une transition ferait partir une salve d'alertes à la première
 * synchro d'un projet, ou après une purge : tout l'historique des litiges et des
 * échecs remonterait d'un coup. Mais ignorer purement les inserts raterait les
 * échecs de renouvellement, qui apparaissent JUSTEMENT comme des lignes neuves
 * (la ligne naît au moment de l'échec).
 *
 * D'où la fenêtre de FRAÎCHEUR : sur un insert, on ne notifie que si l'événement
 * est récent. Un backfill d'historique reste muet, un échec de cette nuit passe.
 */

/**
 * Au-delà, un paiement découvert à l'insert est tenu pour de l'HISTORIQUE et ne
 * déclenche rien. Large devant le cron horaire : tolère un run manqué ou une
 * synchro qui rattrape son retard, sans rouvrir la porte au backfill.
 */
export const FRESH_INSERT_MS = 6 * 60 * 60 * 1000;

/**
 * Motif de facturation d'un RENOUVELLEMENT. Valeur brute Whop ; `undefined` sur
 * les lignes importées avant sa capture — on ne DEVINE pas qu'une ligne sans
 * motif est un renouvellement (on notifierait des premiers paiements ratés).
 */
export const RENEWAL_BILLING_REASON = "subscription_cycle";

/** Sous-ensemble des champs qui décident. Volontairement minimal. */
export type WhopPaymentSnapshot = {
  status: string;
  billingReason?: string;
  retryable?: boolean;
  disputeDueAt?: number;
  /** Date du paiement (ou de sa tentative) — sert la fenêtre de fraîcheur. */
  paidAt: number;
};

function isFresh(snapshot: WhopPaymentSnapshot, now: number): boolean {
  return now - snapshot.paidAt <= FRESH_INSERT_MS;
}

/**
 * Litige EN COURS. Deux signaux, l'un ou l'autre suffit : une échéance de
 * réponse (le cas riche) ou le simple statut `disputed` (quand l'API ne détaille
 * pas). Un litige résolu a déjà été écarté en amont par extractOpenDispute, qui
 * vide `disputeDueAt` — le champ retombe donc à undefined tout seul.
 */
export function isDisputed(s: WhopPaymentSnapshot): boolean {
  return s.disputeDueAt !== undefined || s.status === "disputed";
}

/**
 * Échec de renouvellement qui APPELLE UNE ACTION. Trois conditions :
 * échec, motif de renouvellement explicite, et relances Whop épuisées.
 *
 * `retryable !== true` plutôt que `retryable === false` : le champ est optionnel,
 * et un échec dont on ignore s'il sera relancé mérite d'être vu (on préfère le
 * signaler à tort que de rater un désabonnement silencieux).
 *
 * Les échecs ENCORE relançables sont volontairement exclus ici : Whop va les
 * rejouer tout seul, il n'y a rien à faire dans l'heure. Ils remontent dans le
 * digest quotidien (arbitrage du chantier).
 */
export function isActionableRenewalFailure(s: WhopPaymentSnapshot): boolean {
  return (
    s.status === "failed" &&
    s.billingReason === RENEWAL_BILLING_REASON &&
    s.retryable !== true
  );
}

/** Échec de renouvellement que Whop VA relancer → matière à digest, pas à alerte. */
export function isRetryableRenewalFailure(s: WhopPaymentSnapshot): boolean {
  return (
    s.status === "failed" &&
    s.billingReason === RENEWAL_BILLING_REASON &&
    s.retryable === true
  );
}

/**
 * Fenêtre du digest : il couvre la JOURNÉE écoulée. Sans borne, un échec
 * relançable resterait dans le message tous les matins jusqu'à sa résolution —
 * le digest deviendrait un stock au lieu d'un flux.
 */
export const DIGEST_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Échec relançable SURVENU dans la journée écoulée : la ligne du digest promise
 * par l'arbitrage (immédiat pour les échecs épuisés, digest pour ceux que Whop
 * va rejouer).
 */
export function isDigestableRenewalFailure(
  s: WhopPaymentSnapshot,
  now: number,
): boolean {
  return isRetryableRenewalFailure(s) && now - s.paidAt <= DIGEST_LOOKBACK_MS;
}

/**
 * Passage dans un état notifiable. `prev === null` = ligne neuve (insert), qui
 * n'est retenue que si elle est FRAÎCHE (cf l'en-tête).
 */
function entersState(
  prev: WhopPaymentSnapshot | null,
  next: WhopPaymentSnapshot,
  now: number,
  predicate: (s: WhopPaymentSnapshot) => boolean,
): boolean {
  if (!predicate(next)) return false;
  if (prev === null) return isFresh(next, now);
  return !predicate(prev);
}

/** Un litige vient-il de s'OUVRIR sur ce paiement ? */
export function shouldNotifyDispute(
  prev: WhopPaymentSnapshot | null,
  next: WhopPaymentSnapshot,
  now: number,
): boolean {
  return entersState(prev, next, now, isDisputed);
}

/**
 * Un renouvellement vient-il de devenir un échec ACTIONNABLE ?
 *
 * Couvre deux passages distincts, et c'est voulu :
 *   - un échec non relançable qui apparaît ;
 *   - un échec DÉJÀ connu dont les relances viennent de s'épuiser
 *     (retryable true → false). C'est le moment où il devient actionnable, et le
 *     rater serait passer à côté du seul instant utile.
 */
export function shouldNotifyRenewalFailure(
  prev: WhopPaymentSnapshot | null,
  next: WhopPaymentSnapshot,
  now: number,
): boolean {
  return entersState(prev, next, now, isActionableRenewalFailure);
}

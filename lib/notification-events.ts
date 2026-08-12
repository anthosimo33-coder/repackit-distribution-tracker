/**
 * CATALOGUE des événements notifiables hors-app — source unique des clés, de
 * leur libellé admin et de leur classement immédiat / digest.
 *
 * ⚠️ Règle A6 — un module `convex/` ne peut pas importer `lib/`. Ce fichier a un
 * JUMEAU STRICTEMENT IDENTIQUE en `convex/notificationEvents.ts` ; la parité est
 * verrouillée par `lib/notification-events.test.ts`, qui importe LES DEUX. Toute
 * modification ici doit être reportée là-bas (le test casse sinon).
 *
 * Côté lib : consommé par l'écran admin (rendu d'une bascule par événement).
 * Côté convex : consommé par la répartition (`convex/notifications.ts`) pour
 * savoir si un événement est activé sur le projet.
 */

/**
 * Clé STABLE d'un événement. Elle est PERSISTÉE dans
 * `projects.notify.enabledEvents` → ne JAMAIS renommer une clé existante sans
 * migration (un renommage éteint silencieusement l'événement).
 */
export type NotificationEventKey =
  | "video_submitted"
  | "video_resubmitted"
  | "video_approved"
  | "video_rejected"
  | "publication_confirmed"
  | "whop_dispute"
  | "whop_renewal_failed"
  | "digest_overdue_missions"
  | "digest_pay_cycles"
  | "digest_warmup_late"
  | "digest_clipper_sans_talent";

/**
 * `immediate` = part dès la détection (garde-fou anti-flood en amont pour les
 * soumissions). `digest` = agrégé dans le message quotidien unique.
 */
export type NotificationEventKind = "immediate" | "digest";

export interface NotificationEventDef {
  key: NotificationEventKey;
  kind: NotificationEventKind;
  /** Libellé de la bascule dans l'écran admin. */
  label: string;
  /** Une ligne d'explication sous la bascule. */
  hint: string;
}

export const NOTIFICATION_EVENTS: readonly NotificationEventDef[] = [
  {
    key: "video_submitted",
    kind: "immediate",
    label: "Vidéo soumise",
    hint: "Une créatrice dépose une vidéo à valider.",
  },
  {
    key: "video_resubmitted",
    kind: "immediate",
    label: "Vidéo re-soumise",
    hint: "Une vidéo repart en validation après une demande de correction.",
  },
  {
    key: "video_approved",
    kind: "immediate",
    label: "Vidéo validée",
    hint: "Une vidéo passe la revue. Notifié même si c'est toi qui valides — le groupe sert de journal.",
  },
  {
    key: "video_rejected",
    kind: "immediate",
    label: "Vidéo refusée",
    hint: "Une vidéo est renvoyée à sa créatrice, avec le motif complet.",
  },
  {
    key: "publication_confirmed",
    kind: "immediate",
    label: "Publication confirmée",
    hint: "Un lien de publication est saisi — par la créatrice ou par l'admin en secours. Les publications rapprochées sont regroupées.",
  },
  {
    key: "whop_dispute",
    kind: "immediate",
    label: "Litige bancaire Whop",
    hint: "Un client conteste un paiement — avec le délai de réponse restant.",
  },
  {
    key: "whop_renewal_failed",
    kind: "immediate",
    label: "Renouvellement échoué",
    hint: "Uniquement quand Whop ne relancera plus le paiement ; les échecs encore relançables partent dans le digest.",
  },
  {
    key: "digest_overdue_missions",
    kind: "digest",
    label: "Deadlines de production dépassées",
    hint: "Section du digest quotidien.",
  },
  {
    key: "digest_pay_cycles",
    kind: "digest",
    label: "Cycles de paiement dus",
    hint: "Section du digest quotidien. Nombre uniquement, jamais de montant.",
  },
  {
    key: "digest_warmup_late",
    kind: "digest",
    label: "Comptes en warmup en retard",
    hint: "Section du digest quotidien. Créateurs partenaires uniquement — les comptes de clippeur suivent un autre modèle.",
  },
  {
    key: "digest_clipper_sans_talent",
    kind: "digest",
    label: "Comptes en chauffe sans talent apparié",
    hint: "Section du digest quotidien. Alerte PENDANT la chauffe : après, les trois jours sont perdus.",
  },
] as const;

/** Toutes les clés, dans l'ordre d'affichage du catalogue. */
export const NOTIFICATION_EVENT_KEYS: readonly NotificationEventKey[] =
  NOTIFICATION_EVENTS.map((e) => e.key);

/**
 * `enabledEvents` est une LISTE D'AUTORISATION : ce qui n'y figure pas est
 * éteint. Conséquences voulues — un projet sans config ne notifie rien, et un
 * événement ajouté plus tard au catalogue arrive ÉTEINT (il faut un geste admin
 * explicite pour l'allumer, jamais une surprise après déploiement).
 */
export function isEventEnabled(
  enabledEvents: readonly string[] | undefined,
  key: NotificationEventKey,
): boolean {
  return enabledEvents !== undefined && enabledEvents.includes(key);
}

/** Filtre une saisie quelconque sur les clés connues (dédupliquée, ordre du catalogue). */
export function sanitizeEnabledEvents(
  input: readonly string[],
): NotificationEventKey[] {
  return NOTIFICATION_EVENT_KEYS.filter((k) => input.includes(k));
}

/**
 * CONSTRUCTEURS de messages de notification — fonctions PURES (aucun accès DB,
 * aucun import `_generated`), testées par `lib/notification-message.test.ts`.
 *
 * Module SERVEUR uniquement : l'UI ne rend jamais un message Telegram, donc pas
 * de jumeau `lib/` ici (contrairement à `convex/notificationEvents.ts`, dont
 * l'écran admin a besoin).
 *
 * ─── CONFIDENTIALITÉ — contrainte de conception, pas une consigne de relecture ─
 * Aucun message ne doit porter de donnée sensible : ni montant de paie
 * individuel, ni email de créatrice. Deux garde-fous, dans cet ordre :
 *   1. les TYPES d'entrée ci-dessous n'exposent aucun champ email ni montant —
 *      une fuite demanderait de changer une signature, pas d'oublier une ligne ;
 *   2. `lib/notification-message.test.ts` re-scanne la SORTIE de chaque
 *      constructeur (aucune adresse email, aucun symbole monétaire, aucun code
 *      ISO de devise) et casse sinon.
 * Le lien vers Jarvia suffit : l'authentification protège le détail.
 *
 * Exception assumée et unique : le PSEUDO PUBLIC Whop du client (`memberName`)
 * apparaît sur les deux événements Whop. Sans lui l'alerte n'est pas
 * actionnable — on ne saurait pas quel litige ouvrir. Ce n'est ni un email ni un
 * montant. Le montant du litige, lui, n'est jamais repris.
 */

import { escapeTelegram } from "./notifyApi";

/** Longueur max d'une liste à puces avant repli « et N autres ». */
const LIST_CAP = 8;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Accord au pluriel (français) : `plural(2, "vidéo")` → "vidéos". */
function plural(n: number, singular: string, suffix = "s"): string {
  return n > 1 ? `${singular}${suffix}` : singular;
}

/** Ligne à puce échappée. */
function bullet(text: string): string {
  return `• ${escapeTelegram(text)}`;
}

/**
 * Rend une liste à puces PLAFONNÉE. Le repli est explicite (« et 12 autres »)
 * plutôt que silencieux : une troncature muette se lit comme un total.
 *
 * `total` permet d'annoncer le vrai nombre quand l'échantillon reçu est LUI-MÊME
 * déjà plafonné en amont (tampon anti-flood : on garde 25 lignes mais on compte
 * tout). Absent ⇒ le total est celui des lignes fournies.
 */
function bulletList(lines: string[], total = lines.length, cap = LIST_CAP): string {
  const shown = lines.slice(0, cap).map(bullet);
  const rest = total - Math.min(lines.length, cap);
  if (rest > 0) shown.push(`• … et ${rest} ${plural(rest, "autre")}`);
  return shown.join("\n");
}

/** Lien HTML Telegram (l'URL est construite par nos soins, jamais saisie). */
function link(label: string, url: string): string {
  return `<a href="${url}">${escapeTelegram(label)}</a>`;
}

// ─── URLs profondes ──────────────────────────────────────────────────────────

/**
 * Lien vers LA soumission concernée (pas la liste) — c'est la demande explicite
 * du chantier. La page `validation` lit `?soumission=` pour surligner et
 * dérouler la ligne visée.
 */
export function validationUrl(
  appBaseUrl: string,
  projectSlug: string,
  assignmentId?: string,
): string {
  const base = `${appBaseUrl}/admin/${projectSlug}/validation`;
  return assignmentId ? `${base}?soumission=${assignmentId}` : base;
}

export function paymentsUrl(appBaseUrl: string, projectSlug: string): string {
  return `${appBaseUrl}/admin/${projectSlug}/paiements`;
}

export function dashboardUrl(appBaseUrl: string, projectSlug: string): string {
  return `${appBaseUrl}/admin/${projectSlug}/dashboard`;
}

// ─── Délais ──────────────────────────────────────────────────────────────────

/**
 * Délai restant en clair (« 5 j 3 h »). Rend `null` si l'échéance est passée ou
 * inconnue — l'appelant écrit alors un texte explicite plutôt qu'un « 0 j » qui
 * se lirait comme « aucune urgence ».
 */
export function remainingDelay(dueAt: number, now: number): string | null {
  const ms = dueAt - now;
  if (ms <= 0) return null;
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h`;
  return `moins d'une heure`;
}

/** Jours de retard PLEINS depuis une échéance dépassée (0 si pas en retard). */
export function daysLate(dueDate: number, now: number): number {
  return Math.max(0, Math.floor((now - dueDate) / DAY_MS));
}

// ─── 1 & 2. Soumission / re-soumission vidéo ─────────────────────────────────

/**
 * Contexte d'UNE soumission. Aucun champ email, aucun montant — cf l'en-tête.
 * `campaignName` et `formatName` sont indépendants : une mission d'origine
 * script porte une campagne, une mission d'origine format porte un format, et
 * rien n'interdit d'avoir les deux. On affiche ce qui existe plutôt que de
 * choisir à la place du lecteur.
 */
export interface SubmissionContext {
  creatorName: string;
  campaignName: string | null;
  formatName: string | null;
  /** Cibles de publication : « 1 vidéo → N posts ». */
  targets: { platform: string; accountHandle: string | null }[];
}

/** « Campagne Été (format : Hook Erreur) », ou l'un des deux, ou « — ». */
function describeMission(ctx: SubmissionContext): string {
  const { campaignName, formatName } = ctx;
  if (campaignName && formatName) return `${campaignName} (format : ${formatName})`;
  return campaignName ?? formatName ?? "—";
}

/** « TikTok · @handle » par cible, séparées par «, ». Handle inconnu → plateforme seule. */
function describeTargets(ctx: SubmissionContext): string {
  if (ctx.targets.length === 0) return "aucune cible";
  return ctx.targets
    .map((t) => (t.accountHandle ? `${t.platform} · ${t.accountHandle}` : t.platform))
    .join(", ");
}

/** Ligne compacte d'une soumission, pour le message groupé. */
export function submissionLine(ctx: SubmissionContext): string {
  return `${ctx.creatorName} — ${describeMission(ctx)} → ${describeTargets(ctx)}`;
}

/**
 * Message d'UNE soumission (front montant de la fenêtre anti-flood). Le lien
 * pointe sur CETTE soumission.
 */
export function buildSubmissionMessage(params: {
  ctx: SubmissionContext;
  isResubmission: boolean;
  appBaseUrl: string;
  projectSlug: string;
  assignmentId: string;
}): string {
  const { ctx, isResubmission, appBaseUrl, projectSlug, assignmentId } = params;
  const title = isResubmission
    ? "🔁 <b>Vidéo re-soumise après correction</b>"
    : "🎬 <b>Nouvelle vidéo à valider</b>";
  return [
    title,
    "",
    `<b>${escapeTelegram(ctx.creatorName)}</b> — ${escapeTelegram(describeMission(ctx))}`,
    `→ ${escapeTelegram(describeTargets(ctx))}`,
    "",
    link(
      "Ouvrir la validation",
      validationUrl(appBaseUrl, projectSlug, assignmentId),
    ),
  ].join("\n");
}

/**
 * Message GROUPÉ des soumissions arrivées pendant la fenêtre anti-flood (celles
 * qui suivent le front montant). Le lien pointe sur la LISTE : il y a plusieurs
 * soumissions, aucune n'est « la » bonne.
 */
export function buildGroupedSubmissionsMessage(params: {
  /** Échantillon des lignes conservées (le tampon plafonne à PENDING_CAP). */
  lines: string[];
  /** Total RÉEL de soumissions tamponnées — peut dépasser `lines.length`. */
  total?: number;
  appBaseUrl: string;
  projectSlug: string;
}): string {
  const { lines, appBaseUrl, projectSlug } = params;
  const n = params.total ?? lines.length;
  return [
    `🎬 <b>${n} autre${n > 1 ? "s" : ""} ${plural(n, "vidéo")} à valider</b>`,
    "",
    bulletList(lines, n),
    "",
    link("Ouvrir la validation", validationUrl(appBaseUrl, projectSlug)),
  ].join("\n");
}

// ─── 3. Litige bancaire Whop ─────────────────────────────────────────────────

/**
 * Le délai de réponse est l'information qui rend l'alerte utile : les frais de
 * litige dépassent l'abonnement, et l'échéance Whop se compte en jours.
 * `dueAt` absent (l'API ne l'expose pas toujours) → on le DIT, on n'invente pas.
 */
export function buildDisputeMessage(params: {
  memberName: string | null;
  reason: string | null;
  dueAt: number | null;
  now: number;
  appBaseUrl: string;
  projectSlug: string;
}): string {
  const { memberName, reason, dueAt, now, appBaseUrl, projectSlug } = params;
  const delay =
    dueAt === null
      ? "délai non communiqué par Whop"
      : (remainingDelay(dueAt, now) ?? "échéance DÉPASSÉE");
  return [
    "⚠️ <b>Litige bancaire ouvert</b>",
    "",
    `Client : ${escapeTelegram(memberName ?? "inconnu")}`,
    `Motif : ${escapeTelegram(reason ?? "non précisé")}`,
    `Délai de réponse : <b>${escapeTelegram(delay)}</b>`,
    "",
    link("Ouvrir les paiements", paymentsUrl(appBaseUrl, projectSlug)),
  ].join("\n");
}

// ─── 4. Renouvellement échoué ────────────────────────────────────────────────

/**
 * N'est construit QUE pour les échecs non relançables (arbitrage du chantier) :
 * un échec que Whop va relancer tout seul n'appelle aucune action et part dans
 * le digest. Le message le dit explicitement pour que la distinction soit
 * lisible sans connaître la règle.
 */
export function buildRenewalFailedMessage(params: {
  memberName: string | null;
  failureMessage: string | null;
  appBaseUrl: string;
  projectSlug: string;
}): string {
  const { memberName, failureMessage, appBaseUrl, projectSlug } = params;
  return [
    "💳 <b>Renouvellement échoué</b>",
    "",
    `Client : ${escapeTelegram(memberName ?? "inconnu")}`,
    `Cause : ${escapeTelegram(failureMessage ?? "non communiquée par Whop")}`,
    "Whop ne relancera pas ce paiement.",
    "",
    link("Ouvrir les paiements", paymentsUrl(appBaseUrl, projectSlug)),
  ].join("\n");
}

// ─── 5. Digest quotidien ─────────────────────────────────────────────────────

/**
 * Sections du digest. Chacune est indépendamment activable côté admin ⇒ une
 * section éteinte arrive ici en liste VIDE, exactement comme une section sans
 * contenu. Les trois vides ⇒ `buildDigestMessage` rend `null` et RIEN n'est
 * envoyé (« rien du tout s'il n'y a rien à signaler »).
 *
 * `payCycles` ne porte que des NOMS, jamais de montant : le montant dû est une
 * donnée de paie individuelle, exclue par la contrainte de confidentialité.
 */
export interface DigestSections {
  overdueMissions: { creatorName: string; missionLabel: string; daysLate: number }[];
  payCycles: { creatorName: string }[];
  warmupLate: { handle: string; missedDays: number }[];
  /**
   * Échecs de renouvellement que Whop VA relancer, survenus dans la journée.
   * Contrepartie de l'arbitrage « immédiat seulement si non relançable » : ils
   * ne disparaissent pas, ils changent de canal. Rattachés à la bascule
   * `whop_renewal_failed` (même événement, autre acheminement).
   */
  retryableRenewalFailures: { memberName: string }[];
}

export function buildDigestMessage(params: {
  projectName: string;
  sections: DigestSections;
  appBaseUrl: string;
  projectSlug: string;
}): string | null {
  const { projectName, sections, appBaseUrl, projectSlug } = params;
  const { overdueMissions, payCycles, warmupLate, retryableRenewalFailures } =
    sections;
  if (
    overdueMissions.length === 0 &&
    payCycles.length === 0 &&
    warmupLate.length === 0 &&
    retryableRenewalFailures.length === 0
  ) {
    return null;
  }

  const blocks: string[] = [
    `📋 <b>Digest quotidien — ${escapeTelegram(projectName)}</b>`,
  ];

  if (overdueMissions.length > 0) {
    const n = overdueMissions.length;
    blocks.push(
      `⏰ <b>${n} ${plural(n, "deadline")} de production ${plural(n, "dépassée")}</b>\n` +
        bulletList(
          overdueMissions.map(
            (m) =>
              `${m.creatorName} — ${m.missionLabel} (${m.daysLate} ${plural(m.daysLate, "jour")} de retard)`,
          ),
        ),
    );
  }

  if (payCycles.length > 0) {
    const n = payCycles.length;
    // « dû » perd son accent circonflexe au pluriel (dû → dus) : le helper
    // générique produirait « dûs ». Cas particulier assumé plutôt qu'un helper
    // de conjugaison pour un seul mot.
    blocks.push(
      `💰 <b>${n} ${plural(n, "cycle")} de paiement ${n > 1 ? "dus" : "dû"}</b>\n` +
        bulletList(payCycles.map((c) => c.creatorName)),
    );
  }

  if (warmupLate.length > 0) {
    const n = warmupLate.length;
    blocks.push(
      `🔥 <b>${n} ${plural(n, "compte")} en warmup en retard</b>\n` +
        bulletList(
          warmupLate.map(
            (w) =>
              `${w.handle} (${w.missedDays} ${plural(w.missedDays, "jour")} ${plural(w.missedDays, "manqué")})`,
          ),
        ),
    );
  }

  if (retryableRenewalFailures.length > 0) {
    const n = retryableRenewalFailures.length;
    blocks.push(
      `💳 <b>${n} ${plural(n, "renouvellement")} en échec</b> — Whop ${n > 1 ? "les" : "le"} relancera\n` +
        bulletList(retryableRenewalFailures.map((r) => r.memberName)),
    );
  }

  blocks.push(link("Ouvrir le dashboard", dashboardUrl(appBaseUrl, projectSlug)));
  return blocks.join("\n\n");
}

// ─── Test manuel depuis l'écran admin ────────────────────────────────────────

/**
 * Message du bouton « Envoyer un test ». C'est lui qui valide le couple
 * jeton + destinataire SANS attendre un vrai événement.
 */
export function buildTestMessage(projectName: string): string {
  return [
    "✅ <b>Jarvia est branché</b>",
    "",
    `Projet : ${escapeTelegram(projectName)}`,
    "Si tu lis ce message, le bot et le destinataire sont bien configurés.",
  ].join("\n");
}

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
// Fuseau ÉPINGLÉ sur Paris (cf convex/dateFr.ts) : une date de post rendue en
// UTC afficherait la veille pour 28 % des publications — défaut #52.
import { formatDayMonthFr } from "./dateFr";

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

/**
 * Écran Assignments, éventuellement PRÉ-FILTRÉ sur une créatrice.
 *
 * `?createur=` est lu à l'initialisation du filtre côté écran. Sans lui, le
 * lien d'un bilan de fin de journée tomberait sur la liste complète du projet,
 * et il faudrait re-filtrer à la main pour retrouver les deux posts dont le
 * message vient de parler.
 */
export function assignmentsUrl(
  appBaseUrl: string,
  projectSlug: string,
  creatorId?: string,
): string {
  const base = `${appBaseUrl}/admin/${projectSlug}/assignments`;
  return creatorId ? `${base}?createur=${creatorId}` : base;
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
  /**
   * true = la vidéo est un CLIP monté par un clippeur, pas une vidéo de
   * créatrice partenaire. Ces messages ont été écrits quand une seule population
   * existait ; laissés tels quels, ils annonceraient « la créatrice » là où il y
   * a un clippeur. Les deux flux n'ont ni le même auteur ni le même rythme, et
   * Kevin lit ce canal.
   */
  isClip?: boolean;
}

/** Suffixe qui distingue un clip d'un post de partenaire dans une ligne compacte. */
function clipTag(ctx: { isClip?: boolean }): string {
  return ctx.isClip ? " (clip)" : "";
}

/**
 * « Campagne Été (format : Hook Erreur) », ou l'un des deux, ou « — ».
 *
 * Signature réduite aux DEUX champs réellement lus : le nommage d'une mission est
 * le même pour une soumission, une publication ou une décision de revue, et
 * exiger un `SubmissionContext` complet obligerait les autres à inventer des
 * cibles qu'ils n'ont pas.
 */
function describeMission(ctx: {
  campaignName: string | null;
  formatName: string | null;
}): string {
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
  return `${ctx.creatorName}${clipTag(ctx)} — ${describeMission(ctx)} → ${describeTargets(ctx)}`;
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
  const objet = ctx.isClip ? "Clip" : "Vidéo";
  const title = isResubmission
    ? `🔁 <b>${objet} re-soumis${ctx.isClip ? "" : "e"} après correction</b>`
    : ctx.isClip
      ? "✂️ <b>Nouveau clip à valider</b>"
      : "🎬 <b>Nouvelle vidéo à valider</b>";
  return [
    title,
    "",
    `<b>${escapeTelegram(ctx.creatorName)}</b>${clipTag(ctx)} — ${escapeTelegram(describeMission(ctx))}`,
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

// ─── Publication confirmée ───────────────────────────────────────────────────

/**
 * Contexte d'UNE publication. Même règle de confidentialité que le reste : ni
 * email, ni montant. L'URL du post est PUBLIQUE par nature — c'est le lien que
 * la créatrice vient de coller.
 */
export interface PublicationContext {
  creatorName: string;
  campaignName: string | null;
  formatName: string | null;
  /** Une entrée par plateforme publiée, avec le lien du post. */
  targets: { platform: string; accountHandle: string | null; url: string | null }[];
  /**
   * true = l'admin a saisi le lien EN SECOURS à la place de la créatrice. À dire
   * explicitement : le geste n'a pas la même valeur de preuve, et c'est la seule
   * façon de distinguer « elle a publié » de « on a rattrapé ».
   */
  byAdmin: boolean;
  /**
   * true = clip publié par son clippeur. Voir `SubmissionContext.isClip` : sans
   * ce drapeau, `publishedBy: "creator"` — qui est CORRECT au sens de D1, le
   * clippeur EST le creatorId — ferait tomber le message dans la branche
   * « la créatrice a publié ».
   */
  isClip?: boolean;
}

/** « TikTok · @handle » par cible publiée (le lien est rendu à part, cliquable). */
function describePublicationTargets(ctx: PublicationContext): string {
  if (ctx.targets.length === 0) return "aucune cible";
  return ctx.targets
    .map((t) => (t.accountHandle ? `${t.platform} · ${t.accountHandle}` : t.platform))
    .join(", ");
}

/** Ligne compacte d'une publication, pour le message groupé. */
export function publicationLine(ctx: PublicationContext): string {
  const suffix = ctx.byAdmin ? " (saisi par l'admin)" : "";
  return `${ctx.creatorName}${clipTag(ctx)} — ${describeMission(ctx)} → ${describePublicationTargets(ctx)}${suffix}`;
}

/**
 * Message d'UNE publication (front montant de la fenêtre anti-flood). Un lien
 * CLIQUABLE par plateforme publiée : c'est l'objet même de la notification, on
 * ne renvoie pas vers Jarvia pour aller le chercher.
 */
export function buildPublicationMessage(params: {
  ctx: PublicationContext;
  appBaseUrl: string;
  projectSlug: string;
}): string {
  const { ctx, appBaseUrl, projectSlug } = params;
  const lignes = [
    ctx.isClip ? "🚀 <b>Clip publié</b>" : "🚀 <b>Publication confirmée</b>",
    "",
    `<b>${escapeTelegram(ctx.creatorName)}</b>${clipTag(ctx)} — ${escapeTelegram(describeMission(ctx))}`,
    `→ ${escapeTelegram(describePublicationTargets(ctx))}`,
  ];
  if (ctx.byAdmin) {
    lignes.push(
      `⚠️ Lien saisi par l'admin en secours, pas par ${
        ctx.isClip ? "le clippeur" : "la créatrice"
      }.`,
    );
  }
  const liens = ctx.targets
    .filter((t): t is typeof t & { url: string } => Boolean(t.url))
    .map((t) => link(`Voir le post ${t.platform}`, t.url));
  if (liens.length > 0) {
    lignes.push("", ...liens);
  }
  lignes.push("", link("Ouvrir les missions", assignmentsUrl(appBaseUrl, projectSlug)));
  return lignes.join("\n");
}

/**
 * Message GROUPÉ des publications arrivées pendant la fenêtre anti-flood — même
 * mécanique que les soumissions : une créatrice qui poste ses cinq vidéos du
 * jour ne doit pas produire cinq messages.
 */
export function buildGroupedPublicationsMessage(params: {
  lines: string[];
  total?: number;
  appBaseUrl: string;
  projectSlug: string;
}): string {
  const { lines, appBaseUrl, projectSlug } = params;
  const n = params.total ?? lines.length;
  return [
    `🚀 <b>${n} autre${n > 1 ? "s" : ""} ${plural(n, "publication")}</b>`,
    "",
    bulletList(lines, n),
    "",
    link("Ouvrir les missions", assignmentsUrl(appBaseUrl, projectSlug)),
  ].join("\n");
}

// ─── Publication EN RETARD ───────────────────────────────────────────────────

/**
 * Contexte d'une publication sortie APRÈS sa date prévue.
 *
 * ⚠️ `lateDays` est TOUJOURS strictement positif ici : le calcul en amont
 * (`convex/calendarStatus.lateDays`) rend `null` pour un post à l'heure OU EN
 * AVANCE, et l'action n'émet rien dans ce cas. Le statut calendrier, lui, range
 * l'avance dans « en retard » — correct pour une pastille « hors date », faux
 * pour un message qui annonce des jours de retard.
 */
export interface LatePublicationContext {
  creatorName: string;
  campaignName: string | null;
  formatName: string | null;
  /** Jours pleins de retard, > 0. */
  lateDays: number;
  /** Jour prévu (ms) — rendu en JJ/MM, fuseau Paris. */
  postDate: number;
  /** Comptes sur lesquels le post est sorti. */
  accountHandles: string[];
  isClip?: boolean;
}

/** « sur @a et @b », ou rien si aucun compte n'est identifiable. */
function surLesComptes(handles: string[]): string {
  if (handles.length === 0) return "";
  if (handles.length === 1) return ` sur ${handles[0]}`;
  return ` sur ${handles.slice(0, -1).join(", ")} et ${handles[handles.length - 1]}`;
}

/** Ligne compacte d'une publication en retard, pour le message groupé. */
export function latePublicationLine(ctx: LatePublicationContext): string {
  return `${ctx.creatorName}${clipTag(ctx)} a publié avec ${ctx.lateDays} jour${
    ctx.lateDays > 1 ? "s" : ""
  } de retard${surLesComptes(ctx.accountHandles)}, prévu le ${formatDayMonthFr(ctx.postDate)}`;
}

export function buildLatePublicationMessage(params: {
  ctx: LatePublicationContext;
  appBaseUrl: string;
  projectSlug: string;
  creatorId: string;
}): string {
  const { ctx, appBaseUrl, projectSlug, creatorId } = params;
  return [
    "🐌 <b>Publication en retard</b>",
    "",
    escapeTelegram(latePublicationLine(ctx)),
    `Mission : ${escapeTelegram(describeMission(ctx))}`,
    "",
    link(
      "Voir ses assignations",
      assignmentsUrl(appBaseUrl, projectSlug, creatorId),
    ),
  ].join("\n");
}

export function buildGroupedLatePublicationsMessage(params: {
  lines: string[];
  total?: number;
  appBaseUrl: string;
  projectSlug: string;
}): string {
  const { lines, appBaseUrl, projectSlug } = params;
  const n = params.total ?? lines.length;
  return [
    `🐌 <b>${n} autre${n > 1 ? "s" : ""} ${plural(n, "publication")} en retard</b>`,
    "",
    bulletList(lines, n),
    "",
    link("Ouvrir les missions", assignmentsUrl(appBaseUrl, projectSlug)),
  ].join("\n");
}

// ─── Bilan de fin de journée ─────────────────────────────────────────────────

/**
 * Contexte du bilan du soir d'UNE créatrice.
 *
 * ⚠️ `posts` ne contient QUE des posts prévus AUJOURD'HUI et pas encore
 * publiés. Jamais les manqués des jours précédents : quelqu'un qui a loupé 30
 * posts il y a dix jours et en a 2 aujourd'hui reçoit un message qui parle de 2
 * posts. Les anciens comptent dans le TAUX, qui est leur seul endroit.
 *
 * ⚠️ « pas encore publié », jamais « manqué ». À l'heure d'envoi la journée
 * n'est pas finie — le statut calendrier ne bascule qu'à minuit, et il reste des
 * heures pour sortir. Le message est une ALERTE actionnable, pas un constat.
 */
export interface EveningReportContext {
  creatorName: string;
  /** Un post prévu aujourd'hui, non publié : sa mission et ses comptes. */
  posts: { missionLabel: string; accountHandles: string[] }[];
  /** Taux à l'heure sur TOUT l'historique. `null` = aucun post passé. */
  onTimeRate: number | null;
}

/** Comptes distincts de tous les posts du bilan, dans l'ordre d'apparition. */
function comptesDuBilan(ctx: EveningReportContext): string[] {
  const out: string[] = [];
  for (const p of ctx.posts) {
    for (const h of p.accountHandles) if (!out.includes(h)) out.push(h);
  }
  return out;
}

export function buildEveningReportMessage(params: {
  ctx: EveningReportContext;
  appBaseUrl: string;
  projectSlug: string;
  creatorId: string;
}): string | null {
  const { ctx, appBaseUrl, projectSlug, creatorId } = params;
  // Aucune créatrice sans post en attente ne doit produire de message. Garde
  // ici EN PLUS du filtre amont : une liste vide qui produirait « n'a pas publié
  // 0 post » est le genre d'envoi qui apprend à ignorer le canal.
  if (ctx.posts.length === 0) return null;
  const n = ctx.posts.length;
  const comptes = comptesDuBilan(ctx);
  const lignes = [
    "🌙 <b>Fin de journée</b>",
    "",
    `<b>${escapeTelegram(ctx.creatorName)}</b> n'a pas encore publié ${n} post${
      n > 1 ? "s" : ""
    } prévu${n > 1 ? "s" : ""} aujourd'hui${escapeTelegram(surLesComptes(comptes))}.`,
  ];
  if (ctx.onTimeRate !== null) {
    lignes.push(
      `Son taux de publication à l'heure est de ${Math.round(ctx.onTimeRate * 100)} %.`,
    );
  }
  lignes.push("", bulletList(ctx.posts.map((p) => p.missionLabel)));
  lignes.push(
    "",
    link(
      "Voir ses assignations",
      assignmentsUrl(appBaseUrl, projectSlug, creatorId),
    ),
  );
  return lignes.join("\n");
}

// ─── Revue vidéo : validée / refusée ─────────────────────────────────────────

/**
 * Contexte d'une décision de revue. `actorName` = qui a tranché.
 *
 * L'auteur de l'action reçoit AUSSI la notification : le canal est un groupe
 * partagé, pas une boîte personnelle — il n'existe pas de destinataire
 * individuel à comparer à l'auteur, et le groupe sert de journal pour l'équipe.
 */
export interface ReviewContext {
  creatorName: string;
  campaignName: string | null;
  formatName: string | null;
  /** Nom de l'admin. JAMAIS son email — repli explicite si le nom manque. */
  actorName: string | null;
  /** true = décision portant sur un CLIP (cf `SubmissionContext.isClip`). */
  isClip?: boolean;
}

const actorLabel = (a: string | null) => a ?? "un administrateur";

export function buildVideoApprovedMessage(params: {
  ctx: ReviewContext;
  appBaseUrl: string;
  projectSlug: string;
}): string {
  const { ctx, appBaseUrl, projectSlug } = params;
  return [
    ctx.isClip ? "✅ <b>Clip validé</b>" : "✅ <b>Vidéo validée</b>",
    "",
    `<b>${escapeTelegram(ctx.creatorName)}</b>${clipTag(ctx)} — ${escapeTelegram(describeMission(ctx))}`,
    `${ctx.isClip ? "Validé" : "Validée"} par ${escapeTelegram(actorLabel(ctx.actorName))}`,
    "",
    link("Ouvrir les missions", assignmentsUrl(appBaseUrl, projectSlug)),
  ].join("\n");
}

/**
 * Refus. Le MOTIF est rendu EN ENTIER et jamais tronqué ici : c'est l'unique
 * contenu utile du message (le plafond global de l'API reste le seul garde-fou,
 * cf clampToTelegramLimit). Il est mis en dernier, juste avant le lien, pour
 * rester lisible même long.
 */
export function buildVideoRejectedMessage(params: {
  ctx: ReviewContext;
  reason: string;
  appBaseUrl: string;
  projectSlug: string;
}): string {
  const { ctx, reason, appBaseUrl, projectSlug } = params;
  return [
    ctx.isClip ? "❌ <b>Clip refusé</b>" : "❌ <b>Vidéo refusée</b>",
    "",
    `<b>${escapeTelegram(ctx.creatorName)}</b>${clipTag(ctx)} — ${escapeTelegram(describeMission(ctx))}`,
    `${ctx.isClip ? "Refusé" : "Refusée"} par ${escapeTelegram(actorLabel(ctx.actorName))}`,
    "",
    "<b>Motif :</b>",
    escapeTelegram(reason),
    "",
    link("Ouvrir les missions", assignmentsUrl(appBaseUrl, projectSlug)),
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
  /**
   * Comptes de clippeur EN COURS de chauffe dont le clippeur n'a aucun talent
   * apparié. Signalés pendant, jamais après : une fois la chauffe finie, les
   * trois jours sont perdus et l'alerte n'appelle plus aucune action.
   */
  chauffeSansTalent: { handle: string; clipperName: string; joursRestants: number }[];
  /**
   * Talents ARRÊTÉS (paused/churned) dont au moins un mois de forfait reste dû.
   *
   * Un solde dû à quelqu'un qui part est exactement ce qu'on oublie : il cesse
   * d'apparaître dans les écrans du quotidien. Le nombre de mois y est, JAMAIS
   * le montant — contrainte de confidentialité du canal.
   */
  talentSoldeDu: { creatorName: string; moisDus: number }[];
}

export function buildDigestMessage(params: {
  projectName: string;
  sections: DigestSections;
  appBaseUrl: string;
  projectSlug: string;
}): string | null {
  const { projectName, sections, appBaseUrl, projectSlug } = params;
  const {
    overdueMissions,
    payCycles,
    warmupLate,
    retryableRenewalFailures,
    chauffeSansTalent,
    talentSoldeDu,
  } = sections;
  if (
    overdueMissions.length === 0 &&
    payCycles.length === 0 &&
    warmupLate.length === 0 &&
    retryableRenewalFailures.length === 0 &&
    chauffeSansTalent.length === 0 &&
    talentSoldeDu.length === 0
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

  if (chauffeSansTalent.length > 0) {
    const n = chauffeSansTalent.length;
    blocks.push(
      `🧊 <b>${n} ${plural(n, "compte")} en chauffe sans talent apparié</b>\n` +
        bulletList(
          chauffeSansTalent.map(
            (c) =>
              `${c.handle} (${c.clipperName}) — sort de chauffe dans ${c.joursRestants} ${plural(c.joursRestants, "jour")}`,
          ),
        ),
    );
  }

  if (talentSoldeDu.length > 0) {
    const n = talentSoldeDu.length;
    // Le NOMBRE de mois, jamais le montant : contrainte de confidentialité du
    // canal, la même qui interdit les montants de paie partout ailleurs.
    blocks.push(
      `🧾 <b>${n} ${plural(n, "talent")} ${plural(n, "arrêté")} avec un forfait non payé</b>\n` +
        bulletList(
          talentSoldeDu.map(
            (t) =>
              `${t.creatorName} — ${t.moisDus} ${plural(t.moisDus, "mois", "")} ${n > 1 || t.moisDus > 1 ? "dus" : "dû"}`,
          ),
        ),
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

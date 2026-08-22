import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  EMAIL_ENV_HINT,
  emailConfig,
  escapeHtml,
  isNonNotifiableRecipient,
  p,
  renderEmail,
  sendEmail,
  type EmailConfig,
} from "./emailApi";
import { inviteEmailCopy } from "./emailMessages";

/**
 * Notifications EMAIL (Resend) — 5 événements : invitation créateur, vidéo
 * validée, vidéo refusée, paiement effectué, rappel de deadline.
 *
 * ARCHITECTURE — pourquoi des actions planifiées :
 * une mutation Convex est transactionnelle et ne peut pas faire d'I/O réseau.
 * Chaque événement métier fait donc `ctx.scheduler.runAfter(0, internal.emails.X)`.
 * Conséquence directe et voulue : la transaction métier (validation, refus,
 * paiement) est DÉJÀ committée quand l'email part — un Resend en panne ne peut
 * structurellement pas casser le workflow. Les actions ne jettent jamais : elles
 * loggent et retournent un statut.
 *
 * Corollaire pour le paiement en masse (chantier A) : chaque cycle planifie SON
 * action indépendamment → les envois sont parallèles et hors transaction, ils ne
 * ralentissent ni ne font échouer la boucle de marquage.
 *
 * DÉSACTIVATION : sans les 3 variables d'env (cf emailApi.emailConfig), tout est
 * no-op. Les destinataires de test/seed sont filtrés en plus (isNonNotifiableRecipient).
 */

/**
 * Statuts où la balle est dans le camp du CRÉATEUR (donc relançables).
 * SOURCE UNIQUE : utilisée par le cron de rappel ET par la relance manuelle
 * (assignments.nudgeAssignment) — ne pas la dupliquer.
 */
export const UNFINISHED_STATUSES = [
  "todo",
  "in_progress",
  "video_rejected",
] as const;

/** Fenêtre de rappel : on relance une mission qui échoit dans <= 48 h. */
const REMINDER_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/** Sécurité : borne le nombre d'emails d'un seul run de cron. */
const REMINDER_MAX_PER_RUN = 200;

type Outcome =
  | { ok: true }
  | { ok: false; reason: "disabled" | "not-found" | "test-recipient" | "send-failed" };

const DISABLED: Outcome = { ok: false, reason: "disabled" };

/** Log unique quand le canal n'est pas configuré (même esprit que snytchDrive). */
function warnDisabled(event: string): Outcome {
  console.info(
    `[emails] canal désactivé (RESEND_API_KEY / RESEND_FROM / APP_BASE_URL absents) — ` +
      `« ${event} » non envoyé. Pour activer : ${EMAIL_ENV_HINT}`,
  );
  return DISABLED;
}

/** Date FR courte et déterministe (UTC) — pas de dépendance à Intl/fuseau. */
function formatDateFr(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Montant en dollars, séparateur d'espace fine — cohérent avec l'app. */
function formatAmount(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const [int, dec] = rounded.toFixed(2).split(".");
  const spaced = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec === "00" ? `${spaced} $` : `${spaced},${dec} $`;
}

/** Envoie + logge l'échec sans jamais jeter. */
async function deliver(
  cfg: EmailConfig,
  event: string,
  to: string,
  subject: string,
  html: string,
): Promise<Outcome> {
  const res = await sendEmail(cfg, { to, subject, html });
  if (!res.ok) {
    console.error(`[emails] échec d'envoi « ${event} » → ${to} : ${res.error}`);
    return { ok: false, reason: "send-failed" };
  }
  return { ok: true };
}

// ─── Lectures internes (les actions n'accèdent pas à la DB directement) ───────

export const getCreatorContact = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, { creatorId }) => {
    const c = await ctx.db.get(creatorId);
    if (!c) return null;
    // LANGUE DU DESTINATAIRE — cf localeOrDefault côté rendu. Absente ⇒ français.
    return { email: c.email, name: c.name, locale: c.locale ?? null };
  },
});

/** Contact + libellé de mission pour les mails liés à un assignment. */
export const getAssignmentNotifyData = internalQuery({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }) => {
    const a = await ctx.db.get(assignmentId);
    if (!a) return null;
    const c = await ctx.db.get(a.creatorId);
    if (!c) return null;
    const format = a.formatId ? await ctx.db.get(a.formatId) : null;
    return {
      email: c.email,
      name: c.name,
      // LANGUE DU DESTINATAIRE — un e-mail part TOUJOURS dans sa langue, jamais
      // dans celle de l'expéditeur ni du serveur. Absente ⇒ le rendu retombe sur
      // le français (localeOrDefault) : ici on ne décide rien, on transporte.
      locale: c.locale ?? null,
      // null = aucun format nommé rattaché. Chaque template formule sa phrase
      // en conséquence (pas de repli « ta mission » qui donnait « ta vidéo pour
      // ta mission »).
      missionLabel: format?.name ?? null,
      dueDate: a.dueDate,
      feedback: a.videoReviewFeedback ?? null,
      // Permet à la relance manuelle d'adapter son message (refus à corriger vs
      // vidéo attendue).
      status: a.status,
    };
  },
});

/**
 * Missions à relancer : échéance dans <= windowMs (les retards inclus) ET pas
 * encore relancées. Requête index-backed (by_project_status) par projet et par
 * statut « balle au créateur » — pas de scan global de la table.
 */
export const listDeadlineReminderTargets = internalQuery({
  args: { dueBefore: v.number() },
  handler: async (ctx, { dueBefore }) => {
    const projects = await ctx.db.query("projects").collect();
    const out: {
      assignmentId: Id<"assignments">;
      email: string;
      name: string;
      /** Langue du destinataire (null ⇒ français). */
      locale: string | null;
      /** null = pas de format nommé (cf getAssignmentNotifyData). */
      missionLabel: string | null;
      dueDate: number;
    }[] = [];
    const creatorCache = new Map<string, Doc<"creators"> | null>();
    for (const project of projects) {
      for (const status of UNFINISHED_STATUSES) {
        const rows = await ctx.db
          .query("assignments")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", project._id).eq("status", status),
          )
          .collect();
        for (const a of rows) {
          if (a.dueDate > dueBefore) continue;
          // Anti-spam : UN rappel par mission, jamais de boucle.
          if (a.deadlineReminderSentAt !== undefined) continue;
          const key = a.creatorId as string;
          if (!creatorCache.has(key)) {
            creatorCache.set(key, await ctx.db.get(a.creatorId));
          }
          const c = creatorCache.get(key);
          if (!c) continue;
          const format = a.formatId ? await ctx.db.get(a.formatId) : null;
          out.push({
            assignmentId: a._id,
            email: c.email,
            name: c.name,
            locale: c.locale ?? null,
            missionLabel: format?.name ?? null,
            dueDate: a.dueDate,
          });
        }
      }
    }
    return out.sort((x, y) => x.dueDate - y.dueDate);
  },
});

/** Marqueur anti-spam. Posé APRÈS l'envoi (un échec pourra être re-tenté). */
export const markDeadlineReminderSent = internalMutation({
  args: { assignmentId: v.id("assignments"), at: v.number() },
  handler: async (ctx, { assignmentId, at }) => {
    const a = await ctx.db.get(assignmentId);
    if (!a) return;
    await ctx.db.patch(assignmentId, { deadlineReminderSentAt: at });
  },
});

// ─── 1. Invitation créateur ──────────────────────────────────────────────────

export const sendCreatorInvite = internalAction({
  args: { creatorId: v.id("creators"), token: v.string() },
  handler: async (ctx, { creatorId, token }): Promise<Outcome> => {
    const cfg = emailConfig();
    if (!cfg) return warnDisabled("invitation créateur");
    const c = await ctx.runQuery(internal.emails.getCreatorContact, {
      creatorId,
    });
    if (!c) return { ok: false, reason: "not-found" };
    if (isNonNotifiableRecipient(c.email, c.name)) {
      return { ok: false, reason: "test-recipient" };
    }
    const url = `${cfg.appBaseUrl}/join/${token}`;
    // Langue du DESTINATAIRE (creators.locale), pas celle du serveur. Absente ⇒
    // français : inviteEmailCopy applique le défaut, il n'y a ni cookie ni
    // Accept-Language de ce côté.
    const copy = inviteEmailCopy(c.locale);
    const subject = copy.subject;
    const html = renderEmail({
      title: subject,
      bodyHtml:
        p(copy.greeting(escapeHtml(c.name))) +
        p(copy.intro) +
        p(copy.linkHint),
      cta: { label: copy.ctaLabel, url },
      footerNote: copy.footerNote,
    });
    return deliver(cfg, "invitation créateur", c.email, subject, html);
  },
});

// ─── 2. Vidéo validée ────────────────────────────────────────────────────────

export const sendVideoApproved = internalAction({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }): Promise<Outcome> => {
    const cfg = emailConfig();
    if (!cfg) return warnDisabled("vidéo validée");
    const d = await ctx.runQuery(internal.emails.getAssignmentNotifyData, {
      assignmentId,
    });
    if (!d) return { ok: false, reason: "not-found" };
    if (isNonNotifiableRecipient(d.email, d.name)) {
      return { ok: false, reason: "test-recipient" };
    }
    const url = `${cfg.appBaseUrl}/app/assignments/${assignmentId}`;
    const subject = "Ta vidéo est validée ✅";
    // Sans format nommé, on supprime le complément plutôt que d'écrire
    // « C'est bon pour ta mission » (cf missionLabel null).
    const intro =
      d.missionLabel === null
        ? "C'est bon, ta vidéo est validée."
        : `C'est bon pour <strong>${escapeHtml(d.missionLabel)}</strong>, ta vidéo est validée.`;
    const html = renderEmail({
      title: subject,
      bodyHtml:
        p(`Salut ${escapeHtml(d.name)},`) +
        p(`${intro} Tu peux passer à la publication depuis ton espace.`),
      cta: { label: "Voir la mission", url },
    });
    return deliver(cfg, "vidéo validée", d.email, subject, html);
  },
});

// ─── 3. Vidéo refusée (réutilise le feedback admin déjà obligatoire) ─────────

export const sendVideoRejected = internalAction({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }): Promise<Outcome> => {
    const cfg = emailConfig();
    if (!cfg) return warnDisabled("vidéo refusée");
    const d = await ctx.runQuery(internal.emails.getAssignmentNotifyData, {
      assignmentId,
    });
    if (!d) return { ok: false, reason: "not-found" };
    if (isNonNotifiableRecipient(d.email, d.name)) {
      return { ok: false, reason: "test-recipient" };
    }
    const url = `${cfg.appBaseUrl}/app/assignments/${assignmentId}`;
    const feedbackBlock =
      d.feedback === null
        ? ""
        : `<blockquote style="margin:0 0 12px;padding:10px 14px;border-left:3px solid #cbd5e1;background:#f8fafc;color:#334155;white-space:pre-wrap">${escapeHtml(
            d.feedback,
          )}</blockquote>`;
    // Aucun emoji sur cet email (consigne explicite).
    const subject = "Petite correction sur ta vidéo";
    const intro =
      d.missionLabel === null
        ? "J'ai regardé ta dernière vidéo"
        : `J'ai regardé ta vidéo pour <strong>${escapeHtml(d.missionLabel)}</strong>`;
    const html = renderEmail({
      title: subject,
      bodyHtml:
        p(`Salut ${escapeHtml(d.name)},`) +
        p(`${intro}, il y a un ou deux trucs à ajuster avant de la publier :`) +
        feedbackBlock +
        p(
          "Rien de grave, tu corriges et tu re-soumets directement depuis ta mission.",
        ),
      cta: { label: "Corriger ma vidéo", url },
    });
    return deliver(cfg, "vidéo refusée", d.email, subject, html);
  },
});

// ─── 4. Paiement effectué ────────────────────────────────────────────────────

export const sendPaymentPaid = internalAction({
  args: {
    creatorId: v.id("creators"),
    amount: v.number(),
    cycleStart: v.number(),
    cycleEnd: v.number(),
  },
  handler: async (
    ctx,
    { creatorId, amount, cycleStart, cycleEnd },
  ): Promise<Outcome> => {
    const cfg = emailConfig();
    if (!cfg) return warnDisabled("paiement effectué");
    const c = await ctx.runQuery(internal.emails.getCreatorContact, {
      creatorId,
    });
    if (!c) return { ok: false, reason: "not-found" };
    if (isNonNotifiableRecipient(c.email, c.name)) {
      return { ok: false, reason: "test-recipient" };
    }
    const url = `${cfg.appBaseUrl}/app/paiements`;
    // cycleEnd est exclusif côté modèle → dernier jour inclus = cycleEnd - 1 j.
    // « du X au Y » plutôt qu'un tiret (aucun tiret cadratin dans les contenus).
    const period = `${formatDateFr(cycleStart)} au ${formatDateFr(cycleEnd - 86_400_000)}`;
    const money = formatAmount(amount);
    const subject = `${money} en route 💸`;
    const html = renderEmail({
      title: subject,
      bodyHtml:
        p(`Salut ${escapeHtml(c.name)},`) +
        p(
          `Ton cycle du <strong>${escapeHtml(period)}</strong> est payé : <strong>${escapeHtml(money)}</strong>.`,
        ) +
        p("Le détail vidéo par vidéo est dans ton espace."),
      cta: { label: "Voir mes paiements", url },
    });
    return deliver(cfg, "paiement effectué", c.email, subject, html);
  },
});

// ─── 6. Nouvelle mission assignée (unitaire ET masse) ────────────────────────

/**
 * Déclenché à CHAQUE appel d'assignation (assignScriptCampaign / assignFormat),
 * donc UNE fois par créateur même quand la mutation crée N vidéos, et une fois
 * par créateur en assignation de masse (le bulk boucle sur la mutation unitaire).
 * Planifié : 30 assignations d'un coup = 30 envois parallèles hors transaction.
 */
export const sendAssignmentCreated = internalAction({
  args: { assignmentId: v.id("assignments"), count: v.number() },
  handler: async (ctx, { assignmentId, count }): Promise<Outcome> => {
    const cfg = emailConfig();
    if (!cfg) return warnDisabled("nouvelle mission assignée");
    const d = await ctx.runQuery(internal.emails.getAssignmentNotifyData, {
      assignmentId,
    });
    if (!d) return { ok: false, reason: "not-found" };
    if (isNonNotifiableRecipient(d.email, d.name)) {
      return { ok: false, reason: "test-recipient" };
    }
    const url = `${cfg.appBaseUrl}/app/assignments/${assignmentId}`;
    const many = count > 1;
    const subject = many
      ? `${count} nouvelles vidéos pour toi 🎬`
      : "Nouvelle mission pour toi 🎬";
    const what = many
      ? `${count} nouvelles vidéos à produire`
      : "une nouvelle vidéo à produire";
    const on =
      d.missionLabel === null
        ? ""
        : ` sur <strong>${escapeHtml(d.missionLabel)}</strong>`;
    const html = renderEmail({
      title: subject,
      bodyHtml:
        p(`Salut ${escapeHtml(d.name)},`) +
        p(`Tu as ${what}${on}.`) +
        p(
          `Le script, les consignes et l'échéance (${escapeHtml(formatDateFr(d.dueDate))}) sont dans ton espace.`,
        ),
      cta: { label: many ? "Voir mes missions" : "Voir ma mission", url },
    });
    return deliver(cfg, "nouvelle mission assignée", d.email, subject, html);
  },
});

// ─── 7. Relance MANUELLE (bouton admin de la file « à traiter ») ──────────────

/**
 * Relance déclenchée à la main par l'admin. Ton encourageant, jamais
 * sanctionnant : on propose de débloquer, on ne réprimande pas. Le message
 * s'adapte au statut (retour à corriger vs vidéo attendue).
 * L'anti-spam (1 / mission / 24 h) est porté par assignments.nudgeAssignment.
 */
export const sendManualNudge = internalAction({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }): Promise<Outcome> => {
    const cfg = emailConfig();
    if (!cfg) return warnDisabled("relance manuelle");
    const d = await ctx.runQuery(internal.emails.getAssignmentNotifyData, {
      assignmentId,
    });
    if (!d) return { ok: false, reason: "not-found" };
    if (isNonNotifiableRecipient(d.email, d.name)) {
      return { ok: false, reason: "test-recipient" };
    }
    const url = `${cfg.appBaseUrl}/app/assignments/${assignmentId}`;
    const on =
      d.missionLabel === null
        ? "ta mission"
        : `<strong>${escapeHtml(d.missionLabel)}</strong>`;
    const rejected = d.status === "video_rejected";
    const subject = rejected ? "Tu as un retour à traiter" : "Où en es-tu ? 🙂";
    const html = renderEmail({
      title: subject,
      bodyHtml: rejected
        ? p(`Salut ${escapeHtml(d.name)},`) +
          p(
            `J'ai laissé un retour sur ta vidéo pour ${on}, tu peux la corriger et la re-soumettre quand tu veux.`,
          ) +
          p("Si quelque chose n'est pas clair, réponds-moi, on en parle.")
        : p(`Salut ${escapeHtml(d.name)},`) +
          p(
            `Je fais un point sur ${on}, attendue pour le <strong>${escapeHtml(formatDateFr(d.dueDate))}</strong>.`,
          ) +
          p(
            "Si tu as besoin de quoi que ce soit pour avancer ou de plus de temps, réponds-moi, on trouvera une solution.",
          ),
      cta: { label: rejected ? "Corriger ma vidéo" : "Ouvrir ma mission", url },
    });
    return deliver(cfg, "relance manuelle", d.email, subject, html);
  },
});

// ─── 5. Rappel de deadline (cron) ────────────────────────────────────────────

export type ReminderSummary = {
  ok: boolean;
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
};

/**
 * Cron quotidien : relance les créateurs dont une mission échoit sous 48 h (les
 * retards inclus) et qui n'ont pas encore été relancés sur CETTE mission.
 *
 * Anti-spam : le marqueur `deadlineReminderSentAt` est posé après un envoi
 * réussi → une mission ne génère JAMAIS deux rappels. Un envoi échoué ne pose
 * pas le marqueur (re-tentable au run suivant).
 */
export const runDeadlineReminders = internalAction({
  args: {},
  handler: async (ctx): Promise<ReminderSummary> => {
    const cfg = emailConfig();
    if (!cfg) {
      warnDisabled("rappel de deadline");
      return { ok: false, candidates: 0, sent: 0, skipped: 0, failed: 0 };
    }
    const now = Date.now();
    const targets = await ctx.runQuery(
      internal.emails.listDeadlineReminderTargets,
      { dueBefore: now + REMINDER_WINDOW_MS },
    );
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const t of targets.slice(0, REMINDER_MAX_PER_RUN)) {
      if (isNonNotifiableRecipient(t.email, t.name)) {
        skipped++;
        continue;
      }
      const late = t.dueDate < now;
      const url = `${cfg.appBaseUrl}/app/assignments/${t.assignmentId}`;
      const dateFr = escapeHtml(formatDateFr(t.dueDate));
      const missionStrong =
        t.missionLabel === null
          ? null
          : `<strong>${escapeHtml(t.missionLabel)}</strong>`;
      const subject = late
        ? "On attend ta vidéo 👀"
        : "Ta mission arrive à échéance";
      const html = renderEmail({
        title: subject,
        bodyHtml:
          p(`Salut ${escapeHtml(t.name)},`) +
          (late
            ? // Tête de phrase → majuscule sur le repli sans format nommé.
              p(
                `${missionStrong ?? "Ta mission"} était attendue pour le <strong>${dateFr}</strong> et on ne l'a pas encore reçue.`,
              ) +
              p(
                "Si tu as un souci ou besoin de plus de temps, réponds-moi directement, on trouvera une solution.",
              )
            : p(
                `Petit rappel : ${missionStrong ?? "ta mission"} est attendue pour le <strong>${dateFr}</strong>.`,
              ) +
              p("Tu peux déposer ta vidéo directement depuis ton espace.")),
        cta: { label: "Ouvrir ma mission", url },
      });
      const res = await deliver(cfg, "rappel de deadline", t.email, subject, html);
      if (res.ok) {
        await ctx.runMutation(internal.emails.markDeadlineReminderSent, {
          assignmentId: t.assignmentId,
          at: now,
        });
        sent++;
      } else {
        failed++;
      }
    }
    if (targets.length > 0) {
      console.info(
        `[emails] rappels deadline : ${sent} envoyé(s), ${skipped} ignoré(s), ${failed} échec(s) ` +
          `sur ${targets.length} candidat(s).`,
      );
    }
    return {
      ok: true,
      candidates: targets.length,
      sent,
      skipped,
      failed,
    };
  },
});

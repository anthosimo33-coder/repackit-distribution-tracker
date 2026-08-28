import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { adminMutation, adminQuery } from "./functions";
import { customAction } from "convex-helpers/server/customFunctions";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  NOTIFY_ENV_HINT,
  notifyConfig,
  sendNotification,
  type NotifyConfig,
} from "./notifyApi";
import {
  buildDigestMessage,
  buildDisputeMessage,
  buildGroupedPublicationsMessage,
  buildGroupedSubmissionsMessage,
  buildPublicationMessage,
  buildVideoApprovedMessage,
  buildVideoRejectedMessage,
  publicationLine,
  latePublicationLine,
  buildLatePublicationMessage,
  buildGroupedLatePublicationsMessage,
  buildEveningReportMessage,
  buildRenewalFailedMessage,
  buildSubmissionMessage,
  buildTestMessage,
  submissionLine,
} from "./notificationMessage";
import {
  isCycleDue,
  isOverdueMission,
  missionDaysLate,
  warmupMissedDays,
} from "./opsDigest";
import { effectiveStatus } from "./comptes";
import { resolveCreatorKind } from "./roles";
import { lateDays, parisHour, representativePostedAt } from "./calendarStatus";
import { eveningUnpublishedReports } from "./publicationLateness";
import {
  isChauffeSansTalent,
  joursAvantSortieDeChauffe,
} from "./clipperReadiness";
import {
  effectiveTargetDays,
  warmupTargetDaysOf,
  isWarmupComplete,
} from "./warmup";
import { cyclePaymentsForCreator } from "./payments";
import {
  DIGEST_LOOKBACK_MS,
  isDigestableRenewalFailure,
} from "./whopNotifyTriggers";
import {
  isEventEnabled,
  sanitizeEnabledEvents,
  type NotificationEventKey,
} from "./notificationEvents";
import {
  claimed,
  decideOnEvent,
  freshWindow,
  WINDOW_MS,
} from "./notificationWindow";

/**
 * NOTIFICATIONS hors-app (Telegram) — configuration et répartition.
 *
 * ARCHITECTURE — pourquoi des actions planifiées (copie assumée de
 * convex/emails.ts, même raisonnement, même garantie) :
 * une mutation Convex est transactionnelle et ne peut pas faire d'I/O réseau.
 * Chaque événement métier fait donc
 * `ctx.scheduler.runAfter(0, internal.notifications.X)`. Conséquence DIRECTE et
 * VOULUE : la transaction métier (soumission vidéo, upsert d'un paiement Whop)
 * est DÉJÀ COMMITTÉE quand l'action part — un Telegram en panne ne peut pas
 * structurellement casser une soumission. C'est exactement le problème qu'avait
 * posé un appel d'analytics non protégé dans le chemin de création de compte :
 * l'appel externe vivait DANS la transaction, donc son échec devenait une
 * erreur métier. Ici, il n'y est jamais.
 *
 * Les actions ne jettent JAMAIS : elles loggent et retournent un statut.
 *
 * DÉSACTIVATION : sans le jeton en env (nommé par `projects.notify.tokenEnvVar`)
 * ou sans APP_BASE_URL, `notifyConfig` rend null et tout devient no-op. C'est le
 * garde-fou qui protège dev, preview et CI — la config en base ne suffit pas à
 * faire partir un message.
 */

/** Nom de variable d'env proposé par défaut (modifiable par projet). */
export const DEFAULT_TOKEN_ENV_VAR = "TELEGRAM_BOT_TOKEN";

export type Outcome =
  | { ok: true }
  | {
      ok: false;
      reason: "disabled" | "event-off" | "not-found" | "nothing-to-say" | "send-failed";
      error?: string;
    };

export const DISABLED: Outcome = { ok: false, reason: "disabled" };

/** Log unique quand le canal n'est pas configuré (même esprit que emails/snytchDrive). */
export function warnDisabled(event: string): Outcome {
  console.info(
    `[notifications] canal désactivé (jeton du bot ou APP_BASE_URL absent) — ` +
      `« ${event} » non envoyé. Pour activer : ${NOTIFY_ENV_HINT}`,
  );
  return DISABLED;
}

/** Envoie + logge l'échec sans jamais jeter. */
export async function deliver(
  cfg: NotifyConfig,
  event: string,
  text: string,
): Promise<Outcome> {
  const res = await sendNotification(cfg, text);
  if (!res.ok) {
    console.error(`[notifications] échec d'envoi « ${event} » : ${res.error}`);
    return { ok: false, reason: "send-failed", error: res.error };
  }
  return { ok: true };
}

// ─── Contexte projet partagé par TOUTES les actions de notification ──────────

export type NotifyContext = {
  projectName: string;
  projectSlug: string;
  enabledEvents: string[];
  cfg: NotifyConfig;
};

/**
 * Lecture interne du projet (les actions n'accèdent pas à la DB directement).
 * Rend le bloc `notify` BRUT : la résolution de l'env se fait côté action, où
 * `process.env` est lu.
 */
export const getProjectNotify = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const p = await ctx.db.get(projectId);
    if (p === null) return null;
    return { name: p.name, slug: p.slug, notify: p.notify ?? null };
  },
});

/**
 * Résout le contexte d'envoi d'un projet, ou `null` si rien ne doit partir.
 * Trois refus distincts, tous silencieux et loggés : projet introuvable, canal
 * non configuré, aucun des événements demandés activé côté admin.
 *
 * Point de passage OBLIGÉ de toutes les actions : la vérification « cet
 * événement est-il activé ? » ne doit exister qu'ici.
 *
 * `events` accepte PLUSIEURS clés, et il suffit qu'UNE soit active. C'est requis
 * par le message groupé des soumissions : sa fenêtre mélange première soumission
 * et re-soumission, qui ont deux bascules distinctes. N'en tester qu'une jetterait
 * tout le tampon d'un projet qui n'a activé que l'autre.
 */
export async function resolveNotifyContext(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  events: NotificationEventKey | NotificationEventKey[],
): Promise<NotifyContext | null> {
  const wanted = Array.isArray(events) ? events : [events];
  const p = await ctx.runQuery(internal.notifications.getProjectNotify, {
    projectId,
  });
  if (p === null) return null;
  const cfg = notifyConfig(p.notify);
  if (cfg === null) {
    warnDisabled(wanted.join("/"));
    return null;
  }
  const enabled = p.notify?.enabledEvents;
  if (!wanted.some((e) => isEventEnabled(enabled, e))) return null;
  return {
    projectName: p.name,
    projectSlug: p.slug,
    enabledEvents: enabled ?? [],
    cfg,
  };
}

// ─── Écran admin : lecture / écriture de la config ───────────────────────────

/**
 * Config affichée dans /admin/<slug>/notifications.
 *
 * Ne rend JAMAIS le jeton — seulement le NOM de sa variable d'env et un booléen
 * `tokenPresent` disant si elle est renseignée sur ce déploiement. C'est ce qui
 * permet à l'écran d'afficher « canal non configuré » de façon actionnable sans
 * jamais exposer le secret à un navigateur.
 */
export const getNotifySettings = adminQuery({
  args: {},
  handler: async (ctx) => {
    const p = await ctx.db.get(ctx.projectId);
    const notify = p?.notify ?? null;
    const tokenEnvVar = notify?.tokenEnvVar ?? DEFAULT_TOKEN_ENV_VAR;
    return {
      configured: notify !== null,
      chatId: notify?.chatId ?? "",
      tokenEnvVar,
      enabledEvents: notify?.enabledEvents ?? [],
      /** Heure du bilan de fin de journée, en heure de PARIS. Absent ⇒ 21 h. */
      eveningHourParis: notify?.eveningHourParis ?? DEFAULT_EVENING_HOUR_PARIS,
      /** La variable d'env existe-t-elle sur CE déploiement ? (jamais sa valeur) */
      tokenPresent: (process.env[tokenEnvVar] ?? "").length > 0,
      appBaseUrlPresent: (process.env.APP_BASE_URL ?? "").length > 0,
      envHint: NOTIFY_ENV_HINT,
    };
  },
});

/**
 * Écrit la config du projet. Le destinataire et les bascules changent SANS
 * redéploiement — c'est l'exigence du chantier.
 *
 * `enabledEvents` est assaini contre le catalogue : une clé inconnue (front
 * obsolète, appel forgé) est écartée plutôt que persistée, sinon elle resterait
 * en base à ne rien activer et brouillerait la lecture.
 */
export const setNotifySettings = adminMutation({
  args: {
    chatId: v.string(),
    enabledEvents: v.array(v.string()),
    tokenEnvVar: v.optional(v.string()),
    /** Heure du bilan du soir, en heure de PARIS (0-23). Absent ⇒ défaut. */
    eveningHourParis: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { chatId, enabledEvents, tokenEnvVar, eveningHourParis },
  ) => {
    const trimmedChat = chatId.trim();
    const trimmedEnv = (tokenEnvVar ?? DEFAULT_TOKEN_ENV_VAR).trim();
    if (trimmedEnv.length === 0) {
      throw new ConvexError("Le nom de la variable d'environnement est requis.");
    }
    // Heure BORNÉE serveur : une valeur hors 0-23 ne correspondrait à aucune
    // heure de Paris, donc le cron ne tirerait JAMAIS — une panne silencieuse
    // qu'on ne découvrirait qu'en constatant l'absence de bilans.
    if (
      eveningHourParis !== undefined &&
      (!Number.isInteger(eveningHourParis) ||
        eveningHourParis < 0 ||
        eveningHourParis > 23)
    ) {
      throw new ConvexError(
        "L'heure du bilan doit être un entier entre 0 et 23.",
      );
    }
    // Destinataire vidé = on RETIRE le bloc : « pas de config » et « config avec
    // un destinataire vide » doivent se lire pareil (canal éteint), pas laisser
    // une coquille qui donnerait l'illusion d'un canal branché.
    if (trimmedChat.length === 0) {
      await ctx.db.patch(ctx.projectId, { notify: undefined });
      return { ok: true, cleared: true };
    }
    await ctx.db.patch(ctx.projectId, {
      notify: {
        channel: "telegram" as const,
        chatId: trimmedChat,
        tokenEnvVar: trimmedEnv,
        enabledEvents: sanitizeEnabledEvents(enabledEvents),
        ...(eveningHourParis !== undefined ? { eveningHourParis } : {}),
      },
    });
    return { ok: true, cleared: false };
  },
});

// ─── Fenêtre anti-flood : les deux mutations transactionnelles ───────────────

/**
 * Ouvre la fenêtre du couple (projet, type) ou tamponne dedans. UNE transaction.
 *
 * Rend `lead: true` quand la fenêtre vient d'être ouverte → l'appelant envoie
 * immédiatement (front montant). Sinon la ligne est tamponnée et partira dans le
 * message groupé.
 *
 * Toute la décision est dans `convex/notificationWindow.ts` (pur, testé) ; ici
 * on ne fait qu'écrire et planifier.
 */
export const openOrAppendWindow = internalMutation({
  args: {
    projectId: v.id("projects"),
    kind: v.string(),
    line: v.string(),
  },
  handler: async (ctx, { projectId, kind, line }): Promise<{ lead: boolean }> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("notificationWindows")
      .withIndex("by_project_kind", (q) =>
        q.eq("projectId", projectId).eq("kind", kind),
      )
      .first();

    const decision = decideOnEvent(
      existing === null
        ? null
        : {
            openedAt: existing.openedAt,
            pending: existing.pending,
            pendingCount: existing.pendingCount,
          },
      line,
      now,
    );

    if (decision.action === "open") {
      const fresh = freshWindow(now);
      const windowId = await ctx.db.insert("notificationWindows", {
        projectId,
        kind,
        openedAt: fresh.openedAt,
        pending: fresh.pending,
        pendingCount: fresh.pendingCount,
      });
      await ctx.scheduler.runAfter(
        WINDOW_MS,
        internal.notifications.flushWindow,
        { windowId },
      );
      return { lead: true };
    }

    // `existing` est forcément non-null ici (decideOnEvent ne rend "open" que
    // sur null) — la garde satisfait le typeur sans changer le comportement.
    if (existing === null) return { lead: true };
    await ctx.db.patch(existing._id, {
      pending: decision.state.pending,
      pendingCount: decision.state.pendingCount,
    });
    if (decision.action === "drain") {
      // Fenêtre orpheline (flush jamais arrivé) : on la vide tout de suite,
      // sinon elle retiendrait indéfiniment toutes les soumissions suivantes.
      console.warn(
        `[notifications] fenêtre « ${kind} » orpheline (ouverte depuis ${Math.round(
          (now - existing.openedAt) / 1000,
        )} s) — drainage immédiat.`,
      );
      await ctx.scheduler.runAfter(0, internal.notifications.flushWindow, {
        windowId: existing._id,
      });
    }
    return { lead: false };
  },
});

/**
 * REVENDIQUE une fenêtre : lit son tampon ET supprime le document dans la MÊME
 * transaction.
 *
 * L'atomicité est le cœur du garde-fou, pas un détail d'implémentation. Lire
 * puis supprimer en deux temps (runQuery puis runMutation depuis l'action)
 * laisserait une soumission s'intercaler : elle serait écrite dans un document
 * sur le point d'être supprimé, donc PERDUE. Cf le test qui démontre cette perte
 * dans lib/notification-window.test.ts (« pourquoi la revendication doit être
 * ATOMIQUE »). NE PAS scinder cette mutation.
 *
 * Rend `null` si le document n'existe plus (déjà revendiqué) — cas normal, pas
 * une erreur.
 */
export const claimWindow = internalMutation({
  args: { windowId: v.id("notificationWindows") },
  handler: async (
    ctx,
    { windowId },
  ): Promise<{
    projectId: Id<"projects">;
    /** Type de fenêtre — le flush ne peut pas le deviner après suppression. */
    kind: string;
    lines: string[];
    total: number;
  } | null> => {
    const doc = await ctx.db.get(windowId);
    if (doc === null) return null;
    const { lines, total } = claimed({
      openedAt: doc.openedAt,
      pending: doc.pending,
      pendingCount: doc.pendingCount,
    });
    await ctx.db.delete(windowId);
    return { projectId: doc.projectId, kind: doc.kind, lines, total };
  },
});

/**
 * Ferme une fenêtre et envoie le message groupé — s'il y a quelque chose à dire.
 * Un tampon vide (cas courant : une seule soumission, déjà partie en front
 * montant) ne produit AUCUN message.
 */
export const flushWindow = internalAction({
  args: { windowId: v.id("notificationWindows") },
  handler: async (ctx, { windowId }): Promise<Outcome> => {
    const claimResult = await ctx.runMutation(
      internal.notifications.claimWindow,
      { windowId },
    );
    if (claimResult === null) return { ok: false, reason: "not-found" };
    if (claimResult.total === 0) return { ok: false, reason: "nothing-to-say" };

    // Les bascules sont relues ici : elles ont pu être éteintes pendant la
    // fenêtre. Pour les soumissions, LES DEUX clés sont testées — la fenêtre
    // mélange soumission et re-soumission (cf SUBMISSION_KIND), n'en tester
    // qu'une jetterait tout le tampon d'un projet qui n'a activé que l'autre.
    //
    // Table plutôt que ternaires imbriqués : à deux types de fenêtre un booléen
    // suffisait, à trois il devient une source d'erreur silencieuse (un `else`
    // qui ramasse le mauvais cas enverrait le mauvais message).
    const GROUPES: Record<
      string,
      {
        events: NotificationEventKey[];
        label: string;
        build: (p: {
          lines: string[];
          total: number;
          appBaseUrl: string;
          projectSlug: string;
        }) => string;
      }
    > = {
      [PUBLICATION_KIND]: {
        events: ["publication_confirmed"],
        label: "publications groupées",
        build: buildGroupedPublicationsMessage,
      },
      [LATE_PUBLICATION_KIND]: {
        events: ["publication_late"],
        label: "publications en retard groupées",
        build: buildGroupedLatePublicationsMessage,
      },
      [SUBMISSION_KIND]: {
        events: ["video_submitted", "video_resubmitted"],
        label: "soumissions groupées",
        build: buildGroupedSubmissionsMessage,
      },
    };
    const groupe = GROUPES[claimResult.kind];
    // Type de fenêtre inconnu (déploiement en cours d'une nouvelle clé, tampon
    // écrit par la version d'avant) : on ne devine pas, on n'envoie pas.
    if (groupe === undefined) return { ok: false, reason: "not-found" };

    const nctx = await resolveNotifyContext(
      ctx,
      claimResult.projectId,
      groupe.events,
    );
    if (nctx === null) return DISABLED;

    return deliver(
      nctx.cfg,
      groupe.label,
      groupe.build({
        lines: claimResult.lines,
        total: claimResult.total,
        appBaseUrl: nctx.cfg.appBaseUrl,
        projectSlug: nctx.projectSlug,
      }),
    );
  },
});

// ─── 1 & 2. Soumission / re-soumission vidéo ─────────────────────────────────

/**
 * Type de fenêtre partagé par la soumission ET la re-soumission : côté lecteur
 * c'est le même geste (une vidéo entre dans la file de validation), donc une
 * rafale mixte doit se grouper en UN message.
 */
const SUBMISSION_KIND = "submission";

/**
 * Contexte d'affichage d'une soumission. Reprend les jointures de
 * `assignments.listVideoSubmitted` pour UN assignment (créatrice, campagne,
 * format, cibles) — mêmes sources, pour que le message dise ce que montre
 * l'écran de validation.
 */
export const getSubmissionContext = internalQuery({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }) => {
    const a = await ctx.db.get(assignmentId);
    if (a === null) return null;
    const creator = await ctx.db.get(a.creatorId);
    const format = a.formatId ? await ctx.db.get(a.formatId) : null;
    const campaign = a.scriptCombo
      ? await ctx.db.get(a.scriptCombo.campaignId)
      : null;
    const targets = await Promise.all(
      (a.targets ?? []).map(async (t) => ({
        platform: t.platform,
        accountHandle: t.accountId
          ? ((await ctx.db.get(t.accountId))?.handle ?? null)
          : null,
      })),
    );
    return {
      projectId: a.projectId,
      creatorName: creator?.name ?? a.creatorNameSnapshot ?? "—",
      campaignName: campaign?.name ?? null,
      formatName: format?.name ?? null,
      targets,
      /** CLIP ou vidéo de partenaire — le message ne dit pas la même chose. */
      isClip: resolveCreatorKind(creator?.kind) === "clipper",
    };
  },
});

/**
 * Événement « une vidéo est entrée dans la file de validation ».
 *
 * Planifiée par `assignments.submitVideo` via ctx.scheduler → la soumission est
 * DÉJÀ committée quand cette action démarre. Elle ne peut donc structurellement
 * pas faire échouer la soumission, quoi qu'il arrive ici.
 */
export const notifySubmission = internalAction({
  args: {
    assignmentId: v.id("assignments"),
    isResubmission: v.boolean(),
  },
  handler: async (ctx, { assignmentId, isResubmission }): Promise<Outcome> => {
    const sub = await ctx.runQuery(
      internal.notifications.getSubmissionContext,
      { assignmentId },
    );
    if (sub === null) return { ok: false, reason: "not-found" };

    const event: NotificationEventKey = isResubmission
      ? "video_resubmitted"
      : "video_submitted";
    const nctx = await resolveNotifyContext(ctx, sub.projectId, event);
    if (nctx === null) return { ok: false, reason: "event-off" };

    const context = {
      creatorName: sub.creatorName,
      campaignName: sub.campaignName,
      formatName: sub.formatName,
      targets: sub.targets,
      isClip: sub.isClip,
    };

    // Front montant : la fenêtre décide si CE message part maintenant ou s'il
    // rejoint le groupé de fin de fenêtre.
    const { lead } = await ctx.runMutation(
      internal.notifications.openOrAppendWindow,
      {
        projectId: sub.projectId,
        kind: SUBMISSION_KIND,
        line: submissionLine(context),
      },
    );
    if (!lead) return { ok: true };

    return deliver(
      nctx.cfg,
      event,
      buildSubmissionMessage({
        ctx: context,
        isResubmission,
        appBaseUrl: nctx.cfg.appBaseUrl,
        projectSlug: nctx.projectSlug,
        assignmentId,
      }),
    );
  },
});

// ─── Publication confirmée / revue vidéo ─────────────────────────────────────

/**
 * Type de fenêtre des PUBLICATIONS — distinct de SUBMISSION_KIND : une rafale de
 * publications ne doit pas se mélanger à une rafale de soumissions dans le même
 * message groupé.
 */
const PUBLICATION_KIND = "publication";

/**
 * Contexte d'une publication ET d'une décision de revue — mêmes jointures que
 * `getSubmissionContext`, plus les URL publiées et le nom de l'admin.
 *
 * `actorUserId` est résolu en NOM. Jamais en email : la contrainte de
 * confidentialité du canal l'interdit, et un repli « un administrateur » vaut
 * mieux qu'une adresse.
 */
export const getAssignmentEventContext = internalQuery({
  args: {
    assignmentId: v.id("assignments"),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { assignmentId, actorUserId }) => {
    const a = await ctx.db.get(assignmentId);
    if (a === null) return null;
    const creator = await ctx.db.get(a.creatorId);
    const format = a.formatId ? await ctx.db.get(a.formatId) : null;
    const campaign = a.scriptCombo
      ? await ctx.db.get(a.scriptCombo.campaignId)
      : null;
    const targets = await Promise.all(
      (a.targets ?? []).map(async (t) => ({
        platform: t.platform,
        accountHandle: t.accountId
          ? ((await ctx.db.get(t.accountId))?.handle ?? null)
          : null,
        url: t.publishedUrl ?? null,
      })),
    );
    const actor = actorUserId ? await ctx.db.get(actorUserId) : null;
    const actorName = actor?.name?.trim() ? actor.name.trim() : null;
    return {
      projectId: a.projectId,
      creatorName: creator?.name ?? a.creatorNameSnapshot ?? "—",
      campaignName: campaign?.name ?? null,
      formatName: format?.name ?? null,
      targets,
      actorName,
      /** Traçabilité posée par confirmPublicationCore (creator vs admin secours). */
      publishedBy: a.publishedBy ?? null,
      /**
       * CLIP ou post de partenaire. `publishedBy: "creator"` est CORRECT pour un
       * clip (le clippeur EST le creatorId, arbitrage D1) — c'est justement pour
       * ça qu'il ne suffit pas à distinguer les deux populations.
       */
      isClip: resolveCreatorKind(creator?.kind) === "clipper",
    };
  },
});

/**
 * Événement « une publication est confirmée ».
 *
 * Planifiée depuis `confirmPublicationCore` — le cœur PARTAGÉ par la créatrice
 * (`confirmPublication`) et par l'admin en secours (`confirmPublicationAsAdmin`).
 * Un lien collé par l'admin déclenche donc la notification exactement comme
 * celui de la créatrice ; le message le DIT (`byAdmin`), puisque le geste n'a
 * pas la même valeur de preuve.
 *
 * Même garde-fou anti-flood que les soumissions : front montant immédiat, puis
 * un message groupé pour la rafale (« ses cinq vidéos du jour »).
 */
export const notifyPublication = internalAction({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }): Promise<Outcome> => {
    const data = await ctx.runQuery(
      internal.notifications.getAssignmentEventContext,
      { assignmentId },
    );
    if (data === null) return { ok: false, reason: "not-found" };
    const nctx = await resolveNotifyContext(
      ctx,
      data.projectId,
      "publication_confirmed",
    );
    if (nctx === null) return { ok: false, reason: "event-off" };

    const context = {
      creatorName: data.creatorName,
      campaignName: data.campaignName,
      formatName: data.formatName,
      targets: data.targets,
      byAdmin: data.publishedBy === "admin",
      isClip: data.isClip,
    };
    const { lead } = await ctx.runMutation(
      internal.notifications.openOrAppendWindow,
      {
        projectId: data.projectId,
        kind: PUBLICATION_KIND,
        line: publicationLine(context),
      },
    );
    if (!lead) return { ok: true };

    return deliver(
      nctx.cfg,
      "publication_confirmed",
      buildPublicationMessage({
        ctx: context,
        appBaseUrl: nctx.cfg.appBaseUrl,
        projectSlug: nctx.projectSlug,
      }),
    );
  },
});

/**
 * Fenêtre des publications EN RETARD — DISTINCTE de PUBLICATION_KIND.
 *
 * Une rafale peut contenir des posts à l'heure et des posts en retard ; les
 * mélanger dans un même tampon produirait un message groupé qui annonce « 5
 * publications en retard » dont trois ne le sont pas.
 */
const LATE_PUBLICATION_KIND = "publication_late";

/**
 * Événement « une publication est sortie APRÈS sa date prévue ».
 *
 * Planifié depuis `confirmPublicationCore`, comme `notifyPublication` : le cœur
 * PARTAGÉ par la créatrice et par l'admin en secours. Un lien collé en retard
 * par l'admin alerte donc exactement comme celui de la créatrice.
 *
 * ⚠️ Le SIGNE, pas le statut. `lateDays` rend `null` pour un post à l'heure OU
 * EN AVANCE ; l'action sort alors sans rien émettre. `calendarStatus` range
 * pourtant l'avance dans « en retard » — c'est juste pour une pastille « hors
 * date », et faux pour un message qui compte des jours.
 */
export const notifyLatePublication = internalAction({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }): Promise<Outcome> => {
    const data = await ctx.runQuery(
      internal.notifications.getLatePublicationContext,
      { assignmentId },
    );
    if (data === null) return { ok: false, reason: "not-found" };
    // Pas en retard (à l'heure, en avance, ou pas de date prévue) : rien à dire.
    if (data.lateDays === null) return { ok: true };
    const nctx = await resolveNotifyContext(
      ctx,
      data.projectId,
      "publication_late",
    );
    if (nctx === null) return { ok: false, reason: "event-off" };

    const context = {
      creatorName: data.creatorName,
      campaignName: data.campaignName,
      formatName: data.formatName,
      lateDays: data.lateDays,
      postDate: data.postDate!,
      accountHandles: data.accountHandles,
      isClip: data.isClip,
    };
    const { lead } = await ctx.runMutation(
      internal.notifications.openOrAppendWindow,
      {
        projectId: data.projectId,
        kind: LATE_PUBLICATION_KIND,
        line: latePublicationLine(context),
      },
    );
    if (!lead) return { ok: true };

    return deliver(
      nctx.cfg,
      "publication_late",
      buildLatePublicationMessage({
        ctx: context,
        appBaseUrl: nctx.cfg.appBaseUrl,
        projectSlug: nctx.projectSlug,
        creatorId: data.creatorId,
      }),
    );
  },
});

/**
 * Contexte d'un retard : le décalage en jours, la date prévue, les comptes.
 *
 * Requête distincte de `getAssignmentEventContext` parce qu'elle répond à une
 * question différente — « de combien ce post est-il en retard ? » — et que la
 * réponse `null` (pas en retard) est le cas le plus fréquent : la calculer ici
 * évite de composer un message pour rien.
 */
export const getLatePublicationContext = internalQuery({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }) => {
    const a = await ctx.db.get(assignmentId);
    if (a === null) return null;
    const creator = await ctx.db.get(a.creatorId);
    const format = a.formatId ? await ctx.db.get(a.formatId) : null;
    const campaign = a.scriptCombo
      ? await ctx.db.get(a.scriptCombo.campaignId)
      : null;
    const handles: string[] = [];
    for (const t of a.targets ?? []) {
      if (!t.accountId) continue;
      const compte = await ctx.db.get(t.accountId);
      if (compte && !handles.includes(compte.handle)) handles.push(compte.handle);
    }
    return {
      projectId: a.projectId,
      creatorId: a.creatorId,
      creatorName: creator?.name ?? a.creatorNameSnapshot ?? "—",
      campaignName: campaign?.name ?? null,
      formatName: format?.name ?? null,
      postDate: a.postDate ?? null,
      accountHandles: handles,
      isClip: resolveCreatorKind(creator?.kind) === "clipper",
      lateDays: lateDays({
        postDate: a.postDate ?? null,
        postedAt: representativePostedAt(a),
      }),
    };
  },
});

/**
 * Événements « vidéo validée » et « vidéo refusée ». Planifiées depuis
 * `reviewVideoApprove` / `reviewVideoReject` → la décision est DÉJÀ committée.
 *
 * PAS de groupage ici, et c'est délibéré pour le refus : son MOTIF est tout le
 * contenu du message, un message de synthèse le tronquerait.
 */
export const notifyVideoReviewed = internalAction({
  args: {
    assignmentId: v.id("assignments"),
    actorUserId: v.optional(v.id("users")),
    /** Motif du refus, EN ENTIER. Absent = validation. */
    rejectionReason: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { assignmentId, actorUserId, rejectionReason },
  ): Promise<Outcome> => {
    const data = await ctx.runQuery(
      internal.notifications.getAssignmentEventContext,
      { assignmentId, actorUserId },
    );
    if (data === null) return { ok: false, reason: "not-found" };
    const event: NotificationEventKey =
      rejectionReason === undefined ? "video_approved" : "video_rejected";
    const nctx = await resolveNotifyContext(ctx, data.projectId, event);
    if (nctx === null) return { ok: false, reason: "event-off" };

    const context = {
      creatorName: data.creatorName,
      campaignName: data.campaignName,
      formatName: data.formatName,
      actorName: data.actorName,
      isClip: data.isClip,
    };
    const text =
      rejectionReason === undefined
        ? buildVideoApprovedMessage({
            ctx: context,
            appBaseUrl: nctx.cfg.appBaseUrl,
            projectSlug: nctx.projectSlug,
          })
        : buildVideoRejectedMessage({
            ctx: context,
            reason: rejectionReason,
            appBaseUrl: nctx.cfg.appBaseUrl,
            projectSlug: nctx.projectSlug,
          });
    return deliver(nctx.cfg, event, text);
  },
});

// ─── 3. Litige bancaire Whop ─────────────────────────────────────────────────

/**
 * Planifiée par `whopSync.upsertWhopPayments` quand un litige vient de s'OUVRIR
 * (cf convex/whopNotifyTriggers.shouldNotifyDispute). Les données voyagent en
 * arguments plutôt que d'être relues : la ligne vient d'être écrite, l'action
 * n'a rien à redemander.
 *
 * Détection au rythme du cron horaire (:30) — « immédiat » vaut donc « sous une
 * heure ». Arbitré : le délai de réponse à un litige se compte en jours.
 */
export const notifyWhopDispute = internalAction({
  args: {
    projectId: v.id("projects"),
    memberName: v.union(v.string(), v.null()),
    reason: v.union(v.string(), v.null()),
    dueAt: v.union(v.number(), v.null()),
  },
  handler: async (
    ctx,
    { projectId, memberName, reason, dueAt },
  ): Promise<Outcome> => {
    const nctx = await resolveNotifyContext(ctx, projectId, "whop_dispute");
    if (nctx === null) return { ok: false, reason: "event-off" };
    return deliver(
      nctx.cfg,
      "litige Whop",
      buildDisputeMessage({
        memberName,
        reason,
        dueAt,
        now: Date.now(),
        appBaseUrl: nctx.cfg.appBaseUrl,
        projectSlug: nctx.projectSlug,
      }),
    );
  },
});

// ─── 4. Renouvellement échoué (non relançable) ───────────────────────────────

/**
 * Planifiée quand un renouvellement devient un échec ACTIONNABLE — c'est-à-dire
 * que Whop ne le relancera plus (cf shouldNotifyRenewalFailure). Un échec encore
 * relançable n'appelle aucune action et part dans le digest.
 */
export const notifyWhopRenewalFailed = internalAction({
  args: {
    projectId: v.id("projects"),
    memberName: v.union(v.string(), v.null()),
    failureMessage: v.union(v.string(), v.null()),
  },
  handler: async (
    ctx,
    { projectId, memberName, failureMessage },
  ): Promise<Outcome> => {
    const nctx = await resolveNotifyContext(
      ctx,
      projectId,
      "whop_renewal_failed",
    );
    if (nctx === null) return { ok: false, reason: "event-off" };
    return deliver(
      nctx.cfg,
      "renouvellement échoué",
      buildRenewalFailedMessage({
        memberName,
        failureMessage,
        appBaseUrl: nctx.cfg.appBaseUrl,
        projectSlug: nctx.projectSlug,
      }),
    );
  },
});

// ─── 5, 6, 7. Digest quotidien ───────────────────────────────────────────────

/** Borne le nombre d'entrées collectées par section (le message plafonne déjà). */
const DIGEST_SECTION_LIMIT = 100;

/**
 * Rassemble les trois sections du digest pour un projet.
 *
 * Chaque section est calculée avec le prédicat PARTAGÉ de `convex/opsDigest.ts`,
 * dont le jumeau `lib/ops-digest.ts` sert le dashboard admin — les deux sont
 * appariés par `lib/ops-digest.test.ts`. Sans ça, le message du matin et l'écran
 * compteraient deux choses différentes en ayant tous deux l'air justes.
 *
 * Une section ÉTEINTE côté admin est rendue VIDE : le message n'a alors pas à
 * connaître les bascules.
 *
 * AUCUN MONTANT n'est collecté pour les cycles — seulement des noms. Le montant
 * dû est une donnée de paie individuelle, exclue des messages.
 */
export const collectDigest = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (project === null) return null;
    const enabled = project.notify?.enabledEvents;
    const now = Date.now();

    // ── Deadlines de production dépassées ──────────────────────────────────
    const overdueMissions: {
      creatorName: string;
      missionLabel: string;
      daysLate: number;
    }[] = [];
    if (isEventEnabled(enabled, "digest_overdue_missions")) {
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect();
      const late = assignments
        .filter((a) => isOverdueMission(a, now))
        .sort((a, b) => a.dueDate - b.dueDate)
        .slice(0, DIGEST_SECTION_LIMIT);
      for (const a of late) {
        const creator = await ctx.db.get(a.creatorId);
        const format = a.formatId ? await ctx.db.get(a.formatId) : null;
        const campaign = a.scriptCombo
          ? await ctx.db.get(a.scriptCombo.campaignId)
          : null;
        overdueMissions.push({
          creatorName: creator?.name ?? a.creatorNameSnapshot ?? "—",
          missionLabel: campaign?.name ?? format?.name ?? "mission",
          daysLate: missionDaysLate(a, now),
        });
      }
    }

    // ── Cycles de paiement dus ─────────────────────────────────────────────
    const payCycles: { creatorName: string }[] = [];
    if (isEventEnabled(enabled, "digest_pay_cycles")) {
      const creators = await ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect();
      for (const c of creators) {
        const cycles = await cyclePaymentsForCreator(ctx, projectId, c._id, now);
        // Une créatrice apparaît UNE fois même si plusieurs cycles sont dus :
        // le digest dit qui attend, pas combien de lignes comptables.
        if (cycles.some((cy) => isCycleDue(cy, now))) {
          payCycles.push({ creatorName: c.name });
        }
        if (payCycles.length >= DIGEST_SECTION_LIMIT) break;
      }
    }

    // ── Comptes : warmup partenaire en retard, et chauffe clippeur sans talent ─
    // Les deux sections lisent la MÊME collection, chargée une fois — et se
    // partagent la population : un compte appartient à un partenaire OU à un
    // clippeur, jamais aux deux signaux.
    const warmupLate: { handle: string; missedDays: number }[] = [];
    // Chauffe TERMINÉE, en attente de validation admin. Sous le gate strict
    // (#98) ces comptes ne publient pas tant que l'admin ne les repasse pas en
    // actif : chaque jour de délai annule un jour de chauffe gagné.
    const warmupReady: { handle: string; creatorName: string }[] = [];
    const chauffeSansTalent: {
      handle: string;
      clipperName: string;
      joursRestants: number;
    }[] = [];
    const veutWarmup = isEventEnabled(enabled, "digest_warmup_late");
    const veutReady = isEventEnabled(enabled, "digest_warmup_ready");
    const veutChauffe = isEventEnabled(enabled, "digest_clipper_sans_talent");
    if (veutWarmup || veutChauffe || veutReady) {
      const [comptes, creators] = await Promise.all([
        ctx.db
          .query("comptes")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .collect(),
        ctx.db
          .query("creators")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .collect(),
      ]);
      const creatorMap = new Map(creators.map((c) => [c._id, c]));
      // Barème de warmup DU PROJET — le digest annonce des retards, il doit
      // les compter contre la bonne cible.
      const warmupDays = warmupTargetDaysOf(
        (await ctx.db.get(projectId)) ?? {},
      );
      // Talents appariés PAR clippeur — le dénominateur du signal de chauffe.
      const talentsParClippeur = new Map<string, number>();
      for (const c of creators) {
        if (resolveCreatorKind(c.kind) !== "talent" || !c.clipperId) continue;
        talentsParClippeur.set(
          c.clipperId,
          (talentsParClippeur.get(c.clipperId) ?? 0) + 1,
        );
      }

      for (const c of comptes) {
        const owner = c.creatorId ? creatorMap.get(c.creatorId) : undefined;
        const estClippeur =
          owner !== undefined && resolveCreatorKind(owner.kind) === "clipper";

        if (estClippeur) {
          // ⚠️ CORRECTION d'un faux positif préexistant : les comptes de clippeur
          // n'ont PAS de checks quotidiens (leur modèle est dérivé d'une date,
          // arbitrage D3). Le compteur de checks manqués les faisait donc
          // remonter « en retard » dès J+1, tous les jours, depuis leur
          // déclaration. Ils sortent du signal partenaire — rien ne change pour
          // les partenaires eux-mêmes.
          if (!veutChauffe) continue;
          const talentCount = talentsParClippeur.get(owner._id) ?? 0;
          if (!isChauffeSansTalent({ validatedAt: c.validatedAt, talentCount }, now)) {
            continue;
          }
          chauffeSansTalent.push({
            handle: c.handle,
            clipperName: owner.name,
            joursRestants: joursAvantSortieDeChauffe(c.validatedAt, now) ?? 0,
          });
          continue;
        }

        // Pas de `continue` sur veutWarmup ici : la section « terminés » lit la
        // même boucle et peut être activée seule. Le filtre par section se fait
        // juste avant chaque `push`.
        const shape = {
          effectiveStatus: effectiveStatus(c),
          warmupStartedAt: c.warmupStartedAt,
          dailyChecks: c.warmupProtocol?.dailyChecks ?? [],
          targetDays: effectiveTargetDays(c, warmupDays),
        };
        if (
          veutReady &&
          isWarmupComplete(
            { plateforme: c.plateforme, warmupProtocol: c.warmupProtocol },
            warmupDays,
          )
        ) {
          warmupReady.push({
            handle: c.handle,
            creatorName:
              (c.creatorId ? creatorMap.get(c.creatorId)?.name : null) ??
              "sans créateur",
          });
        }
        if (!veutWarmup) continue;
        const missed = warmupMissedDays(shape, now);
        if (missed > 0) warmupLate.push({ handle: c.handle, missedDays: missed });
      }
      warmupLate.sort((a, b) => b.missedDays - a.missedDays);
      // Le plus urgent d'abord : celui qui sort de chauffe le plus tôt.
      chauffeSansTalent.sort((a, b) => a.joursRestants - b.joursRestants);
    }

    // ── Renouvellements échoués que Whop VA relancer ───────────────────────
    // Contrepartie de l'arbitrage « immédiat seulement si non relançable » :
    // ceux-là ne disparaissent pas, ils changent de canal. Même bascule que
    // l'alerte immédiate (`whop_renewal_failed`), autre acheminement.
    // Bornés à la journée écoulée, sinon le digest deviendrait un stock.
    const retryableRenewalFailures: { memberName: string }[] = [];
    if (isEventEnabled(enabled, "whop_renewal_failed")) {
      const recent = await ctx.db
        .query("whopPayments")
        .withIndex("by_project_paidAt", (q) =>
          q.eq("projectId", projectId).gte("paidAt", now - DIGEST_LOOKBACK_MS),
        )
        .collect();
      for (const p of recent) {
        if (isDigestableRenewalFailure(p, now)) {
          retryableRenewalFailures.push({ memberName: p.memberName ?? "inconnu" });
        }
      }
    }

    return {
      projectName: project.name,
      projectSlug: project.slug,
      sections: {
        overdueMissions,
        payCycles,
        warmupLate: warmupLate.slice(0, DIGEST_SECTION_LIMIT),
        warmupReady: warmupReady.slice(0, DIGEST_SECTION_LIMIT),
        chauffeSansTalent: chauffeSansTalent.slice(0, DIGEST_SECTION_LIMIT),
        retryableRenewalFailures: retryableRenewalFailures.slice(
          0,
          DIGEST_SECTION_LIMIT,
        ),
      },
    };
  },
});

/** Projets ayant une config de notification — seuls candidats au digest. */
/** Heure de bilan par défaut, en heure de Paris. */
export const DEFAULT_EVENING_HOUR_PARIS = 21;

/**
 * Données du bilan du soir d'un projet : une entrée par créatrice ayant au
 * moins un post prévu AUJOURD'HUI et pas encore publié.
 *
 * Rend `[]` quand tout est publié — et c'est le cas nominal : l'action n'envoie
 * alors rien du tout.
 */
export const collectEveningReports = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (project === null) return null;
    const reports = await eveningUnpublishedReports(ctx, projectId, Date.now());
    return {
      projectSlug: project.slug,
      reports: reports.map((r) => ({
        creatorId: r.creatorId,
        creatorName: r.creatorName,
        onTimeRate: r.tally.rate,
        posts: r.posts.map((p) => ({
          missionLabel: p.missionLabel,
          accountHandles: p.accountHandles,
        })),
      })),
    };
  },
});

export type EveningSummary = {
  /** Projets dont l'heure de bilan correspond à MAINTENANT (Paris). */
  projects: number;
  /** Messages envoyés (un par créatrice concernée). */
  sent: number;
  /** Projets à l'heure du bilan mais sans rien à signaler. */
  silent: number;
};

/**
 * Cron HORAIRE du bilan de fin de journée.
 *
 * ⚠️ HORAIRE et non quotidien : chaque projet ne tire que lorsque l'heure de
 * PARIS vaut son heure configurée. Un cron quotidien à heure UTC fixe glisserait
 * d'une heure au changement d'heure d'octobre — « le bilan de 21 h » arriverait
 * à 20 h tout l'hiver. C'est le remède que l'en-tête de convex/crons.ts prévoit
 * nommément pour ce cas.
 *
 * ⚠️ Si l'heure de Paris n'est PAS calculable (`parisHour` rend null), on
 * n'envoie RIEN. Un repli sur UTC ferait partir le bilan à la mauvaise heure
 * toute l'année ; une comparaison qui échoue « vers vrai » en enverrait 24 par
 * jour. En cas de doute, on se tait.
 *
 * UN MESSAGE PAR CRÉATRICE, comme demandé : chacun est actionnable et
 * transférable seul. Aucune créatrice sans post en attente n'en produit.
 */
export const runEveningReports = internalAction({
  args: {},
  handler: async (ctx): Promise<EveningSummary> => {
    const maintenant = Date.now();
    const heureParis = parisHour(maintenant);
    if (heureParis === null) {
      console.error(
        "[notifications] heure de Paris incalculable — bilan du soir NON envoyé " +
          "(un repli sur UTC enverrait à la mauvaise heure).",
      );
      return { projects: 0, sent: 0, silent: 0 };
    }

    const projectIds = await ctx.runQuery(
      internal.notifications.listNotifyProjects,
      {},
    );
    let projects = 0;
    let sent = 0;
    let silent = 0;
    for (const projectId of projectIds) {
      const p = await ctx.runQuery(internal.notifications.getProjectNotify, {
        projectId,
      });
      const heureVoulue =
        p?.notify?.eveningHourParis ?? DEFAULT_EVENING_HOUR_PARIS;
      if (heureVoulue !== heureParis) continue;
      projects += 1;

      const nctx = await resolveNotifyContext(
        ctx,
        projectId,
        "evening_unpublished",
      );
      if (nctx === null) continue;

      const data = await ctx.runQuery(
        internal.notifications.collectEveningReports,
        { projectId },
      );
      if (data === null || data.reports.length === 0) {
        silent += 1;
        continue;
      }
      for (const r of data.reports) {
        const text = buildEveningReportMessage({
          ctx: {
            creatorName: r.creatorName,
            posts: r.posts,
            onTimeRate: r.onTimeRate,
          },
          appBaseUrl: nctx.cfg.appBaseUrl,
          projectSlug: nctx.projectSlug,
          creatorId: r.creatorId,
        });
        if (text === null) continue;
        const res = await deliver(nctx.cfg, "bilan de fin de journée", text);
        if (res.ok) sent += 1;
      }
    }
    return { projects, sent, silent };
  },
});

export const listNotifyProjects = internalQuery({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    return projects
      .filter((p) => p.notify !== undefined && p.status === "active")
      .map((p) => p._id);
  },
});

export type DigestSummary = {
  projects: number;
  sent: number;
  silent: number;
};

/**
 * Cron quotidien. UN message par projet configuré — et AUCUN message quand il
 * n'y a rien à signaler (`buildDigestMessage` rend null sur trois sections
 * vides). Un digest « rien à signaler » quotidien apprendrait à ignorer le
 * canal ; c'est explicitement ce qu'on ne veut pas.
 */
export const runDailyDigest = internalAction({
  args: {},
  handler: async (ctx): Promise<DigestSummary> => {
    const projectIds = await ctx.runQuery(
      internal.notifications.listNotifyProjects,
      {},
    );
    let sent = 0;
    let silent = 0;
    for (const projectId of projectIds) {
      const data = await ctx.runQuery(internal.notifications.collectDigest, {
        projectId,
      });
      if (data === null) continue;
      // Le canal est résolu par projet : un projet dont le jeton manque est
      // simplement sauté (log unique), sans interrompre les autres.
      const p = await ctx.runQuery(internal.notifications.getProjectNotify, {
        projectId,
      });
      const cfg = notifyConfig(p?.notify);
      if (cfg === null) {
        warnDisabled("digest quotidien");
        continue;
      }
      const text = buildDigestMessage({
        projectName: data.projectName,
        sections: data.sections,
        appBaseUrl: cfg.appBaseUrl,
        projectSlug: data.projectSlug,
      });
      if (text === null) {
        silent += 1;
        continue;
      }
      const res = await deliver(cfg, "digest quotidien", text);
      if (res.ok) sent += 1;
    }
    return { projects: projectIds.length, sent, silent };
  },
});

// ─── Wrapper ACTION admin-only (idiome LOCAL, cf convex/radar.ts:101) ────────

/**
 * Vérifie le rôle admin DEPUIS UNE ACTION (qui n'a pas d'accès db direct).
 * Jumeau de `radar.requireAdminForRadarAction` — même règle que
 * requireProjectAdmin. Local au module, comme Radar l'a établi, pour ne pas
 * toucher functions.ts.
 */
export const requireAdminForNotifyAction = internalQuery({
  args: { userId: v.id("users"), projectId: v.id("projects") },
  handler: async (ctx, { userId, projectId }): Promise<boolean> => {
    const project = await ctx.db.get(projectId);
    if (project === null) return false;
    const user = await ctx.db.get(userId);
    if (user?.role === "superadmin") return true;
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", userId).eq("projectId", projectId),
      )
      .first();
    return membership?.role === "admin";
  },
});

const adminAction = customAction(action, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Non authentifié.");
    const ok: boolean = await ctx.runQuery(
      internal.notifications.requireAdminForNotifyAction,
      { userId, projectId },
    );
    if (!ok) throw new ConvexError("Réservé aux administrateurs du projet.");
    return { ctx: { userId, projectId }, args: {} };
  },
});

/**
 * Bouton « Envoyer un test » de l'écran admin. C'est LUI qui valide le couple
 * jeton + destinataire, sans attendre un vrai événement — et qui rend lisible
 * la panne la plus fréquente (mauvais chat_id → « chat not found »).
 *
 * Contrairement aux sept événements, ce test IGNORE les bascules : on teste le
 * canal, pas la configuration événementielle.
 */
export const sendTestNotification = adminAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; error?: string }> => {
    const p = await ctx.runQuery(internal.notifications.getProjectNotify, {
      projectId: ctx.projectId,
    });
    if (p === null) return { ok: false, error: "Projet introuvable." };
    const cfg = notifyConfig(p.notify);
    if (cfg === null) {
      return {
        ok: false,
        error:
          "Canal non configuré : renseigne le destinataire ici, et le jeton du bot en variable d'environnement.",
      };
    }
    const res = await sendNotification(cfg, buildTestMessage(p.name));
    if (!res.ok) {
      console.error(`[notifications] test d'envoi échoué : ${res.error}`);
      return { ok: false, error: res.error };
    }
    return { ok: true };
  },
});

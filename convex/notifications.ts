import { action, internalQuery, type ActionCtx } from "./_generated/server";
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
import { buildTestMessage } from "./notificationMessage";
import {
  isEventEnabled,
  sanitizeEnabledEvents,
  type NotificationEventKey,
} from "./notificationEvents";

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
 * Résout le contexte d'envoi d'un projet POUR UN ÉVÉNEMENT donné, ou `null` si
 * rien ne doit partir. Trois refus distincts, tous silencieux et loggés :
 * projet introuvable, canal non configuré, événement éteint côté admin.
 *
 * Point de passage OBLIGÉ de toutes les actions : la vérification « cet
 * événement est-il activé ? » ne doit exister qu'ici.
 */
export async function resolveNotifyContext(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  event: NotificationEventKey,
): Promise<NotifyContext | null> {
  const p = await ctx.runQuery(internal.notifications.getProjectNotify, {
    projectId,
  });
  if (p === null) return null;
  const cfg = notifyConfig(p.notify);
  if (cfg === null) {
    warnDisabled(event);
    return null;
  }
  if (!isEventEnabled(p.notify?.enabledEvents, event)) return null;
  return {
    projectName: p.name,
    projectSlug: p.slug,
    enabledEvents: p.notify?.enabledEvents ?? [],
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
  },
  handler: async (ctx, { chatId, enabledEvents, tokenEnvVar }) => {
    const trimmedChat = chatId.trim();
    const trimmedEnv = (tokenEnvVar ?? DEFAULT_TOKEN_ENV_VAR).trim();
    if (trimmedEnv.length === 0) {
      throw new ConvexError("Le nom de la variable d'environnement est requis.");
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
      },
    });
    return { ok: true, cleared: false };
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

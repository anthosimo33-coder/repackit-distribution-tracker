/**
 * Canal NOTIFICATION sortant (Telegram) — client minimal + garde-fous.
 *
 * Appelle l'API Bot directement en `fetch` (pas de dépendance npm) : aucun
 * module convex/ n'utilise `"use node"`, tout tourne dans le runtime V8 par
 * défaut. Même convention que emailApi / googleDriveApi / apifyApi / whopSync,
 * qui parlent à leurs API tierces sans SDK.
 *
 * RÈGLE N°1 (identique à emailApi) : une notification ne bloque JAMAIS une
 * action métier. `sendNotification` ne jette jamais — elle retourne
 * { ok:false, error } que l'appelant se contente de logger. Les envois sont par
 * ailleurs déclenchés via ctx.scheduler depuis les mutations (voir
 * convex/notifications.ts) : la transaction métier est déjà COMMITTÉE quand
 * l'action part, donc un Telegram en panne ne peut structurellement pas
 * transformer une erreur de notification en erreur métier.
 *
 * POURQUOI TELEGRAM : aucune validation de compte, aucun modèle de message à
 * faire approuver, format libre modifiable à volonté (cf le plan du chantier).
 * Le transport est isolé ici : ajouter Slack = un second `sendX` + un champ
 * `channel`, sans toucher aux sept événements.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

/** Timeout dur : un tiers lent ne doit pas retenir une action indéfiniment. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Plafond DUR de l'API Bot : un `sendMessage` au-delà de 4096 caractères est
 * rejeté en entier (HTTP 400). Un digest chargé peut s'en approcher → on tronque
 * plutôt que de perdre le message. Marge laissée pour le suffixe de troncature.
 */
export const TELEGRAM_MAX_CHARS = 4096;
const TRUNCATION_SUFFIX = "\n…(message tronqué)";

export type NotifyConfig = {
  /** Jeton du bot, lu en env — JAMAIS stocké en base. */
  token: string;
  /** Destinataire : id de la conversation ou du groupe (négatif pour un groupe). */
  chatId: string;
  /** Base URL PUBLIQUE de l'app Next (liens profonds), sans slash final. */
  appBaseUrl: string;
};

/**
 * Commande opérateur à exécuter pour activer le canal (affichée dans les logs
 * quand l'env est absente, comme le font emailApi et snytchDrive).
 */
export const NOTIFY_ENV_HINT =
  "npx convex env set TELEGRAM_BOT_TOKEN <jeton @BotFather> ; npx convex env set APP_BASE_URL https://ton-app.com";

/**
 * Config effective d'un projet. `null` = canal DÉSACTIVÉ → tous les envois
 * deviennent des no-op silencieux. Trois causes possibles, toutes voulues :
 *   - le projet n'a pas de bloc `notify` (jamais configuré) ;
 *   - la variable d'env NOMMÉE par `tokenEnvVar` est absente (dev/preview, CI) ;
 *   - APP_BASE_URL est absente (les liens profonds seraient cassés).
 *
 * C'est le garde-fou principal contre les envois depuis un environnement de dev
 * ou une suite e2e : sans le jeton en env, rien ne part, quoi qu'il y ait en base.
 */
export function notifyConfig(
  notify: { chatId?: string; tokenEnvVar?: string } | undefined | null,
): NotifyConfig | null {
  if (!notify) return null;
  const chatId = notify.chatId?.trim();
  const tokenEnvVar = notify.tokenEnvVar?.trim();
  if (!chatId || !tokenEnvVar) return null;
  const token = process.env[tokenEnvVar];
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!token || !appBaseUrl) return null;
  return { token, chatId, appBaseUrl: appBaseUrl.replace(/\/+$/, "") };
}

/**
 * Échappe le texte injecté dans un message Telegram en `parse_mode: "HTML"`.
 *
 * Telegram n'accepte qu'un sous-ensemble balisé (<b>, <i>, <a href>, <code>…) et
 * n'exige d'échapper que ces TROIS caractères — contre ~18 pour MarkdownV2, d'où
 * le choix du mode HTML : un pseudo ou un motif de litige contenant un tiret ou
 * un point ne casse pas le rendu.
 */
export function escapeTelegram(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Tronque au plafond de l'API en le signalant, plutôt que de perdre l'envoi. */
export function clampToTelegramLimit(text: string): string {
  if (text.length <= TELEGRAM_MAX_CHARS) return text;
  return (
    text.slice(0, TELEGRAM_MAX_CHARS - TRUNCATION_SUFFIX.length) +
    TRUNCATION_SUFFIX
  );
}

export type SendResult = { ok: boolean; error?: string };

/**
 * Envoi unitaire. NE JETTE JAMAIS : toute erreur (réseau, 4xx/5xx, timeout) est
 * remontée dans `error` pour être loggée par l'appelant.
 *
 * Le jeton transite dans le CHEMIN de l'URL (imposé par l'API Bot) : ne jamais
 * inclure l'URL construite dans un message d'erreur, elle porterait le secret.
 * D'où le `error` qui ne reprend que le statut et le corps de réponse.
 */
export async function sendNotification(
  cfg: NotifyConfig,
  text: string,
): Promise<SendResult> {
  try {
    const res = await fetch(
      `${TELEGRAM_API_BASE}/bot${cfg.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text: clampToTelegramLimit(text),
          parse_mode: "HTML",
          // Les messages portent un lien vers Jarvia (authentifié) : l'aperçu
          // serait vide ou afficherait l'écran de login. On le désactive.
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status} ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

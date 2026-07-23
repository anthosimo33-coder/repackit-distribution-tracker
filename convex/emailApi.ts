/**
 * Canal EMAIL sortant (Resend) — client minimal + garde-fous.
 *
 * Appelle l'API REST Resend directement en `fetch` (pas de dépendance npm) :
 * aucun module convex/ n'utilise `"use node"`, tout tourne dans le runtime V8
 * par défaut. Même convention que googleDriveApi / apifyApi / whopSync, qui
 * parlent à leurs API tierces sans SDK. Le service reste bien Resend.
 *
 * RÈGLE N°1 : un email ne bloque JAMAIS une action métier. `sendEmail` ne jette
 * jamais — il retourne { ok:false, error } que l'appelant se contente de logger.
 * Les envois sont par ailleurs déclenchés via ctx.scheduler depuis les mutations
 * (voir convex/emails.ts) : la transaction métier est déjà committée quand
 * l'action part.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Timeout dur : un tiers lent ne doit pas retenir une action indéfiniment. */
const SEND_TIMEOUT_MS = 10_000;

export type EmailConfig = {
  apiKey: string;
  /** Expéditeur vérifié Resend, ex. `Anthony (Jarvia) <anthony@mondomaine.com>`. */
  from: string;
  /** Base URL PUBLIQUE de l'app Next (liens du portail), sans slash final. */
  appBaseUrl: string;
  /**
   * Adresse de RÉPONSE. Plusieurs emails invitent explicitement la créatrice à
   * répondre (« réponds-moi directement ») : elle doit atterrir sur une vraie
   * boîte lue, jamais un noreply. Optionnelle : si absente, Resend fait
   * retomber les réponses sur `from` — qui doit alors être une vraie boîte.
   */
  replyTo?: string;
};

/**
 * Commande opérateur à exécuter pour activer le canal (affichée dans les logs
 * quand l'env est absente, comme le fait snytchDrive pour Google Drive).
 */
export const EMAIL_ENV_HINT =
  'npx convex env set RESEND_API_KEY <clé> ; npx convex env set RESEND_FROM "Anthony (Jarvia) <anthony@ton-domaine.com>" ; npx convex env set APP_BASE_URL https://ton-app.com ; npx convex env set RESEND_REPLY_TO anthony@ton-domaine.com';

/**
 * Config lue en env. `null` = canal DÉSACTIVÉ → tous les envois deviennent des
 * no-op silencieux. C'est le garde-fou principal contre les envois depuis un
 * environnement de dev/preview : sans les 3 variables requises, rien ne part.
 * RESEND_REPLY_TO est le seul optionnel (cf EmailConfig.replyTo).
 */
export function emailConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!apiKey || !from || !appBaseUrl) return null;
  const replyTo = process.env.RESEND_REPLY_TO;
  return {
    apiKey,
    from,
    appBaseUrl: appBaseUrl.replace(/\/+$/, ""),
    replyTo: replyTo && replyTo.trim().length > 0 ? replyTo.trim() : undefined,
  };
}

/**
 * Destinataires JAMAIS notifiés : jeux de données e2e et seed démo. Deuxième
 * garde-fou (le premier étant l'absence d'env) pour qu'un run de seed ou une
 * suite e2e lancée contre un déploiement CONFIGURÉ n'envoie pas de vrais mails.
 *
 * Couvre : emails en `.test` (@repackit.test des specs), `example.com`, le
 * compte démo (`antho.test.demo@repackit.io`) et les fiches nommées [E2E_TEST].
 */
export function isNonNotifiableRecipient(email: string, name?: string): boolean {
  const e = email.trim().toLowerCase();
  if (e.length === 0) return true;
  if (/\.test$/.test(e)) return true;
  if (/@example\.(com|org|net)$/.test(e)) return true;
  if (e.startsWith("e2e-")) return true;
  if (e.includes("test.demo@")) return true;
  if (name !== undefined && name.includes("[E2E_TEST]")) return true;
  return false;
}

/** Échappe le texte injecté dans les templates HTML (feedback admin, noms…). */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type SendResult = { ok: boolean; error?: string };

/**
 * Envoi unitaire. NE JETTE JAMAIS : toute erreur (réseau, 4xx/5xx, timeout) est
 * remontée dans `error` pour être loggée par l'appelant.
 */
export async function sendEmail(
  cfg: EmailConfig,
  msg: { to: string; subject: string; html: string },
): Promise<SendResult> {
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        // Omis si non configuré : Resend fait alors retomber les réponses sur `from`.
        ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status} ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Templates (sobres, français, un seul CTA vers la surface concernée) ──────

const WRAP_STYLE =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
  "max-width:520px;margin:0 auto;padding:24px;color:#0f172a;line-height:1.55;font-size:15px";
const BTN_STYLE =
  "display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;" +
  "padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px";
const MUTED_STYLE = "color:#64748b;font-size:13px;margin:20px 0 0";
const SIGNATURE_STYLE = "margin:20px 0 0;color:#0f172a";

/** Signature de TOUS les emails. Ces mails partent au nom d'Anthony. */
const SIGNATURE = "Anthony";

/**
 * Gabarit commun. `bodyHtml` est déjà échappé par l'appelant s'il contient de
 * la saisie libre. Le CTA pointe TOUJOURS vers la surface concernée du portail
 * (pas un simple « connecte-toi »).
 *
 * Ordre de rendu : titre, corps, bouton, note optionnelle, signature.
 */
export function renderEmail(params: {
  title: string;
  bodyHtml: string;
  cta: { label: string; url: string };
  /** Note discrète APRÈS le bouton et AVANT la signature (ex. validité du lien). */
  footerNote?: string;
}): string {
  return [
    `<div style="${WRAP_STYLE}">`,
    `<h1 style="font-size:19px;margin:0 0 16px">${escapeHtml(params.title)}</h1>`,
    params.bodyHtml,
    `<p style="margin:24px 0"><a href="${params.cta.url}" style="${BTN_STYLE}">${escapeHtml(params.cta.label)}</a></p>`,
    params.footerNote
      ? `<p style="${MUTED_STYLE}">${escapeHtml(params.footerNote)}</p>`
      : "",
    `<p style="${SIGNATURE_STYLE}">${SIGNATURE}</p>`,
    `</div>`,
  ].join("");
}

/** Paragraphe simple (texte déjà échappé si besoin). */
export function p(html: string): string {
  return `<p style="margin:0 0 12px">${html}</p>`;
}

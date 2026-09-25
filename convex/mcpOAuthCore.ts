/**
 * OAUTH DU SERVEUR MCP — module PUR (aucun import Convex), testé par Vitest
 * (lib/mcp-oauth.test.ts). Les fonctions Convex (convex/mcpOAuth.ts) et les
 * routes HTTP (convex/mcpOAuthHttp.ts) ne font que brancher la base et le réseau
 * sur ce qui est décidé ici.
 *
 * À QUOI ÇA SERT. La clé personnelle (convex/mcpTokens.ts) oblige à copier un
 * secret dans un fichier de config : impossible dans claude.ai, Claude Desktop
 * ou mobile, qui n'acceptent un serveur distant que comme CONNECTEUR — une
 * adresse, puis une connexion OAuth. Ce module fait de l'app son propre serveur
 * d'autorisation : Claude s'enregistre (RFC 7591), envoie la personne sur une
 * page de consentement de l'app, puis échange le code contre un jeton.
 *
 * Ce que Claude exige (claude.com/docs/connectors/building/authentication) :
 *   - un 401 portant `WWW-Authenticate: Bearer resource_metadata="…"` ;
 *   - les métadonnées de la ressource (RFC 9728) et du serveur (RFC 8414) ;
 *   - PKCE S256 annoncé ET exigé ;
 *   - `/token` en `application/x-www-form-urlencoded`, `/register` en JSON ;
 *   - `invalid_grant` (et aucun autre code) pour un jeton de rafraîchissement
 *     mort, et une ROTATION de ce jeton (client public) ;
 *   - le retour `https://claude.ai/api/mcp/auth_callback`, et pour Claude Code un
 *     retour loopback dont le PORT varie à chaque session.
 *
 * L'ÉMETTEUR VIT SOUS `/oauth`, PAS À LA RACINE. Convex Auth publie déjà, à la
 * racine du même site, un `/.well-known/openid-configuration` qui déclare
 * l'émetteur racine et un `authorization_endpoint` qui n'existe pas. Un client
 * qui tomberait sur ce document-là échouerait sans rien dire ; avec un émetteur à
 * chemin, aucune URL de découverte ne peut y mener.
 */

/** Seule permission accordée : lire, avec les droits de la personne. */
export const OAUTH_SCOPE_LECTURE = "read";
/** Demandé par Claude pour obtenir un jeton de rafraîchissement. */
export const OAUTH_SCOPE_HORS_LIGNE = "offline_access";
const SCOPES_CONNUS = [OAUTH_SCOPE_LECTURE, OAUTH_SCOPE_HORS_LIGNE] as const;

/** Code d'autorisation : échangé dans la foulée, 10 min suffisent largement. */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Jeton d'accès : une heure — Claude le renouvelle seul, sur 401 ou avant l'échéance. */
export const ACCESS_TTL_S = 60 * 60;
/**
 * Jeton de rafraîchissement : 90 jours GLISSANTS (chaque rotation les relance),
 * la durée d'une session de l'app (convex/auth.ts).
 */
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Enregistrements dynamiques acceptés par heure, tous clients confondus (anti-abus). */
export const ENREGISTREMENTS_MAX_PAR_HEURE = 50;
const REDIRECTIONS_MAX = 10;
const NOM_CLIENT_MAX = 100;
const URL_MAX = 2048;
const STATE_MAX = 2048;

export const PREFIXES = {
  client: "jvcl_",
  secret: "jvcs_",
  code: "jvco_",
  acces: "jvat_",
  rafraichissement: "jvrt_",
} as const;

export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";
const AUTH_METHODS: readonly AuthMethod[] = [
  "none",
  "client_secret_post",
  "client_secret_basic",
];

// ── Adresses ────────────────────────────────────────────────────────────────

export interface OAuthUrls {
  /** Émetteur (RFC 8414) — sous `/oauth`, cf l'en-tête. */
  issuer: string;
  /** La ressource protégée : l'adresse que la personne colle dans Claude. */
  resource: string;
  resourceMetadata: string;
  serverMetadata: string;
  /** Page de consentement : dans l'APP, là où la personne a sa session. */
  authorize: string;
  token: string;
  register: string;
  revoke: string;
}

/**
 * `siteUrl` = le site HTTP Convex (`CONVEX_SITE_URL`), `appUrl` = l'app Next
 * (`APP_BASE_URL`, repli `SITE_URL`). `appUrl` vide ⇒ `null` : sans adresse de
 * page de consentement, annoncer l'OAuth ne ferait qu'envoyer Claude dans le mur.
 */
export function oauthUrls(siteUrl: string, appUrl: string): OAuthUrls | null {
  const site = siteUrl.replace(/\/+$/, "");
  const app = appUrl.replace(/\/+$/, "");
  if (site === "" || app === "") return null;
  return {
    issuer: `${site}/oauth`,
    resource: `${site}/mcp`,
    resourceMetadata: `${site}/.well-known/oauth-protected-resource/mcp`,
    serverMetadata: `${site}/.well-known/oauth-authorization-server/oauth`,
    authorize: `${app}/oauth/authorize`,
    token: `${site}/oauth/token`,
    register: `${site}/oauth/register`,
    revoke: `${site}/oauth/revoke`,
  };
}

/** RFC 9728 — ce que Claude lit après le 401 pour trouver l'émetteur. */
export function protectedResourceMetadata(u: OAuthUrls) {
  return {
    resource: u.resource,
    authorization_servers: [u.issuer],
    scopes_supported: [OAUTH_SCOPE_LECTURE],
    bearer_methods_supported: ["header"],
    resource_name: "Jarvia",
  };
}

/**
 * RFC 8414. Pas de `client_id_metadata_document_supported` : sans lui, Claude
 * choisit l'enregistrement dynamique (`registration_endpoint`), le seul mode
 * implémenté ici.
 */
export function authorizationServerMetadata(u: OAuthUrls) {
  return {
    issuer: u.issuer,
    authorization_endpoint: u.authorize,
    token_endpoint: u.token,
    registration_endpoint: u.register,
    revocation_endpoint: u.revoke,
    scopes_supported: [...SCOPES_CONNUS],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [...AUTH_METHODS],
    revocation_endpoint_auth_methods_supported: [...AUTH_METHODS],
    code_challenge_methods_supported: ["S256"],
  };
}

/**
 * En-tête du 401 de `/mcp`. `jetonPresente` : un jeton a été envoyé mais n'est
 * pas (ou plus) valable — `invalid_token` dit à Claude de le rafraîchir.
 */
export function wwwAuthenticate(u: OAuthUrls | null, jetonPresente: boolean): string {
  const parties = ['Bearer realm="jarvia"'];
  if (jetonPresente) parties.push('error="invalid_token"');
  if (u) {
    parties.push(`resource_metadata="${u.resourceMetadata}"`);
    parties.push(`scope="${OAUTH_SCOPE_LECTURE}"`);
  }
  return parties.join(", ");
}

// ── Redirections ────────────────────────────────────────────────────────────

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/** `http(s)://hôte/chemin` : HTTPS partout, HTTP seulement en boucle locale (RFC 8252). */
export function redirectionAcceptable(uri: string): boolean {
  if (uri.length > URL_MAX) return false;
  const u = parseUrl(uri);
  if (!u || u.hash !== "" || u.username !== "" || u.password !== "") return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && LOOPBACK.has(u.hostname);
}

export function estBoucleLocale(uri: string): boolean {
  const u = parseUrl(uri);
  return u !== null && u.protocol === "http:" && LOOPBACK.has(u.hostname);
}

/**
 * Le retour demandé fait-il partie des retours enregistrés ? Égalité EXACTE,
 * sauf en boucle locale où le PORT est ignoré (RFC 8252 §7.3) : Claude Code ouvre
 * un port différent à chaque connexion.
 */
export function redirectionEnregistree(
  enregistrees: readonly string[],
  demandee: string,
): boolean {
  if (enregistrees.includes(demandee)) return true;
  const d = parseUrl(demandee);
  if (!d || !estBoucleLocale(demandee)) return false;
  return enregistrees.some((r) => {
    const e = parseUrl(r);
    return (
      e !== null &&
      estBoucleLocale(r) &&
      e.hostname === d.hostname &&
      e.pathname === d.pathname &&
      e.search === d.search
    );
  });
}

/** Paramètres ajoutés au retour, sans écraser sa propre query. */
export function avecParametres(
  uri: string,
  params: Record<string, string | undefined>,
): string {
  const u = new URL(uri);
  for (const [k, val] of Object.entries(params)) {
    if (val !== undefined) u.searchParams.set(k, val);
  }
  return u.toString();
}

/** Hôte affiché sur la page de consentement — ce vers quoi le code partira. */
export function hoteDe(uri: string): string {
  return parseUrl(uri)?.host ?? uri;
}

/** Le retour mène-t-il à Claude lui-même ? (seul cas où l'écran dit « Claude ») */
export function estRetourClaude(uri: string): boolean {
  const u = parseUrl(uri);
  return (
    u !== null &&
    u.protocol === "https:" &&
    (u.hostname === "claude.ai" || u.hostname === "claude.com")
  );
}

// ── Enregistrement dynamique (RFC 7591) ─────────────────────────────────────

export interface Refus {
  ok: false;
  error: string;
  description: string;
}
export type Resultat<T> = { ok: true; value: T } | Refus;

const refus = (error: string, description: string): Refus => ({
  ok: false,
  error,
  description,
});

export interface Enregistrement {
  redirectUris: string[];
  clientName: string;
  authMethod: AuthMethod;
}

const estObjet = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

export function validerEnregistrement(corps: unknown): Resultat<Enregistrement> {
  if (!estObjet(corps)) {
    return refus("invalid_client_metadata", "JSON object expected.");
  }
  const uris = corps.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    uris.length > REDIRECTIONS_MAX ||
    !uris.every((u) => typeof u === "string")
  ) {
    return refus(
      "invalid_redirect_uri",
      `redirect_uris: 1 to ${REDIRECTIONS_MAX} URIs required.`,
    );
  }
  const invalide = (uris as string[]).find((u) => !redirectionAcceptable(u));
  if (invalide !== undefined) {
    return refus(
      "invalid_redirect_uri",
      `Redirect URI not allowed (HTTPS, or HTTP on loopback only): ${invalide.slice(0, 200)}`,
    );
  }
  // RFC 7591 §2 : sans méthode déclarée, la valeur par défaut est client_secret_basic.
  const methode = corps.token_endpoint_auth_method ?? "client_secret_basic";
  if (!AUTH_METHODS.includes(methode as AuthMethod)) {
    return refus(
      "invalid_client_metadata",
      `token_endpoint_auth_method must be one of: ${AUTH_METHODS.join(", ")}.`,
    );
  }
  const grants = corps.grant_types;
  if (
    grants !== undefined &&
    (!Array.isArray(grants) ||
      !grants.every((g) => g === "authorization_code" || g === "refresh_token"))
  ) {
    return refus(
      "invalid_client_metadata",
      "grant_types: only authorization_code and refresh_token are supported.",
    );
  }
  const reponses = corps.response_types;
  if (
    reponses !== undefined &&
    (!Array.isArray(reponses) || !reponses.every((r) => r === "code"))
  ) {
    return refus("invalid_client_metadata", "response_types: only code is supported.");
  }
  const nom =
    typeof corps.client_name === "string"
      ? corps.client_name.trim().replace(/\s+/g, " ").slice(0, NOM_CLIENT_MAX)
      : "";
  return {
    ok: true,
    value: {
      redirectUris: [...new Set(uris as string[])],
      clientName: nom,
      authMethod: methode as AuthMethod,
    },
  };
}

// ── Demande d'autorisation ──────────────────────────────────────────────────

/** Paramètres de `/oauth/authorize`, tels que reçus (tous optionnels). */
export interface ParametresAutorisation {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
}

export interface DemandeValide {
  codeChallenge: string;
  scope: string;
  resource?: string;
  state?: string;
}

/** Portée accordée : ce qui est connu dans la demande, et toujours la lecture. */
export function scopeAccorde(demande: string | undefined): string {
  const voulus = new Set((demande ?? "").split(/\s+/).filter(Boolean));
  voulus.add(OAUTH_SCOPE_LECTURE);
  return SCOPES_CONNUS.filter((s) => voulus.has(s)).join(" ");
}

/** Une ressource désigne-t-elle NOTRE serveur MCP ? (barre finale tolérée) */
export function ressourceConforme(resource: string | undefined, attendue: string): boolean {
  if (resource === undefined || resource === "") return true;
  const sansBarre = (s: string) => s.replace(/\/+$/, "");
  return sansBarre(resource) === sansBarre(attendue);
}

/** Défi S256 = base64url(SHA-256(verifier)) de 32 octets : 43 caractères. */
const DEFI_S256 = /^[A-Za-z0-9_-]{43}$/;

/**
 * Le reste de la demande, une fois le client et le retour vérifiés. Un refus ici
 * se RENVOIE au client (son retour est sûr) ; un client ou un retour inconnus,
 * eux, ne se renvoient jamais — c'est l'appelant qui les traite avant.
 */
export function validerDemande(
  p: ParametresAutorisation,
  ressourceAttendue: string,
): Resultat<DemandeValide> {
  if (p.response_type !== "code") {
    return refus("unsupported_response_type", "response_type must be code.");
  }
  if (!p.code_challenge) {
    return refus("invalid_request", "PKCE is required (code_challenge, S256).");
  }
  if (p.code_challenge_method !== "S256") {
    return refus("invalid_request", "code_challenge_method must be S256.");
  }
  if (!DEFI_S256.test(p.code_challenge)) {
    return refus("invalid_request", "Malformed code_challenge.");
  }
  if (!ressourceConforme(p.resource, ressourceAttendue)) {
    return refus("invalid_target", "Unknown resource.");
  }
  if (p.state !== undefined && p.state.length > STATE_MAX) {
    return refus("invalid_request", "state is too long.");
  }
  return {
    ok: true,
    value: {
      codeChallenge: p.code_challenge,
      scope: scopeAccorde(p.scope),
      ...(p.resource ? { resource: p.resource } : {}),
      ...(p.state !== undefined ? { state: p.state } : {}),
    },
  };
}

// ── Jetons, PKCE, corps de requête ──────────────────────────────────────────

function base64url(octets: Uint8Array): string {
  let bin = "";
  for (const b of octets) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Secret aléatoire préfixé. À n'appeler QUE dans une action ou une action HTTP :
 * l'aléa d'une mutation Convex est rejouable (cf convex/mcpTokens.ts).
 */
export function secretAleatoire(prefixe: string, octets = 32): string {
  return prefixe + base64url(crypto.getRandomValues(new Uint8Array(octets)));
}

/** Empreinte SHA-256 en hexadécimal — la seule forme stockée d'un secret. */
export async function empreinte(texte: string): Promise<string> {
  const octets = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return [...new Uint8Array(octets)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** RFC 7636 : 43 à 128 caractères non réservés. */
export function verifierValide(v: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
}

/** Défi S256 d'un verifier : ce que le client a envoyé à l'autorisation. */
export async function defiS256(verifier: string): Promise<string> {
  const octets = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(octets));
}

/** Corps `application/x-www-form-urlencoded` → dictionnaire (première valeur). */
export function lireFormulaire(texte: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of new URLSearchParams(texte)) {
    if (!(k in out)) out[k] = val;
  }
  return out;
}

/** `Authorization: Basic …` (RFC 6749 §2.3.1 : id et secret form-encodés). */
export function lireBasic(
  entete: string | null,
): { clientId: string; clientSecret: string } | null {
  const m = entete?.match(/^\s*Basic\s+(\S+)\s*$/i);
  if (!m) return null;
  let brut: string;
  try {
    brut = atob(m[1]);
  } catch {
    return null;
  }
  const i = brut.indexOf(":");
  if (i < 0) return null;
  try {
    return {
      clientId: decodeURIComponent(brut.slice(0, i).replace(/\+/g, " ")),
      clientSecret: decodeURIComponent(brut.slice(i + 1).replace(/\+/g, " ")),
    };
  } catch {
    return null;
  }
}

/**
 * Identité du client à `/token` et `/revoke` : Basic, sinon champs du formulaire.
 * `secret` absent = client public (PKCE seul).
 */
export function identiteClient(
  form: Record<string, string>,
  authorization: string | null,
): { clientId: string; secret?: string } | null {
  const basic = lireBasic(authorization);
  if (basic) return { clientId: basic.clientId, secret: basic.clientSecret };
  if (!form.client_id) return null;
  return form.client_secret !== undefined
    ? { clientId: form.client_id, secret: form.client_secret }
    : { clientId: form.client_id };
}

export function reponseJeton(t: {
  accessToken: string;
  refreshToken: string;
  scope: string;
}) {
  return {
    access_token: t.accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: t.refreshToken,
    scope: t.scope,
  };
}

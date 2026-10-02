/**
 * CONNECTEUR OAUTH du serveur MCP — la base et les droits. Le protocole est
 * décidé dans `mcpOAuthCore.ts` (pur, testé) ; les routes HTTP sont dans
 * `mcpOAuthHttp.ts`.
 *
 * Parcours, vu de Claude :
 *   1. `POST /mcp` sans jeton → 401 qui pointe les métadonnées ;
 *   2. `POST /oauth/register` → un client (`insererClient`) ;
 *   3. la personne arrive sur `/oauth/authorize` DANS L'APP (sa session y est),
 *      lit ce qu'elle accorde et à qui, puis autorise (`approuverAutorisation`)
 *      ou refuse ;
 *   4. `POST /oauth/token` échange le code (`echangerCode`), puis rafraîchit
 *      (`rafraichirAcces`) ;
 *   5. chaque appel à `/mcp` porte le jeton d'accès (`resoudreJetonAcces`).
 *
 * Un accès OAuth vaut une clé personnelle : il agit au nom de la personne, avec
 * SES droits, projet par projet — et il est réservé à l'équipe, par la même règle
 * (`peutDetenirUneCle`).
 */

import { v, type Infer } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { authedAction, authedMutation, authedQuery, e2eMutation } from "./functions";
import { ERR, err } from "./errorCodes";
import { assertPeutDetenirUneCle, basculerScope, peutDetenirUneCle } from "./mcpTokens";
import {
  ACCESS_TTL_S,
  CODE_TTL_MS,
  ENREGISTREMENTS_MAX_PAR_HEURE,
  PREFIXES,
  REFRESH_TTL_MS,
  avecParametres,
  empreinte,
  estBoucleLocale,
  estRetourClaude,
  hoteDe,
  oauthUrls,
  redirectionEnregistree,
  ressourceConforme,
  secretAleatoire,
  validerDemande,
  type OAuthUrls,
} from "./mcpOAuthCore";

/**
 * Adresses de CE déploiement. L'app se lit dans `APP_BASE_URL` (celle des liens
 * d'e-mail), à défaut dans `SITE_URL` (celle de Convex Auth). Ni l'une ni
 * l'autre ⇒ `null` : l'OAuth n'est pas annoncé, les clés restent la seule voie.
 */
export function urlsDuDeploiement(): OAuthUrls | null {
  return oauthUrls(
    process.env.CONVEX_SITE_URL ?? "",
    process.env.APP_BASE_URL || process.env.SITE_URL || "",
  );
}

const parametres = {
  response_type: v.optional(v.string()),
  client_id: v.optional(v.string()),
  redirect_uri: v.optional(v.string()),
  code_challenge: v.optional(v.string()),
  code_challenge_method: v.optional(v.string()),
  state: v.optional(v.string()),
  scope: v.optional(v.string()),
  resource: v.optional(v.string()),
};
const parametresValidator = v.object(parametres);
type Parametres = Infer<typeof parametresValidator>;

type Demande =
  /** client inconnu : rien ne garantit où renverrait une redirection → on n'en fait pas. */
  | { kind: "client_inconnu" }
  /** retour absent de ceux du client : idem. */
  | { kind: "redirection_invalide" }
  /** le reste est faux, mais le retour est sûr : l'erreur y repart. */
  | { kind: "demande_invalide"; retour: string; hote: string }
  | {
      kind: "ok";
      client: Doc<"mcpOAuthClients">;
      redirectUri: string;
      codeChallenge: string;
      scope: string;
      resource?: string;
      state?: string;
    };

async function preparerDemande(ctx: QueryCtx, p: Parametres): Promise<Demande> {
  const client = p.client_id
    ? await ctx.db
        .query("mcpOAuthClients")
        .withIndex("by_client_id", (q) => q.eq("clientId", p.client_id!))
        .first()
    : null;
  if (!client) return { kind: "client_inconnu" };
  // Sans retour demandé : le seul enregistré, s'il est unique.
  const redirectUri =
    p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !redirectionEnregistree(client.redirectUris, redirectUri)) {
    return { kind: "redirection_invalide" };
  }
  const urls = urlsDuDeploiement();
  const demande = validerDemande(p, urls?.resource ?? "");
  if (!demande.ok) {
    return {
      kind: "demande_invalide",
      hote: hoteDe(redirectUri),
      retour: avecParametres(redirectUri, {
        error: demande.error,
        error_description: demande.description,
        state: p.state,
      }),
    };
  }
  return { kind: "ok", client, redirectUri, ...demande.value };
}

/**
 * Ce que la page de consentement affiche. Le NOM du client est déclaré par le
 * client lui-même : l'écran ne dit « Claude » que si le code repart vers
 * claude.ai, et montre toujours l'hôte de retour.
 */
export const describeAuthorization = authedQuery({
  args: parametres,
  handler: async (ctx, p) => {
    const d = await preparerDemande(ctx, p);
    if (d.kind !== "ok") return d;
    const refus = avecParametres(d.redirectUri, { error: "access_denied", state: d.state });
    if (!(await peutDetenirUneCle(ctx, ctx.userId))) {
      return { kind: "non_autorise" as const, refus, hote: hoteDe(d.redirectUri) };
    }
    const user = await ctx.db.get(ctx.userId);
    return {
      kind: "ok" as const,
      nomClient: d.client.clientName,
      hote: hoteDe(d.redirectUri),
      claude: estRetourClaude(d.redirectUri),
      boucleLocale: estBoucleLocale(d.redirectUri),
      compte: user?.email ?? user?.name ?? "",
      refus,
    };
  },
});

/**
 * La personne autorise. Le code est tiré ICI (action : aléa non rejouable),
 * seule son empreinte est écrite, et la demande est revalidée dans la même
 * transaction que l'écriture.
 */
export const approveAuthorization = authedAction({
  args: parametres,
  handler: async (ctx, p): Promise<{ url: string }> => {
    const code = secretAleatoire(PREFIXES.code);
    const r: { redirectUri: string; state?: string } = await ctx.runMutation(
      internal.mcpOAuth.enregistrerCode,
      { userId: ctx.userId, params: p, codeHash: await empreinte(code) },
    );
    return { url: avecParametres(r.redirectUri, { code, state: r.state }) };
  },
});

export const enregistrerCode = internalMutation({
  args: { userId: v.id("users"), params: parametresValidator, codeHash: v.string() },
  handler: async (ctx, { userId, params, codeHash }) => {
    const d = await preparerDemande(ctx, params);
    if (d.kind !== "ok") {
      throw err(
        ERR.MCP_OAUTH_REQUEST_INVALID,
        "Demande d'autorisation invalide : relance la connexion depuis Claude.",
      );
    }
    await assertPeutDetenirUneCle(ctx, userId);
    await ctx.db.insert("mcpOAuthCodes", {
      codeHash,
      clientId: d.client.clientId,
      userId,
      redirectUri: d.redirectUri,
      codeChallenge: d.codeChallenge,
      scope: d.scope,
      ...(d.resource ? { resource: d.resource } : {}),
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    return { redirectUri: d.redirectUri, ...(d.state !== undefined ? { state: d.state } : {}) };
  },
});

// ── Enregistrement dynamique ────────────────────────────────────────────────

export const insererClient = internalMutation({
  args: {
    clientId: v.string(),
    clientSecretHash: v.optional(v.string()),
    authMethod: v.union(
      v.literal("none"),
      v.literal("client_secret_post"),
      v.literal("client_secret_basic"),
    ),
    clientName: v.string(),
    redirectUris: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; createdAt: number }> => {
    const maintenant = Date.now();
    // Anti-abus : l'enregistrement est ouvert à tous (c'est le principe du DCR),
    // le volume ne l'est pas.
    const recents = await ctx.db
      .query("mcpOAuthClients")
      .withIndex("by_created", (q) => q.gt("createdAt", maintenant - 60 * 60 * 1000))
      .take(ENREGISTREMENTS_MAX_PAR_HEURE);
    if (recents.length >= ENREGISTREMENTS_MAX_PAR_HEURE) {
      return { ok: false, createdAt: maintenant };
    }
    await ctx.db.insert("mcpOAuthClients", { ...args, createdAt: maintenant });
    return { ok: true, createdAt: maintenant };
  },
});

// ── Échange du code, rafraîchissement ───────────────────────────────────────

type ErreurJeton = { ok: false; error: "invalid_grant" | "invalid_client"; description: string };
type SuccesJeton = { ok: true; scope: string };

/** Le client est-il bien lui ? Un client public (PKCE seul) n'a pas de secret à prouver. */
async function clientAuthentifie(
  ctx: QueryCtx,
  clientId: string,
  secretHash: string | undefined,
): Promise<Doc<"mcpOAuthClients"> | null> {
  const client = await ctx.db
    .query("mcpOAuthClients")
    .withIndex("by_client_id", (q) => q.eq("clientId", clientId))
    .first();
  if (!client) return null;
  if (client.authMethod !== "none" && secretHash !== client.clientSecretHash) return null;
  return client;
}

const CLIENT_REFUSE: ErreurJeton = {
  ok: false,
  error: "invalid_client",
  description: "Unknown client or bad credentials.",
};

export const echangerCode = internalMutation({
  args: {
    codeHash: v.string(),
    clientId: v.string(),
    clientSecretHash: v.optional(v.string()),
    redirectUri: v.optional(v.string()),
    /** Défi S256 recalculé depuis le verifier reçu. */
    defi: v.string(),
    resource: v.optional(v.string()),
    accessTokenHash: v.string(),
    refreshTokenHash: v.string(),
  },
  handler: async (ctx, a): Promise<SuccesJeton | ErreurJeton> => {
    const code = await ctx.db
      .query("mcpOAuthCodes")
      .withIndex("by_hash", (q) => q.eq("codeHash", a.codeHash))
      .first();
    const perdu = (description: string): ErreurJeton => ({
      ok: false,
      error: "invalid_grant",
      description,
    });
    if (!code) return perdu("Unknown or already used code.");
    // Usage UNIQUE, y compris quand l'échange échoue : un code essayé est brûlé.
    await ctx.db.delete(code._id);
    const client = await clientAuthentifie(ctx, a.clientId, a.clientSecretHash);
    if (!client) return CLIENT_REFUSE;
    const maintenant = Date.now();
    if (code.expiresAt < maintenant) return perdu("Code expired.");
    if (code.clientId !== a.clientId) return perdu("Code issued to another client.");
    if (a.redirectUri !== undefined && a.redirectUri !== code.redirectUri) {
      return perdu("redirect_uri does not match the authorization request.");
    }
    if (a.defi !== code.codeChallenge) return perdu("PKCE verification failed.");
    // (Que la ressource désigne bien CE serveur est vérifié par la route HTTP.)
    if (a.resource && code.resource && !ressourceConforme(a.resource, code.resource)) {
      return perdu("resource does not match the authorization request.");
    }
    if (!(await ctx.db.get(code.userId))) return perdu("Account no longer exists.");

    // Ménage des accès morts de la personne, au passage.
    for (const g of await ctx.db
      .query("mcpOAuthGrants")
      .withIndex("by_user", (q) => q.eq("userId", code.userId))
      .collect()) {
      if (g.refreshExpiresAt < maintenant) await ctx.db.delete(g._id);
    }
    await ctx.db.insert("mcpOAuthGrants", {
      userId: code.userId,
      clientId: client.clientId,
      clientName: client.clientName,
      redirectHost: hoteDe(code.redirectUri),
      scope: code.scope,
      accessTokenHash: a.accessTokenHash,
      accessExpiresAt: maintenant + ACCESS_TTL_S * 1000,
      refreshTokenHash: a.refreshTokenHash,
      refreshExpiresAt: maintenant + REFRESH_TTL_MS,
      createdAt: maintenant,
    });
    return { ok: true, scope: code.scope };
  },
});

async function accesParRafraichissement(ctx: QueryCtx, hash: string) {
  const courant = await ctx.db
    .query("mcpOAuthGrants")
    .withIndex("by_refresh", (q) => q.eq("refreshTokenHash", hash))
    .first();
  if (courant) return { grant: courant, viaPrecedent: false };
  const precedent = await ctx.db
    .query("mcpOAuthGrants")
    .withIndex("by_previous_refresh", (q) => q.eq("previousRefreshTokenHash", hash))
    .first();
  return precedent ? { grant: precedent, viaPrecedent: true } : null;
}

export const rafraichirAcces = internalMutation({
  args: {
    refreshTokenHash: v.string(),
    clientId: v.string(),
    clientSecretHash: v.optional(v.string()),
    newAccessTokenHash: v.string(),
    newRefreshTokenHash: v.string(),
  },
  handler: async (ctx, a): Promise<SuccesJeton | ErreurJeton> => {
    const trouve = await accesParRafraichissement(ctx, a.refreshTokenHash);
    const perdu: ErreurJeton = {
      ok: false,
      error: "invalid_grant",
      description: "Refresh token unknown, revoked or expired.",
    };
    if (!trouve) return perdu;
    const { grant, viaPrecedent } = trouve;
    const client = await clientAuthentifie(ctx, a.clientId, a.clientSecretHash);
    if (!client) return CLIENT_REFUSE;
    if (grant.clientId !== a.clientId) return perdu;
    const maintenant = Date.now();
    if (grant.refreshExpiresAt < maintenant || !(await ctx.db.get(grant.userId))) {
      await ctx.db.delete(grant._id);
      return perdu;
    }
    await ctx.db.patch(grant._id, {
      accessTokenHash: a.newAccessTokenHash,
      accessExpiresAt: maintenant + ACCESS_TTL_S * 1000,
      refreshTokenHash: a.newRefreshTokenHash,
      // Le jeton qu'on vient d'utiliser devient « le précédent » : il reste
      // valable tant que le nouveau n'a pas servi. Rejouer le précédent, lui, ne
      // le remplace pas — il garde sa place jusqu'au premier usage du nouveau.
      previousRefreshTokenHash: viaPrecedent
        ? grant.previousRefreshTokenHash
        : grant.refreshTokenHash,
      refreshExpiresAt: maintenant + REFRESH_TTL_MS,
    });
    return { ok: true, scope: grant.scope };
  },
});

// ── Usage à /mcp ────────────────────────────────────────────────────────────

/** Jeton d'accès → personne. `null` si inconnu, expiré, révoqué, ou compte supprimé. */
export const resoudreJetonAcces = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const grant = await ctx.db
      .query("mcpOAuthGrants")
      .withIndex("by_access", (q) => q.eq("accessTokenHash", tokenHash))
      .first();
    if (!grant || grant.accessExpiresAt < Date.now()) return null;
    if (!(await ctx.db.get(grant.userId))) return null;
    return {
      userId: grant.userId,
      grantId: grant._id,
      lastUsedAt: grant.lastUsedAt ?? null,
      writeScopes: grant.writeScopes ?? [],
      name: grant.clientName,
    };
  },
});

export const toucherAcces = internalMutation({
  args: { grantId: v.id("mcpOAuthGrants") },
  handler: async (ctx, { grantId }) => {
    if (await ctx.db.get(grantId)) await ctx.db.patch(grantId, { lastUsedAt: Date.now() });
  },
});

/** RFC 7009 : jeton d'accès OU de rafraîchissement → l'accès entier disparaît. */
export const revoquerParJeton = internalMutation({
  args: { tokenHash: v.string(), clientId: v.optional(v.string()) },
  handler: async (ctx, { tokenHash, clientId }) => {
    const grant =
      (await ctx.db
        .query("mcpOAuthGrants")
        .withIndex("by_access", (q) => q.eq("accessTokenHash", tokenHash))
        .first()) ?? (await accesParRafraichissement(ctx, tokenHash))?.grant;
    if (grant && (clientId === undefined || grant.clientId === clientId)) {
      await ctx.db.delete(grant._id);
    }
  },
});

// ── Écran « Connecter Claude » ──────────────────────────────────────────────

/** L'OAuth est-il annoncé sur ce déploiement ? (l'écran n'offre le connecteur que si oui) */
export const getOAuthStatus = authedQuery({
  args: {},
  handler: async () => ({ pret: urlsDuDeploiement() !== null }),
});

export const listMyOAuthGrants = authedQuery({
  args: {},
  handler: async (ctx) => {
    const maintenant = Date.now();
    const grants = await ctx.db
      .query("mcpOAuthGrants")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .collect();
    // Projection explicite : jamais une empreinte de jeton.
    return grants
      .filter((g) => g.refreshExpiresAt >= maintenant)
      .map((g) => ({
        _id: g._id,
        clientName: g.clientName,
        hote: g.redirectHost,
        createdAt: g.createdAt,
        lastUsedAt: g.lastUsedAt ?? null,
        writeScopes: g.writeScopes ?? [],
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const revokeOAuthGrant = authedMutation({
  args: { grantId: v.id("mcpOAuthGrants") },
  handler: async (ctx, { grantId }) => {
    const grant = await ctx.db.get(grantId);
    // L'accès d'un AUTRE est traité comme inexistant : ne rien révéler.
    if (!grant || grant.userId !== ctx.userId) {
      throw err(ERR.MCP_OAUTH_GRANT_NOT_FOUND, "Accès introuvable.");
    }
    await ctx.db.delete(grantId);
  },
});

/**
 * Autoriser (ou couper) les MODIFICATIONS d'UN domaine pour une application
 * connectée — comme `setMcpTokenWriteScope`, appliqué à la valeur en base.
 */
export const setOAuthGrantWriteScope = authedMutation({
  args: { grantId: v.id("mcpOAuthGrants"), scope: v.string(), on: v.boolean() },
  handler: async (ctx, { grantId, scope, on }) => {
    const grant = await ctx.db.get(grantId);
    if (!grant || grant.userId !== ctx.userId) {
      throw err(ERR.MCP_OAUTH_GRANT_NOT_FOUND, "Accès introuvable.");
    }
    await ctx.db.patch(grantId, { writeScopes: basculerScope(grant.writeScopes ?? [], scope, on) });
  },
});

/** Nettoyage e2e — tout l'OAuth du déploiement de test. Gardé par E2E_SECRET. */
export const cleanupTestMcpOAuth = e2eMutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0;
    for (const table of ["mcpOAuthGrants", "mcpOAuthCodes", "mcpOAuthClients"] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    return { deleted };
  },
});


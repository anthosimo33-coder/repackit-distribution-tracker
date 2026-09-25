/**
 * ROUTES HTTP du connecteur OAuth (cf convex/mcpOAuth.ts pour le parcours).
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]    RFC 9728
 *   GET  /.well-known/oauth-authorization-server[/oauth] RFC 8414
 *   POST /oauth/register                                RFC 7591 (JSON)
 *   POST /oauth/token                                   RFC 6749 (formulaire)
 *   POST /oauth/revoke                                  RFC 7009 (formulaire)
 *
 * La page d'autorisation n'est PAS ici : elle vit dans l'app (/oauth/authorize),
 * là où la personne a sa session.
 *
 * CORS ouvert (`*`) : ces routes ne lisent aucun cookie, un client navigateur
 * (inspecteur MCP) doit pouvoir les appeler, et Claude, lui, les appelle depuis
 * ses serveurs.
 */

import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { urlsDuDeploiement } from "./mcpOAuth";
import {
  PREFIXES,
  authorizationServerMetadata,
  defiS256,
  empreinte,
  identiteClient,
  lireFormulaire,
  protectedResourceMetadata,
  reponseJeton,
  ressourceConforme,
  secretAleatoire,
  validerEnregistrement,
  verifierValide,
} from "./mcpOAuthCore";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version",
};

function json(status: number, corps: unknown, entetes: Record<string, string> = {}) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...entetes },
  });
}

/** Erreur OAuth (RFC 6749 §5.2) — jamais mise en cache. */
function erreurOAuth(status: number, error: string, description: string) {
  return json(
    status,
    { error, error_description: description },
    {
      "Cache-Control": "no-store",
      ...(status === 401 ? { "WWW-Authenticate": 'Basic realm="jarvia"' } : {}),
    },
  );
}

const NON_CONFIGURE = () =>
  json(503, {
    error: "temporarily_unavailable",
    error_description: "OAuth is not configured on this deployment (APP_BASE_URL).",
  });

export const preflight = httpAction(
  async () => new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } }),
);

export const ressourceProtegee = httpAction(async () => {
  const u = urlsDuDeploiement();
  return u ? json(200, protectedResourceMetadata(u)) : NON_CONFIGURE();
});

export const serveurAutorisation = httpAction(async () => {
  const u = urlsDuDeploiement();
  return u ? json(200, authorizationServerMetadata(u)) : NON_CONFIGURE();
});

export const enregistrement = httpAction(async (ctx, request) => {
  if (!urlsDuDeploiement()) return NON_CONFIGURE();
  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    return erreurOAuth(400, "invalid_client_metadata", "JSON body expected.");
  }
  const r = validerEnregistrement(corps);
  if (!r.ok) return erreurOAuth(400, r.error, r.description);
  const clientId = secretAleatoire(PREFIXES.client, 16);
  const secret =
    r.value.authMethod === "none" ? undefined : secretAleatoire(PREFIXES.secret);
  const insere = await ctx.runMutation(internal.mcpOAuth.insererClient, {
    clientId,
    ...(secret ? { clientSecretHash: await empreinte(secret) } : {}),
    authMethod: r.value.authMethod,
    clientName: r.value.clientName,
    redirectUris: r.value.redirectUris,
  });
  if (!insere.ok) {
    return erreurOAuth(429, "temporarily_unavailable", "Too many registrations, retry later.");
  }
  return json(
    201,
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(insere.createdAt / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: r.value.clientName,
      redirect_uris: r.value.redirectUris,
      token_endpoint_auth_method: r.value.authMethod,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { "Cache-Control": "no-store" },
  );
});

export const jeton = httpAction(async (ctx, request) => {
  const u = urlsDuDeploiement();
  if (!u) return NON_CONFIGURE();
  const form = lireFormulaire(await request.text());
  const client = identiteClient(form, request.headers.get("authorization"));
  if (!client) return erreurOAuth(401, "invalid_client", "client_id is required.");
  const clientSecretHash =
    client.secret !== undefined ? await empreinte(client.secret) : undefined;
  if (!ressourceConforme(form.resource, u.resource)) {
    return erreurOAuth(400, "invalid_target", "Unknown resource.");
  }

  const acces = secretAleatoire(PREFIXES.acces);
  const rafraichissement = secretAleatoire(PREFIXES.rafraichissement);
  let r;
  if (form.grant_type === "authorization_code") {
    if (!form.code || !form.code_verifier) {
      return erreurOAuth(400, "invalid_request", "code and code_verifier are required.");
    }
    if (!verifierValide(form.code_verifier)) {
      return erreurOAuth(400, "invalid_grant", "Malformed code_verifier.");
    }
    r = await ctx.runMutation(internal.mcpOAuth.echangerCode, {
      codeHash: await empreinte(form.code),
      clientId: client.clientId,
      ...(clientSecretHash ? { clientSecretHash } : {}),
      ...(form.redirect_uri !== undefined ? { redirectUri: form.redirect_uri } : {}),
      defi: await defiS256(form.code_verifier),
      ...(form.resource ? { resource: form.resource } : {}),
      accessTokenHash: await empreinte(acces),
      refreshTokenHash: await empreinte(rafraichissement),
    });
  } else if (form.grant_type === "refresh_token") {
    if (!form.refresh_token) {
      return erreurOAuth(400, "invalid_request", "refresh_token is required.");
    }
    r = await ctx.runMutation(internal.mcpOAuth.rafraichirAcces, {
      refreshTokenHash: await empreinte(form.refresh_token),
      clientId: client.clientId,
      ...(clientSecretHash ? { clientSecretHash } : {}),
      newAccessTokenHash: await empreinte(acces),
      newRefreshTokenHash: await empreinte(rafraichissement),
    });
  } else {
    return erreurOAuth(
      400,
      "unsupported_grant_type",
      "grant_type must be authorization_code or refresh_token.",
    );
  }
  if (!r.ok) {
    return erreurOAuth(r.error === "invalid_client" ? 401 : 400, r.error, r.description);
  }
  return json(
    200,
    reponseJeton({ accessToken: acces, refreshToken: rafraichissement, scope: r.scope }),
    { "Cache-Control": "no-store", Pragma: "no-cache" },
  );
});

/** RFC 7009 : 200 dans tous les cas où la requête est bien formée — ne rien révéler. */
export const revocation = httpAction(async (ctx, request) => {
  const form = lireFormulaire(await request.text());
  if (!form.token) return erreurOAuth(400, "invalid_request", "token is required.");
  const client = identiteClient(form, request.headers.get("authorization"));
  await ctx.runMutation(internal.mcpOAuth.revoquerParJeton, {
    tokenHash: await empreinte(form.token),
    ...(client ? { clientId: client.clientId } : {}),
  });
  return new Response(null, { status: 200, headers: CORS });
});

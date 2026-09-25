import { describe, expect, it } from "vitest";
import {
  authorizationServerMetadata,
  avecParametres,
  defiS256,
  estRetourClaude,
  identiteClient,
  lireBasic,
  lireFormulaire,
  oauthUrls,
  protectedResourceMetadata,
  redirectionAcceptable,
  redirectionEnregistree,
  scopeAccorde,
  validerDemande,
  validerEnregistrement,
  verifierValide,
  wwwAuthenticate,
} from "../convex/mcpOAuthCore";

const SITE = "https://giddy-bass-969.convex.site";
const APP = "https://studio.jarvia.example";
const CALLBACK_CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const urls = oauthUrls(`${SITE}/`, `${APP}/`)!;

// Défi S256 de 43 caractères (RFC 7636, annexe B).
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const DEFI = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("adresses et métadonnées", () => {
  it("l'émetteur vit sous /oauth, la page de consentement dans l'app", () => {
    expect(urls.issuer).toBe(`${SITE}/oauth`);
    expect(urls.resource).toBe(`${SITE}/mcp`);
    expect(urls.authorize).toBe(`${APP}/oauth/authorize`);
    expect(urls.serverMetadata).toBe(`${SITE}/.well-known/oauth-authorization-server/oauth`);
    expect(urls.resourceMetadata).toBe(`${SITE}/.well-known/oauth-protected-resource/mcp`);
  });

  it("sans adresse d'app, pas d'OAuth annoncé", () => {
    expect(oauthUrls(SITE, "")).toBeNull();
    expect(oauthUrls("", APP)).toBeNull();
  });

  it("la ressource pointe l'émetteur, l'émetteur annonce S256, DCR et le client public", () => {
    const prm = protectedResourceMetadata(urls);
    expect(prm.resource).toBe(`${SITE}/mcp`);
    expect(prm.authorization_servers).toEqual([`${SITE}/oauth`]);
    const as = authorizationServerMetadata(urls);
    expect(as.issuer).toBe(prm.authorization_servers[0]);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.token_endpoint_auth_methods_supported).toContain("none");
    expect(as.registration_endpoint).toBe(`${SITE}/oauth/register`);
    expect(as.scopes_supported).toContain("offline_access");
    // Sans ce drapeau, Claude choisit l'enregistrement dynamique — le seul implémenté.
    expect(as).not.toHaveProperty("client_id_metadata_document_supported");
  });

  it("le 401 pointe les métadonnées, et dit invalid_token quand un jeton a été présenté", () => {
    expect(wwwAuthenticate(urls, false)).toBe(
      `Bearer realm="jarvia", resource_metadata="${SITE}/.well-known/oauth-protected-resource/mcp", scope="read"`,
    );
    expect(wwwAuthenticate(urls, true)).toContain('error="invalid_token"');
    expect(wwwAuthenticate(null, false)).toBe('Bearer realm="jarvia"');
  });
});

describe("retours (redirect_uri)", () => {
  it("HTTPS partout, HTTP seulement en boucle locale", () => {
    for (const ok of [
      CALLBACK_CLAUDE,
      "http://localhost:3118/callback",
      "http://127.0.0.1:52011/callback",
      "http://[::1]:8080/cb",
    ]) {
      expect(redirectionAcceptable(ok), ok).toBe(true);
    }
    for (const ko of [
      "http://claude.ai/api/mcp/auth_callback",
      "javascript:alert(1)",
      "cursor://anysphere.cursor-retrieval/oauth",
      "https://claude.ai/api/mcp/auth_callback#frag",
      "https://user:pass@claude.ai/cb",
      "pas une url",
    ]) {
      expect(redirectionAcceptable(ko), ko).toBe(false);
    }
  });

  it("égalité exacte, sauf le port en boucle locale (Claude Code change de port)", () => {
    const claudeCode = ["http://localhost:3118/callback"];
    expect(redirectionEnregistree(claudeCode, "http://localhost:3118/callback")).toBe(true);
    expect(redirectionEnregistree(claudeCode, "http://localhost:49152/callback")).toBe(true);
    expect(redirectionEnregistree(claudeCode, "http://127.0.0.1:3118/callback")).toBe(false);
    expect(redirectionEnregistree(claudeCode, "http://localhost:3118/autre")).toBe(false);
    expect(redirectionEnregistree([CALLBACK_CLAUDE], CALLBACK_CLAUDE)).toBe(true);
    expect(redirectionEnregistree([CALLBACK_CLAUDE], `${CALLBACK_CLAUDE}?x=1`)).toBe(false);
    expect(redirectionEnregistree([CALLBACK_CLAUDE], "https://claude.ai:8443/api/mcp/auth_callback")).toBe(false);
  });

  it("ajoute code et state sans écraser la query du retour", () => {
    const u = new URL(avecParametres("http://localhost:3118/callback?session=a1", { code: "jvco_x", state: "s t", error: undefined }));
    expect(u.searchParams.get("session")).toBe("a1");
    expect(u.searchParams.get("code")).toBe("jvco_x");
    expect(u.searchParams.get("state")).toBe("s t");
    expect(u.searchParams.has("error")).toBe(false);
  });

  it("« Claude » seulement si le code repart vers claude.ai en HTTPS", () => {
    expect(estRetourClaude(CALLBACK_CLAUDE)).toBe(true);
    expect(estRetourClaude("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(estRetourClaude("https://claude.ai.evil.example/api/mcp/auth_callback")).toBe(false);
    expect(estRetourClaude("http://localhost:3118/callback")).toBe(false);
  });
});

describe("enregistrement dynamique", () => {
  it("accepte la demande de Claude (client public)", () => {
    const r = validerEnregistrement({
      client_name: "  Claude  ",
      redirect_uris: [CALLBACK_CLAUDE, CALLBACK_CLAUDE],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(r).toEqual({
      ok: true,
      value: { redirectUris: [CALLBACK_CLAUDE], clientName: "Claude", authMethod: "none" },
    });
  });

  it("sans méthode déclarée : client_secret_basic (RFC 7591 §2)", () => {
    const r = validerEnregistrement({ redirect_uris: [CALLBACK_CLAUDE] });
    expect(r.ok && r.value.authMethod).toBe("client_secret_basic");
    expect(r.ok && r.value.clientName).toBe("");
  });

  it("refuse un retour non permis, un grant implicite, un corps qui n'est pas un objet", () => {
    expect(validerEnregistrement({ redirect_uris: ["http://evil.example/cb"] })).toMatchObject({
      ok: false,
      error: "invalid_redirect_uri",
    });
    expect(validerEnregistrement({ redirect_uris: [] })).toMatchObject({ error: "invalid_redirect_uri" });
    expect(
      validerEnregistrement({ redirect_uris: [CALLBACK_CLAUDE], grant_types: ["implicit"] }),
    ).toMatchObject({ error: "invalid_client_metadata" });
    expect(
      validerEnregistrement({ redirect_uris: [CALLBACK_CLAUDE], token_endpoint_auth_method: "private_key_jwt" }),
    ).toMatchObject({ error: "invalid_client_metadata" });
    expect(validerEnregistrement([CALLBACK_CLAUDE])).toMatchObject({ error: "invalid_client_metadata" });
  });
});

describe("demande d'autorisation", () => {
  const base = {
    response_type: "code",
    client_id: "jvcl_Ab12",
    redirect_uri: CALLBACK_CLAUDE,
    code_challenge: DEFI,
    code_challenge_method: "S256",
    state: "etat-7f3a",
    scope: "read offline_access",
    resource: `${SITE}/mcp`,
  };

  it("une demande de Claude passe, portée et état conservés", () => {
    expect(validerDemande(base, urls.resource)).toEqual({
      ok: true,
      value: {
        codeChallenge: DEFI,
        scope: "read offline_access",
        resource: `${SITE}/mcp`,
        state: "etat-7f3a",
      },
    });
  });

  it("PKCE S256 est obligatoire", () => {
    expect(validerDemande({ ...base, code_challenge: undefined }, urls.resource)).toMatchObject({ error: "invalid_request" });
    expect(validerDemande({ ...base, code_challenge_method: undefined }, urls.resource)).toMatchObject({ error: "invalid_request" });
    expect(validerDemande({ ...base, code_challenge_method: "plain", code_challenge: VERIFIER }, urls.resource)).toMatchObject({ error: "invalid_request" });
    expect(validerDemande({ ...base, code_challenge: "trop-court" }, urls.resource)).toMatchObject({ error: "invalid_request" });
  });

  it("response_type et ressource", () => {
    expect(validerDemande({ ...base, response_type: "token" }, urls.resource)).toMatchObject({ error: "unsupported_response_type" });
    expect(validerDemande({ ...base, resource: "https://autre.example/mcp" }, urls.resource)).toMatchObject({ error: "invalid_target" });
    expect(validerDemande({ ...base, resource: `${SITE}/mcp/` }, urls.resource).ok).toBe(true);
    expect(validerDemande({ ...base, resource: undefined }, urls.resource).ok).toBe(true);
  });

  it("portée : la lecture toujours, rien d'inconnu", () => {
    expect(scopeAccorde(undefined)).toBe("read");
    expect(scopeAccorde("admin write offline_access")).toBe("read offline_access");
  });
});

describe("PKCE et corps de requête", () => {
  it("vecteur de la RFC 7636 (annexe B)", async () => {
    expect(await defiS256(VERIFIER)).toBe(DEFI);
    expect(verifierValide(VERIFIER)).toBe(true);
    expect(verifierValide("court")).toBe(false);
    expect(verifierValide(`${VERIFIER}!`)).toBe(false);
  });

  it("formulaire et Basic (id et secret form-encodés)", () => {
    expect(lireFormulaire("grant_type=authorization_code&code=jvco_a%2Bb&code=second")).toEqual({
      grant_type: "authorization_code",
      code: "jvco_a+b",
    });
    const basic = `Basic ${btoa("jvcl_x%3Ay:s%C3%A9cret")}`;
    expect(lireBasic(basic)).toEqual({ clientId: "jvcl_x:y", clientSecret: "sécret" });
    expect(lireBasic("Bearer abc")).toBeNull();
    expect(lireBasic("Basic !!!")).toBeNull();
  });

  it("identité du client : Basic d'abord, sinon le formulaire ; client public sans secret", () => {
    expect(identiteClient({ client_id: "jvcl_a" }, null)).toEqual({ clientId: "jvcl_a" });
    expect(identiteClient({ client_id: "jvcl_a", client_secret: "s" }, null)).toEqual({ clientId: "jvcl_a", secret: "s" });
    expect(identiteClient({}, `Basic ${btoa("jvcl_b:t")}`)).toEqual({ clientId: "jvcl_b", secret: "t" });
    expect(identiteClient({}, null)).toBeNull();
  });
});

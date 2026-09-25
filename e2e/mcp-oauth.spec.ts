import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

/**
 * CONNECTEUR OAUTH — le parcours de claude.ai, joué comme Claude le joue :
 * découverte par le 401, enregistrement dynamique, page de consentement DANS
 * l'app, échange du code (PKCE), appels MCP, rafraîchissement, coupure.
 *
 * Le retour `https://claude.ai/api/mcp/auth_callback` est intercepté : la page
 * y part vraiment (c'est l'adresse que Claude enregistre), la spec y lit le code.
 */

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

interface Metadonnees {
  mcpUrl: string;
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  code_challenge_methods_supported: string[];
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function formulaire(url: string, champs: Record<string, string>) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(champs).toString(),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : null) as Record<string, string> | null };
}

async function mcp(url: string, token: string | null, method: string, params: object = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await r.text();
  return {
    status: r.status,
    challenge: r.headers.get("www-authenticate"),
    json: text ? (JSON.parse(text) as { result?: { content: { text: string }[]; isError?: boolean } }) : null,
  };
}

/** L'adresse du serveur, lue dans l'écran (seule source côté client), puis la découverte. */
async function decouvrir(page: Page): Promise<Metadonnees> {
  await page.goto(adminPath("/comptes"));
  await page.getByRole("button", { name: "Connecter Claude" }).click();
  const mcpUrl = (await page.getByTestId("mcp-adresse-connecteur").textContent())!.trim();
  await page.keyboard.press("Escape");

  const sans = await mcp(mcpUrl, null, "initialize");
  expect(sans.status).toBe(401);
  const prmUrl = sans.challenge!.match(/resource_metadata="([^"]+)"/)![1];
  const prm = (await (await fetch(prmUrl)).json()) as { resource: string; authorization_servers: string[] };
  expect(prm.resource).toBe(mcpUrl);
  const issuer = prm.authorization_servers[0];
  const u = new URL(issuer);
  const meta = (await (
    await fetch(`${u.origin}/.well-known/oauth-authorization-server${u.pathname}`)
  ).json()) as Omit<Metadonnees, "mcpUrl">;
  expect(meta.issuer).toBe(issuer);
  return { ...meta, mcpUrl };
}

async function enregistrerClaude(meta: Metadonnees): Promise<string> {
  const r = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { client_id: string }).client_id;
}

/** Chemin de la page de consentement (sur l'app servie aux tests, quel que soit son port). */
function consentement(
  meta: Metadonnees,
  clientId: string,
  challenge: string,
  state: string,
  redirectUri = CALLBACK,
) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "read offline_access",
    resource: meta.mcpUrl,
  });
  return `${new URL(meta.authorization_endpoint).pathname}?${q}`;
}

/** Retour vers claude.ai : on sert une page vide et on lit l'URL. */
async function intercepterClaude(page: Page) {
  await page.route("https://claude.ai/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<p>callback</p>" }),
  );
}

async function autoriser(page: Page, chemin: string): Promise<URL> {
  await page.goto(chemin);
  await expect(page.getByRole("heading", { name: "Connecter Claude à Jarvia ?" })).toBeVisible();
  await page.getByRole("button", { name: "Autoriser" }).click();
  await page.waitForURL((u) => u.hostname === "claude.ai");
  return new URL(page.url());
}

test.describe("Connecteur OAuth du serveur MCP", () => {
  test("découverte → enregistrement → consentement → jetons → outils → rafraîchissement → coupure", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const meta = await decouvrir(page);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    const clientId = await enregistrerClaude(meta);
    await intercepterClaude(page);

    // ── Consentement : l'écran dit à qui part l'accès, et ce qu'il permet ───
    const { verifier, challenge } = pkce();
    const state = `etat-${randomBytes(6).toString("hex")}`;
    await page.goto(consentement(meta, clientId, challenge, state));
    await expect(page.getByRole("heading", { name: "Connecter Claude à Jarvia ?" })).toBeVisible();
    await expect(page.getByText("repartira vers claude.ai")).toBeVisible();
    await expect(page.getByText("Lecture seule : rien ne pourra être modifié")).toBeVisible();
    await page.getByRole("button", { name: "Autoriser" }).click();
    await page.waitForURL((u) => u.hostname === "claude.ai");
    const retour = new URL(page.url());
    expect(`${retour.origin}${retour.pathname}`).toBe(CALLBACK);
    expect(retour.searchParams.get("state")).toBe(state);
    const code = retour.searchParams.get("code")!;
    expect(code).toMatch(/^jvco_[A-Za-z0-9_-]{40,}$/);

    // ── Échange du code (formulaire, PKCE) ──────────────────────────────────
    const echange = {
      grant_type: "authorization_code",
      code,
      redirect_uri: CALLBACK,
      client_id: clientId,
      code_verifier: verifier,
      resource: meta.mcpUrl,
    };
    const jetons = await formulaire(meta.token_endpoint, echange);
    expect(jetons.status).toBe(200);
    expect(jetons.json).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "read offline_access" });
    const a1 = jetons.json!.access_token;
    const r1 = jetons.json!.refresh_token;
    expect(a1).toMatch(/^jvat_/);
    expect(r1).toMatch(/^jvrt_/);
    // Usage unique : le même code, rejoué, ne donne plus rien.
    const rejeu = await formulaire(meta.token_endpoint, echange);
    expect(rejeu.status).toBe(400);
    expect(rejeu.json!.error).toBe("invalid_grant");

    // ── Les outils, avec le jeton d'accès ───────────────────────────────────
    const projets = await mcp(meta.mcpUrl, a1, "tools/call", { name: "projets", arguments: {} });
    expect(projets.status).toBe(200);
    expect(projets.json!.result!.isError).toBeUndefined();
    expect(projets.json!.result!.content[0].text).toContain("e2e-test");

    // ── Rafraîchissement : rotation, et le précédent tient tant que le nouveau n'a pas servi
    const refresh = (r: string) =>
      formulaire(meta.token_endpoint, { grant_type: "refresh_token", refresh_token: r, client_id: clientId });
    const t2 = await refresh(r1);
    expect(t2.status).toBe(200);
    expect(t2.json!.refresh_token).not.toBe(r1);
    // L'ancien jeton d'accès est remplacé : 401 qui dit invalid_token (Claude rafraîchit).
    const perime = await mcp(meta.mcpUrl, a1, "ping");
    expect(perime.status).toBe(401);
    expect(perime.challenge).toContain('error="invalid_token"');
    expect((await mcp(meta.mcpUrl, t2.json!.access_token, "ping")).status).toBe(200);
    // Réponse perdue : Claude rejoue r1, toujours accepté (r2 n'a pas servi).
    const t3 = await refresh(r1);
    expect(t3.status).toBe(200);
    // Le nouveau sert : r1 meurt.
    const t4 = await refresh(t3.json!.refresh_token);
    expect(t4.status).toBe(200);
    const mort = await refresh(r1);
    expect(mort.status).toBe(400);
    expect(mort.json!.error).toBe("invalid_grant");
    const a4 = t4.json!.access_token;
    expect((await mcp(meta.mcpUrl, a4, "ping")).status).toBe(200);

    // ── L'écran liste l'accès, puis le coupe ────────────────────────────────
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    const liste = page.getByRole("list", { name: "Applications connectées" });
    const ligne = liste.getByRole("listitem").filter({ hasText: "claude.ai" });
    await expect(ligne).toHaveCount(1);
    await expect(ligne).toContainText("Claude");
    await ligne.getByRole("button", { name: "Couper l’accès" }).click();
    await expect(ligne).toHaveCount(0);
    await expect(page.getByText("Aucune application connectée.")).toBeVisible();
    // Présence juste au-dessus (200), absence ici : jeton d'accès ET rafraîchissement morts.
    expect((await mcp(meta.mcpUrl, a4, "ping")).status).toBe(401);
    expect((await refresh(t4.json!.refresh_token)).json!.error).toBe("invalid_grant");
  });

  test("refus, PKCE faux, client ou retour inconnus : rien ne part", async ({ page }) => {
    test.setTimeout(90_000);
    const meta = await decouvrir(page);
    const clientId = await enregistrerClaude(meta);
    await intercepterClaude(page);

    // Refuser : retour vers Claude avec access_denied, et AUCUN code.
    const refus = pkce();
    await page.goto(consentement(meta, clientId, refus.challenge, "etat-refus"));
    await page.getByRole("button", { name: "Refuser" }).click();
    await page.waitForURL((u) => u.hostname === "claude.ai");
    const retourRefus = new URL(page.url());
    expect(retourRefus.searchParams.get("error")).toBe("access_denied");
    expect(retourRefus.searchParams.get("state")).toBe("etat-refus");
    expect(retourRefus.searchParams.has("code")).toBe(false);

    // PKCE : un autre verifier est refusé, et le code est brûlé par l'essai.
    const bon = pkce();
    const code = (await autoriser(page, consentement(meta, clientId, bon.challenge, "etat-pkce"))).searchParams.get("code")!;
    const echange = (verifier: string) =>
      formulaire(meta.token_endpoint, {
        grant_type: "authorization_code",
        code,
        redirect_uri: CALLBACK,
        client_id: clientId,
        code_verifier: verifier,
      });
    const faux = await echange(pkce().verifier);
    expect(faux.status).toBe(400);
    expect(faux.json!.error).toBe("invalid_grant");
    expect((await echange(bon.verifier)).json!.error).toBe("invalid_grant");

    // Client inconnu, puis retour étranger au client : la page le dit, sans bouton, sans départ.
    for (const chemin of [
      consentement(meta, "jvcl_inconnu", bon.challenge, "etat-x"),
      consentement(meta, clientId, bon.challenge, "etat-x", "https://evil.example/cb"),
    ]) {
      await page.goto(chemin);
      await expect(page.getByRole("heading", { name: "Lien d’autorisation invalide" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Autoriser" })).toHaveCount(0);
      expect(new URL(page.url()).hostname).not.toBe("evil.example");
    }
  });

  test("sans session : détour par la connexion puis retour ; une créatrice est refusée", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const meta = await decouvrir(page);
    const clientId = await enregistrerClaude(meta);
    const { challenge } = pkce();
    const chemin = consentement(meta, clientId, challenge, "etat-creatrice");

    // Déjà connecté : /login avec ce retour renvoie sur le consentement…
    await page.goto(`/login?suite=${encodeURIComponent(chemin)}`);
    await expect(page).toHaveURL((u) => u.pathname === "/oauth/authorize");
    await expect(page.getByRole("button", { name: "Autoriser" })).toBeVisible();
    // …mais jamais ailleurs (liste fermée).
    await page.goto(`/login?suite=${encodeURIComponent("//evil.example/oauth/authorize")}`);
    await expect(page).toHaveURL((u) => u.hostname !== "evil.example" && u.pathname !== "/oauth/authorize");

    // Une créatrice (rôle de portail) sans session.
    const ts = Date.now();
    const creatrice = await createCreatorSession(convexUrl!, {
      name: `[E2E_TEST] Inès Moreau ${ts}`,
      email: `e2e-mcp-oauth-${ts}@repackit.test`,
      password: "oauth-creatrice-12345",
    });
    // Contexte VIERGE : sans cet état explicite, le runner y remettrait la
    // session e2e de la fixture, et la « visiteuse » serait l'admin.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const visiteur = await ctx.newPage();
    await visiteur.goto(chemin);
    await visiteur.waitForURL((u) => u.pathname === "/login");
    expect(new URL(visiteur.url()).searchParams.get("suite")).toBe(chemin);
    await visiteur.getByLabel("Email").fill(creatrice.email);
    await visiteur.getByLabel("Mot de passe").fill("oauth-creatrice-12345");
    await visiteur.getByRole("button", { name: "Se connecter" }).click();
    await visiteur.waitForURL((u) => u.pathname === "/oauth/authorize", { timeout: 60_000 });
    await expect(visiteur.getByRole("heading", { name: "Réservé à l’équipe" })).toBeVisible();
    await expect(visiteur.getByRole("button", { name: "Autoriser" })).toHaveCount(0);
    await ctx.close();

    // Et le serveur tient la même règle si on contourne l'écran.
    const params = Object.fromEntries(new URL(chemin, "http://x").searchParams);
    await expect(
      creatrice.client.action(api.mcpOAuth.approveAuthorization, params),
    ).rejects.toThrow(/ERR_MCP_TOKEN_NOT_ALLOWED/);
  });
});

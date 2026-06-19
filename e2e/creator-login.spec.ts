import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import {
  createE2eClient,
  E2E_EMAIL,
  E2E_PASSWORD,
} from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Chantier RECONNEXION CRÉATEUR — un créateur déjà inscrit (lien /join
 * consommé) doit pouvoir revenir via /login. Couvre :
 *   1. non connecté → /app redirige vers /login (gating proxy) ;
 *   2. identifiants faux → message LISIBLE (pas "Server Error") ;
 *   3. login créateur → portail /app (redirection par rôle via getMyPortal) ;
 *   4. lien /join mort → écran "Lien invalide" propose un lien vers /login ;
 *   5. login admin → /admin (redirection par rôle).
 *
 * Pas de fixture d'auth admin ici : tout part de contextes navigateur VIERGES
 * (le sujet EST le login). Le compte créateur est créé via convex (invite +
 * signUp par token), ce qui consomme aussi le token → réutilisable comme lien
 * mort pour l'étape 4.
 */
test.describe("Auth — reconnexion créateur via /login", () => {
  test("non connecté → /login, faux creds lisibles, login rôle creator/admin, lien mort → /login", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Login ${ts}`;
    const email = `e2e-creator-login-${ts}@repackit.test`;
    const password = "creator-login-12345";

    // Setup convex : invite + signUp par token (crée le compte, consomme le token).
    const { token } = await admin.mutation(api.creators.inviteCreator, {
      name,
      email,
    });
    const signupClient = new ConvexHttpClient(convexUrl);
    await signupClient.action(api.auth.signIn, {
      provider: "password",
      params: { email, password, flow: "signUp", inviteToken: token },
    });

    // ── 1. Non connecté : /app → /login ──────────────────────────────────────
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const p = await ctx.newPage();
    await p.goto("/app");
    await p.waitForURL("**/login", { timeout: 20_000 });

    // ── 2. Identifiants faux → message lisible (pas "Server Error") ───────────
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
    await p.getByRole("button", { name: /se connecter/i }).click();
    const alert = p.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).not.toContainText(/server error/i);

    // ── 3. Bons identifiants créateur → portail /app ──────────────────────────
    await p.getByLabel("Mot de passe").fill(password);
    await p.getByRole("button", { name: /se connecter/i }).click();
    await p.waitForURL("**/app", { timeout: 20_000 });
    const heading = p.getByRole("heading", { name: /Bonjour/ });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    await expect(heading).toContainText(name);
    await ctx.close();

    // ── 4. Lien /join mort → "Lien invalide" + lien vers /login ───────────────
    const ctxDead = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const pDead = await ctxDead.newPage();
    await pDead.goto(`/join/${token}`);
    await expect(pDead.getByText(/lien invalide/i)).toBeVisible({
      timeout: 10_000,
    });
    await pDead.getByRole("link", { name: /se connecter/i }).click();
    await pDead.waitForURL("**/login", { timeout: 20_000 });
    await ctxDead.close();

    // ── 5. Login admin → /admin (redirection par rôle) ────────────────────────
    const ctxAdmin = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const pAdmin = await ctxAdmin.newPage();
    await pAdmin.goto("/login");
    await pAdmin.getByLabel("Email").fill(E2E_EMAIL);
    await pAdmin.getByLabel("Mot de passe").fill(E2E_PASSWORD);
    await pAdmin.getByRole("button", { name: /se connecter/i }).click();
    await pAdmin.waitForURL("**/admin/**", { timeout: 20_000 });
    await ctxAdmin.close();
  });
});

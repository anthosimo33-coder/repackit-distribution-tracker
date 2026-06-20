import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Reset mot de passe admin (Voie B) — flow complet :
 *  inviter + finaliser un créateur (compte avec mot de passe) → admin génère un
 *  lien de reset (UI) → /reset-password en navigation privée → nouveau mot de
 *  passe → redirection /login → connexion OK avec le NOUVEAU mot de passe →
 *  lien rejoué rejeté (usage unique) → lien expiré rejeté.
 *
 * NB orchestration : le dialog du lien de reset est MODAL (backdrop plein
 * écran). Il DOIT être refermé (Escape) après lecture du lien, sinon le clic
 * suivant sur le bouton « Réinitialiser » est intercepté par le backdrop et
 * part en timeout. generateResetToken() encapsule ouvrir → lire → refermer.
 */
test.describe("Reset mot de passe admin (Voie B)", () => {
  test("générer → reset → login → usage unique → expiration", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Reset ${ts}`;
    const email = `e2e-creator-reset-${ts}@repackit.test`;
    const oldPassword = "old-pass-12345";
    const newPassword = "new-pass-67890";

    // ── Setup : inviter (UI) puis finaliser le compte via l'action signUp ──
    // (équivalent serveur de /join, sans contexte navigateur supplémentaire).
    await page.goto(adminPath("/createurs"));
    await page
      .getByRole("button", { name: /inviter un créateur/i })
      .first()
      .click();
    const inviteDialog = page.getByRole("dialog");
    await expect(inviteDialog).toBeVisible();
    await inviteDialog.getByLabel("Nom *", { exact: true }).fill(name);
    await inviteDialog.getByLabel("Email *", { exact: true }).fill(email);
    await inviteDialog
      .getByRole("button", { name: "Inviter", exact: true })
      .click();
    const joinInput = inviteDialog.getByLabel("Lien d'invitation");
    await expect(joinInput).toBeVisible({ timeout: 10_000 });
    const joinToken = (await joinInput.inputValue()).split("/join/")[1];

    // Finalise le compte (user + mot de passe + membership creator) comme le
    // ferait la page /join. Le dialog d'invitation encore ouvert est de toute
    // façon jeté par le page.goto qui suit.
    await convex.action(api.auth.signIn, {
      provider: "password",
      params: {
        email,
        password: oldPassword,
        flow: "signUp",
        inviteToken: joinToken,
      },
    });

    // ── Admin : ouvrir la fiche créateur. ──
    await page.goto(adminPath("/createurs"));
    // Le nom contient des crochets (métachars regex) → on cible la portion
    // bracket-free « Reset <ts> », unique au run.
    await page
      .getByRole("link", { name: new RegExp(`Reset ${ts}`) })
      .first()
      .click();
    await page.waitForURL(/\/createurs\/.+/, { timeout: 10_000 });

    // Génère un lien de reset via l'UI, renvoie le token, et REFERME le dialog
    // modal (sinon le backdrop bloque les interactions suivantes).
    async function generateResetToken(): Promise<string> {
      await page
        .getByRole("button", { name: /réinitialiser le mot de passe/i })
        .click();
      const dialog = page.getByRole("dialog");
      const input = dialog.getByLabel("Lien de réinitialisation");
      await expect(input).toBeVisible({ timeout: 10_000 });
      const url = await input.inputValue();
      expect(url).toContain("/reset-password/");
      const token = url.split("/reset-password/")[1];
      expect(token.length).toBeGreaterThan(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      return token;
    }

    // ── 1. Génération + reset + login avec le NOUVEAU mot de passe. ──
    const resetToken = await generateResetToken();
    const resetCtx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const resetPage = await resetCtx.newPage();
    await resetPage.goto(`/reset-password/${resetToken}`);
    await resetPage.getByLabel("Nouveau mot de passe").fill(newPassword);
    await resetPage.getByLabel("Confirmer le mot de passe").fill(newPassword);
    await resetPage
      .getByRole("button", { name: /réinitialiser le mot de passe/i })
      .click();
    await resetPage.waitForURL("**/login", { timeout: 20_000 });
    await resetCtx.close();

    const signedIn = await convex.action(api.auth.signIn, {
      provider: "password",
      params: { email, password: newPassword, flow: "signIn" },
    });
    expect(signedIn.tokens?.token).toBeTruthy();

    // ── 2. Usage unique : rejouer le même lien → invalide, pas de formulaire. ──
    const replayCtx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const replayPage = await replayCtx.newPage();
    await replayPage.goto(`/reset-password/${resetToken}`);
    await expect(replayPage.getByText(/lien invalide/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(replayPage.getByLabel("Nouveau mot de passe")).toHaveCount(0);
    await replayCtx.close();

    // ── 3. Expiration : nouveau lien, expiré côté serveur, puis rejet. ──
    const expiredToken = await generateResetToken();
    await convex.mutation(api.passwordReset.e2eExpirePasswordResetToken, {
      secret: E2E_SECRET,
      token: expiredToken,
    });
    const expiredCtx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const expiredPage = await expiredCtx.newPage();
    await expiredPage.goto(`/reset-password/${expiredToken}`);
    await expect(expiredPage.getByText(/lien invalide/i)).toBeVisible({
      timeout: 10_000,
    });
    await expiredCtx.close();

    // ── Teardown. ──
    await convex.mutation(api.creators.cleanupTestCreators, {
      secret: E2E_SECRET,
    });
  });
});

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

    // ── Setup : inviter + finaliser le créateur (compte + mot de passe). ──
    await page.goto(adminPath("/createurs"));
    await page
      .getByRole("button", { name: /inviter un créateur/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nom *", { exact: true }).fill(name);
    await dialog.getByLabel("Email *", { exact: true }).fill(email);
    await dialog.getByRole("button", { name: "Inviter", exact: true }).click();
    const joinInput = dialog.getByLabel("Lien d'invitation");
    await expect(joinInput).toBeVisible({ timeout: 10_000 });
    const joinToken = (await joinInput.inputValue()).split("/join/")[1];

    const joinCtx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const joinPage = await joinCtx.newPage();
    await joinPage.goto(`/join/${joinToken}`);
    await joinPage.getByLabel("Mot de passe").fill(oldPassword);
    await joinPage.getByRole("button", { name: /activer mon compte/i }).click();
    await joinPage.waitForURL("**/app", { timeout: 20_000 });
    await joinCtx.close();

    // ── Admin : ouvrir la fiche créateur → générer le lien de reset. ──
    await page.goto(adminPath("/createurs"));
    // Le nom contient des crochets (métachars regex) → on cible la portion
    // bracket-free « Reset <ts> », unique au run.
    await page
      .getByRole("link", { name: new RegExp(`Reset ${ts}`) })
      .first()
      .click();
    await page.waitForURL(/\/createurs\/.+/, { timeout: 10_000 });

    await page
      .getByRole("button", { name: /réinitialiser le mot de passe/i })
      .click();
    const resetDialog = page.getByRole("dialog");
    await expect(resetDialog).toBeVisible();
    const resetInput = resetDialog.getByLabel("Lien de réinitialisation");
    await expect(resetInput).toBeVisible({ timeout: 10_000 });
    const resetUrl = await resetInput.inputValue();
    expect(resetUrl).toContain("/reset-password/");
    const resetToken = resetUrl.split("/reset-password/")[1];
    expect(resetToken.length).toBeGreaterThan(0);

    // ── Créateur : ouvrir le lien (contexte vierge) → nouveau mot de passe. ──
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
    // Redirection /login après succès.
    await resetPage.waitForURL("**/login", { timeout: 20_000 });
    await resetCtx.close();

    // ── Connexion avec le NOUVEAU mot de passe (via l'action signIn). ──
    const signedIn = await convex.action(api.auth.signIn, {
      provider: "password",
      params: { email, password: newPassword, flow: "signIn" },
    });
    expect(signedIn.tokens?.token).toBeTruthy();

    // ── Usage unique : rejouer le même lien → invalide, pas de formulaire. ──
    const replayCtx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const replayPage = await replayCtx.newPage();
    await replayPage.goto(`/reset-password/${resetToken}`);
    await expect(replayPage.getByText(/lien invalide/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      replayPage.getByLabel("Nouveau mot de passe"),
    ).toHaveCount(0);
    await replayCtx.close();

    // ── Expiration : générer un nouveau lien, l'expirer, vérifier le rejet. ──
    await page
      .getByRole("button", { name: /réinitialiser le mot de passe/i })
      .click();
    const dialog2 = page.getByRole("dialog");
    const input2 = dialog2.getByLabel("Lien de réinitialisation");
    await expect(input2).toBeVisible({ timeout: 10_000 });
    const token2 = (await input2.inputValue()).split("/reset-password/")[1];

    await convex.mutation(api.passwordReset.e2eExpirePasswordResetToken, {
      secret: E2E_SECRET,
      token: token2,
    });

    const expiredCtx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const expiredPage = await expiredCtx.newPage();
    await expiredPage.goto(`/reset-password/${token2}`);
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

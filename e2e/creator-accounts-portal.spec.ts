import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * P5 — portail créateur (UI) : join → déclarer un compte tiktok (défaut 3 j) →
 * l'admin pose des mots-clés + instructions → le créateur les voit → coche le
 * check du jour → bouton désactivé (et persisté au reload).
 */
test.describe("Portail créateur — /app/comptes", () => {
  test("déclarer → voir le protocole → cocher le warmup du jour", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Portal ${ts}`;
    const email = `e2e-creator-portal-${ts}@repackit.test`;
    const password = "creator-portal-12345";
    const handle = `@e2ewarmup${ts}`;

    // Invitation (admin) → token.
    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name,
      email,
    });

    // Onboarding en navigation privée → /app.
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });

    // Mes comptes (lien de nav — exact pour ne pas matcher le bouton d'accueil).
    await page.getByRole("link", { name: "Mes comptes", exact: true }).click();
    await page.waitForURL("**/app/comptes", { timeout: 15_000 });

    // Déclarer un compte tiktok.
    await page
      .getByRole("button", { name: /déclarer un compte/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Handle *", { exact: true }).fill(handle);
    await dialog.getByRole("button", { name: "Déclarer", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 8000 });

    // Carte warmup : « Jour 1 / 3 » (défaut TikTok = 3).
    await expect(page.getByText("Jour 1 / 3")).toBeVisible({ timeout: 8000 });

    // L'admin pose le protocole (keywords + instructions).
    const comptes = await convex.query(api.comptes.listComptes, {});
    const compte = comptes.find((c) => c.handle === handle);
    expect(compte).toBeTruthy();
    await convex.mutation(api.comptes.updateWarmupProtocol, {
      id: compte!._id,
      keywords: [`kw-alpha-${ts}`, `kw-beta-${ts}`],
      instructions: "**Routine :** regarde 10 vidéos par jour",
    });

    // Le créateur voit les mots-clés + instructions après refresh.
    await page.reload();
    await expect(page.getByText(`kw-alpha-${ts}`)).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText(/regarde 10 vidéos par jour/i)).toBeVisible();

    // Coche le check du jour → bouton désactivé (✓), persistant au reload.
    await page.getByRole("button", { name: /^warmup du jour fait$/i }).click();
    await expect(
      page.getByRole("button", { name: "Warmup du jour fait ✓" }),
    ).toBeDisabled({ timeout: 8000 });

    await page.reload();
    await expect(
      page.getByRole("button", { name: "Warmup du jour fait ✓" }),
    ).toBeDisabled({ timeout: 8000 });

    await ctx.close();
  });
});

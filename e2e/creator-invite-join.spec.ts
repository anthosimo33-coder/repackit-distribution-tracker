import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * P1 Créateurs — flow complet d'onboarding :
 *  inviter (UI admin) → lien copiable → /join en navigation privée → mot de
 *  passe → /app « Bienvenue » → statut "onboarding" côté admin → token rejoué
 *  rejeté (sans leak) → creator redirigé hors de /admin.
 */
test.describe("Créateurs — invitation + onboarding", () => {
  test("inviter → join → /app → token rejoué rejeté → creator hors /admin", async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Créateur ${ts}`;
    const email = `e2e-creator-${ts}@repackit.test`;
    const password = "creator-pass-12345";

    // 1. Admin invite via l'UI → récupère le lien /join affiché.
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

    const linkInput = dialog.getByLabel("Lien d'invitation");
    await expect(linkInput).toBeVisible({ timeout: 10_000 });
    const joinUrl = await linkInput.inputValue();
    expect(joinUrl).toContain("/join/");
    const token = joinUrl.split("/join/")[1];
    expect(token.length).toBeGreaterThan(0);

    // 2. Le créateur ouvre le lien en navigation privée (contexte vierge).
    const creatorCtx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const creatorPage = await creatorCtx.newPage();
    await creatorPage.goto(`/join/${token}`);

    // Email pré-rempli et non modifiable.
    const emailField = creatorPage.getByLabel("Email", { exact: true });
    await expect(emailField).toHaveValue(email);
    await expect(emailField).toBeDisabled();

    await creatorPage.getByLabel("Mot de passe").fill(password);
    await creatorPage
      .getByRole("button", { name: /activer mon compte/i })
      .click();

    // 3. Redirigé vers /app avec l'accueil « Bienvenue {name} ».
    await creatorPage.waitForURL("**/app", { timeout: 20_000 });
    const heading = creatorPage.getByRole("heading", { name: /Bonjour/ });
    await expect(heading).toBeVisible({ timeout: 10_000 });
    await expect(heading).toContainText(name);

    // 4. Côté admin : statut passé à "onboarding".
    const creators = await convex.query(api.creators.listCreators, {});
    const created = creators.find((c) => c.email === email);
    expect(created?.status).toBe("onboarding");

    // 5. Token rejoué → message propre, aucun formulaire (no-leak).
    const replayCtx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const replayPage = await replayCtx.newPage();
    await replayPage.goto(`/join/${token}`);
    await expect(replayPage.getByText(/lien invalide/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(replayPage.getByLabel("Mot de passe")).toHaveCount(0);
    await replayCtx.close();

    // 6. Le creator (connecté) qui tape /admin/* est renvoyé vers /app.
    await creatorPage.goto(adminPath("/createurs"));
    await creatorPage.waitForURL("**/app", { timeout: 20_000 });
    await expect(
      creatorPage.getByRole("heading", { name: /Bonjour/ }),
    ).toBeVisible({ timeout: 10_000 });

    await creatorCtx.close();
  });
});

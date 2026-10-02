import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/** Connexion email + mot de passe : true si une session est ouverte. */
async function connexion(email: string, password: string): Promise<boolean> {
  try {
    const res = await new ConvexHttpClient(url!).action(api.auth.signIn, {
      provider: "password",
      params: { email, password, flow: "signIn" },
    });
    return Boolean(res.tokens?.token);
  } catch {
    return false;
  }
}

const dernierLien = (email: string) =>
  admin.mutation(api.passwordReset.e2eLatestPasswordResetToken, {
    secret: E2E_SECRET,
    email,
  });

/**
 * « Mot de passe oublié ? » en libre-service : depuis la page de connexion,
 * déconnecté, l'email saisi reçoit un lien /reset-password/<token> valable 1 h.
 * Les emails de test ne partent jamais (isNonNotifiableRecipient) : la spec lit
 * le lien en base, puis fait le parcours comme la créatrice.
 */
test.describe("Mot de passe oublié — libre-service", () => {
  test("demande depuis /login → lien → nouveau mot de passe → connexion", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    // Forme de la prod : email saisi avec majuscules et espaces, comme un
    // clavier de téléphone le rend ; le compte, lui, est en minuscules.
    const email = `e2e-creator-oubli-${ts}@repackit.test`;
    const saisi = `  E2E-Creator-Oubli-${ts}@Repackit.test `;
    const ancien = "Ancien-mdp-2026!";
    const nouveau = "Nouveau-mdp-2026//";
    await createCreatorSession(url, {
      name: `[E2E_TEST] Oubli Camille Dupont-Laurent ${ts}`,
      email,
      password: ancien,
    });
    expect(await dernierLien(email)).toBeNull();

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(saisi);
    await page.getByRole("button", { name: "Mot de passe oublié ?" }).click();
    await page.getByRole("button", { name: "Recevoir le lien" }).click();
    await expect(page.locator("#forgot-panel").getByRole("status")).toContainText("le lien vient de partir");

    const lien = await dernierLien(email);
    expect(lien).not.toBeNull();
    // Lien EMAIL : 1 h (le lien admin vaut 48 h). Arrondi : `_creationTime` a
    // des fractions de milliseconde.
    expect(Math.round(lien!.ttlMs / 60_000)).toBe(60);

    // Une deuxième demande dans la foulée ne renvoie pas de lien : même jeton.
    await new ConvexHttpClient(url).mutation(
      api.passwordReset.requestPasswordReset,
      { email },
    );
    expect(await dernierLien(email)).toEqual(lien);

    await page.goto(`/reset-password/${lien!.token}`);
    await page.getByLabel("Nouveau mot de passe").fill(nouveau);
    await page.getByLabel("Confirmer le mot de passe").fill(nouveau);
    await page
      .getByRole("button", { name: /réinitialiser le mot de passe/i })
      .click();
    await expect(page.getByText("Mot de passe réinitialisé")).toBeVisible({
      timeout: 15_000,
    });

    expect(await connexion(email, nouveau)).toBe(true);
    expect(await connexion(email, ancien)).toBe(false);
    await ctx.close();
  });

  test("un email sans compte reçoit la même réponse, et aucun lien", async ({
    browser,
  }) => {
    const ts = Date.now();
    const inconnu = `e2e-creator-inconnu-${ts}@repackit.test`;
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(inconnu);
    await page.getByRole("button", { name: "Mot de passe oublié ?" }).click();
    await page.getByRole("button", { name: "Recevoir le lien" }).click();
    await expect(page.locator("#forgot-panel").getByRole("status")).toContainText(
      `Si un compte existe pour ${inconnu}, le lien vient de partir`,
    );
    expect(await dernierLien(inconnu)).toBeNull();
    await ctx.close();
  });

  test("la page de connexion d'un projet propose aussi le lien", async ({
    browser,
  }) => {
    const ts = Date.now();
    const email = `e2e-creator-oubli-projet-${ts}@repackit.test`;
    await createCreatorSession(url, {
      name: `[E2E_TEST] Oubli projet ${ts}`,
      email,
      password: "Projet-mdp-2026!",
    });
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto("/e2e-test/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Mot de passe oublié ?" }).click();
    await page.getByRole("button", { name: "Recevoir le lien" }).click();
    await expect(page.locator("#forgot-panel").getByRole("status")).toContainText("le lien vient de partir");
    expect(await dernierLien(email)).not.toBeNull();
    await ctx.close();
  });
});

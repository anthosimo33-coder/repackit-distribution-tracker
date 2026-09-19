import { test, expect } from "./fixtures/auth-fixture";

/**
 * `/` — page d'accueil PUBLIQUE pour un visiteur, routage par rôle pour un
 * compte connecté. Les deux branches dans le même fichier : l'une ne peut pas
 * passer parce que l'autre a disparu (une page d'accueil servie à tout le
 * monde, ou une redirection /login pour tout le monde, casse l'un des deux).
 */
test.describe("Accueil — public sans session, routage par rôle connecté", () => {
  test("visiteur : la page d'accueil s'affiche sur /, sans redirection", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("filme. publie.");
    expect(new URL(page.url()).pathname).toBe("/");
    // Le mur de vidéos est là, avec les vues de chaque vidéo.
    await expect(page.getByLabel(/Vidéo de Kelly pour Snytch, 750\sk vues/)).toHaveCount(1);
    // Le bouton mène bien à la connexion.
    await page.getByRole("link", { name: "se connecter" }).first().click();
    await page.waitForURL("**/login");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
    await context.close();
  });

  test("connecté : / route vers l'espace, jamais la page d'accueil", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForURL((url) => url.pathname !== "/", { timeout: 20_000 });
    await expect(page.getByText("filme. publie.")).toHaveCount(0);
  });
});

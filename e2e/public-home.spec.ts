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
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Filme. Publie.");
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
    await expect(page.getByText("Filme. Publie.")).toHaveCount(0);
  });

  test("mouvement réduit : rien n'est invisible, rien ne défile", async ({ browser }) => {
    // Les apparitions au défilement cachent le contenu tant qu'il n'est pas vu.
    // Avec `prefers-reduced-motion`, ce mécanisme doit être NEUTRALISÉ : sinon
    // un visiteur qui a désactivé les animations verrait une page vide.
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll("[data-reveal]")].filter(
        (el) => Number(getComputedStyle(el).opacity) < 0.99,
      ).length,
    );
    const reveals = await page.locator("[data-reveal]").count();
    expect(reveals).toBeGreaterThan(10);
    expect(hidden).toBe(0);
    // Le mur de vidéos ne défile pas non plus.
    const marquee = await page
      .locator("[aria-label]")
      .first()
      .evaluate(() => {
        const track = document.querySelector("video")?.closest("div")?.parentElement;
        return track ? getComputedStyle(track).animationName : "none";
      });
    expect(marquee).toBe("none");
    await context.close();
  });

  test("mobile : les six cartes sont dans un rail qui se glisse", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("/");
    // Le rail existe et déborde horizontalement (sinon il n'y a rien à glisser),
    // sans jamais faire déborder la PAGE.
    const rail = page.locator("[class*='rail']").first();
    const box = await rail.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      page: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(box.scroll).toBeGreaterThan(box.client + 200);
    expect(box.page).toBe(box.inner);
    await context.close();
  });
});

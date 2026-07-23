import { test, expect, adminPath } from "./fixtures/auth-fixture";

/**
 * Hub Analytics (admin) — smoke de la section et de ses 4 onglets.
 *
 * Le projet e2e n'a PAS de config PostHog : ce spec couvre donc précisément le
 * chemin « non configuré », qui est la garantie centrale du chantier —
 *  - la section se rend malgré tout (ni écran blanc, ni crash),
 *  - un état « non configuré » explicite est affiché,
 *  - l'onglet Attribution reste exploitable car ses vues/coûts viennent de
 *    Jarvia (indépendant de PostHog et de Whop).
 */
test.describe("Analytics — hub produit", () => {
  test("la nav mène à la section et affiche les 4 onglets", async ({ page }) => {
    await page.goto(adminPath("/dashboard"));

    const navLink = page.getByRole("link", { name: /^analytics$/i }).first();
    await expect(navLink).toBeVisible();
    await navLink.click();

    await expect(page).toHaveURL(/\/analytics/);
    await expect(
      page.getByRole("heading", { name: /^analytics$/i }),
    ).toBeVisible({ timeout: 10000 });

    for (const name of [
      /vue d'ensemble/i,
      /attribution/i,
      /revenus/i,
      /cohortes/i,
    ]) {
      await expect(page.getByRole("tab", { name })).toBeVisible();
    }
  });

  test("sans config PostHog : état « non configuré », aucun écran cassé", async ({
    page,
  }) => {
    await page.goto(adminPath("/analytics"));

    await expect(
      page.getByRole("heading", { name: /^analytics$/i }),
    ).toBeVisible({ timeout: 10000 });

    // Bandeau explicite + bouton Actualiser désactivé (aucun appel à faire).
    await expect(
      page.getByText(/posthog n'est pas configuré/i).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /actualiser/i })).toBeDisabled();
  });

  test("l'onglet Attribution se rend sans PostHog (données Jarvia)", async ({
    page,
  }) => {
    await page.goto(adminPath("/analytics"));
    await expect(
      page.getByRole("heading", { name: /^analytics$/i }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("tab", { name: /attribution/i }).click();

    // Soit des vidéos publiées (table + mention de la limite d'attribution),
    // soit l'état vide « aucune vidéo publiée » — jamais une erreur.
    await expect(
      page
        .getByText(/attribution par fenêtre 24 h|aucune vidéo publiée/i)
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

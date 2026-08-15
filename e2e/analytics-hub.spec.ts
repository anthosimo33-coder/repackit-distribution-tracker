import { test, expect, adminPath } from "./fixtures/auth-fixture";

/**
 * Hub Analytics (admin) — smoke de la section et de ses 7 onglets.
 *
 * Le projet e2e n'a PAS de config PostHog : ce spec couvre donc précisément le
 * chemin « non configuré », qui est la garantie centrale du chantier —
 *  - la section se rend malgré tout (ni écran blanc, ni crash),
 *  - un état « non configuré » explicite est affiché,
 *  - l'en-tête montre la fraîcheur de synchro (« Jamais synchronisé » ici),
 *  - les « i » explicatifs s'ouvrent au clic (le point le plus important),
 *  - l'onglet Acquisition reste exploitable car ses vues/coûts viennent de
 *    Jarvia (indépendant de PostHog et de Whop).
 */
test.describe("Analytics — hub produit", () => {
  const TABS = [
    /vue d'ensemble/i,
    /parcours/i,
    /acquisition/i,
    /santé produit/i,
    /offres/i,
    /rétention/i,
    /fiabilité/i,
  ];

  test("la nav mène à la section et affiche les 7 onglets", async ({ page }) => {
    await page.goto(adminPath("/dashboard"));

    const navLink = page.getByRole("link", { name: /^analytics$/i }).first();
    await expect(navLink).toBeVisible();
    await navLink.click();

    await expect(page).toHaveURL(/\/analytics/);
    await expect(
      page.getByRole("heading", { name: /^analytics$/i }),
    ).toBeVisible({ timeout: 10000 });

    for (const name of TABS) {
      await expect(page.getByRole("tab", { name })).toBeVisible();
    }
  });

  test("sans config PostHog : état « non configuré » + fraîcheur de synchro", async ({
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

    // Régression corrigée : la date de synchro est de retour dans l'en-tête.
    await expect(page.getByText(/jamais synchronisé|dernière synchro/i)).toBeVisible();
  });

  test("un « i » explicatif s'ouvre au clic et affiche une explication", async ({
    page,
  }) => {
    await page.goto(adminPath("/analytics"));
    await expect(
      page.getByRole("heading", { name: /^analytics$/i }),
    ).toBeVisible({ timeout: 10000 });

    // La Vue d'ensemble se rend même sans PostHog : ses KPI portent un « i ».
    const info = page
      .getByRole("button", { name: /explication : clients payants/i })
      .first();
    await expect(info).toBeVisible();
    await info.click();
    await expect(
      page.getByText(/compté chez Whop qui encaisse/i),
    ).toBeVisible();
  });

  test("l'onglet Acquisition se rend sans PostHog (données Jarvia)", async ({
    page,
  }) => {
    await page.goto(adminPath("/analytics"));
    await expect(
      page.getByRole("heading", { name: /^analytics$/i }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("tab", { name: /acquisition/i }).click();

    // Les trois compteurs de vues (Jarvia) sont toujours présents, ou l'état vide.
    await expect(
      page.getByText(/trois compteurs|aucune vidéo/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("Fiabilité chiffre les assignations SANS date de post (sans PostHog)", async ({
    page,
  }) => {
    // Ce contrôle porte sur de la donnée PROJET, pas sur PostHog : il doit
    // s'afficher même ici, où PostHog n'est pas configuré. Une assignation sans
    // date de post sort du taux à l'heure des DEUX côtés de la fraction — en
    // prod c'est un quart des livrables, et rien ne l'affichait.
    await page.goto(adminPath("/analytics"));
    await expect(
      page.getByRole("heading", { name: /^analytics$/i }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("tab", { name: /fiabilité/i }).click();

    const ligne = page
      .getByRole("row")
      .filter({ hasText: /assignations sans date de post/i });
    await expect(ligne).toBeVisible({ timeout: 10000 });
    // Un chiffre, pas un tiret : la mesure existe même à zéro.
    await expect(ligne).toHaveText(/\d+ sur \d+|aucune assignation/i);
  });
});

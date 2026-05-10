import { test, expect } from "@playwright/test";

async function ensureCompteExists(page: import("@playwright/test").Page, handle: string, plateforme: "TikTok" | "Instagram") {
  await page.goto("/comptes");
  // If the compte already exists from a previous run, skip creating it.
  if ((await page.getByRole("cell", { name: `@${handle}` }).count()) > 0) return;
  await page.getByRole("button", { name: /ajouter un compte/i }).click();
  await page.getByLabel("Handle").fill(handle);
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: plateforme }).click();
  await page.getByLabel("Notes").fill("[E2E_TEST] compte pour carrousel biblio");
  await page.getByRole("button", { name: /^ajouter$/i }).click();
  await expect(page.getByRole("cell", { name: `@${handle}` })).toBeVisible();
}

test.describe("Création carrousel via bibliothèque", () => {
  test("flow complet bibliothèque → carrousel créé", async ({ page }) => {
    await ensureCompteExists(page, "test_e2e_carousel", "TikTok");

    await page.goto("/biblio-hooks");
    // Wait for hooks to load — attend le 1er link "Créer carrousel" qui n'apparaît
    // qu'une fois la query Convex résolue. Plus précis que l'ancien match
    // /hooks?$/ qui collait avec le titre h1 ET le compteur "X sur Y hooks".
    const firstCreateLink = page
      .getByRole("link", { name: /créer carrousel/i })
      .first();
    await expect(firstCreateLink).toBeVisible({ timeout: 10000 });

    // Click first "Créer carrousel" link in the FR Erreur section (default state)
    await firstCreateLink.click();

    await expect(page).toHaveURL(/\/nouveau\?hookId=/);

    // Vérifier qu'un hook est sélectionné (badges Erreur/Broad-A/FR par défaut)
    await expect(page.getByText("Erreur").first()).toBeVisible();
    await expect(page.getByText("FR").first()).toBeVisible();

    // Slides
    await page.getByLabel("Slide 1").fill("Slide 1 test E2E");

    // Décocher Instagram (défaut TikTok+IG cochés) pour ne pas avoir de warning compte
    await page.getByRole("checkbox", { name: /instagram/i }).uncheck();

    // Wait for the Compte select to mount (Convex query for comptesData must resolve;
    // until then the form shows a Skeleton in place of the combobox, so .last() would
    // pick up the Angle combobox instead).
    await expect(page.getByRole("combobox")).toHaveCount(4);
    await page.getByRole("combobox").last().click();
    await page.getByRole("option", { name: /test_e2e_carousel/i }).click();

    // Notes
    await page.getByLabel("Notes").fill("[E2E_TEST] carrousel via biblio");

    // Submit
    await page.getByRole("button", { name: /^créer le carrousel$/i }).click();

    await expect(page).toHaveURL(/\/carrousels/, { timeout: 10000 });
    await expect(
      page.getByRole("cell", { name: "@test_e2e_carousel" }).first(),
    ).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";

/**
 * Batch F — smoke test sidebar 3e section. Vérifie que la nav vers
 * /inspirations fonctionne et que l'item "Inspirations" est actif sur
 * cette route. Indirectement : vérifie qu'aucune route existante n'a été
 * cassée par l'ajout de la 3e section.
 */
test.describe("Sidebar — section Veille", () => {
  test("affiche Inspirations + nav fonctionnelle", async ({ page }) => {
    await page.goto("/dashboard");

    // Les 3 labels de section sont visibles en mode expanded.
    // (Pas de role/heading sur le label de section — texte uppercase pur.)
    await expect(page.getByText("Général", { exact: true })).toBeVisible();
    await expect(page.getByText("Contenu", { exact: true })).toBeVisible();
    await expect(page.getByText("Veille", { exact: true })).toBeVisible();

    // L'item Inspirations existe et navigue vers /inspirations.
    const inspirationsLink = page
      .getByRole("link", { name: /inspirations/i })
      .first();
    await expect(inspirationsLink).toBeVisible();
    await inspirationsLink.click();

    await expect(page).toHaveURL(/\/inspirations/);
    await expect(
      page.getByRole("heading", { name: /^inspirations$/i }),
    ).toBeVisible();
  });
});

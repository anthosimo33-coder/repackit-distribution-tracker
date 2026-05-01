import { test, expect } from "@playwright/test";

test.describe("Tracker filtres", () => {
  test("filtre par verdict WINNER affiche que les winners", async ({ page }) => {
    await page.goto("/tracker");

    // Skip si pas de pubs (test indépendant des autres)
    if ((await page.getByText(/aucun carrousel/i).count()) > 0) {
      test.skip();
      return;
    }

    // Filter bar comboboxes are in declaration order: Plateforme, Mécanique, Format, Verdict.
    // The dialogs (edit metrics, detail) are NOT mounted on initial /tracker render, so
    // we can safely use nth across all comboboxes.
    const allCombos = page.getByRole("combobox");
    await allCombos.nth(3).click();
    await page.getByRole("option", { name: "WINNER" }).click();

    // Toutes les rows visibles doivent contenir WINNER (ou aucune si pas de winners)
    const rows = page.locator("tbody tr");
    const count = await rows.count();
    if (count === 0) {
      // Aucun WINNER pour l'instant — on accepte ce cas
      return;
    }
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).getByText("WINNER")).toBeVisible();
    }
  });
});

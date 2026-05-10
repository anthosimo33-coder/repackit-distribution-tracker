import { test, expect } from "@playwright/test";

test.describe("Tracker filtres", () => {
  test("filtre par verdict WINNER affiche que les winners", async ({ page }) => {
    await page.goto("/carrousels");

    // Skip si pas de pubs (test indépendant des autres)
    if ((await page.getByText(/aucun carrousel/i).count()) > 0) {
      test.skip();
      return;
    }

    // Anchor sémantique : trouve le label "Verdict", remonte au parent direct
    // (le wrapper <div> de FilterMultiSelect), descend à la combobox. Insensible à
    // l'ajout de nouveaux filtres dans la barre (compte/statut/etc.).
    // Modif 1 : Verdict est passé en multi-select (Popover + buttons role=option).
    const verdictLabel = page
      .locator("label")
      .filter({ hasText: /^Verdict$/ });
    const verdictWrapper = verdictLabel.locator("xpath=..");
    await verdictWrapper.getByRole("combobox").click();
    await page.getByRole("option", { name: "WINNER" }).click();
    // Le popover multi-select reste ouvert (volontaire) — on le ferme via
    // Escape pour libérer le DOM avant de vérifier les rows.
    await page.keyboard.press("Escape");

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

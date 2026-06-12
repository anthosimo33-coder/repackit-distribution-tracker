import { test, expect } from "./fixtures/auth-fixture";

/**
 * Batch C — création carrousel mode Custom via modal NouveauModal.
 *
 * Flow : /carrousels → bouton "Nouveau Carrousel" → modal pré-sélectionné
 * carousel → étape 2 (Hook custom) → étape 3 → 4 → 5 → Créer.
 */
test.describe("Création carrousel mode custom", () => {
  test("hook custom + tous les champs", async ({ page }) => {
    // Pré-requis : compte test
    await page.goto("/comptes");
    if (
      (await page.getByRole("cell", { name: "@test_e2e_custom" }).count()) === 0
    ) {
      await page.getByRole("button", { name: /ajouter un compte/i }).click();
      await page.getByLabel("Handle").fill("test_e2e_custom");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Instagram" }).click();
      await page.getByLabel("Notes").fill("[E2E_TEST] compte custom");
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.getByRole("cell", { name: "@test_e2e_custom" }),
      ).toBeVisible();
    }

    // Ouvre le modal directement avec format pré-sélectionné via URL.
    // Plus rapide et déterministe que de cliquer le bouton header.
    await page.goto("/dashboard?nouveau=open&format=carousel");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Step 2 (Hook). Switch sur l'onglet Custom.
    await dialog.getByRole("tab", { name: /custom/i }).click();
    await dialog
      .getByLabel("Texte du hook")
      .fill("Hook custom test E2E unique");

    // Selects custom : Mécanique Question, Niveau Niché, Langue inchangée FR.
    const dialogCombos = dialog.getByRole("combobox");
    // Ordre attendu : 0=Langue, 1=Mécanique, 2=Niveau (pas de format A-H ni
    // angle ici — ces champs sont en step 3 Contenu).
    await dialogCombos.nth(1).click();
    await page.getByRole("option", { name: "Question" }).click();
    await dialogCombos.nth(2).click();
    await page.getByRole("option", { name: "Niché" }).click();

    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 3 (Contenu carousel) : Format D + Angle Pédagogique.
    const step3Combos = dialog.getByRole("combobox");
    await step3Combos.nth(0).click();
    await page.getByRole("option", { name: /^D · / }).click();
    await step3Combos.nth(1).click();
    await page.getByRole("option", { name: "Pédagogique" }).click();
    // Slide 1 pré-rempli via le hook custom (cf isDataDirty + pre-fill).
    // On l'écrase pour matcher le comportement de l'ancien test.
    await dialog.getByLabel("Slide 1").fill("Slide 1");
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 4 (Publication) : cocher Instagram (compte est IG).
    await dialog.getByRole("checkbox", { name: /instagram/i }).check();
    await dialog
      .locator("label")
      .filter({ hasText: /^Compte$/ })
      .locator("xpath=..")
      .getByRole("combobox")
      .click();
    await page.getByRole("option", { name: /test_e2e_custom/i }).click();
    await dialog.getByLabel("Notes").fill("[E2E_TEST] carrousel custom");
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 5 (Récap) : Créer.
    await dialog.getByRole("button", { name: /^créer$/i }).click();

    await expect(page).toHaveURL(/\/carrousels/, { timeout: 10000 });
    await expect(
      page.getByText("Hook custom test E2E unique"),
    ).toBeVisible();
  });
});

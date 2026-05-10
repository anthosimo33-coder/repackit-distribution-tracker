import { test, expect } from "@playwright/test";

test.describe("Création carrousel mode custom", () => {
  test("hook custom + tous les champs", async ({ page }) => {
    // Pré-requis : compte test
    await page.goto("/comptes");
    if ((await page.getByRole("cell", { name: "@test_e2e_custom" }).count()) === 0) {
      await page.getByRole("button", { name: /ajouter un compte/i }).click();
      await page.getByLabel("Handle").fill("test_e2e_custom");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Instagram" }).click();
      await page.getByLabel("Notes").fill("[E2E_TEST] compte custom");
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(page.getByRole("cell", { name: "@test_e2e_custom" })).toBeVisible();
    }

    await page.goto("/nouveau");

    // Switch en mode Custom
    await page.getByRole("tab", { name: /custom/i }).click();

    // Texte du hook
    await page.getByLabel("Texte du hook").fill("Hook custom test E2E unique");

    // Tous les comboboxes du form custom (langue, mécanique, niveau, format, angle, compte)
    // L'ordre dans le DOM : Langue, Mécanique, Niveau, puis section 2 Format, Angle, puis section 4 Compte
    // On utilise les options pour différencier.

    // Décocher TikTok (compte est IG)
    await page.getByRole("checkbox", { name: /tiktok/i }).uncheck();

    // Sélectionner Mécanique = Question
    const comboboxes = page.getByRole("combobox");
    // Custom mode order: 0=Langue, 1=Mécanique, 2=Niveau, 3=Format, 4=Angle, 5=Compte
    await comboboxes.nth(1).click();
    await page.getByRole("option", { name: "Question" }).click();

    // Niveau = Niché
    await comboboxes.nth(2).click();
    await page.getByRole("option", { name: "Niché" }).click();

    // Format D
    await comboboxes.nth(3).click();
    await page.getByRole("option", { name: /^D · / }).click();

    // Angle = Pédagogique
    await comboboxes.nth(4).click();
    await page.getByRole("option", { name: "Pédagogique" }).click();

    // Compte
    await comboboxes.nth(5).click();
    await page.getByRole("option", { name: /test_e2e_custom/i }).click();

    // Slide 1
    await page.getByLabel("Slide 1").fill("Slide 1");

    // Notes
    await page.getByLabel("Notes").fill("[E2E_TEST] carrousel custom");

    // Submit
    await page.getByRole("button", { name: /^créer le carrousel$/i }).click();

    await expect(page).toHaveURL(/\/carrousels/, { timeout: 10000 });
    await expect(page.getByText("Hook custom test E2E unique")).toBeVisible();
  });
});

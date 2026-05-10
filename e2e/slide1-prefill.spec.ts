import { test, expect } from "@playwright/test";

/**
 * Batch C — pre-fill slide 1 dans le modal NouveauModal.
 *
 * Politique d'écrasement (inchangée vs ancienne /nouveau) : on ne remplit
 * la slide 1 que si elle est vide. Toute édition manuelle figée.
 *
 * 2 cas couverts :
 *   1. Bibliothèque : sélection d'un hook pré-remplit slide 1 ; vidage
 *      manuel + re-sélection re-fill.
 *   2. Custom : keystroke remplit slide 1 vide ; figée une fois remplie.
 */
test.describe("Slide 1 — pre-fill depuis hook (modal NouveauModal)", () => {
  test("biblio: sélection → slide 1 remplie ; re-sélection → préservée ; vidage → re-fill", async ({
    page,
  }) => {
    // Arrive via /biblio-hooks → click "Créer carrousel" → modal s'ouvre
    // étape 2 (format=carousel pré-sélectionné, hookId initial set).
    await page.goto("/biblio-hooks");
    const firstHookLink = page.locator('a[href*="hookId="]').first();
    await firstHookLink.click();
    await expect(page).toHaveURL(/[?&]nouveau=open/, { timeout: 10000 });

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Step 2 → step 3 (Contenu carousel — slide 1 doit être pré-remplie
    // avec le texte du hook initial, propagé par useEffect dans le modal).
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    const slide1 = dialog.getByLabel("Slide 1");
    await expect(slide1).not.toHaveValue("", { timeout: 5000 });
    const firstHookText = await slide1.inputValue();
    expect(firstHookText.length).toBeGreaterThan(0);

    // Cas 2 : revenir step 2, sélectionner un autre hook → slide 1 préservée.
    await dialog.getByRole("button", { name: /^précédent$/i }).click();
    const hookCombo = dialog.getByRole("combobox").first();
    await hookCombo.click();
    const items = page.getByRole("option");
    await items.nth(1).click();
    await dialog.getByRole("button", { name: /^suivant$/i }).click();
    await page.waitForTimeout(300);
    await expect(slide1).toHaveValue(firstHookText);

    // Cas 3 : vider slide 1 → revenir step 2, sélectionner un 3e hook →
    // re-fill OK.
    await slide1.fill("");
    await dialog.getByRole("button", { name: /^précédent$/i }).click();
    await hookCombo.click();
    await items.nth(2).click();
    await dialog.getByRole("button", { name: /^suivant$/i }).click();
    await expect(dialog.getByLabel("Slide 1")).not.toHaveValue("", {
      timeout: 5000,
    });
    await expect(dialog.getByLabel("Slide 1")).not.toHaveValue(firstHookText);
  });

  test("custom: keystroke remplit slide 1 vide ; figée une fois remplie", async ({
    page,
  }) => {
    await page.goto("/dashboard?nouveau=open&format=carousel");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Step 2 — switch Custom + saisir hook.
    await dialog.getByRole("tab", { name: /custom/i }).click();
    const customText = dialog.getByLabel("Texte du hook");

    // Cas 4a : 1er fill → slide 1 prend la valeur (vide → remplie).
    await customText.fill("Foo");
    await dialog.getByRole("button", { name: /^suivant$/i }).click();
    const slide1 = dialog.getByLabel("Slide 1");
    await expect(slide1).toHaveValue("Foo");

    // Cas 4b : keystroke suivant → slide 1 NE bouge PLUS (politique
    // "n'écraser que si vide"). On revient step 2 pour ré-éditer.
    await dialog.getByRole("button", { name: /^précédent$/i }).click();
    await customText.fill("Foo bar baz");
    await dialog.getByRole("button", { name: /^suivant$/i }).click();
    await expect(dialog.getByLabel("Slide 1")).toHaveValue("Foo");

    // Cas 4c : vider slide 1 puis nouveau keystroke custom → re-fill.
    await dialog.getByLabel("Slide 1").fill("");
    await dialog.getByRole("button", { name: /^précédent$/i }).click();
    await customText.fill("Foo bar baz qux");
    await dialog.getByRole("button", { name: /^suivant$/i }).click();
    await expect(dialog.getByLabel("Slide 1")).toHaveValue("Foo bar baz qux");
  });
});

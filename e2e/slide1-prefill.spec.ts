import { test, expect } from "@playwright/test";

/**
 * Modif 3 — slide 1 = hook auto-rempli.
 *
 * Politique d'écrasement : on ne remplit que si slide 1 est vide. Tout
 * édition manuelle (utilisateur qui a tapé dans la textarea slide 1) est
 * préservée et ne sera plus écrasée par les sélections/typings ultérieurs
 * dans le hook.
 *
 * 4 cas couverts :
 *  1. Sélection d'un hook depuis la combobox biblio → slide 1 = hook.text
 *  2. Re-sélection d'un autre hook (slide 1 non vide) → slide 1 préservé
 *  3. Vidage manuel de slide 1 puis re-sélection → re-fill OK
 *  4. Mode custom : keystroke par keystroke tant que slide 1 reste vide,
 *     fige une fois remplie (cf décision A : "n'écraser que si vide")
 */
test.describe("Slide 1 — pre-fill depuis hook", () => {
  test("biblio: sélection → slide 1 remplie ; re-sélection → préservée ; vidage → re-fill", async ({
    page,
  }) => {
    // Cas 1 : arriver via /biblio-hooks → click "Créer carrousel" → /nouveau ?hookId=
    await page.goto("/biblio-hooks");
    const firstHookLink = page.locator('a[href*="hookId="]').first();
    const firstHookHref = await firstHookLink.getAttribute("href");
    expect(firstHookHref).toBeTruthy();
    await firstHookLink.click();
    await expect(page).toHaveURL(/\/nouveau\?hookId=/);

    // Slide 1 doit être pré-remplie avec le texte du hook (run-once seed).
    const slide1 = page.getByLabel("Slide 1");
    await expect(slide1).not.toHaveValue("", { timeout: 5000 });
    const firstHookText = await slide1.inputValue();
    expect(firstHookText.length).toBeGreaterThan(0);

    // Cas 2 : ouvrir le combobox, sélectionner un AUTRE hook → slide 1 ne change pas.
    const hookCombo = page.getByRole("combobox").first();
    await hookCombo.click();
    // Le 2e item de la liste cmdk (le 1er étant déjà sélectionné).
    const items = page.getByRole("option");
    await items.nth(1).click();
    // Wait UI settle.
    await page.waitForTimeout(300);
    // Slide 1 conserve la valeur initiale (préservation édition implicite
    // — la slide n'était pas vide au moment de la 2e sélection).
    await expect(slide1).toHaveValue(firstHookText);

    // Cas 3 : vider slide 1 → re-sélectionner un hook → re-fill.
    await slide1.fill("");
    await hookCombo.click();
    await items.nth(2).click();
    // Slide 1 doit être remplie avec le texte du nouveau hook (différent
    // des deux précédents).
    await expect(slide1).not.toHaveValue("", { timeout: 5000 });
    await expect(slide1).not.toHaveValue(firstHookText);
  });

  test("custom: keystroke remplit slide 1 vide ; figée une fois remplie", async ({
    page,
  }) => {
    await page.goto("/nouveau");

    // Switch mode Custom.
    await page.getByRole("tab", { name: /custom/i }).click();

    const customText = page.getByLabel("Texte du hook");
    const slide1 = page.getByLabel("Slide 1");
    await expect(slide1).toHaveValue("");

    // Cas 4a : 1er keystroke sur custom-text → slide 1 prend la valeur
    // courante (la règle prev[0] === "" passe).
    await customText.fill("Foo");
    await expect(slide1).toHaveValue("Foo");

    // Cas 4b : keystrokes suivants → slide 1 NE bouge PLUS car non vide
    // (politique "n'écraser que si vide", décision A). C'est intentionnel :
    // le pré-remplissage est un coup d'envoi, pas une sync continue.
    await customText.fill("Foo bar baz");
    await expect(slide1).toHaveValue("Foo");

    // Cas 4c : vider slide 1 puis nouveau keystroke custom → re-fill OK.
    await slide1.fill("");
    await customText.fill("Foo bar baz qux");
    await expect(slide1).toHaveValue("Foo bar baz qux");
  });
});

import { test, expect } from "@playwright/test";

/**
 * Feature 3 — édition d'un draft via la vue détail.
 * Couvre le flow : créer un draft → ouvrir détail → modifier une slide
 * → enregistrer → ré-ouvrir → vérifier que la modification a persisté.
 */
test.describe("Draft edit via detail dialog", () => {
  test("modifier le texte d'une slide d'un draft persiste", async ({
    page,
  }) => {
    // Pré-requis : compte
    await page.goto("/comptes");
    if (
      (await page
        .getByRole("cell", { name: "@test_e2e_draft_edit" })
        .count()) === 0
    ) {
      await page.getByRole("button", { name: /ajouter un compte/i }).click();
      await page.getByLabel("Handle").fill("test_e2e_draft_edit");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "TikTok" }).click();
      await page.getByLabel("Notes").fill("[E2E_TEST] draft edit");
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.getByRole("cell", { name: "@test_e2e_draft_edit" }),
      ).toBeVisible();
    }

    // Créer un draft custom
    await page.goto("/nouveau");
    await page.getByRole("tab", { name: /custom/i }).click();
    await page.getByLabel("Texte du hook").fill("Hook draft edit E2E");

    await page.getByRole("checkbox", { name: /instagram/i }).uncheck();

    const comboboxes = page.getByRole("combobox");
    await comboboxes.nth(1).click();
    await page.getByRole("option", { name: "Erreur" }).click();
    await comboboxes.nth(2).click();
    await page.getByRole("option", { name: "Broad-A" }).click();
    await comboboxes.nth(3).click();
    await page.getByRole("option", { name: /^A · / }).click();
    await comboboxes.nth(4).click();
    await page.getByRole("option", { name: "Psycho" }).click();
    await comboboxes.nth(5).click();
    await page.getByRole("option", { name: /test_e2e_draft_edit/i }).click();

    await page.getByLabel("Slide 1").fill("Texte initial slide 1");
    await page.getByLabel("Notes").fill("[E2E_TEST] draft edit");
    await page.getByRole("button", { name: /^créer le carrousel$/i }).click();

    await expect(page).toHaveURL(/\/tracker/, { timeout: 10000 });

    // Ouvrir détail/édition du draft
    const row = page
      .getByRole("row")
      .filter({ hasText: "Hook draft edit E2E" });
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /voir détail/i }).click();

    // Le dialog est en mode édition (DraftEditView). Slide 1 doit afficher le texte initial.
    const slide1 = page.getByLabel("Slide 1");
    await expect(slide1).toHaveValue("Texte initial slide 1");

    // Modifier le texte
    await slide1.fill("Texte modifié via dialog E2E");

    // Save
    await page.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    // Ré-ouvrir le détail pour vérifier la persistance
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /voir détail/i }).click();

    await expect(page.getByLabel("Slide 1")).toHaveValue(
      "Texte modifié via dialog E2E",
    );
  });

  // NB : la couverture du disabled state de "Mettre à jour stats" sur un draft
  // est implicite — tracker-metrics.spec.ts est obligé de passer par "Voir
  // détail / éditer" pour publier d'abord, parce que "Mettre à jour stats" est
  // disabled. Si ce verrou sautait, le test casserait au moment du fill postUrl.
});

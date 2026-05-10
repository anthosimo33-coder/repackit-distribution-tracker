import { test, expect } from "@playwright/test";

/**
 * Modif 4 — raccourci 1-clic "Marquer comme posté" sur les drafts.
 *
 * Flow couvert : créer un draft → ouvrir le dropdown du tracker → cliquer
 * "Marquer comme posté" → vérifier la garde validation URL → submit avec
 * URL valide → la row passe en section "Publié" → l'item disparaît du dropdown.
 */
test.describe("Tracker — Marquer comme posté (raccourci 1-clic)", () => {
  test("draft → dropdown → dialog → URL → row en Publié", async ({ page }) => {
    // Pré-requis : compte
    await page.goto("/comptes");
    if (
      (await page
        .getByRole("cell", { name: "@test_e2e_mark_posted" })
        .count()) === 0
    ) {
      await page.getByRole("button", { name: /ajouter un compte/i }).click();
      await page.getByLabel("Handle").fill("test_e2e_mark_posted");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "TikTok" }).click();
      await page.getByLabel("Notes").fill("[E2E_TEST] mark as posted");
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.getByRole("cell", { name: "@test_e2e_mark_posted" }),
      ).toBeVisible();
    }

    // Créer un draft custom
    const hookText = `Hook mark posted E2E ${Date.now()}`;
    await page.goto("/nouveau");
    await page.getByRole("tab", { name: /custom/i }).click();
    await page.getByLabel("Texte du hook").fill(hookText);

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
    await page.getByRole("option", { name: /test_e2e_mark_posted/i }).click();

    await page.getByLabel("Slide 1").fill("Slide initiale");
    await page.getByLabel("Notes").fill("[E2E_TEST] mark as posted");
    await page.getByRole("button", { name: /^créer le carrousel$/i }).click();

    await expect(page).toHaveURL(/\/carrousels/, { timeout: 10000 });

    // La row vient d'être créée → section "À venir". Ouvre son dropdown.
    const row = page.getByRole("row").filter({ hasText: hookText });
    await expect(row).toBeVisible();
    await row.getByRole("button").last().click();

    // L'item "Marquer comme posté" doit être visible (et placé en haut).
    const markItem = page.getByRole("menuitem", {
      name: /marquer comme posté/i,
    });
    await expect(markItem).toBeVisible();
    await markItem.click();

    // Dialog ouvert. Garde URL : Confirmer disabled tant que !startsWith("http").
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const confirmBtn = dialog.getByRole("button", { name: /^confirmer$/i });
    await expect(confirmBtn).toBeDisabled();

    const urlInput = dialog.getByLabel("Lien de publication");
    await urlInput.fill("notvalid");
    await expect(confirmBtn).toBeDisabled();

    await urlInput.fill("https://www.tiktok.com/@test/video/12345");
    await expect(confirmBtn).toBeEnabled();

    await confirmBtn.click();
    await expect(dialog).toBeHidden();

    // La row doit maintenant être dans la section "Publié". On vérifie que son
    // dropdown ne contient PLUS l'item "Marquer comme posté" (publication déjà
    // publiée, l'item est conditionné par !isPublished).
    const updatedRow = page.getByRole("row").filter({ hasText: hookText });
    await expect(updatedRow).toBeVisible();
    await updatedRow.getByRole("button").last().click();
    await expect(
      page.getByRole("menuitem", { name: /marquer comme posté/i }),
    ).toHaveCount(0);
    // "Mettre à jour stats" devient enabled (la row est désormais publiée).
    await expect(
      page.getByRole("menuitem", { name: /mettre à jour stats/i }),
    ).toBeEnabled();
  });
});

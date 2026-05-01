import { test, expect } from "@playwright/test";

test.describe("Tracker édition métriques", () => {
  test("verdict change selon save rate", async ({ page }) => {

    // Pré-requis : compte
    await page.goto("/comptes");
    if ((await page.getByRole("cell", { name: "@test_e2e_metrics" }).count()) === 0) {
      await page.getByRole("button", { name: /ajouter un compte/i }).click();
      await page.getByLabel("Handle").fill("test_e2e_metrics");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "TikTok" }).click();
      await page.getByLabel("Notes").fill("[E2E_TEST] metrics");
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(page.getByRole("cell", { name: "@test_e2e_metrics" })).toBeVisible();
    }

    // Créer un carrousel custom rapide
    await page.goto("/nouveau");
    await page.getByRole("tab", { name: /custom/i }).click();
    await page.getByLabel("Texte du hook").fill("Hook test metrics E2E");

    // Décocher Instagram
    await page.getByRole("checkbox", { name: /instagram/i }).uncheck();

    const comboboxes = page.getByRole("combobox");
    // Mécanique = Erreur
    await comboboxes.nth(1).click();
    await page.getByRole("option", { name: "Erreur" }).click();
    // Niveau = Broad-A
    await comboboxes.nth(2).click();
    await page.getByRole("option", { name: "Broad-A" }).click();
    // Format A
    await comboboxes.nth(3).click();
    await page.getByRole("option", { name: /^A · / }).click();
    // Angle = Psycho
    await comboboxes.nth(4).click();
    await page.getByRole("option", { name: "Psycho" }).click();
    // Compte
    await comboboxes.nth(5).click();
    await page.getByRole("option", { name: /test_e2e_metrics/i }).click();

    await page.getByLabel("Slide 1").fill("S1");
    await page.getByLabel("Notes").fill("[E2E_TEST] verdict test");
    await page.getByRole("button", { name: /^créer le carrousel$/i }).click();

    await expect(page).toHaveURL(/\/tracker/, { timeout: 10000 });

    const row = page
      .getByRole("row")
      .filter({ hasText: "Hook test metrics E2E" });

    // Feature 3 : "Mettre à jour stats" est désactivé sur les drafts.
    // Pour saisir des métriques + voir un verdict, il faut d'abord publier
    // via la vue détail (DraftEditView) en renseignant un postUrl.
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /voir détail/i }).click();

    await page
      .getByLabel(/lien de publication/i)
      .fill("https://www.tiktok.com/@test_e2e_metrics/video/123");
    await page.getByRole("button", { name: /^enregistrer$/i }).click();

    // Wait for the draft dialog to close before re-opening the dropdown.
    await expect(page.getByRole("dialog")).toBeHidden();

    // Désormais "Mettre à jour stats" est activé.
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /mettre à jour stats/i }).click();

    // Saisir vues=1500, saves=60 → save rate 4% → WINNER
    await page.getByLabel(/vues j\+7/i).fill("1500");
    await page.getByLabel(/^saves$/i).fill("60");

    // Vérifier preview live "WINNER" — exact pour ne pas matcher "Winners" (KPI label)
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("WINNER", { exact: true })).toBeVisible();

    // Save
    await page.getByRole("button", { name: /^enregistrer$/i }).click();

    // Dialog se ferme — vérifier la row (qui est maintenant dans la section Publié)
    await expect(row.getByText("WINNER", { exact: true })).toBeVisible();
    await expect(row.getByText("4,00 %")).toBeVisible();
  });
});

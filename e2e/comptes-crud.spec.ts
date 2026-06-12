import { test, expect } from "./fixtures/auth-fixture";

test.describe("Comptes CRUD", () => {
  test("créer, modifier, archiver un compte", async ({ page }) => {
    await page.goto("/comptes");

    // Ajouter
    await page.getByRole("button", { name: /ajouter un compte/i }).click();
    await page.getByLabel("Handle").fill("test_e2e_1");
    // Plateforme select (Base UI combobox)
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "TikTok" }).click();
    await page.getByLabel("Notes").fill("[E2E_TEST] compte test 1");
    await page.getByRole("button", { name: /^ajouter$/i }).click();

    // Vérifier que le compte apparaît dans la table (pas le toast)
    await expect(
      page.getByRole("cell", { name: "@test_e2e_1" }),
    ).toBeVisible();

    // Modifier via menu actions
    const row = page.getByRole("row").filter({ hasText: "@test_e2e_1" });
    await row.getByRole("button").last().click(); // dropdown menu trigger
    await page.getByRole("menuitem", { name: "Modifier" }).click();

    await page.getByLabel("Notes").fill("[E2E_TEST] compte test 1 modifié");
    await page.getByRole("button", { name: /^enregistrer$/i }).click();

    // Vérifier le compte est toujours là
    await expect(
      page.getByRole("cell", { name: "@test_e2e_1" }),
    ).toBeVisible();

    // Archiver
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Archiver" }).click();

    // Vérifier que le badge passe à "Archivé"
    await expect(row.getByText(/archivé/i)).toBeVisible();
  });
});

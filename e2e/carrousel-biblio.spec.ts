import { test, expect } from "./fixtures/auth-fixture";

async function ensureCompteExists(
  page: import("@playwright/test").Page,
  handle: string,
  plateforme: "TikTok" | "Instagram",
) {
  await page.goto("/comptes");
  if ((await page.getByRole("cell", { name: `@${handle}` }).count()) > 0) return;
  await page.getByRole("button", { name: /ajouter un compte/i }).click();
  await page.getByLabel("Handle").fill(handle);
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: plateforme }).click();
  await page.getByLabel("Notes").fill("[E2E_TEST] compte pour carrousel biblio");
  await page.getByRole("button", { name: /^ajouter$/i }).click();
  await expect(page.getByRole("cell", { name: `@${handle}` })).toBeVisible();
}

/**
 * Batch C — création carrousel via biblio + modal NouveauModal.
 *
 * Flow couvert :
 *   - /biblio-hooks → click "Créer carrousel" → redirect legacy /nouveau
 *     vers /dashboard?nouveau=open&format=carousel&hookId=X → modal s'ouvre
 *     étape 2 (Hook) avec hook pré-sélectionné.
 *   - Étape 2 → 3 (Contenu) → 4 (Publication) → 5 (Récap) → Créer.
 *   - Redirect /carrousels après création réussie.
 */
test.describe("Création carrousel via bibliothèque", () => {
  test("flow complet bibliothèque → carrousel créé", async ({ page }) => {
    await ensureCompteExists(page, "test_e2e_carousel", "TikTok");

    await page.goto("/biblio-hooks");
    const firstCreateLink = page
      .getByRole("link", { name: /créer carrousel/i })
      .first();
    await expect(firstCreateLink).toBeVisible({ timeout: 10000 });
    await firstCreateLink.click();

    // Le link est /nouveau?hookId=X — redirect 308 vers
    // /dashboard?nouveau=open&format=carousel&hookId=X. Modal s'ouvre étape 2.
    await expect(page).toHaveURL(/[?&]nouveau=open/, { timeout: 10000 });

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2 })).toContainText(
      /nouvelle publication/i,
    );

    // Step 2 (Hook) actif via initialMediaType=carousel + initialHookId=X.
    // Le hook est pré-sélectionné via la combobox biblio. Suivant → step 3.
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 3 (Contenu carousel) : fill slide 1 (la slide 1 doit être pré-
    // remplie via le hook texte mais on l'écrase pour rester déterministe).
    await dialog.getByLabel("Slide 1").fill("Slide 1 test E2E");
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 4 (Publication) : cocher TikTok, sélectionner le compte test.
    await dialog.getByRole("checkbox", { name: /tiktok/i }).check();
    // Le compte est auto-pické au 1er compte filtré (cf NouveauModal effect).
    // Si plusieurs comptes TikTok existent, on sélectionne explicitement
    // notre compte de test pour rester déterministe.
    await dialog
      .locator("label")
      .filter({ hasText: /^Compte$/ })
      .locator("xpath=..")
      .getByRole("combobox")
      .click();
    await page.getByRole("option", { name: /test_e2e_carousel/i }).click();
    await dialog.getByLabel("Notes").fill("[E2E_TEST] carrousel via biblio");
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 5 (Récap) : Créer.
    await dialog.getByRole("button", { name: /^créer$/i }).click();

    // Redirect vers /carrousels?carouselId=X + close modal + toast.
    await expect(page).toHaveURL(/\/carrousels/, { timeout: 10000 });
    await expect(
      page.getByRole("cell", { name: "@test_e2e_carousel" }).first(),
    ).toBeVisible();
  });
});

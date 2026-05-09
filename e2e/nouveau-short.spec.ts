import { test, expect } from "@playwright/test";

/**
 * Batch 2 Modif 3 — création d'un Short via le toggle Format de /nouveau.
 *
 * Couvre :
 *   - Toggle Format passe de "Carrousel" (default) à "Short"
 *   - Card "Script" remplace "Slides" ; Format Select et nbSlides Input
 *     disparaissent
 *   - Pre-fill du script avec le texte custom au keystroke (parallèle au
 *     pre-fill slide 1 carousel)
 *   - Plateforme YouTube disponible (apparaît dans les checkboxes après le
 *     switch ; absente en mode carousel)
 *   - Submit → row visible dans /tracker
 *
 * Cleanup : helpers/cleanup.ts global supprime les pubs et comptes marqués
 * "[E2E_TEST]" en début et fin de suite — pas besoin de cleanup local.
 */
test.describe("Création Short via /nouveau", () => {
  test("toggle Format → Short → script pré-rempli → YouTube → submit", async ({
    page,
  }) => {
    // Pré-requis : compte YouTube
    await page.goto("/comptes");
    if (
      (await page
        .getByRole("cell", { name: "@test_e2e_short_yt" })
        .count()) === 0
    ) {
      await page
        .getByRole("button", { name: /ajouter un compte/i })
        .click();
      await page.getByLabel("Handle").fill("test_e2e_short_yt");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "YouTube" }).click();
      await page
        .getByLabel("Notes")
        .fill("[E2E_TEST] compte short YT");
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.getByRole("cell", { name: "@test_e2e_short_yt" }),
      ).toBeVisible();
    }

    const hookText = `Hook short E2E ${Date.now()}`;
    await page.goto("/nouveau");

    // Default mediaType = "carousel" → vérifier que les éléments carousel
    // sont visibles. Le Tab "Short" est unique (pas de collision avec
    // "Custom" ou "Bibliothèque" du toggle Hook).
    await expect(page.getByLabel("Slide 1")).toBeVisible();

    // Switcher vers Short via le Tab Format
    await page.getByRole("tab", { name: "Short", exact: true }).click();

    // Card "Slides" doit disparaître, Card "Script" doit apparaître. Le
    // bouton submit doit refléter le format.
    await expect(page.getByLabel("Slide 1")).toHaveCount(0);
    await expect(page.getByLabel("Script")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^créer le short$/i }),
    ).toBeVisible();

    // Switcher Hook vers Custom + saisir texte → script pré-rempli
    await page.getByRole("tab", { name: /^custom$/i }).click();
    await page.getByLabel("Texte du hook").fill(hookText);
    await expect(page.getByLabel("Script")).toHaveValue(hookText);

    // Plateforme YouTube : visible en mode short (absente en carousel).
    // Cocher YouTube + décocher TikTok/Instagram (le compte cible est YT).
    await page.getByRole("checkbox", { name: /youtube/i }).check();
    await page.getByRole("checkbox", { name: /tiktok/i }).uncheck();
    await page.getByRole("checkbox", { name: /instagram/i }).uncheck();

    // Le useEffect "compte reset" auto-sélectionne le premier compte
    // matchant les plateformes courantes (cf app/nouveau/page.tsx). Avec
    // plateformes=["YouTube"] et un seul compte YouTube en DB, on s'attend
    // à @test_e2e_short_yt sélectionné automatiquement → on vérifie via le
    // texte affiché dans le SelectTrigger (combobox role).
    await expect(
      page.getByRole("combobox").filter({ hasText: "@test_e2e_short_yt" }),
    ).toBeVisible({ timeout: 5000 });

    await page.getByLabel("Notes").fill("[E2E_TEST] short via /nouveau");

    await page
      .getByRole("button", { name: /^créer le short$/i })
      .click();

    await expect(page).toHaveURL(/\/tracker/, { timeout: 10000 });
    // La row apparaît avec son hookText (filtre mediaType ajouté en Modif 4
    // étape suivante — pour ce test l'absence de filtre suffit).
    await expect(page.getByText(hookText).first()).toBeVisible();
  });
});

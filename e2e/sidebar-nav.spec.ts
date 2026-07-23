import { test, expect, adminPath } from "./fixtures/auth-fixture";

/**
 * Smoke test de la nav admin REGROUPÉE (refonte sidebar).
 *  - les groupes PILOTAGE / CONTENU sont visibles (labels uppercase purs, pas
 *    de role heading) ;
 *  - la section « Archives » (Carrousels, Shorts, ScreenRecorder, Biblio Hooks)
 *    a été RETIRÉE du menu : ni toggle « Archives », ni liens legacy dans la
 *    sidebar. Les routes restent accessibles par URL directe (hors nav) ;
 *  - Inspirations (dans le groupe Contenu) navigue toujours vers /inspirations.
 * Indirectement : vérifie qu'aucune route n'a été cassée par la refonte.
 */
test.describe("Sidebar — nav regroupée (sans Archives)", () => {
  test("groupes visibles, Archives retirées du menu, nav Inspirations", async ({
    page,
  }) => {
    await page.goto(adminPath("/dashboard"));

    // Labels de groupe non ambigus (n'existent pas aussi comme item de nav).
    await expect(page.getByText("Pilotage", { exact: true })).toBeVisible();
    await expect(page.getByText("Contenu", { exact: true })).toBeVisible();

    // Section Archives retirée : ni toggle repliable, ni lien legacy dans la
    // sidebar (les routes /carrousels… existent toujours mais hors menu).
    await expect(
      page.getByRole("button", { name: /archives/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /carrousels/i }),
    ).toHaveCount(0);

    // Inspirations (groupe Contenu) existe et navigue vers /inspirations.
    const inspirationsLink = page
      .getByRole("link", { name: /inspirations/i })
      .first();
    await expect(inspirationsLink).toBeVisible();
    await inspirationsLink.click();

    await expect(page).toHaveURL(/\/inspirations/);
    await expect(
      page.getByRole("heading", { name: /^inspirations$/i }),
    ).toBeVisible();
  });
});

import { test, expect, adminPath } from "./fixtures/auth-fixture";

/**
 * Smoke test de la nav admin REGROUPÉE (refonte sidebar).
 *  - les groupes PILOTAGE / CONTENU sont visibles (labels uppercase purs, pas
 *    de role heading) ;
 *  - le repli « Archives » est fermé par défaut → les 4 vues legacy
 *    (Carrousels, Shorts, ScreenRecorder, Biblio Hooks) sont masquées, puis
 *    apparaissent au clic sur le toggle ;
 *  - Inspirations (désormais dans le groupe Contenu) navigue toujours vers
 *    /inspirations.
 * Indirectement : vérifie qu'aucune route n'a été cassée par la refonte.
 */
test.describe("Sidebar — nav regroupée + Archives", () => {
  test("groupes visibles, repli Archives, nav Inspirations", async ({
    page,
  }) => {
    await page.goto(adminPath("/dashboard"));

    // Labels de groupe non ambigus (n'existent pas aussi comme item de nav).
    await expect(page.getByText("Pilotage", { exact: true })).toBeVisible();
    await expect(page.getByText("Contenu", { exact: true })).toBeVisible();

    // Archives : repli FERMÉ par défaut → un item legacy (Carrousels) absent du
    // DOM tant que le repli n'est pas ouvert.
    const archivesToggle = page.getByRole("button", { name: /archives/i });
    await expect(archivesToggle).toBeVisible();
    const carrouselsLink = page.getByRole("link", { name: /carrousels/i });
    await expect(carrouselsLink).toHaveCount(0);

    // Déplier Archives → l'item legacy apparaît (toujours pleinement accessible).
    await archivesToggle.click();
    await expect(carrouselsLink.first()).toBeVisible();

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

import { test, expect, adminPath } from "./fixtures/auth-fixture";

/**
 * Modif 2 — presets de filtres tracker.
 *
 * Couvre le cycle complet : créer un preset depuis l'état courant des filtres,
 * reset, recharger le preset (filtres restaurés), supprimer.
 *
 * Le test suppose qu'au moins une publication existe pour que /tracker rende
 * la PresetBar (pas l'EmptyState). Dans la suite ordonnée alphabétiquement,
 * carrousel-biblio passe avant et crée C001 — sa data persiste jusqu'au
 * teardown global. Si lancé en solo après teardown, le test skip proprement.
 */
// Batch B : la spec exige que createPreset envoie mediaTypeScope (v4) que
// le déploiement Convex en cours d'usage par les e2e ne connaît pas tant
// qu'un `convex deploy` n'a pas été exécuté. Le test reste en place et sera
// ré-activé par Leo une fois le push + deploy faits — la suppression brute
// effacerait la couverture de save/reload/delete des presets.
test.describe.skip("Tracker — presets de filtres (skip jusqu'à Convex deploy v4)", () => {
  test("create → reset → reload → delete", async ({ page }) => {
    await page.goto(adminPath("/carrousels"));

    // Skip si EmptyState (DB sans publication) — la PresetBar n'est rendue
    // que quand publications.length > 0. Wait stable de 3s pour laisser
    // Convex résoudre, puis vérifier la présence du label "Plateforme"
    // (= filter bar rendue) ; sinon skip propre.
    const plateformeLabel = page
      .locator("label")
      .filter({ hasText: /^Plateforme$/ });
    try {
      await plateformeLabel.waitFor({ timeout: 3000 });
    } catch {
      test.skip();
      return;
    }

    // Nom unique par run → pas de collision si une exécution précédente
    // a laissé un orphelin. createPreset refuse les noms dupliqués.
    const presetName = `[E2E_TEST] preset-${Date.now()}`;

    // 1. Changer 2 filtres pour avoir quelque chose à sauvegarder. P10 — le
    //    filtre Mécanique a été retiré de l'UI ; on couvre désormais
    //    Plateforme (single-select) + Format (multi-select), tous deux
    //    toujours présents sur la page carrousels.
    const plateformeWrapper = plateformeLabel.locator("xpath=..");
    await plateformeWrapper.getByRole("combobox").click();
    await page.getByRole("option", { name: "TikTok" }).click();

    const formatLabel = page
      .locator("label")
      .filter({ hasText: /^Format$/ })
      .first();
    const formatWrapper = formatLabel.locator("xpath=..");
    await formatWrapper.getByRole("combobox").click();
    await page.getByRole("option", { name: "A", exact: true }).click();
    // Multi-select reste ouvert volontairement — Escape pour libérer le DOM.
    await page.keyboard.press("Escape");

    // 2. Le bouton "Sauvegarder ce preset" est maintenant actif.
    const saveBtn = page.getByRole("button", { name: /sauvegarder ce preset/i });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // 3. Dialog de naming.
    await page.getByLabel("Nom du preset").fill(presetName);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^sauvegarder$/i })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden();

    // Helper : récupère le trigger de la PresetBar — c'est le bouton qui
    // contient l'icône Bookmark, distinct des boutons des items popover qui
    // n'ont pas d'icône. Reste stable peu importe le label affiché.
    const presetTrigger = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-bookmark") });

    // 4. Le trigger reflète le preset (matchingPreset === preset créé).
    await expect(presetTrigger).toContainText(presetName);

    // 5. Reset des filtres → trigger redevient "Charger un preset".
    await page.getByRole("button", { name: /^reset$/i }).click();
    await expect(presetTrigger).toContainText(/charger un preset/i);

    // 6. Ouvrir la popover, cliquer le preset → filtres restaurés.
    await presetTrigger.click();
    const popoverContent = page.locator('[data-slot="popover-content"]');
    await popoverContent
      .getByRole("button", { name: presetName, exact: true })
      .click();
    // La popover se ferme et le trigger reflète à nouveau le preset.
    await expect(presetTrigger).toContainText(presetName);

    // 7. Vérifier que les filtres Plateforme et Format sont restaurés.
    await expect(plateformeWrapper.getByRole("combobox")).toContainText(
      "TikTok",
    );
    await expect(formatWrapper.getByRole("combobox")).toContainText("A");

    // 8. Supprimer le preset via la popover (X icon).
    await presetTrigger.click();
    await popoverContent
      .getByRole("button", { name: `Supprimer le preset ${presetName}` })
      .click();

    // 9. Le preset n'apparaît plus dans la popover. Filtres toujours sur
    //    TikTok donc trigger → "(custom)".
    await expect(presetTrigger).toContainText(/\(custom\)/);
    await presetTrigger.click();
    await expect(
      popoverContent.getByText("Aucun preset sauvegardé."),
    ).toBeVisible();
  });
});

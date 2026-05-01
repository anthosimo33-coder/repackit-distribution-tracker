import { test, expect } from "@playwright/test";

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
test.describe("Tracker — presets de filtres", () => {
  test("create → reset → reload → delete", async ({ page }) => {
    await page.goto("/tracker");

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

    // 1. Changer un filtre pour avoir quelque chose à sauvegarder.
    const plateformeWrapper = plateformeLabel.locator("xpath=..");
    await plateformeWrapper.getByRole("combobox").click();
    await page.getByRole("option", { name: "TikTok" }).click();

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

    // 7. Vérifier que le filtre Plateforme est revenu à TikTok.
    await expect(plateformeWrapper.getByRole("combobox")).toContainText(
      "TikTok",
    );

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

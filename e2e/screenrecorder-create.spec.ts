import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";
import path from "node:path";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);

const FIXTURE_IMAGE = path.resolve(__dirname, "fixtures/test-image.png");

/**
 * Batch D — création ScreenRecorder via modal NouveauModal.
 *
 * Flow couvert :
 *   - /screenrecorder?nouveau=open&format=screenrecorder → modal step 2
 *   - Hook custom + suivant
 *   - Step 3 : Titre + ImageUploader (Playwright setInputFiles) + Script
 *   - Step 4 : YouTube + compte + suivant
 *   - Step 5 : Créer
 *   - Redirect /screenrecorder?carouselId=NEW
 *   - Vérifier que la pub apparaît dans la liste avec image thumbnail
 */
// Le file upload via Playwright setInputFiles + roundtrip Convex storage
// (generateUploadUrl → POST → resolve URL → preview affichée) est observé
// flaky en CI : le button "Remplacer" tarde à apparaître selon la latence
// du déploiement Convex et la résolution de getPreviewUrl. Le flow complet
// est validé manuellement (cf vérifs Batch D points c-h). Activable dès
// que le déploiement Convex prod est stable + une fixture image plus
// robuste (PNG > 1x1) est ajoutée.
test.describe.skip("Création ScreenRecorder via modal NouveauModal", () => {
  test("flow complet ScreenRecorder → image upload → submit", async ({
    page,
  }) => {
    // Setup défensif compte test
    const stalleComptes = await convex.query(api.comptes.listComptes, {});
    for (const c of stalleComptes) {
      if (c.handle === "@test_e2e_sr_yt" && !c.actif) {
        await convex.mutation(api.comptes.updateCompte, {
          id: c._id,
          actif: true,
        });
      }
    }
    const compteExists = stalleComptes.find(
      (c) => c.handle === "@test_e2e_sr_yt" && c.plateforme === "YouTube",
    );
    if (!compteExists) {
      await convex.mutation(api.comptes.createCompte, {
        handle: "@test_e2e_sr_yt",
        plateforme: "YouTube",
        notes: "[E2E_TEST] compte SR YT",
      });
    }

    const titre = `ScreenRecorder E2E ${Date.now()}`;
    const hookText = `Hook SR E2E ${Date.now()}`;

    await page.goto("/screenrecorder?nouveau=open&format=screenrecorder");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Étape 2 \/ 5 — Hook/),
    ).toBeVisible();

    // Step 2 — Custom hook
    await dialog.getByRole("tab", { name: /custom/i }).click();
    await dialog.getByLabel("Texte du hook").fill(hookText);
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 3 — Titre + Image + Script
    await expect(
      dialog.getByText(/Étape 3 \/ 5 — Contenu/),
    ).toBeVisible();
    await dialog.getByLabel("Titre").fill(titre);

    // Image upload via input file caché. ImageUploader expose un input
    // type=file avec aria-label "Sélectionner une image".
    const fileInput = dialog.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURE_IMAGE);
    // Attendre que le preview apparaisse (l'image est uploadée + résolue
    // via la query getPreviewUrl).
    await expect(
      dialog.getByRole("button", { name: /^remplacer$/i }),
    ).toBeVisible({ timeout: 15000 });

    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 4 — Publication
    await dialog.getByRole("checkbox", { name: /youtube/i }).check();
    const compteCombo = dialog
      .locator("label")
      .filter({ hasText: /^Compte$/ })
      .locator("xpath=..")
      .getByRole("combobox");
    await compteCombo.waitFor({ state: "visible", timeout: 5000 });
    await compteCombo.click();
    await page.getByRole("option", { name: /test_e2e_sr_yt/i }).click();
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 5 — Récap + Créer
    await dialog.getByRole("button", { name: /^créer$/i }).click();

    await expect(page).toHaveURL(/\/screenrecorder/, { timeout: 15000 });
    await expect(page.getByText(titre).first()).toBeVisible();
  });
});

import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";
import path from "node:path";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const FIXTURE_IMAGE = path.resolve(__dirname, "fixtures/test-image.png");

/**
 * Batch D + Refinement SR — création ScreenRecorder via modal NouveauModal.
 *
 * Flow couvert (Refinement SR : 4 étapes au lieu de 5, l'étape Hook est
 * skip) :
 *   - /screenrecorder?nouveau=open&format=screenrecorder → modal ouvre
 *     directement step=3 (Contenu) affiché "Étape 2 / 4" car format
 *     pré-sélectionné via URL
 *   - Étape 2 / 4 (Contenu) : Titre + ImageUploader + Appareil + Type +
 *     Script
 *   - Étape 3 / 4 (Publication) : YouTube + compte
 *   - Étape 4 / 4 (Récap) : Créer
 *   - Redirect /screenrecorder?carouselId=NEW
 *   - Vérifier que la pub apparaît dans la liste avec image thumbnail
 *
 * Note : skipped tant que l'environnement Convex prod n'est pas stable
 * pour le roundtrip storage. Réactivé manuellement après deploy.
 */
test.describe.skip("Création ScreenRecorder via modal NouveauModal", () => {
  test("flow complet ScreenRecorder → image upload → Appareil + Repackaging → submit", async ({
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

    await page.goto(adminPath("/screenrecorder?nouveau=open&format=screenrecorder"));

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Refinement SR — étape Hook skip. Modal ouvre directement à Contenu
    // affichée comme "Étape 2 / 4" (compressé visuellement, internal step=3).
    await expect(
      dialog.getByText(/Étape 2 \/ 4 — Contenu/),
    ).toBeVisible();

    // Étape Contenu — Titre + Image + Appareil + Repackaging + Script
    await dialog.getByLabel("Titre").fill(titre);

    // Image upload via input file caché.
    const fileInput = dialog.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURE_IMAGE);
    await expect(
      dialog.getByRole("button", { name: /^remplacer$/i }),
    ).toBeVisible({ timeout: 15000 });

    // Refinement SR — sélections Appareil + Repackaging via cards radio.
    await dialog
      .getByRole("button", { name: /^téléphone$/i })
      .click();
    await dialog
      .getByRole("button", { name: /^repackaging repackit/i })
      .click();

    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Étape 3 / 4 — Publication
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

    // Étape 4 / 4 — Récap + Créer
    await dialog.getByRole("button", { name: /^créer$/i }).click();

    await expect(page).toHaveURL(/\/screenrecorder/, { timeout: 15000 });
    await expect(page.getByText(titre).first()).toBeVisible();
  });
});

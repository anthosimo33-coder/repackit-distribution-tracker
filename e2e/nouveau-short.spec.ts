import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);

/**
 * Batch C — création Short via modal NouveauModal.
 *
 * Flow : /shorts → bouton "Nouveau Short" → modal pré-sélectionné short →
 * étape 2 (Hook custom) → étape 3 (Script + Angle, pas de slides) → 4 → 5
 * → Créer.
 */
test.describe("Création Short via modal NouveauModal", () => {
  test("Short pré-sélectionné → script pré-rempli → YouTube → submit", async ({
    page,
  }) => {
    // Setup défensif Convex : si le compte test_e2e_short_yt existe mais est
    // archivé (cleanup précédent), on le réactive pour que le Select compte
    // affiche au lieu du message "Aucun compte actif".
    const stalleComptes = await convex.query(api.comptes.listComptes, {});
    for (const c of stalleComptes) {
      if (c.handle === "@test_e2e_short_yt" && !c.actif) {
        await convex.mutation(api.comptes.updateCompte, {
          id: c._id,
          actif: true,
        });
      }
    }
    const compteExists = stalleComptes.find(
      (c) =>
        c.handle === "@test_e2e_short_yt" && c.plateforme === "YouTube",
    );
    if (!compteExists) {
      await convex.mutation(api.comptes.createCompte, {
        handle: "@test_e2e_short_yt",
        plateforme: "YouTube",
        notes: "[E2E_TEST] compte short YT",
      });
    }

    const hookText = `Hook short E2E ${Date.now()}`;

    // Modal pré-sélectionné short via URL → ouvre étape 2 directement.
    await page.goto("/shorts?nouveau=open&format=short");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Step 2 — switch Custom + saisir hook.
    await dialog.getByRole("tab", { name: /custom/i }).click();
    await dialog.getByLabel("Texte du hook").fill(hookText);

    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 3 (Contenu short) — Script visible, pas de Slides ni Format A-H.
    await expect(dialog.getByLabel("Slide 1")).toHaveCount(0);
    const script = dialog.getByLabel("Script");
    await expect(script).toBeVisible();
    // Script pré-rempli avec le hookText (idempotent).
    await expect(script).toHaveValue(hookText);

    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 4 (Publication) — YouTube est dans les plateformes éligibles
    // (ALLOWED_PLATFORMS_FOR_SHORT = TikTok+Insta+YT). Cocher YouTube.
    await dialog.getByRole("checkbox", { name: /youtube/i }).check();
    // Sélecteur scopé au dialog (sinon le label "Compte" du filtre tracker
    // en arrière-plan match en premier). Wait sur visibility au cas où le
    // useQuery comptes résolve avec retard (1er fetch).
    const compteCombo = dialog
      .locator("label")
      .filter({ hasText: /^Compte$/ })
      .locator("xpath=..")
      .getByRole("combobox");
    await compteCombo.waitFor({ state: "visible", timeout: 5000 });
    await compteCombo.click();
    await page
      .getByRole("option", { name: /test_e2e_short_yt/i })
      .click();
    await dialog.getByLabel("Notes").fill("[E2E_TEST] short via modal");
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step 5 → Créer.
    await dialog.getByRole("button", { name: /^créer$/i }).click();

    await expect(page).toHaveURL(/\/shorts/, { timeout: 10000 });
    await expect(page.getByText(hookText).first()).toBeVisible();
  });
});

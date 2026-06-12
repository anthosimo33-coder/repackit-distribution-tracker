import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

/**
 * Création d'un Short avec ICP via le modal. Vérifie le refinement Shorts :
 * onglet custom sans mécanique/niveau, étape Contenu avec IcpCombobox required
 * + script + PAS d'angle, récap avec ICP + PAS d'angle, puis colonne ICP dans
 * la liste /shorts.
 */
test.describe("Short — création avec ICP", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.icps.cleanupTestIcps, { secret: E2E_SECRET });
  });

  test("custom hook sans méca/niveau → ICP required → recap → liste", async ({
    page,
  }) => {
    const ts = Date.now();
    const icpName = `${E2E_MARKER} ICP ${ts}`;
    await convex.mutation(api.icps.createIcp, { nom: icpName });

    // Compte TikTok de test (réactive si archivé, crée sinon).
    const comptes = await convex.query(api.comptes.listComptes, {});
    const existing = comptes.find(
      (c) => c.handle === "@test_e2e_short_icp" && c.plateforme === "TikTok",
    );
    if (existing && !existing.actif) {
      await convex.mutation(api.comptes.updateCompte, {
        id: existing._id,
        actif: true,
      });
    }
    if (!existing) {
      await convex.mutation(api.comptes.createCompte, {
        handle: "@test_e2e_short_icp",
        plateforme: "TikTok",
        notes: `${E2E_MARKER} compte short icp`,
      });
    }

    const hookText = `Hook ICP E2E ${ts}`;
    await page.goto(adminPath("/shorts?nouveau=open&format=short"));

    const dialog = page.getByRole("dialog", { name: /nouvelle publication/i });
    await expect(dialog).toBeVisible();

    // Étape 2 (Hook) — onglet Custom : texte + langue, PAS de mécanique/niveau.
    await dialog.getByRole("tab", { name: /custom/i }).click();
    await expect(dialog.getByText("Mécanique")).toHaveCount(0);
    await expect(dialog.getByText("Niveau")).toHaveCount(0);
    await dialog.getByLabel("Texte du hook").fill(hookText);

    // Anti-shadowban — source requise pour un Short (saisie étape Hook).
    const sourceVal = `test_source_icp_${ts}`;
    const sourceCombo = dialog
      .locator("label")
      .filter({ hasText: /Source \(nom de fichier Drive\)/ })
      .locator("xpath=..")
      .getByRole("combobox");
    await sourceCombo.click();
    await page
      .getByPlaceholder("Cherche ou saisis une source…")
      .fill(sourceVal);
    await page.getByRole("option", { name: /utiliser/i }).click();

    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Étape 3 (Contenu) — Script + IcpCombobox required, PAS d'angle.
    await expect(dialog.getByText(/angle tonal/i)).toHaveCount(0);
    await expect(dialog.getByLabel("Script")).toBeVisible();
    await dialog.getByRole("combobox").click();
    await page
      .getByRole("option", { name: new RegExp(`ICP ${ts}`, "i") })
      .click();
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Étape 4 (Publication) — TikTok + compte.
    await dialog.getByRole("checkbox", { name: /tiktok/i }).check();
    const compteCombo = dialog
      .locator("label")
      .filter({ hasText: /^Compte$/ })
      .locator("xpath=..")
      .getByRole("combobox");
    await compteCombo.waitFor({ state: "visible", timeout: 5000 });
    await compteCombo.click();
    await page
      .getByRole("option", { name: /test_e2e_short_icp/i })
      .click();
    await dialog.getByLabel("Notes").fill(`${E2E_MARKER} short icp`);
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Étape 5 (Récap) — ICP affiché, PAS d'angle.
    await expect(
      dialog.getByText(new RegExp(`ICP ${ts}`, "i")),
    ).toBeVisible();
    await expect(dialog.getByText(/angle tonal/i)).toHaveCount(0);

    await dialog.getByRole("button", { name: /^créer$/i }).click();

    await expect(page).toHaveURL(/\/shorts/, { timeout: 10000 });
    // La liste /shorts affiche le hook + la colonne ICP avec le badge.
    await expect(page.getByText(hookText).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText(new RegExp(`ICP ${ts}`, "i")).first(),
    ).toBeVisible({ timeout: 5000 });
  });
});

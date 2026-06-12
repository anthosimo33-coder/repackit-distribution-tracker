import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

/**
 * Assignation d'un gestionnaire à un compte via le dialog d'édition, puis
 * vérification de la colonne Gestionnaire dans le tableau.
 *
 * Setup ConvexHttpClient : 1 personne + 1 compte sans gestionnaire.
 * Le compte (notes marquées) et la personne (nom marqué) sont nettoyés par
 * le global teardown.
 */
test.describe("Compte — assignation gestionnaire", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.personnes.cleanupTestPersonnes, { secret: E2E_SECRET });
  });

  test("assigner une personne → colonne Gestionnaire", async ({ page }) => {
    const prenom = "Marc";
    const nom = `${E2E_MARKER} Bidule ${Date.now()}`;
    const handle = `@assign_${Date.now()}`;

    await convex.mutation(api.personnes.createPersonne, { prenom, nom });
    await convex.mutation(api.comptes.createCompte, {
      handle,
      plateforme: "TikTok",
      notes: `${E2E_MARKER} assign`,
    });

    await page.goto("/comptes");

    // Ouvre le dialog d'édition du compte
    const row = page.getByRole("row").filter({ hasText: handle });
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Modifier" }).click();

    // Scopé par nom : le Popover du combobox a aussi role="dialog".
    const dialog = page.getByRole("dialog", { name: /modifier le compte/i });
    await expect(dialog).toBeVisible();

    // PersonneCombobox visible (label Gestionnaire + trigger combobox).
    // Scopé au conteneur "Gestionnaire" : le dialog a aussi un combobox de
    // Statut (Select base-ui, role="combobox") depuis l'ajout des statuts.
    await expect(
      dialog.getByText("Gestionnaire", { exact: true }),
    ).toBeVisible();
    const combobox = dialog
      .locator("label")
      .filter({ hasText: "Gestionnaire" })
      .locator("xpath=..")
      .getByRole("combobox");
    await expect(combobox).toBeVisible();
    await combobox.click();

    // Sélectionne la personne (option portalée hors du dialog)
    await page
      .getByRole("option", { name: new RegExp(prenom, "i") })
      .click();

    // Sauvegarde
    await dialog.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Colonne Gestionnaire affiche prénom + nom
    const updatedRow = page.getByRole("row").filter({ hasText: handle });
    await expect(updatedRow.getByText(new RegExp(prenom, "i"))).toBeVisible({
      timeout: 5000,
    });
  });
});

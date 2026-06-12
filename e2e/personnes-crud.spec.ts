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
 * CRUD personnes (gestionnaires) via /comptes?view=personnes.
 *
 * Couvre : EmptyState (greenfield + cleanup) → créer (prénom + nom) →
 * compteCount 0 → renommer le prénom → supprimer via AlertDialog.
 *
 * Les personnes de test sont marquées via le nom préfixé [E2E_TEST] pour
 * que cleanupTestPersonnes les nettoie même si un run précédent a crashé.
 */
test.describe("Personnes — CRUD", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.personnes.cleanupTestPersonnes, { secret: E2E_SECRET });
  });

  test("create → rename → delete personne", async ({ page }) => {
    const prenom = "Antoine";
    const nom = `${E2E_MARKER} Durand ${Date.now()}`;

    await page.goto("/comptes?view=personnes");

    // Header + EmptyState
    await expect(
      page.getByRole("heading", { name: /^personnes$/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/crée ta première personne/i),
    ).toBeVisible();

    // Créer
    await page
      .getByRole("button", { name: /nouvelle personne/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Prénom *", { exact: true }).fill(prenom);
    await dialog.getByLabel("Nom *", { exact: true }).fill(nom);
    await dialog.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Apparaît avec compteCount 0
    const row = page.locator("ul > li").filter({ hasText: prenom });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row.getByText(/0 compte/i)).toBeVisible();

    // Renommer le prénom
    await row.getByRole("button", { name: /renommer/i }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog).toBeVisible();
    await editDialog
      .getByLabel("Prénom *", { exact: true })
      .fill("Antoinette");
    await editDialog.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 5000 });
    const renamedRow = page
      .locator("ul > li")
      .filter({ hasText: "Antoinette" });
    await expect(renamedRow).toBeVisible({ timeout: 5000 });

    // Supprimer via AlertDialog
    await renamedRow.getByRole("button", { name: /supprimer/i }).click();
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: /^supprimer$/i }).click();
    await expect(alert).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.locator("ul > li").filter({ hasText: "Antoinette" }),
    ).not.toBeVisible();
  });
});

import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

/**
 * Suppression d'une personne avec cascade unset : les comptes assignés sont
 * désassignés (Gestionnaire = "—"), pas supprimés.
 *
 * Setup ConvexHttpClient : 1 personne + 2 comptes assignés. Comptes (notes
 * marquées) nettoyés par le global teardown ; la personne est supprimée par
 * le test lui-même.
 */
test.describe("Personne — suppression cascade", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.personnes.cleanupTestPersonnes, {});
  });

  test("delete personne → 2 comptes désassignés", async ({ page }) => {
    const prenom = "Paul";
    const nom = `${E2E_MARKER} Cascade ${Date.now()}`;
    const h1 = `@casc1_${Date.now()}`;
    const h2 = `@casc2_${Date.now()}`;

    const personneId = await convex.mutation(api.personnes.createPersonne, {
      prenom,
      nom,
    });
    await convex.mutation(api.comptes.createCompte, {
      handle: h1,
      plateforme: "TikTok",
      notes: `${E2E_MARKER} casc`,
      personneId,
    });
    await convex.mutation(api.comptes.createCompte, {
      handle: h2,
      plateforme: "Instagram",
      notes: `${E2E_MARKER} casc`,
      personneId,
    });

    await page.goto("/comptes?view=personnes");

    // Personne avec compteCount 2
    const row = page.locator("ul > li").filter({ hasText: prenom });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row.getByText(/2 comptes/i)).toBeVisible();

    // Supprimer → AlertDialog mentionne le désassignement
    await row.getByRole("button", { name: /supprimer/i }).click();
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/2 comptes seront désassignés/i);
    await alert.getByRole("button", { name: /^supprimer$/i }).click();
    await expect(alert).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.locator("ul > li").filter({ hasText: prenom }),
    ).not.toBeVisible();

    // Les 2 comptes restent, sans gestionnaire
    await page.goto("/comptes");
    const r1 = page.getByRole("row").filter({ hasText: h1 });
    const r2 = page.getByRole("row").filter({ hasText: h2 });
    await expect(r1).toBeVisible({ timeout: 5000 });
    await expect(r2).toBeVisible();
    await expect(r1).not.toContainText(prenom);
    await expect(r2).not.toContainText(prenom);
  });
});

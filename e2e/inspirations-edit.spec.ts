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
 * Batch G — édition d'une inspiration existante via click sur la card.
 *
 * Couvre :
 *   - Setup : créer une inspiration via mutation
 *   - Click card → Dialog mode edit pré-rempli (URL, titre, notes)
 *   - Modifier titre
 *   - Click Sauvegarder → grid affiche le nouveau titre
 */
test.describe("Inspirations — édition", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.inspirations.cleanupTestInspirations, {});
  });

  test("click card → édit titre → sauvegarde", async ({ page }) => {
    const initialTitle = `Edit E2E ${Date.now()}`;
    const updatedTitle = `${initialTitle} (modifié)`;

    await convex.mutation(api.inspirations.createInspiration, {
      url: "https://www.tiktok.com/@user/video/7000000001",
      type: "video",
      plateforme: "TikTok",
      titre: initialTitle,
      notes: `${E2E_MARKER} initial`,
    });

    await page.goto("/inspirations");

    // Card visible avec initialTitle
    await expect(page.getByText(initialTitle).first()).toBeVisible({
      timeout: 5000,
    });

    // Click card (le titre est dans la card, click ouvre Dialog edit)
    await page.getByText(initialTitle).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /modifier l.inspiration/i }),
    ).toBeVisible();

    // Champs pré-remplis
    const titreInput = dialog.getByLabel("Titre");
    await expect(titreInput).toHaveValue(initialTitle);

    // Modifier titre
    await titreInput.fill(updatedTitle);

    // Sauvegarder
    await dialog.getByRole("button", { name: /^sauvegarder$/i }).click();

    // Dialog ferme + nouveau titre visible
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText(updatedTitle).first()).toBeVisible({
      timeout: 5000,
    });
  });
});

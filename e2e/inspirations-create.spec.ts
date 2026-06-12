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
 * Batch F — création d'une inspiration via /inspirations.
 *
 * Couvre :
 *   - EmptyState visible si aucune inspiration
 *   - Bouton "+ Nouvelle inspiration" ouvre InspirationDialog
 *   - Saisie URL TikTok video → blur → autodétection (badges visibles)
 *   - Saisie titre + notes (avec marker [E2E_TEST] pour cleanup)
 *   - Click Enregistrer → modal ferme + card visible dans grid
 *
 * Cleanup : la mutation cleanupTestInspirations dans globalSetup ramasse
 * les rows dont notes commence par [E2E_TEST] avant le run suivant.
 */
test.describe("Inspirations — création", () => {
  test.beforeEach(async () => {
    // Cleanup défensif des inspirations test laissées par un run précédent.
    await convex.mutation(api.inspirations.cleanupTestInspirations, { secret: E2E_SECRET });
  });

  test("flow création TikTok video", async ({ page }) => {
    const titre = `Inspiration E2E ${Date.now()}`;
    const notes = `${E2E_MARKER} created from playwright`;
    const url = "https://www.tiktok.com/@user/video/7123456789";

    await page.goto("/inspirations");

    // EmptyState visible (cleanup garantit grille vide).
    await expect(
      page.getByRole("heading", { name: /aucune inspiration/i }),
    ).toBeVisible();

    // Cliquer le CTA d'EmptyState (peut y avoir 2 boutons "Nouvelle
    // inspiration" : header + emptystate). Le first() suffit.
    await page
      .getByRole("button", { name: /nouvelle inspiration/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /nouvelle inspiration/i }),
    ).toBeVisible();

    // URL → blur → détection
    await dialog.getByLabel("URL *").fill(url);
    await dialog.getByLabel("URL *").blur();

    // Badge "Détection : TikTok · Vidéo" doit s'afficher
    await expect(dialog.getByText(/détection/i)).toBeVisible();
    await expect(dialog.getByText("TikTok").first()).toBeVisible();
    await expect(dialog.getByText(/vidéo/i).first()).toBeVisible();

    // Titre + notes
    await dialog.getByLabel("Titre").fill(titre);
    await dialog.getByLabel("Notes").fill(notes);

    // Save
    await dialog.getByRole("button", { name: /^enregistrer$/i }).click();

    // Dialog ferme + card visible
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText(titre).first()).toBeVisible({
      timeout: 5000,
    });
  });
});

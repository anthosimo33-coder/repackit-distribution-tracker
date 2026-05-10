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
 * Batch H — toggle Grid/List via URL param ?view=grid|list.
 *
 * Couvre :
 *   - Default = grid view (cards visibles)
 *   - Click toggle "Liste" → table visible + URL ?view=list
 *   - Reload sur ?view=list → list préservée
 *   - Click toggle "Grille" → URL sans ?view= (= grid implicite)
 */
test.describe("Inspirations — toggle vue Grid/List", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.inspirations.cleanupTestInspirations, {});
  });

  test("grid default → list → reload → grid", async ({ page }) => {
    const titre = `View toggle ${Date.now()}`;
    await convex.mutation(api.inspirations.createInspiration, {
      url: "https://www.tiktok.com/@user/video/7000000200",
      type: "video",
      plateforme: "TikTok",
      titre,
      notes: `${E2E_MARKER} view toggle`,
    });

    await page.goto("/inspirations");

    // Grid view default — card avec role=button visible (InspirationCard)
    const cardGrid = page.getByRole("button", { name: new RegExp(titre, "i") });
    await expect(cardGrid).toBeVisible({ timeout: 5000 });
    // Pas de table (vue list)
    await expect(page.locator("table")).not.toBeVisible();

    // Click toggle list
    await page.getByRole("button", { name: /vue liste/i }).click();
    await expect(page).toHaveURL(/view=list/);
    // Table visible
    await expect(page.locator("table")).toBeVisible({ timeout: 5000 });
    // Row contains the title
    await expect(page.locator("table").getByText(titre)).toBeVisible();

    // Reload → list view préservée
    await page.reload();
    await expect(page.locator("table")).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/view=list/);

    // Click toggle grid
    await page.getByRole("button", { name: /vue grille/i }).click();
    // URL sans view=list (peut être ?view=grid OU pas de param view du tout)
    await expect(page).not.toHaveURL(/view=list/);
    await expect(page.locator("table")).not.toBeVisible();
    const cardGridAfter = page.getByRole("button", {
      name: new RegExp(titre, "i"),
    });
    await expect(cardGridAfter).toBeVisible({ timeout: 5000 });
  });
});

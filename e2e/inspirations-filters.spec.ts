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
 * Batch G — filtres /inspirations. Crée 3 inspirations avec des shapes
 * variés puis exerce plateforme + favori + search via le panneau filtres.
 */
test.describe("Inspirations — filtres", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.inspirations.cleanupTestInspirations, { secret: E2E_SECRET });
  });

  test("filtres plateforme + favoris + search", async ({ page }) => {
    const t1 = `Filter TK ${Date.now()}`;
    const t2 = `Filter IG ${Date.now()}`;
    const t3 = `Filter YT fav ${Date.now()}`;

    await convex.mutation(api.inspirations.createInspiration, {
      url: "https://www.tiktok.com/@user/video/7000000010",
      type: "video",
      plateforme: "TikTok",
      titre: t1,
      notes: `${E2E_MARKER} 1`,
    });
    await convex.mutation(api.inspirations.createInspiration, {
      url: "https://www.instagram.com/reel/abc",
      type: "video",
      plateforme: "Instagram",
      titre: t2,
      notes: `${E2E_MARKER} 2`,
    });
    await convex.mutation(api.inspirations.createInspiration, {
      url: "https://www.youtube.com/shorts/xyz",
      type: "video",
      plateforme: "YouTube",
      titre: t3,
      notes: `${E2E_MARKER} 3`,
      isFavorite: true,
    });

    await page.goto("/inspirations");

    // 3 cards visibles initialement
    await expect(page.getByText(t1).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(t2).first()).toBeVisible();
    await expect(page.getByText(t3).first()).toBeVisible();

    // Open filters
    await page.getByRole("button", { name: /^filtres$/i }).click();

    // FilterMultiSelect : la <label> est en sibling du <button role=combobox>,
    // pas associée via htmlFor. On localise le combobox via la label parente
    // (xpath ..) puis le bouton role=combobox à l'intérieur.
    const plateformeFilter = page
      .getByText("Plateforme", { exact: true })
      .locator("xpath=..")
      .getByRole("combobox");
    await plateformeFilter.click();
    await page.getByRole("option", { name: "TikTok" }).click();
    // Close popover by pressing Escape
    await page.keyboard.press("Escape");

    // Only t1 visible
    await expect(page.getByText(t1).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(t2)).not.toBeVisible();
    await expect(page.getByText(t3)).not.toBeVisible();

    // Reset filters
    await page.getByRole("button", { name: /réinitialiser/i }).click();

    // All visible again
    await expect(page.getByText(t1).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(t2).first()).toBeVisible();
    await expect(page.getByText(t3).first()).toBeVisible();

    // Toggle Favoris seulement
    await page.getByRole("switch", { name: /favoris seulement/i }).click();

    // Only t3 (the favorite) visible
    await expect(page.getByText(t3).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(t1)).not.toBeVisible();
    await expect(page.getByText(t2)).not.toBeVisible();

    // Reset again
    await page.getByRole("button", { name: /réinitialiser/i }).click();

    // Search "tiktok" (matches URL of t1, case-insensitive)
    const search = page.getByPlaceholder(/titre, notes, url/i);
    await search.fill("tiktok");
    // Wait for debounce
    await page.waitForTimeout(500);

    await expect(page.getByText(t1).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(t2)).not.toBeVisible();
    await expect(page.getByText(t3)).not.toBeVisible();
  });
});

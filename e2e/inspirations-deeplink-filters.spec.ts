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
 * Batch H — deeplink filtres via URL params. Couvre :
 *   - Ouverture URL pré-filtrée → filtres restaurés post-hydration
 *   - Toggle filter via UI → URL synchronisée
 *   - Reset → URL nettoyée des filter params
 */
test.describe("Inspirations — deeplink filtres", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.inspirations.cleanupTestInspirations, {});
  });

  test("URL pré-filtrée applique au load + reset nettoie URL", async ({
    page,
  }) => {
    const tTik = `Deeplink TikTok ${Date.now()}`;
    const tIg = `Deeplink IG ${Date.now()}`;
    const tYt = `Deeplink YT ${Date.now()}`;

    await convex.mutation(api.inspirations.createInspiration, {
      url: "https://www.tiktok.com/@user/video/7000000300",
      type: "video",
      plateforme: "TikTok",
      titre: tTik,
      notes: `${E2E_MARKER} deeplink TK`,
    });
    await convex.mutation(api.inspirations.createInspiration, {
      url: "https://www.instagram.com/reel/deeplink/",
      type: "video",
      plateforme: "Instagram",
      titre: tIg,
      notes: `${E2E_MARKER} deeplink IG`,
    });
    await convex.mutation(api.inspirations.createInspiration, {
      url: "https://www.youtube.com/shorts/deeplink",
      type: "video",
      plateforme: "YouTube",
      titre: tYt,
      notes: `${E2E_MARKER} deeplink YT`,
    });

    // Deeplink : URL pré-filtrée par plateforme TikTok
    await page.goto("/inspirations?plateformes=TikTok");

    // Hydration : TikTok visible, autres masqués
    await expect(page.getByText(tTik).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(tIg)).not.toBeVisible();
    await expect(page.getByText(tYt)).not.toBeVisible();

    // Bouton Filtres : badge "1" affiché
    await expect(
      page.getByRole("button", { name: /^filtres/i }),
    ).toContainText("1");

    // Le panel Filtres est auto-ouvert (deeplink)
    await expect(
      page.getByText("Plateforme", { exact: true }),
    ).toBeVisible();

    // Click Réinitialiser → URL nettoyée
    await page.getByRole("button", { name: /réinitialiser/i }).click();
    await expect(page).not.toHaveURL(/plateformes=/);
    await expect(page).not.toHaveURL(/favorites=/);
    // Toutes les cards reviennent
    await expect(page.getByText(tTik).first()).toBeVisible();
    await expect(page.getByText(tIg).first()).toBeVisible();
    await expect(page.getByText(tYt).first()).toBeVisible();
  });
});

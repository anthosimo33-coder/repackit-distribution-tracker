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
 * Bouton "Ouvrir" (lien externe ↗) sur les cards d'inspiration ayant une URL.
 *
 * Couvre :
 *   - Grid : lien présent, href/target/rel corrects
 *   - Grid : click "Ouvrir" ouvre un nouvel onglet SANS ouvrir le Dialog edit
 *     (isolation stopPropagation)
 *   - List : lien présent, href/target/rel corrects
 *
 * Note : l'absence du bouton « sans URL » n'est pas testée e2e — l'URL est
 * requise non-vide côté mutation (createInspiration throw si vide), donc une
 * inspiration sans URL n'existe pas en pratique. Le rendu conditionnel
 * (hasUrl) reste un garde défensif.
 */
test.describe("Inspirations — bouton Ouvrir (lien externe)", () => {
  const url = "https://www.tiktok.com/@user/video/7000000900";

  test.beforeEach(async () => {
    await convex.mutation(api.inspirations.cleanupTestInspirations, { secret: E2E_SECRET });
  });

  test("grid : lien présent, attributs corrects, isolé du click card", async ({
    page,
  }) => {
    const titre = `Open link ${Date.now()}`;
    await convex.mutation(api.inspirations.createInspiration, {
      url,
      type: "video",
      plateforme: "TikTok",
      titre,
      notes: `${E2E_MARKER} open link`,
    });

    await page.goto(adminPath("/inspirations"));

    const card = page.getByRole("button", { name: new RegExp(titre, "i") });
    await expect(card).toBeVisible({ timeout: 5000 });

    const openLink = card.getByRole("link", { name: /ouvrir la publication/i });
    await expect(openLink).toBeVisible();
    await expect(openLink).toHaveAttribute("href", url);
    await expect(openLink).toHaveAttribute("target", "_blank");
    await expect(openLink).toHaveAttribute("rel", "noopener noreferrer");

    // Click "Ouvrir" → nouvel onglet, mais PAS le Dialog edit de la card.
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      openLink.click(),
    ]);
    await popup.close();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("list : lien présent, attributs corrects", async ({ page }) => {
    const titre = `Open link list ${Date.now()}`;
    await convex.mutation(api.inspirations.createInspiration, {
      url,
      type: "video",
      plateforme: "TikTok",
      titre,
      notes: `${E2E_MARKER} open link list`,
    });

    await page.goto(adminPath("/inspirations?view=list"));

    const row = page.getByRole("row", { name: new RegExp(titre, "i") });
    await expect(row).toBeVisible({ timeout: 5000 });

    const openLink = row.getByRole("link", { name: /ouvrir la publication/i });
    await expect(openLink).toBeVisible();
    await expect(openLink).toHaveAttribute("href", url);
    await expect(openLink).toHaveAttribute("target", "_blank");
    await expect(openLink).toHaveAttribute("rel", "noopener noreferrer");
  });
});

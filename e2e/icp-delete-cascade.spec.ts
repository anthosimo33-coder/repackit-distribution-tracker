import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

async function createShort(args: {
  carouselId: string;
  icpId: string;
  ts: number;
}) {
  await convex.mutation(api.publications.createPublication, {
    carouselId: args.carouselId,
    hookId: null,
    hookText: `${E2E_MARKER} hook ${args.carouselId}`,
    mecanique: "Erreur",
    niveau: "Broad-A",
    angleTonal: "Psycho",
    langue: "FR",
    mediaType: "short",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icpId: args.icpId as any,
    plateformes: ["TikTok"],
    compte: "@e2e_casc",
    datePubli: args.ts,
    notes: `${E2E_MARKER} cascade`,
  });
}

/**
 * Suppression d'un ICP avec cascade unset : les Shorts assignés sont
 * désassignés (ICP = "—"), pas supprimés.
 */
test.describe("ICP — suppression cascade", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.icps.cleanupTestIcps, {});
  });

  test("delete ICP → 2 Shorts désassignés", async ({ page }) => {
    const ts = Date.now();
    const icpName = `${E2E_MARKER} Cascade ${ts}`;
    const c1 = `E2E${ts}A`;
    const c2 = `E2E${ts}B`;

    const icpId = await convex.mutation(api.icps.createIcp, { nom: icpName });
    await createShort({ carouselId: c1, icpId, ts });
    await createShort({ carouselId: c2, icpId, ts });

    await page.goto("/comptes?view=icps");

    const row = page.locator("ul > li").filter({ hasText: icpName });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row.getByText(/2 shorts/i)).toBeVisible();

    await row.getByRole("button", { name: /supprimer/i }).click();
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/2 shorts seront désassignés/i);
    await alert.getByRole("button", { name: /^supprimer$/i }).click();
    await expect(alert).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.locator("ul > li").filter({ hasText: icpName }),
    ).not.toBeVisible();

    // Les 2 Shorts restent, sans ICP.
    await page.goto("/shorts");
    const r1 = page.getByRole("row").filter({ hasText: c1 });
    const r2 = page.getByRole("row").filter({ hasText: c2 });
    await expect(r1).toBeVisible({ timeout: 5000 });
    await expect(r2).toBeVisible();
    await expect(r1).not.toContainText(icpName);
    await expect(r2).not.toContainText(icpName);
  });
});

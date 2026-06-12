import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

async function createShort(carouselId: string, icpId: string, ts: number) {
  await convex.mutation(api.publications.createPublication, {
    carouselId,
    hookId: null,
    hookText: `${E2E_MARKER} hook ${carouselId}`,
    mecanique: "Erreur",
    niveau: "Broad-A",
    angleTonal: "Psycho",
    langue: "FR",
    mediaType: "short",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icpId: icpId as any,
    plateformes: ["TikTok"],
    compte: "@e2e_filter",
    datePubli: ts,
    notes: `${E2E_MARKER} filter`,
  });
}

/**
 * Filtre ICP sur /shorts (FilterMultiSelect). 2 ICPs + 3 Shorts (2 sur ICP1,
 * 1 sur ICP2) → le filtre restreint la liste à l'ICP sélectionné.
 */
test.describe("Short — filtre par ICP", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.icps.cleanupTestIcps, { secret: E2E_SECRET });
  });

  test("filtre ICP1 (2 Shorts) puis ICP2 (1 Short)", async ({ page }) => {
    const ts = Date.now();
    const icp1 = await convex.mutation(api.icps.createIcp, {
      nom: `${E2E_MARKER} ICP1 ${ts}`,
    });
    const icp2 = await convex.mutation(api.icps.createIcp, {
      nom: `${E2E_MARKER} ICP2 ${ts}`,
    });
    const a = `E2E${ts}A`;
    const b = `E2E${ts}B`;
    const c = `E2E${ts}C`;
    await createShort(a, icp1, ts);
    await createShort(b, icp1, ts);
    await createShort(c, icp2, ts);

    await page.goto("/shorts");

    const icpFilter = page
      .locator("label")
      .filter({ hasText: /^ICP$/ })
      .locator("xpath=..")
      .getByRole("combobox");
    await icpFilter.waitFor({ state: "visible", timeout: 5000 });

    // Filtre ICP1 → a + b visibles, c masqué.
    await icpFilter.click();
    await page.getByRole("option", { name: `ICP1 ${ts}` }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("row").filter({ hasText: a })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole("row").filter({ hasText: b })).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: c }),
    ).toHaveCount(0);

    // Bascule sur ICP2 → c visible, a masqué.
    await icpFilter.click();
    await page.getByRole("option", { name: `ICP1 ${ts}` }).click(); // déselect
    await page.getByRole("option", { name: `ICP2 ${ts}` }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("row").filter({ hasText: c })).toBeVisible({
      timeout: 5000,
    });
    await expect(
      page.getByRole("row").filter({ hasText: a }),
    ).toHaveCount(0);
  });
});

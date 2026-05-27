import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);

test.describe("Filtre statut /comptes", () => {
  test("Tous / Actifs / Warmup / Shadowban", async ({ page }) => {
    const ts = Date.now();
    const aHandle = `@e2e_flt_actif_${ts}`;
    const wHandle = `@e2e_flt_warmup_${ts}`;
    const sHandle = `@e2e_flt_shadow_${ts}`;
    await convex.mutation(api.comptes.createCompte, {
      handle: aHandle,
      plateforme: "TikTok",
      notes: "[E2E_TEST] filter actif",
    });
    await convex.mutation(api.comptes.createCompte, {
      handle: wHandle,
      plateforme: "TikTok",
      notes: "[E2E_TEST] filter warmup",
      status: "warmup",
      warmupStartedAt: Date.now(),
    });
    await convex.mutation(api.comptes.createCompte, {
      handle: sHandle,
      plateforme: "TikTok",
      notes: "[E2E_TEST] filter shadow",
      status: "shadowban",
    });

    await page.goto("/comptes");
    const rowA = page.getByRole("row").filter({ hasText: aHandle });
    const rowW = page.getByRole("row").filter({ hasText: wHandle });
    const rowS = page.getByRole("row").filter({ hasText: sHandle });

    const filter = page.getByRole("combobox", { name: /filtrer par statut/i });
    async function setFilter(label: string) {
      await filter.click();
      await page.getByRole("option", { name: label, exact: true }).click();
    }

    // Tous : les 3 visibles.
    await expect(rowA).toBeVisible();
    await expect(rowW).toBeVisible();
    await expect(rowS).toBeVisible();

    // Actifs.
    await setFilter("Actifs");
    await expect(rowA).toBeVisible();
    await expect(rowW).toBeHidden();
    await expect(rowS).toBeHidden();

    // Warmup.
    await setFilter("Warmup");
    await expect(rowW).toBeVisible();
    await expect(rowA).toBeHidden();
    await expect(rowS).toBeHidden();

    // Shadowban.
    await setFilter("Shadowban");
    await expect(rowS).toBeVisible();
    await expect(rowA).toBeHidden();
    await expect(rowW).toBeHidden();
  });
});

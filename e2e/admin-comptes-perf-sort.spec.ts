import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * P5 — /admin/[slug]/comptes : colonnes de performance triables. Le tri ne doit
 * pas casser sur un compte SANS publication (perf = 0 vues / 0 posts / —).
 */
test.describe("Admin comptes — tri performance", () => {
  test("trier par chaque colonne perf avec un compte 0 publication", async ({
    page,
  }) => {
    const ts = Date.now();
    const handle = `@e2eperf${ts}`;
    await convex.mutation(api.comptes.createCompte, {
      handle,
      plateforme: "TikTok",
      notes: "[E2E_TEST] perf sort",
    });

    await page.goto(adminPath("/comptes"));
    const row = page.getByRole("row").filter({ hasText: handle });
    await expect(row).toBeVisible({ timeout: 8000 });

    // Tri par chaque colonne perf → pas de crash, la row reste rendue.
    // Les en-têtes triables sont des boutons dont le nom = le libellé visible.
    for (const col of ["Vues", "Posts", "Dernier post"]) {
      await page.getByRole("button", { name: col, exact: true }).click();
      await expect(row).toBeVisible();
    }

    // Compte sans publication : 0 vues / 0 posts.
    await expect(row.getByRole("cell").filter({ hasText: /^0$/ })).toHaveCount(
      2,
    );
  });
});

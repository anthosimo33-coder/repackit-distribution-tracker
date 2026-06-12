import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const DAY = 86_400_000;

test.describe("Warmup décompte adaptatif par plateforme", () => {
  test("J+4 sur TikTok/Instagram/YouTube + passer YouTube en actif", async ({
    page,
  }) => {
    const ts = Date.now();
    // 4 jours + 6h pour rester franchement dans la tranche J+4 (évite le bord).
    const started = Date.now() - (4 * DAY + 6 * 3_600_000);
    const tk = `@e2e_wp_tk_${ts}`;
    const ig = `@e2e_wp_ig_${ts}`;
    const yt = `@e2e_wp_yt_${ts}`;
    const trio = [
      [tk, "TikTok"],
      [ig, "Instagram"],
      [yt, "YouTube"],
    ] as const;
    for (const [handle, plateforme] of trio) {
      await convex.mutation(api.comptes.createCompte, {
        handle,
        plateforme,
        notes: "[E2E_TEST] warmup by platform",
        status: "warmup",
        warmupStartedAt: started,
      });
    }

    await page.goto("/comptes");
    const rowTk = page.getByRole("row").filter({ hasText: tk });
    const rowIg = page.getByRole("row").filter({ hasText: ig });
    const rowYt = page.getByRole("row").filter({ hasText: yt });

    // Décompte adaptatif : N varie selon la plateforme.
    await expect(rowTk.getByText("Warmup J+4/7")).toBeVisible();
    await expect(rowIg.getByText("Warmup J+4/14")).toBeVisible();
    // YouTube (3 jours) : J+4 dépasse la durée → "À valider".
    await expect(rowYt.getByText("À valider")).toBeVisible();

    // YouTube → dialog → bouton "Passer en actif" présent.
    await rowYt.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Modifier" }).click();
    const dialog = page.getByRole("dialog");
    const passerBtn = dialog.getByRole("button", { name: /passer en actif/i });
    await expect(passerBtn).toBeVisible();
    await passerBtn.click();
    await expect(dialog).toBeHidden();

    // Le badge YouTube devient "Actif".
    await expect(rowYt.getByText("Actif", { exact: true })).toBeVisible();
  });
});

import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const ymd = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const DAY = 86_400_000;

test.describe("Warmup décompte adaptatif par plateforme (par checks réels)", () => {
  test("dénominateur adaptatif + complétion par checks → 'À valider'", async ({
    page,
  }) => {
    const ts = Date.now();
    // Chantier B — le décompte est fondé sur les CHECKS, pas le calendaire :
    // 0 check → « Warmup J+0/N » quel que soit warmupStartedAt.
    const started = ts - 2 * DAY;
    const tk = `@e2e_wp_tk_${ts}`;
    const ig = `@e2e_wp_ig_${ts}`;
    const yt = `@e2e_wp_yt_${ts}`;
    const ids: Record<string, Id<"comptes">> = {};
    const trio = [
      [tk, "TikTok"],
      [ig, "Instagram"],
      [yt, "YouTube"],
    ] as const;
    for (const [handle, plateforme] of trio) {
      ids[handle] = await convex.mutation(api.comptes.createCompte, {
        handle,
        plateforme,
        notes: "[E2E_TEST] warmup by platform",
        status: "warmup",
        warmupStartedAt: started,
      });
    }

    await page.goto(adminPath("/comptes"));
    const rowTk = page.getByRole("row").filter({ hasText: tk });
    const rowIg = page.getByRole("row").filter({ hasText: ig });
    const rowYt = page.getByRole("row").filter({ hasText: yt });

    // Décompte adaptatif : N varie selon la plateforme (TikTok=7, YouTube=7,
    // Instagram=14). 0 check → numérateur 0 (PAS « À valider », malgré J+2).
    await expect(rowTk.getByText("Warmup J+0/7")).toBeVisible();
    await expect(rowYt.getByText("Warmup J+0/7")).toBeVisible();
    await expect(rowIg.getByText("Warmup J+0/14")).toBeVisible();

    // Poser 7 checks réels sur YouTube (durée 7) → warmup TERMINÉ par les checks.
    await convex.mutation(api.comptes.e2eSetWarmupChecks, {
      secret: E2E_SECRET,
      id: ids[yt],
      dailyChecks: [7, 6, 5, 4, 3, 2, 1].map((d) => ymd(ts - d * DAY)),
    });
    await page.reload();
    await expect(rowYt.getByText("À valider")).toBeVisible();

    // YouTube → dialog → bouton "Passer en actif" (apparaît car warmup complet).
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

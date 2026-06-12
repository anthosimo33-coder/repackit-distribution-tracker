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
 * Renommage en cascade : 1 source partagée par 3 Shorts (TikTok / Instagram /
 * YouTube) → le rename met à jour les 3 publications. Vérifie la couverture
 * 3/3 sur le nouveau nom + les 3 lignes /shorts.
 */
test.describe("Source rename — cascade 3 plateformes", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.icps.cleanupTestIcps, { secret: E2E_SECRET });
  });

  test("renomme une source partagée sur 3 plateformes", async ({ page }) => {
    const ts = Date.now();
    const src = `cascade_${ts}`;
    const newSrc = `cascade_renamed_${ts}`;
    const icpId = await convex.mutation(api.icps.createIcp, {
      nom: `${E2E_MARKER} casc ${ts}`,
    });
    const base = {
      hookId: null,
      hookText: `${E2E_MARKER} hook ${ts}`,
      mecanique: "Erreur" as const,
      niveau: "Broad-A" as const,
      angleTonal: "Psycho" as const,
      langue: "FR" as const,
      mediaType: "short" as const,
      icpId,
      datePubli: ts,
      notes: `${E2E_MARKER} cascade`,
      sourceId: src,
    };
    // 3 plateformes distinctes → aucune collision au create (la contrainte
    // n'est QUE par plateforme).
    await convex.mutation(api.publications.createPublication, {
      ...base,
      carouselId: `E2ECAS${ts}T`,
      plateformes: ["TikTok"],
      compte: "@e2e_casc_tt",
    });
    await convex.mutation(api.publications.createPublication, {
      ...base,
      carouselId: `E2ECAS${ts}I`,
      plateformes: ["Instagram"],
      compte: "@e2e_casc_ig",
    });
    await convex.mutation(api.publications.createPublication, {
      ...base,
      carouselId: `E2ECAS${ts}Y`,
      plateformes: ["YouTube"],
      compte: "@e2e_casc_yt",
    });

    await page.goto("/shorts/sources");
    await page
      .getByRole("button", { name: `Renommer la source ${src}` })
      .click();

    const dialog = page.getByRole("dialog", { name: /renommer la source/i });
    await expect(dialog).toBeVisible();
    // Le warning cascade annonce bien 3 publications.
    await expect(dialog.getByText(/3 publication/i)).toBeVisible();
    await dialog.getByLabel("Nouveau nom").fill(newSrc);
    await dialog
      .getByRole("button", { name: /confirmer le renommage/i })
      .click();

    await expect(page.getByText(/3 publications renommées/i)).toBeVisible({
      timeout: 5000,
    });

    // Matrice : la ligne du nouveau nom a une couverture 3/3.
    const row = page.getByRole("row").filter({ hasText: newSrc });
    await expect(row).toBeVisible();
    await expect(row.getByText("3/3")).toBeVisible();

    // /shorts : 3 publications portent le nouveau sourceId.
    await page.goto("/shorts");
    await expect(page.getByText(newSrc)).toHaveCount(3, { timeout: 5000 });
  });
});

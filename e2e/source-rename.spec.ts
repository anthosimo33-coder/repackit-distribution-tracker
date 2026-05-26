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
 * Renommage simple d'un sourceId depuis /shorts/sources : 1 Short sur TikTok,
 * renommé via le dialog → cascade visible sur /shorts/sources + colonne Source
 * de /shorts.
 */
test.describe("Source rename — renommage simple", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.icps.cleanupTestIcps, {});
  });

  test("renomme une source sur 1 plateforme + reflet /shorts", async ({
    page,
  }) => {
    const ts = Date.now();
    const oldSrc = `rename_old_${ts}`;
    const newSrc = `rename_new_${ts}`;
    const carouselId = `E2EREN${ts}`;
    const icpId = await convex.mutation(api.icps.createIcp, {
      nom: `${E2E_MARKER} ren ${ts}`,
    });
    await convex.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: `${E2E_MARKER} hook ${ts}`,
      mecanique: "Erreur",
      niveau: "Broad-A",
      angleTonal: "Psycho",
      langue: "FR",
      mediaType: "short",
      icpId,
      plateformes: ["TikTok"],
      compte: "@e2e_rename",
      datePubli: ts,
      notes: `${E2E_MARKER} rename`,
      sourceId: oldSrc,
    });

    await page.goto("/shorts/sources");
    await page
      .getByRole("button", { name: `Renommer la source ${oldSrc}` })
      .click();

    const dialog = page.getByRole("dialog", { name: /renommer la source/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nouveau nom").fill(newSrc);
    await expect(dialog.getByText(/nouveau nom disponible/i)).toBeVisible();
    await dialog
      .getByRole("button", { name: /confirmer le renommage/i })
      .click();

    // Toast succès + cascade matrice (ancien nom disparu, nouveau présent).
    await expect(page.getByText(/1 publication renommée/i)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText(newSrc)).toBeVisible();
    await expect(page.getByText(oldSrc)).toHaveCount(0);

    // /shorts : la colonne Source affiche le nouveau nom.
    await page.goto("/shorts");
    await expect(page.getByText(newSrc).first()).toBeVisible({
      timeout: 5000,
    });
  });
});

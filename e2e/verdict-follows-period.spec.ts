import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);
const DAY = 86_400_000;

test.describe("Verdict suit la période sélectionnée", () => {
  test("J+1 = FOLD, J+7 = WINNER selon le save rate du snapshot", async ({
    page,
  }) => {
    // Compte
    await page.goto("/comptes");
    if (
      (await page
        .getByRole("cell", { name: "@test_e2e_verdict" })
        .count()) === 0
    ) {
      await page.getByRole("button", { name: /ajouter un compte/i }).click();
      await page.getByLabel("Handle").fill("test_e2e_verdict");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "TikTok" }).click();
      await page.getByLabel("Notes").fill("[E2E_TEST] verdict");
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.getByRole("cell", { name: "@test_e2e_verdict" }),
      ).toBeVisible();
    }

    const datePubli = Date.now() - 20 * DAY;
    const carouselId = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    const { ids } = await convex.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: "Hook E2E verdict période",
      mecanique: "Erreur",
      niveau: "Broad-A",
      mediaType: "carousel",
      format: "A",
      nbSlides: 7,
      slides: Array.from({ length: 7 }, (_, i) => ({
        position: i + 1,
        texte: i === 0 ? "S1" : "",
      })),
      angleTonal: "Psycho",
      langue: "FR",
      plateformes: ["TikTok"],
      compte: "@test_e2e_verdict",
      datePubli,
      notes: "[E2E_TEST] verdict",
    });
    const pubId = ids[0];
    await convex.mutation(api.publications.updateMetrics, {
      id: pubId,
      postUrl: "https://www.tiktok.com/@test_e2e_verdict/video/1",
    });
    // J+1 : 5/1000 = 0,5 % → FOLD. J+7 : 40/1000 = 4 % → WINNER.
    await convex.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: pubId,
      capturedAt: datePubli + 1 * DAY,
      vues: 1000,
      likes: 0,
      saves: 5,
    });
    await convex.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: pubId,
      capturedAt: datePubli + 7 * DAY,
      vues: 1000,
      likes: 0,
      saves: 40,
    });

    await page.goto("/carrousels");
    const row = page
      .getByRole("row")
      .filter({ hasText: "Hook E2E verdict période" })
      .first();

    // J+1 → FOLD + 0,50 %.
    await page.getByRole("radio", { name: "J+1", exact: true }).click();
    await expect(row.getByText("FOLD", { exact: true })).toBeVisible();
    await expect(row.getByText("0,50 %")).toBeVisible();

    // J+7 → WINNER + 4,00 %.
    await page.getByRole("radio", { name: "J+7", exact: true }).click();
    await expect(row.getByText("WINNER", { exact: true })).toBeVisible();
    await expect(row.getByText("4,00 %")).toBeVisible();

    await convex.mutation(api.publications.deletePublication, { id: pubId });
  });
});

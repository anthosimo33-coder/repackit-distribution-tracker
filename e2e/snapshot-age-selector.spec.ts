import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);
const DAY = 86_400_000;

async function ensureCompte(page: import("@playwright/test").Page, handle: string) {
  await page.goto("/comptes");
  if ((await page.getByRole("cell", { name: `@${handle}` }).count()) === 0) {
    await page.getByRole("button", { name: /ajouter un compte/i }).first().click();
    await page.getByLabel("Handle").fill(handle);
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "TikTok" }).click();
    await page.getByLabel("Notes").fill("[E2E_TEST] snapage");
    await page.getByRole("button", { name: /^ajouter$/i }).click();
    await expect(page.getByRole("cell", { name: `@${handle}` })).toBeVisible();
  }
}

test.describe("SnapshotAgeSelector", () => {
  test("pilote les vues affichées + persiste en localStorage", async ({
    page,
  }) => {
    await ensureCompte(page, "test_e2e_snapage");

    const datePubli = Date.now() - 40 * DAY;
    const carouselId = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    const { ids } = await convex.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: "Hook E2E snapage",
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
      compte: "@test_e2e_snapage",
      datePubli,
      notes: "[E2E_TEST] snapage",
    });
    const pubId = ids[0];
    await convex.mutation(api.publications.updateMetrics, {
      id: pubId,
      postUrl: "https://www.tiktok.com/@test_e2e_snapage/video/1",
    });
    // 3 snapshots à J+1 / J+7 / J+30 avec des vues distinctes (< 1000 pour
    // éviter les séparateurs de milliers dans l'assertion texte).
    await convex.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: pubId,
      capturedAt: datePubli + 1 * DAY,
      vues: 100,
      likes: 0,
    });
    await convex.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: pubId,
      capturedAt: datePubli + 7 * DAY,
      vues: 700,
      likes: 0,
    });
    await convex.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: pubId,
      capturedAt: datePubli + 30 * DAY,
      vues: 300,
      likes: 0,
    });

    await page.goto("/carrousels");
    const row = page
      .getByRole("row")
      .filter({ hasText: "Hook E2E snapage" })
      .first();

    // Défaut Latest → snapshot J+30 (capturedAt max) → 300.
    await expect(
      page.getByRole("radio", { name: "Latest" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(row.getByText("300", { exact: true })).toBeVisible();

    // J+7 → 700.
    await page.getByRole("radio", { name: "J+7", exact: true }).click();
    await expect(row.getByText("700", { exact: true })).toBeVisible();

    // J+1 → 100.
    await page.getByRole("radio", { name: "J+1", exact: true }).click();
    await expect(row.getByText("100", { exact: true })).toBeVisible();

    // Reload → la période J+1 est restaurée depuis localStorage.
    await page.reload();
    const row2 = page
      .getByRole("row")
      .filter({ hasText: "Hook E2E snapage" })
      .first();
    await expect(
      page.getByRole("radio", { name: "J+1", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(row2.getByText("100", { exact: true })).toBeVisible();

    await convex.mutation(api.publications.deletePublication, { id: pubId });
  });
});

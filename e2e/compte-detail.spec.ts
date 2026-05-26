import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);
const DAY = 86_400_000;

const HANDLE = "@test_e2e_detail";

async function ensureCompte() {
  const all = await convex.query(api.comptes.listComptes, {});
  const found = all.find((c) => c.handle === HANDLE && c.plateforme === "TikTok");
  if (found) {
    if (!found.actif) {
      await convex.mutation(api.comptes.updateCompte, {
        id: found._id,
        actif: true,
      });
    }
    return found._id;
  }
  return await convex.mutation(api.comptes.createCompte, {
    handle: HANDLE,
    plateforme: "TikTok",
    notes: "[E2E_TEST] detail",
  });
}

async function seedCarousel(opts: {
  hookText: string;
  datePubli: number;
  published?: boolean;
}) {
  const carouselId = await convex.query(api.publications.getNextCarouselId, {});
  const { ids } = await convex.mutation(api.publications.createPublication, {
    carouselId,
    hookId: null,
    hookText: opts.hookText,
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
    compte: HANDLE,
    datePubli: opts.datePubli,
    notes: "[E2E_TEST] detail carousel",
  });
  if (opts.published) {
    await convex.mutation(api.publications.updateMetrics, {
      id: ids[0],
      postUrl: `https://www.tiktok.com/${HANDLE}/video/1`,
    });
    await convex.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: ids[0],
      capturedAt: opts.datePubli + 1000,
      vues: 1500,
      likes: 100,
      saves: 60,
    });
  }
  return ids[0];
}

test.describe("Vue détail compte", () => {
  test("navigation, stats, calendrier, tabs, dialog", async ({ page }) => {
    await ensureCompte();
    const icpId = await convex.mutation(api.icps.createIcp, {
      nom: "[E2E_TEST] detail icp",
    });
    const now = Date.now();

    // 1 carousel publié (today), 1 short à venir (futur), 1 carousel en retard.
    await seedCarousel({
      hookText: "HOOKDETAIL pub publie E2E",
      datePubli: now,
      published: true,
    });
    await seedCarousel({
      hookText: "HOOKDETAIL pub retard E2E",
      datePubli: now - 2 * DAY,
    });
    const shortId = await convex.query(api.publications.getNextPublicationId, {
      mediaType: "short",
    });
    await convex.mutation(api.publications.createPublication, {
      carouselId: shortId,
      hookId: null,
      hookText: "HOOKDETAIL short avenir E2E",
      mecanique: "Erreur",
      niveau: "Broad-A",
      mediaType: "short",
      angleTonal: "Psycho",
      langue: "FR",
      icpId,
      plateformes: ["TikTok"],
      compte: HANDLE,
      datePubli: now + 3 * DAY,
      notes: "[E2E_TEST] detail short",
    });

    // Navigation via la cellule handle du tableau.
    await page.goto("/comptes");
    await page.getByRole("link", { name: HANDLE }).click();
    await expect(page).toHaveURL(/\/comptes\/[a-z0-9]+/i);

    // Header.
    await expect(
      page.getByRole("heading", { name: HANDLE }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /modifier le compte/i }),
    ).toBeVisible();

    // Stats : labels présents.
    await expect(page.getByText("Publications", { exact: true })).toBeVisible();
    await expect(page.getByText("Vues totales")).toBeVisible();
    await expect(page.getByText("Likes totaux")).toBeVisible();

    // Tabs avec counts (encode le breakdown : 2 carrousels / 1 short / 0 SR).
    await expect(page.getByRole("tab", { name: /Carrousels \(2\)/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Shorts \(1\)/ })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /ScreenRecorders \(0\)/ }),
    ).toBeVisible();

    // Calendrier : badge de la publication publiée (aujourd'hui) → dialog.
    await page
      .locator('button[title*="HOOKDETAIL pub publie E2E"]')
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // Tab Shorts → la liste affiche le short du compte.
    await page.getByRole("tab", { name: /Shorts \(1\)/ }).click();
    const shortRow = page
      .getByRole("row")
      .filter({ hasText: "HOOKDETAIL short avenir E2E" });
    await expect(shortRow).toBeVisible();
    await expect(shortRow.getByText(/à venir/i)).toBeVisible();

    // Click row → dialog (draft, car non publié).
    await shortRow.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // Retour.
    await page.getByRole("link", { name: "Retour aux comptes" }).click();
    await expect(page).toHaveURL(/\/comptes$/);
  });
});

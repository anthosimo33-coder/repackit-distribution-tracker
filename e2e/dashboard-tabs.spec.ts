import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);

/**
 * Batch 3 Modif 5 — Dashboard onglets Carrousels / Shorts.
 *
 * Couvre :
 *   - Onglet par défaut Carrousels (URL sans ?mediaType)
 *   - KPIs spécifiques par onglet ("Save rate moyen" carousel vs "Subs gagnés" + "Ratio subs/vues" Shorts)
 *   - Switch onglet → URL ?mediaType=short
 *   - Top hooks segmentés par mediaType (un Short n'apparaît pas en mode carousel)
 *
 * Setup direct via ConvexHttpClient pour rester déterministe.
 */
test.describe("Dashboard — onglets Carrousels / Shorts", () => {
  test("default carousel → switch short → KPIs distincts", async ({
    page,
  }) => {
    // Cleanup défensif
    const stalePubs = await convex.query(
      api.publications.listPublications,
      {},
    );
    for (const p of stalePubs) {
      if (
        p.compte === "@test_e2e_dash_tt" ||
        p.compte === "@test_e2e_dash_yt"
      ) {
        await convex.mutation(api.publications.deletePublication, {
          id: p._id,
        });
      }
    }
    const stalleComptes = await convex.query(api.comptes.listComptes, {});
    for (const c of stalleComptes) {
      if (
        (c.handle === "@test_e2e_dash_tt" ||
          c.handle === "@test_e2e_dash_yt") &&
        !c.actif
      ) {
        await convex.mutation(api.comptes.updateCompte, {
          id: c._id,
          actif: true,
        });
      }
    }

    // Pré-requis : 2 comptes (TikTok pour carousel, YouTube pour short)
    const compteTT = stalleComptes.find(
      (c) => c.handle === "@test_e2e_dash_tt" && c.plateforme === "TikTok",
    );
    if (!compteTT) {
      await convex.mutation(api.comptes.createCompte, {
        handle: "@test_e2e_dash_tt",
        plateforme: "TikTok",
        notes: "[E2E_TEST] dash carousel",
      });
    }
    const compteYT = stalleComptes.find(
      (c) => c.handle === "@test_e2e_dash_yt" && c.plateforme === "YouTube",
    );
    if (!compteYT) {
      await convex.mutation(api.comptes.createCompte, {
        handle: "@test_e2e_dash_yt",
        plateforme: "YouTube",
        notes: "[E2E_TEST] dash short",
      });
    }

    const carouselHook = `Carousel dash E2E ${Date.now()}`;
    const shortHook = `Short dash E2E ${Date.now()}`;

    // 1 Carousel publié (saveRate = 30/1000 = 3% → WINNER)
    const cidCarousel = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    await convex.mutation(api.publications.createPublication, {
      carouselId: cidCarousel,
      hookId: null,
      hookText: carouselHook,
      mecanique: "Erreur",
      niveau: "Broad-A",
      mediaType: "carousel",
      format: "A",
      nbSlides: 7,
      slides: Array.from({ length: 7 }, (_, i) => ({
        position: i + 1,
        texte: `S${i + 1}`,
      })),
      angleTonal: "Psycho",
      langue: "FR",
      plateformes: ["TikTok"],
      compte: "@test_e2e_dash_tt",
      datePubli: Date.now(),
      notes: "[E2E_TEST] dash carousel",
    });
    const allPubs1 = await convex.query(
      api.publications.listPublications,
      {},
    );
    const carousel = allPubs1.find((p) => p.carouselId === cidCarousel);
    await convex.mutation(api.publications.updateMetrics, {
      id: carousel!._id,
      postUrl: "https://tiktok.com/@dash-c",
      saves: 30,
      vuesJ7: 1000,
    });

    // 1 Short publié (vuesJ7=2000, subsGained=50 → ratio 2.5%, likes=100)
    const cidShort = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    await convex.mutation(api.publications.createPublication, {
      carouselId: cidShort,
      hookId: null,
      hookText: shortHook,
      mecanique: "Volume",
      niveau: "Broad-B",
      mediaType: "short",
      script: "Script E2E dash short",
      angleTonal: "Pédagogique",
      langue: "FR",
      plateformes: ["YouTube"],
      compte: "@test_e2e_dash_yt",
      datePubli: Date.now() - 1000,
      notes: "[E2E_TEST] dash short",
    });
    const allPubs2 = await convex.query(
      api.publications.listPublications,
      {},
    );
    const short = allPubs2.find((p) => p.carouselId === cidShort);
    await convex.mutation(api.publications.updateMetrics, {
      id: short!._id,
      postUrl: "https://youtube.com/shorts/dash-s",
      vuesJ7: 2000,
      likes: 100,
      subsGained: 50,
    });

    await page.goto("/");

    // Onglet par défaut = Carrousels (URL sans ?mediaType). Base-ui Tabs
    // utilise aria-selected pour marquer le tab actif (pas data-state
    // comme Radix). Le test cible l'attribut ARIA standard.
    expect(page.url()).not.toContain("mediaType=");
    const carouselTab = page.getByRole("tab", { name: "Carrousels" });
    const shortTab = page.getByRole("tab", { name: "Shorts" });
    await expect(carouselTab).toHaveAttribute("aria-selected", "true");
    await expect(shortTab).toHaveAttribute("aria-selected", "false");

    // KPI carrousel "Save rate moyen" présent. .first() car le label
    // existe aussi dans PlateformeComparison (Stat dt) → strict mode.
    await expect(
      page.getByText("Save rate moyen", { exact: true }).first(),
    ).toBeVisible();

    // Top hooks visible avec le hook carousel (pas le short)
    await expect(page.getByText(carouselHook).first()).toBeVisible();
    await expect(page.getByText(shortHook)).toHaveCount(0);

    // Click onglet Shorts
    await shortTab.click();
    await expect(page).toHaveURL(/\?mediaType=short/);
    await expect(shortTab).toHaveAttribute("aria-selected", "true");

    // KPIs Shorts spécifiques visibles. .first() car les labels existent
    // aussi en columnheader du Top hooks Shorts table → strict mode.
    await expect(
      page.getByText("Subs gagnés", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Ratio subs/vues", { exact: true }).first(),
    ).toBeVisible();
    // KPI carrousel-only absent en mode Shorts (toHaveCount accepte 0
    // strict — pas de need .first()).
    await expect(
      page.getByText("Save rate moyen", { exact: true }),
    ).toHaveCount(0);

    // Top hooks Shorts visible avec le hook short (pas le carousel)
    await expect(page.getByText(shortHook).first()).toBeVisible();
    await expect(page.getByText(carouselHook)).toHaveCount(0);

    // Cleanup
    const finalPubs = await convex.query(
      api.publications.listPublications,
      {},
    );
    for (const p of finalPubs) {
      if (
        p.compte === "@test_e2e_dash_tt" ||
        p.compte === "@test_e2e_dash_yt"
      ) {
        await convex.mutation(api.publications.deletePublication, {
          id: p._id,
        });
      }
    }
  });
});

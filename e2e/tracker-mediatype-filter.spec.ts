import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);

/**
 * Batch 2 Modif 4a — filtre top-level mediaType + colonnes conditionnelles.
 *
 * Setup direct via ConvexHttpClient (déterministe, pas de dépendance UI
 * /nouveau dont la signature peut évoluer). Le test crée 1 carrousel et 1
 * Short et vérifie le rendu de la table selon les 3 modes du filtre.
 */
test.describe("Tracker — filtre mediaType + colonnes conditionnelles", () => {
  test("Tous / Carrousel / Short → rows et colonnes adaptées", async ({
    page,
  }) => {
    // Cleanup défensif (tests précédents peuvent avoir laissé des orphelins)
    const stalePubs = await convex.query(api.publications.listPublications, {});
    for (const p of stalePubs) {
      if (
        p.compte === "@test_e2e_mtfilter_tt" ||
        p.compte === "@test_e2e_mtfilter_yt"
      ) {
        await convex.mutation(api.publications.deletePublication, {
          id: p._id,
        });
      }
    }
    const allComptes = await convex.query(api.comptes.listComptes, {});
    for (const c of allComptes) {
      if (
        (c.handle === "@test_e2e_mtfilter_tt" ||
          c.handle === "@test_e2e_mtfilter_yt") &&
        !c.actif
      ) {
        await convex.mutation(api.comptes.updateCompte, {
          id: c._id,
          actif: true,
        });
      }
    }

    // Pré-requis : 2 comptes (TikTok pour le carrousel, YouTube pour le Short)
    const compteTT = allComptes.find(
      (c) => c.handle === "@test_e2e_mtfilter_tt" && c.plateforme === "TikTok",
    );
    if (!compteTT) {
      await convex.mutation(api.comptes.createCompte, {
        handle: "@test_e2e_mtfilter_tt",
        plateforme: "TikTok",
        notes: "[E2E_TEST] mtfilter TT",
      });
    }
    const compteYT = allComptes.find(
      (c) =>
        c.handle === "@test_e2e_mtfilter_yt" && c.plateforme === "YouTube",
    );
    if (!compteYT) {
      await convex.mutation(api.comptes.createCompte, {
        handle: "@test_e2e_mtfilter_yt",
        plateforme: "YouTube",
        notes: "[E2E_TEST] mtfilter YT",
      });
    }

    const carouselHook = `Carousel mtfilter E2E ${Date.now()}`;
    const shortHook = `Short mtfilter E2E ${Date.now()}`;

    // 1 Carrousel TikTok (mediaType = "carousel" explicite)
    const carouselCid = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    await convex.mutation(api.publications.createPublication, {
      carouselId: carouselCid,
      hookId: null,
      hookText: carouselHook,
      mecanique: "Erreur",
      niveau: "Broad-A",
      mediaType: "carousel",
      format: "A",
      nbSlides: 7,
      slides: Array.from({ length: 7 }, (_, i) => ({
        position: i + 1,
        texte: `Slide ${i + 1}`,
      })),
      angleTonal: "Psycho",
      langue: "FR",
      plateformes: ["TikTok"],
      compte: "@test_e2e_mtfilter_tt",
      datePubli: Date.now(),
      notes: "[E2E_TEST] mtfilter carousel",
    });

    // 1 Short YouTube (mediaType = "short")
    const shortCid = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    await convex.mutation(api.publications.createPublication, {
      carouselId: shortCid,
      hookId: null,
      hookText: shortHook,
      mecanique: "Volume",
      niveau: "Broad-B",
      mediaType: "short",
      script: "Script E2E mtfilter",
      angleTonal: "Pédagogique",
      langue: "FR",
      plateformes: ["YouTube"],
      compte: "@test_e2e_mtfilter_yt",
      datePubli: Date.now() - 1000,
      notes: "[E2E_TEST] mtfilter short",
    });

    await page.goto("/tracker");

    // Helper : la barre filtres a 7 wrappers de filtre (Format en 1ère
    // position depuis Modif 4a). Locator par label garanti insensible à
    // l'ordre.
    const formatLabel = page
      .locator("label")
      .filter({ hasText: /^Format$/ })
      .first(); // 1er = filtre top-level (le 2e dans la barre est l'ancien
    // FilterMultiSelect "Format" pour les codes A-H, conservé tel quel).
    const formatTrigger = formatLabel.locator("xpath=..").getByRole("combobox");

    // Mode "Tous" par défaut : les 2 rows visibles
    await expect(page.getByRole("row").filter({ hasText: carouselHook })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: shortHook })).toBeVisible();
    // Toutes colonnes présentes : on vérifie via les TableHead.
    await expect(
      page.getByRole("columnheader", { name: /^Format$/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /^Saves$/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /^Likes$/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /^Subs gained$/ }).first(),
    ).toBeVisible();

    // Filtre "Carrousel" → 1 row (carousel), colonnes Likes/SubsGained masquées
    await formatTrigger.click();
    await page.getByRole("option", { name: "Carrousel" }).click();
    await expect(
      page.getByRole("row").filter({ hasText: carouselHook }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: shortHook }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: /^Format$/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /^Likes$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: /^Subs gained$/ }),
    ).toHaveCount(0);

    // Filtre "Short" → 1 row (short), colonnes Format/Saves/SaveRate/Verdict masquées
    await formatTrigger.click();
    await page.getByRole("option", { name: "Short" }).click();
    await expect(
      page.getByRole("row").filter({ hasText: shortHook }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: carouselHook }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: /^Format$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: /^Saves$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: /^Save rate$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: /^Verdict$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: /^Likes$/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /^Subs gained$/ }).first(),
    ).toBeVisible();

    // Cleanup explicite (notes prefixées [E2E_TEST] → global cleanup gère
    // aussi mais on est conservateurs).
    const post = await convex.query(api.publications.listPublications, {});
    for (const p of post) {
      if (
        p.compte === "@test_e2e_mtfilter_tt" ||
        p.compte === "@test_e2e_mtfilter_yt"
      ) {
        await convex.mutation(api.publications.deletePublication, {
          id: p._id,
        });
      }
    }
  });
});

import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

/**
 * Préfixes d'ID dynamiques par mediaType : C### (carousel), S### (short),
 * SR### (screenrecorder). On vérifie (1) que le compteur getNextPublicationId
 * renvoie le bon préfixe pour chaque format, (2) que l'UID affiché dans les
 * listes reflète le préfixe. La création SR directe nécessite une image
 * (storageId) → on valide le préfixe SR au niveau compteur uniquement (le
 * flow SR complet est couvert par screenrecorder-create.spec).
 */
test.describe("Publication — préfixes d'ID par mediaType", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.icps.cleanupTestIcps, { secret: E2E_SECRET });
  });

  test("compteur C/S/SR + affichage liste", async ({ page }) => {
    const ts = Date.now();

    // (1) Compteur : préfixe correct par mediaType.
    const cId = await convex.query(api.publications.getNextPublicationId, {
      mediaType: "carousel",
    });
    const sId = await convex.query(api.publications.getNextPublicationId, {
      mediaType: "short",
    });
    const srId = await convex.query(api.publications.getNextPublicationId, {
      mediaType: "screenrecorder",
    });
    expect(cId).toMatch(/^C\d{3,}$/);
    expect(sId).toMatch(/^S\d{3,}$/);
    expect(srId).toMatch(/^SR\d{3,}$/);

    // Setup création carousel + short.
    const icpId = await convex.mutation(api.icps.createIcp, {
      nom: `${E2E_MARKER} prefix ${ts}`,
    });
    const comptes = await convex.query(api.comptes.listComptes, {});
    const handle = "@e2e_prefix";
    const existing = comptes.find(
      (c) => c.handle === handle && c.plateforme === "TikTok",
    );
    if (existing && !existing.actif) {
      await convex.mutation(api.comptes.updateCompte, {
        id: existing._id,
        actif: true,
      });
    }
    if (!existing) {
      await convex.mutation(api.comptes.createCompte, {
        handle,
        plateforme: "TikTok",
        notes: `${E2E_MARKER} prefix`,
      });
    }

    await convex.mutation(api.publications.createPublication, {
      carouselId: cId,
      hookId: null,
      hookText: `${E2E_MARKER} cprefix ${ts}`,
      mecanique: "Erreur",
      niveau: "Broad-A",
      angleTonal: "Psycho",
      langue: "FR",
      mediaType: "carousel",
      format: "A",
      nbSlides: 5,
      slides: Array.from({ length: 5 }, (_, i) => ({
        position: i + 1,
        texte: "x",
      })),
      plateformes: ["TikTok"],
      compte: handle,
      datePubli: ts,
      notes: `${E2E_MARKER} prefix`,
    });
    await convex.mutation(api.publications.createPublication, {
      carouselId: sId,
      hookId: null,
      hookText: `${E2E_MARKER} sprefix ${ts}`,
      mecanique: "Erreur",
      niveau: "Broad-A",
      angleTonal: "Psycho",
      langue: "FR",
      mediaType: "short",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      icpId: icpId as any,
      plateformes: ["TikTok"],
      compte: handle,
      datePubli: ts,
      notes: `${E2E_MARKER} prefix`,
    });

    // (2) Affichage : la liste /carrousels montre le C###, /shorts le S###.
    await page.goto(adminPath(`/carrousels?carouselId=${cId}`));
    await expect(
      page.getByRole("row").filter({ hasText: cId }),
    ).toBeVisible({ timeout: 5000 });

    await page.goto(adminPath(`/shorts?carouselId=${sId}`));
    await expect(
      page.getByRole("row").filter({ hasText: sId }),
    ).toBeVisible({ timeout: 5000 });

    // Cleanup explicite des publications (notes marquées → teardown global aussi).
    const pubs = await convex.query(api.publications.listPublications, {});
    for (const p of pubs) {
      if (p.carouselId === cId || p.carouselId === sId) {
        await convex.mutation(api.publications.deletePublication, {
          id: p._id,
        });
      }
    }
  });
});

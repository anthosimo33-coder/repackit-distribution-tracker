import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

/**
 * P3 — preuves du nouveau routing /admin/[projectSlug] :
 *  - redirects legacy (/dashboard, /carrousels?carouselId=…) → /admin/repackit/…
 *  - resolver cross-projet /p/[carouselId] → route scopée du bon projet
 *  - slug inexistant → message « Projet introuvable »
 *  - deeplink /p inconnu → 404 propre
 */
test.describe("Routing /admin — redirects & resolvers", () => {
  test("ancienne route /dashboard redirige vers /admin/repackit/dashboard", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/admin\/repackit\/dashboard/, {
      timeout: 10000,
    });
  });

  test("ancienne route /carrousels?carouselId préserve la query", async ({
    page,
  }) => {
    await page.goto("/carrousels?carouselId=C012");
    await expect(page).toHaveURL(/\/admin\/repackit\/carrousels\?carouselId=C012/, {
      timeout: 10000,
    });
  });

  test("slug inexistant → « Projet introuvable »", async ({ page }) => {
    await page.goto("/admin/zzz-projet-inexistant-999/dashboard");
    await expect(
      page.getByText("Projet introuvable"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("/p/[carouselId] résout vers la route scopée du projet accessible", async ({
    page,
  }) => {
    const ts = Date.now();
    const cId = await convex.query(api.publications.getNextPublicationId, {
      mediaType: "carousel",
    });
    await convex.mutation(api.publications.createPublication, {
      carouselId: cId,
      hookId: null,
      hookText: `${E2E_MARKER} resolver ${ts}`,
      mecanique: "Erreur",
      niveau: "Broad-A",
      angleTonal: "Psycho",
      langue: "FR",
      mediaType: "carousel",
      format: "A",
      nbSlides: 2,
      slides: [
        { position: 1, texte: "x" },
        { position: 2, texte: "y" },
      ],
      plateformes: ["TikTok"],
      compte: "@e2e_resolver",
      datePubli: ts,
      notes: `${E2E_MARKER} resolver`,
    });

    // /p/<cId> est rendu hors ProjectProvider : il cherche le carouselId dans
    // les projets accessibles (ici e2e-test) puis redirige vers la route scopée.
    await page.goto(`/p/${cId}`);
    await expect(page).toHaveURL(
      new RegExp(`/admin/e2e-test/carrousels\\?carouselId=${cId}`),
      { timeout: 10000 },
    );

    // Cleanup.
    const pubs = await convex.query(api.publications.listPublications, {});
    for (const p of pubs) {
      if (p.carouselId === cId) {
        await convex.mutation(api.publications.deletePublication, { id: p._id });
      }
    }
  });

  test("/p/[carouselId] inconnu → 404", async ({ page }) => {
    await page.goto("/p/ZZZ-inconnu-999");
    await expect(
      page.getByText("Cette page n'existe pas."),
    ).toBeVisible({ timeout: 10000 });
  });
});

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
 * P3 — création de projet (superadmin) via le switcher de sidebar + preuve
 * d'isolation UI inter-projets :
 *  - le user e2e (superadmin) crée un projet vierge depuis le switcher ;
 *  - on bascule dessus → workspace 100 % vide ;
 *  - une publication d'e2e-test n'y fuit PAS ;
 *  - retour à e2e-test via le switcher → la publication est de nouveau là.
 */
test.describe("Projets — création + switcher + isolation UI", () => {
  test("créer un projet → vide, isolé, retour au projet d'origine", async ({
    page,
  }) => {
    const ts = Date.now();
    const newSlug = `e2e-create-${ts}`;
    const newName = `E2E Create ${ts}`;

    // Publication marqueur dans le projet d'origine (e2e-test).
    const cId = await convex.query(api.publications.getNextPublicationId, {
      mediaType: "carousel",
    });
    await convex.mutation(api.publications.createPublication, {
      carouselId: cId,
      hookId: null,
      hookText: `${E2E_MARKER} isolation ${ts}`,
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
      compte: "@e2e_isolation",
      datePubli: ts,
      notes: `${E2E_MARKER} isolation`,
    });

    try {
      // Baseline : la pub est visible dans e2e-test.
      await page.goto(adminPath(`/carrousels?carouselId=${cId}`));
      await expect(
        page.getByRole("row").filter({ hasText: cId }),
      ).toBeVisible({ timeout: 8000 });

      // Switcher → « Créer un projet » → modal.
      await page
        .getByRole("button", { name: "Changer de projet" })
        .click();
      await page
        .getByRole("menuitem", { name: "Créer un projet" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Créer un projet" }),
      ).toBeVisible();
      await page.getByLabel("Nom").fill(newName);
      await page.getByLabel("Slug").fill(newSlug);
      await page.getByRole("button", { name: "Créer le projet" }).click();

      // Bascule auto sur le nouveau projet → dashboard vide.
      await expect(page).toHaveURL(
        new RegExp(`/admin/${newSlug}/dashboard`),
        { timeout: 10000 },
      );
      // Refonte dashboard : l'arrivée par défaut est la vue ACTION ; un projet
      // neuf (0 créateur, 0 soumission) affiche l'état d'accueil vide.
      await expect(
        page.getByText("Invite tes premiers créateurs pour commencer"),
      ).toBeVisible({ timeout: 10000 });

      // Isolation : la pub d'e2e-test n'apparaît PAS dans le nouveau projet.
      await page.goto(`/admin/${newSlug}/carrousels`);
      await expect(
        page.getByRole("heading", { name: "Carrousels", level: 1 }),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByRole("row").filter({ hasText: cId }),
      ).toHaveCount(0);

      // Retour à e2e-test via le switcher.
      await page
        .getByRole("button", { name: "Changer de projet" })
        .click();
      await page
        .getByRole("menuitem", { name: "E2E Test", exact: true })
        .click();
      await expect(page).toHaveURL(/\/admin\/e2e-test\/dashboard/, {
        timeout: 10000,
      });

      // Données intactes : la pub est de nouveau visible côté e2e-test.
      await page.goto(adminPath(`/carrousels?carouselId=${cId}`));
      await expect(
        page.getByRole("row").filter({ hasText: cId }),
      ).toBeVisible({ timeout: 8000 });
    } finally {
      const pubs = await convex.query(api.publications.listPublications, {});
      for (const p of pubs) {
        if (p.carouselId === cId) {
          await convex.mutation(api.publications.deletePublication, {
            id: p._id,
          });
        }
      }
      await convex.mutation(api.projects.e2eDeleteProject, {
        secret: E2E_SECRET,
        slug: newSlug,
      });
    }
  });
});

import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const HANDLE = "@test_e2e_cal";

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
    notes: "[E2E_TEST] cal",
  });
}

async function seedCarousel(hookText: string, datePubli: number) {
  const carouselId = await convex.query(api.publications.getNextCarouselId, {});
  await convex.mutation(api.publications.createPublication, {
    carouselId,
    hookId: null,
    hookText,
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
    datePubli,
    notes: "[E2E_TEST] cal carousel",
  });
}

test.describe("Calendrier vue détail compte — navigation mois", () => {
  test("flèches boutons + clavier changent de mois", async ({ page }) => {
    const compteId = await ensureCompte();
    const now = new Date();
    const midThis = new Date(now.getFullYear(), now.getMonth(), 15, 12).getTime();
    const midNext = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      15,
      12,
    ).getTime();

    await seedCarousel("HOOKCAL mois courant E2E", midThis);
    await seedCarousel("HOOKCAL mois suivant E2E", midNext);

    await page.goto(`/comptes/${compteId}`);

    const badgeThis = page.locator(
      'button[title*="HOOKCAL mois courant E2E"]',
    );
    const badgeNext = page.locator(
      'button[title*="HOOKCAL mois suivant E2E"]',
    );

    // Mois courant par défaut.
    await expect(badgeThis).toBeVisible();
    await expect(badgeNext).toHaveCount(0);

    // Bouton mois suivant.
    await page.getByRole("button", { name: "Mois suivant" }).click();
    await expect(badgeNext).toBeVisible();
    await expect(badgeThis).toHaveCount(0);

    // Clavier ← : retour mois courant.
    await page.keyboard.press("ArrowLeft");
    await expect(badgeThis).toBeVisible();
    await expect(badgeNext).toHaveCount(0);

    // Clavier → : mois suivant.
    await page.keyboard.press("ArrowRight");
    await expect(badgeNext).toBeVisible();
    await expect(badgeThis).toHaveCount(0);
  });
});

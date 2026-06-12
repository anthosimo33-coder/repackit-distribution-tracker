import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const HANDLE = "@test_e2e_rename";

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
    notes: "[E2E_TEST] rename",
  });
}

test.describe("Garde-fou rename compte", () => {
  test("renommer un handle utilisé est refusé", async ({ page }) => {
    await ensureCompte();
    // 1 publication utilise ce handle → rename doit être bloqué côté serveur.
    const carouselId = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    await convex.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: "Hook rename guard E2E",
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
      datePubli: Date.now(),
      notes: "[E2E_TEST] rename guard",
    });

    await page.goto(adminPath("/comptes"));

    // Ouvre Modifier via le menu d'actions de la ligne.
    const row = page.getByRole("row").filter({ hasText: HANDLE });
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Modifier" }).click();

    // Tente le rename.
    await page.getByLabel("Handle").fill("test_e2e_rename_changed");
    await page.getByRole("button", { name: /^enregistrer$/i }).click();

    // Toast d'erreur du garde-fou serveur. Scopé au toaster sonner : le même
    // message apparaît aussi dans l'overlay d'erreur dev de Next (Convex logue
    // les erreurs de mutation en console), à ne pas matcher.
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /Impossible de renommer ce compte/i }),
    ).toBeVisible();

    // Vérification autoritative côté base : le handle n'a pas changé.
    const after = await convex.query(api.comptes.listComptes, {});
    expect(after.some((c) => c.handle === HANDLE)).toBe(true);
    expect(
      after.some((c) => c.handle === "@test_e2e_rename_changed"),
    ).toBe(false);
  });
});

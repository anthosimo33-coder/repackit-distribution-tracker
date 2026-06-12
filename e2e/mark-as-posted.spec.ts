import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Modif 4 — raccourci 1-clic "Marquer comme posté" sur les drafts.
 *
 * Batch C : setup du draft via ConvexHttpClient (vs ancien flow /nouveau
 * qui n'existe plus). Le test couvre toujours le dropdown → dialog → URL →
 * row en Publié.
 */
test.describe("Tracker — Marquer comme posté (raccourci 1-clic)", () => {
  test("draft → dropdown → dialog → URL → row en Publié", async ({ page }) => {
    // Pré-requis : compte
    await page.goto(adminPath("/comptes"));
    if (
      (await page
        .getByRole("cell", { name: "@test_e2e_mark_posted" })
        .count()) === 0
    ) {
      await page.getByRole("button", { name: /ajouter un compte/i }).first().click();
      await page.getByLabel("Handle").fill("test_e2e_mark_posted");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "TikTok" }).click();
      await page.getByLabel("Notes").fill("[E2E_TEST] mark as posted");
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.getByRole("cell", { name: "@test_e2e_mark_posted" }),
      ).toBeVisible();
    }

    const hookText = `Hook mark posted E2E ${Date.now()}`;
    const carouselId = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
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
        texte: i === 0 ? "Slide initiale" : "",
      })),
      angleTonal: "Psycho",
      langue: "FR",
      plateformes: ["TikTok"],
      compte: "@test_e2e_mark_posted",
      datePubli: Date.now(),
      notes: "[E2E_TEST] mark as posted",
    });

    await page.goto(adminPath("/carrousels"));

    // La row vient d'être créée → section "À venir". Ouvre son dropdown.
    const row = page.getByRole("row").filter({ hasText: hookText });
    await expect(row).toBeVisible();
    await row.getByRole("button").last().click();

    // L'item "Marquer comme posté" doit être visible (et placé en haut).
    const markItem = page.getByRole("menuitem", {
      name: /marquer comme posté/i,
    });
    await expect(markItem).toBeVisible();
    await markItem.click();

    // Dialog ouvert. Garde URL : Confirmer disabled tant que !startsWith("http").
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const confirmBtn = dialog.getByRole("button", { name: /^confirmer$/i });
    await expect(confirmBtn).toBeDisabled();

    const urlInput = dialog.getByLabel("Lien de publication");
    await urlInput.fill("notvalid");
    await expect(confirmBtn).toBeDisabled();

    await urlInput.fill("https://www.tiktok.com/@test/video/12345");
    await expect(confirmBtn).toBeEnabled();

    await confirmBtn.click();
    await expect(dialog).toBeHidden();

    // La row doit maintenant être dans la section "Publié". On vérifie que son
    // dropdown ne contient PLUS l'item "Marquer comme posté" (publication déjà
    // publiée, l'item est conditionné par !isPublished).
    const updatedRow = page.getByRole("row").filter({ hasText: hookText });
    await expect(updatedRow).toBeVisible();
    await updatedRow.getByRole("button").last().click();
    await expect(
      page.getByRole("menuitem", { name: /marquer comme posté/i }),
    ).toHaveCount(0);
    // "Mettre à jour stats" devient enabled (la row est désormais publiée).
    await expect(
      page.getByRole("menuitem", { name: /mettre à jour stats/i }),
    ).toBeEnabled();
  });
});

import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);

test.describe("Tracker édition métriques", () => {
  test("verdict change selon save rate", async ({ page }) => {
    // Pré-requis : compte
    await page.goto("/comptes");
    if ((await page.getByRole("cell", { name: "@test_e2e_metrics" }).count()) === 0) {
      await page.getByRole("button", { name: /ajouter un compte/i }).click();
      await page.getByLabel("Handle").fill("test_e2e_metrics");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "TikTok" }).click();
      await page.getByLabel("Notes").fill("[E2E_TEST] metrics");
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(page.getByRole("cell", { name: "@test_e2e_metrics" })).toBeVisible();
    }

    // Batch C : setup direct via Convex (vs ancien UI /nouveau).
    const carouselId = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    await convex.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: "Hook test metrics E2E",
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
      compte: "@test_e2e_metrics",
      datePubli: Date.now(),
      notes: "[E2E_TEST] verdict test",
    });

    await page.goto("/carrousels");

    // Batch E — AnalyticsSection.TopHooksTable peut afficher la même
    // ligne (hook winners listé en bas de page) → scope first() pour
    // cibler la row de la liste tracker, pas du top.
    const row = page
      .getByRole("row")
      .filter({ hasText: "Hook test metrics E2E" })
      .first();

    // Feature 3 : "Mettre à jour stats" est désactivé sur les drafts.
    // Pour saisir des métriques + voir un verdict, il faut d'abord publier
    // via la vue détail (DraftEditView) en renseignant un postUrl.
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /voir détail/i }).click();

    await page
      .getByLabel(/lien de publication/i)
      .fill("https://www.tiktok.com/@test_e2e_metrics/video/123");
    await page.getByRole("button", { name: /^enregistrer$/i }).click();

    // Wait for the draft dialog to close before re-opening the dropdown.
    await expect(page.getByRole("dialog")).toBeHidden();

    // Désormais "Mettre à jour stats" est activé.
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /mettre à jour stats/i }).click();

    // Saisir vues=1500, saves=60 → save rate 4% → WINNER
    await page.getByLabel(/vues j\+7/i).fill("1500");
    await page.getByLabel(/^saves$/i).fill("60");

    // Vérifier preview live "WINNER" — exact pour ne pas matcher "Winners" (KPI label)
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("WINNER", { exact: true })).toBeVisible();

    // Save
    await page.getByRole("button", { name: /^enregistrer$/i }).click();

    // Dialog se ferme — vérifier la row (qui est maintenant dans la section Publié)
    await expect(row.getByText("WINNER", { exact: true })).toBeVisible();
    await expect(row.getByText("4,00 %")).toBeVisible();
  });
});

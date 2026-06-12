import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);
const DAY = 86_400_000;

test.describe("CRUD snapshots via le dialog", () => {
  test("ajouter, éditer puis supprimer un snapshot", async ({ page }) => {
    // Compte
    await page.goto("/comptes");
    if (
      (await page.getByRole("cell", { name: "@test_e2e_snapcrud" }).count()) ===
      0
    ) {
      await page.getByRole("button", { name: /ajouter un compte/i }).click();
      await page.getByLabel("Handle").fill("test_e2e_snapcrud");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "TikTok" }).click();
      await page.getByLabel("Notes").fill("[E2E_TEST] snapcrud");
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.getByRole("cell", { name: "@test_e2e_snapcrud" }),
      ).toBeVisible();
    }

    const datePubli = Date.now() - 10 * DAY;
    const carouselId = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    const { ids } = await convex.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: "Hook E2E snapshot CRUD",
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
      compte: "@test_e2e_snapcrud",
      datePubli,
      notes: "[E2E_TEST] snapcrud",
    });
    const pubId = ids[0];
    await convex.mutation(api.publications.updateMetrics, {
      id: pubId,
      postUrl: "https://www.tiktok.com/@test_e2e_snapcrud/video/1",
    });

    await page.goto("/carrousels");
    const row = page
      .getByRole("row")
      .filter({ hasText: "Hook E2E snapshot CRUD" })
      .first();

    // Ouvre le gestionnaire de snapshots.
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /mettre à jour stats/i }).click();
    const editDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Mettre à jour" });

    // Ajoute un snapshot J+7.
    await editDialog
      .getByRole("button", { name: /ajouter un snapshot/i })
      .click();
    const addDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Nouveau snapshot" });
    await addDialog.getByRole("button", { name: "J+7", exact: true }).click();
    await addDialog.getByLabel(/^vues$/i).fill("1500");
    await addDialog.getByLabel(/^likes$/i).fill("80");
    await addDialog.getByLabel(/^saves$/i).fill("20");
    await addDialog.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(addDialog).toBeHidden();

    // Le snapshot apparaît (badge J+7 + 1 500 vues).
    await expect(editDialog.getByText("J+7").first()).toBeVisible();
    await expect(editDialog.getByText(/1\s?500 vues/)).toBeVisible();

    // Édite le snapshot → vues = 2000.
    await editDialog
      .getByRole("button", { name: /éditer le snapshot/i })
      .click();
    const updDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Modifier le snapshot" });
    await updDialog.getByLabel(/^vues$/i).fill("2000");
    await updDialog.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(updDialog).toBeHidden();
    await expect(editDialog.getByText(/2\s?000 vues/)).toBeVisible();

    // Supprime le snapshot → AlertDialog confirm.
    await editDialog
      .getByRole("button", { name: /supprimer le snapshot/i })
      .click();
    const alert = page
      .getByRole("alertdialog")
      .filter({ hasText: "Supprimer ce snapshot" });
    await alert.getByRole("button", { name: /^supprimer$/i }).click();

    // Plus de snapshot → message d'état vide.
    await expect(editDialog.getByText(/aucun snapshot/i)).toBeVisible();

    await convex.mutation(api.publications.deletePublication, { id: pubId });
  });
});

import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Feature 3 — édition d'un draft via la vue détail.
 * Batch C : setup du draft via ConvexHttpClient (vs ancien flow /nouveau
 * qui n'existe plus). Le test conserve son scope : valider l'édition d'une
 * slide d'un draft via DraftEditView dialog.
 */
test.describe("Draft edit via detail dialog", () => {
  test("modifier le texte d'une slide d'un draft persiste", async ({
    page,
  }) => {
    // Pré-requis : compte (création UI car le test couvre incidemment ce
    // flow — fonction extraite ailleurs aurait été plus DRY mais hors scope).
    await page.goto("/comptes");
    if (
      (await page
        .getByRole("cell", { name: "@test_e2e_draft_edit" })
        .count()) === 0
    ) {
      await page.getByRole("button", { name: /ajouter un compte/i }).click();
      await page.getByLabel("Handle").fill("test_e2e_draft_edit");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "TikTok" }).click();
      await page.getByLabel("Notes").fill("[E2E_TEST] draft edit");
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.getByRole("cell", { name: "@test_e2e_draft_edit" }),
      ).toBeVisible();
    }

    // Setup direct du draft via Convex (vs ancien flow UI /nouveau).
    const carouselId = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    await convex.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: "Hook draft edit E2E",
      mecanique: "Erreur",
      niveau: "Broad-A",
      mediaType: "carousel",
      format: "A",
      nbSlides: 7,
      slides: [
        { position: 1, texte: "Texte initial slide 1" },
        { position: 2, texte: "" },
        { position: 3, texte: "" },
        { position: 4, texte: "" },
        { position: 5, texte: "" },
        { position: 6, texte: "" },
        { position: 7, texte: "" },
      ],
      angleTonal: "Psycho",
      langue: "FR",
      plateformes: ["TikTok"],
      compte: "@test_e2e_draft_edit",
      datePubli: Date.now(),
      notes: "[E2E_TEST] draft edit",
    });

    await page.goto("/carrousels");

    // Ouvrir détail/édition du draft
    const row = page
      .getByRole("row")
      .filter({ hasText: "Hook draft edit E2E" });
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /voir détail/i }).click();

    // Le dialog est en mode édition (DraftEditView). Slide 1 doit afficher le texte initial.
    const slide1 = page.getByLabel("Slide 1");
    await expect(slide1).toHaveValue("Texte initial slide 1");

    // Modifier le texte
    await slide1.fill("Texte modifié via dialog E2E");

    // Save
    await page.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    // Ré-ouvrir le détail pour vérifier la persistance
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /voir détail/i }).click();

    await expect(page.getByLabel("Slide 1")).toHaveValue(
      "Texte modifié via dialog E2E",
    );
  });

  // NB : la couverture du disabled state de "Mettre à jour stats" sur un draft
  // est implicite — tracker-metrics.spec.ts est obligé de passer par "Voir
  // détail / éditer" pour publier d'abord, parce que "Mettre à jour stats" est
  // disabled. Si ce verrou sautait, le test casserait au moment du fill postUrl.
});

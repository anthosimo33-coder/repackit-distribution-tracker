import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Page Comptes — actions admin du menu ⋯ : suppression (avec RÉCAP obligatoire,
 * archivage proposé quand le compte a un historique) et réassignation de la
 * créatrice propriétaire. Le serveur est couvert par admin-comptes-control /
 * compte-reassign ; ici on vérifie le CÂBLAGE UI (le menu ouvre le bon dialog,
 * le récap dit la vérité, l'action aboutit).
 */
test.describe("Comptes — supprimer / réassigner depuis le menu ⋯", () => {
  test("compte avec historique : suppression refusée, archivage proposé", async ({
    page,
  }) => {
    const ts = Date.now();
    const handle = `@test_e2e_used${ts}`;
    await convex.mutation(api.comptes.createCompte, {
      handle,
      plateforme: "TikTok",
      notes: "[E2E_TEST] delete-guard",
    });
    // Publication rattachée PAR HANDLE → le compte n'est plus vierge.
    const carouselId = await convex.query(api.publications.getNextCarouselId, {});
    await convex.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: "[E2E_TEST] delete guard pub",
      mecanique: "Erreur",
      niveau: "Broad-A",
      mediaType: "carousel",
      format: "A",
      nbSlides: 2,
      slides: [
        { position: 1, texte: "S1" },
        { position: 2, texte: "S2" },
      ],
      angleTonal: "Psycho",
      langue: "FR",
      plateformes: ["TikTok"],
      compte: handle,
      datePubli: ts,
      notes: "[E2E_TEST] delete guard pub",
    });

    await page.goto(adminPath("/comptes"));
    const row = page.getByRole("row").filter({ hasText: handle });
    await row.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Supprimer" }).click();

    const dialog = page.getByTestId("compte-delete-dialog");
    await expect(dialog).toBeVisible();
    // Récap : le handle + le nombre de publications concernées.
    await expect(dialog.getByText(/1 publication/)).toBeVisible();
    // Pas de suppression sèche possible : seul l'archivage est proposé.
    await expect(
      dialog.getByRole("button", { name: /archiver à la place/i }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /^supprimer$/i }),
    ).toHaveCount(0);

    await dialog.getByRole("button", { name: /archiver à la place/i }).click();
    await expect(dialog).toBeHidden();
    // Le compte reste listé, en "Archivé" — son historique n'a pas bougé.
    await expect(row.getByText(/archivé/i)).toBeVisible();
  });

  test("compte vierge : suppression franche après confirmation", async ({
    page,
  }) => {
    const ts = Date.now();
    const handle = `@test_e2e_vierge${ts}`;
    await convex.mutation(api.comptes.createCompte, {
      handle,
      plateforme: "Instagram",
      notes: "[E2E_TEST] delete-vierge",
    });

    await page.goto(adminPath("/comptes"));
    const row = page.getByRole("row").filter({ hasText: handle });
    await row.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Supprimer" }).click();

    const dialog = page.getByTestId("compte-delete-dialog");
    // Assertion portée par le DIALOGUE lui-même (élément unique par testid), pas
    // par un locator de texte : `getByText(/vierge/i)` résolvait 2 éléments —
    // le handle de test contient lui-même « vierge » (`@test_e2e_vierge…`) et le
    // mot apparaît dans la phrase du dialogue. `toContainText` sur le dialogue
    // supprime l'ambiguïté par construction, et la phrase visée ne dépend plus du
    // nom du compte.
    await expect(dialog).toContainText(/aucune ligne de paie/i);
    await dialog.getByRole("button", { name: /^supprimer$/i }).click();
    await expect(row).toHaveCount(0);
  });

  test("réassignation de la créatrice depuis la liste", async ({ page }) => {
    const ts = Date.now();
    const handle = `@test_e2e_reassign${ts}`;
    const creatorName = `[E2E_TEST] UiReassign ${ts}`;
    await convex.mutation(api.creators.inviteCreator, {
      name: creatorName,
      email: `e2e-creator-ui-reassign-${ts}@repackit.test`,
    });
    await convex.mutation(api.comptes.createCompte, {
      handle,
      plateforme: "TikTok",
      notes: "[E2E_TEST] reassign-ui",
    });

    await page.goto(adminPath("/comptes"));
    const row = page.getByRole("row").filter({ hasText: handle });
    // Compte interne au départ.
    await expect(row.getByText("Interne")).toBeVisible();

    await row.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Réassigner" }).click();

    const dialog = page.getByTestId("compte-reassign-dialog");
    await expect(dialog).toBeVisible();
    // Récap : rien à réattribuer (compte sans publication).
    await expect(dialog.getByText(/aucune publication/i)).toBeVisible();

    // 1er combobox du dialog = créatrice propriétaire (le 2e est le
    // gestionnaire). Les options cmdk sont portalées HORS du dialog.
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: creatorName }).click();
    await dialog.getByRole("button", { name: /^réassigner$/i }).click();
    await expect(dialog).toBeHidden();

    // La colonne Créateur de la ligne porte la nouvelle propriétaire.
    await expect(row.getByText(creatorName)).toBeVisible();
  });
});

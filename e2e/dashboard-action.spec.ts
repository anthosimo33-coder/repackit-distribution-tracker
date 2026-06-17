import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * Refonte dashboard — vue ACTION (par défaut). Sur données seedées (1 créateur,
 * 1 assignment soumis + 1 todo deadline 5 j), vérifie que :
 *  - le titre « Bonjour » s'affiche (vue action = arrivée par défaut) ;
 *  - les 4 cartes-action sont présentes ;
 *  - la worklist « À traiter maintenant » surface au moins une soumission
 *    (bouton Valider) ;
 *  - les cartes sont cliquables et mènent aux bonnes pages ;
 *  - le toggle bascule vers la vue « tracker » historique.
 * Assertions volontairement robustes (présence + navigation, pas de comptage
 * exact — la DB e2e est partagée et sérielle).
 */
test.describe("Dashboard — vue action", () => {
  test("cartes + worklist + navigation + toggle tracker", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();

    // ─── Seed : créateur + format + 2 assignments (1 soumis, 1 todo) ─────────
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Dash ${ts}`,
      email: `e2e-dash-${ts}@repackit.test`,
      password: "creator-dash-12345",
    });
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Format Dash ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10 },
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorIds: [creator.creatorId],
      postsPerCreator: 2,
      dueDate: ts + 5 * DAY,
    });
    const mine = (
      await admin.query(api.assignments.listAssignments, {})
    ).filter(
      (a) => a.formatId === formatId && a.creatorId === creator.creatorId,
    );
    expect(mine.length).toBe(2);
    // Le créateur soumet le 1er → status "submitted" (carte À valider +
    // worklist). Le 2e reste "todo" avec une deadline à 5 j (carte Deadlines).
    await creator.client.mutation(api.assignments.startAssignment, {
      projectId: creator.projectId,
      id: mine[0]._id,
    });
    await creator.client.mutation(api.assignments.submitAssignment, {
      projectId: creator.projectId,
      id: mine[0]._id,
      url: `https://www.tiktok.com/@e2e/video/${ts}`,
    });

    // ─── Vue action (arrivée par défaut) ─────────────────────────────────────
    await page.goto(adminPath("/dashboard"));
    await expect(page.getByRole("heading", { name: "Bonjour" })).toBeVisible();

    // Les 4 cartes-action.
    await expect(page.getByText("À valider", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Warmups en retard", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Dû ce mois", { exact: true })).toBeVisible();
    await expect(page.getByText("Deadlines 7 j", { exact: true })).toBeVisible();

    // Worklist : la soumission seedée surface (au moins un bouton Valider).
    await expect(
      page.getByRole("heading", { name: "À traiter maintenant" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Valider", exact: true }).first(),
    ).toBeVisible();

    // Carte « Deadlines 7 j » cliquable → /assignments.
    await page.getByRole("link", { name: /Deadlines 7 j/ }).click();
    await expect(page).toHaveURL(/\/assignments/);

    // Carte « À valider » cliquable → /validation.
    await page.goto(adminPath("/dashboard"));
    await page.getByRole("link", { name: /À valider/ }).click();
    await expect(page).toHaveURL(/\/validation/);

    // Toggle → vue tracker historique.
    await page.goto(adminPath("/dashboard"));
    await page.getByRole("radio", { name: "Tracker" }).click();
    await expect(
      page.getByRole("heading", { name: "Vue tracker" }),
    ).toBeVisible();
  });
});

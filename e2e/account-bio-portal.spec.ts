import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Bio à mettre (UI) — flux complet admin ↔ créateur :
 * l'admin pose une bio (éditeur de la fiche compte) → le créateur la voit dans
 * son espace avec l'indicateur « à mettre à jour » + le texte à copier → il
 * confirme « J'ai appliqué » → l'indicateur disparaît, l'admin voit « Appliquée »
 * → l'admin re-modifie → le compte repasse « à mettre à jour » côté créateur.
 */
test.describe("Bio à mettre — portail créateur (UI)", () => {
  test("admin pose → créateur voit & confirme → admin voit appliquée → re-modif", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Bio UI ${ts}`;
    const email = `e2e-bio-ui-${ts}@repackit.test`;
    const password = "creator-bio-ui-12345";
    const handle = `@e2ebioui${ts}`;
    const bioV1 = `Bio a recopier v1 ${ts}`;
    const bioV2 = `Bio modifiee v2 ${ts}`;

    // ── Onboarding créateur (contexte privé) + déclaration d'un compte ──
    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name,
      email,
    });
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const creator = await ctx.newPage();
    await creator.goto(`/join/${token}`);
    await creator.getByLabel("Mot de passe").fill(password);
    await creator
      .getByRole("button", { name: /activer mon compte/i })
      .click();
    await creator.waitForURL("**/app", { timeout: 20_000 });

    await creator
      .getByRole("link", { name: "Mes comptes", exact: true })
      .click();
    await creator.waitForURL("**/app/comptes", { timeout: 15_000 });
    await creator
      .getByRole("button", { name: /déclarer un compte/i })
      .first()
      .click();
    const dialog = creator.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Handle *", { exact: true }).fill(handle);
    await dialog.getByRole("button", { name: "Déclarer", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 8000 });

    // Avant toute bio : aucun encart bio côté créateur.
    await expect(creator.getByTestId("bio-panel")).toHaveCount(0);

    const compte = (await convex.query(api.comptes.listComptes, {})).find(
      (c) => c.handle === handle,
    );
    expect(compte).toBeTruthy();
    const compteId = compte!._id;

    // ── Admin pose la bio depuis la fiche compte ──
    await page.goto(adminPath(`/comptes/${compteId}`));
    const bioTextarea = page.getByTestId("admin-bio-textarea");
    await expect(bioTextarea).toBeVisible({ timeout: 15_000 });
    await bioTextarea.fill(bioV1);
    await page.getByRole("button", { name: /enregistrer la bio/i }).click();
    await expect(page.getByTestId("admin-bio-status")).toContainText(
      /en attente/i,
      { timeout: 8000 },
    );

    // ── Créateur : voit l'indicateur « à mettre à jour » + le texte ──
    await creator.reload();
    await expect(creator.getByTestId("bio-due-notif")).toBeVisible({
      timeout: 10_000,
    });
    await expect(creator.getByTestId("bio-pending-badge")).toBeVisible();
    await expect(creator.getByText(bioV1)).toBeVisible();

    // ── Créateur confirme → l'indicateur disparaît ──
    await creator
      .getByRole("button", { name: /j'ai appliqué cette bio/i })
      .click();
    await expect(creator.getByTestId("bio-pending-badge")).toBeHidden({
      timeout: 8000,
    });
    await expect(creator.getByText(/bio actuelle à maintenir/i)).toBeVisible();
    // La bio reste lisible (juste l'alerte disparaît).
    await expect(creator.getByText(bioV1)).toBeVisible();

    // ── Admin voit « Appliquée » ──
    await page.reload();
    await expect(page.getByTestId("admin-bio-status")).toContainText(
      /appliquée/i,
      { timeout: 10_000 },
    );

    // ── Admin re-modifie → le créateur repasse « à mettre à jour » ──
    const bioTextarea2 = page.getByTestId("admin-bio-textarea");
    await expect(bioTextarea2).toHaveValue(bioV1, { timeout: 8000 });
    await bioTextarea2.fill(bioV2);
    await page.getByRole("button", { name: /enregistrer la bio/i }).click();
    await expect(page.getByTestId("admin-bio-status")).toContainText(
      /en attente/i,
      { timeout: 8000 },
    );

    await creator.reload();
    await expect(creator.getByTestId("bio-pending-badge")).toBeVisible({
      timeout: 10_000,
    });
    await expect(creator.getByText(bioV2)).toBeVisible();

    await ctx.close();
  });
});

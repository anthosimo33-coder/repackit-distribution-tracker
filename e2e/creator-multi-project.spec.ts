import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Multi-projets créateur (un compte, N memberships) :
 *  - admin invite + le créateur finalise son compte sur e2e-test ;
 *  - l'admin le rattache à un 2ᵉ projet via le bouton « Ajouter au projet » ;
 *  - le 2ᵉ projet disparaît du sélecteur (pas de doublon) et le créateur
 *    apparaît dans la liste admin du 2ᵉ projet ;
 *  - le créateur (même login) voit un switcher listant SES 2 projets ;
 *  - ISOLATION : un compte déclaré sur le projet A n'apparaît PAS sur le
 *    projet B, et réapparaît au retour sur A.
 */
test.describe("Créateurs — multi-projets + switcher + isolation", () => {
  test("rattacher à un 2ᵉ projet → switcher → isolation par projet", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] MP ${ts}`;
    const email = `e2e-creator-mp-${ts}@repackit.test`;
    const password = "creator-mp-12345";
    const handleA = `@e2empA${ts}`;
    const slugB = `e2e-mp-${ts}`;
    const nameB = `E2E MP Projet ${ts}`;

    // 1. Admin invite (serveur, superadmin) → token.
    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name,
      email,
    });

    // 2. Le créateur finalise son compte (contexte vierge → reste connecté).
    const creatorCtx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const creatorPage = await creatorCtx.newPage();
    await creatorPage.goto(`/join/${token}`);
    await creatorPage.getByLabel("Mot de passe").fill(password);
    await creatorPage
      .getByRole("button", { name: /activer mon compte/i })
      .click();
    await creatorPage.waitForURL("**/app", { timeout: 20_000 });

    // 3. Crée le 2ᵉ projet (serveur).
    const { projectId: projectBId } = await convex.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: slugB, name: nameB },
    );

    // 4. Admin (superadmin) : fiche créateur → carte « Autres projets » →
    //    rattache au 2ᵉ projet via le bouton.
    await page.goto(adminPath("/createurs"));
    await page
      .getByRole("link", { name: new RegExp(`MP ${ts}`) })
      .first()
      .click();
    await page.waitForURL(/\/createurs\/.+/, { timeout: 10_000 });

    const targetSelect = page.getByRole("combobox", { name: "Projet cible" });
    await targetSelect.click();
    await page.getByRole("option", { name: nameB, exact: true }).click();
    await page.getByRole("button", { name: /ajouter au projet/i }).click();
    await expect(page.getByText(/rattaché au projet/i)).toBeVisible({
      timeout: 10_000,
    });

    // Pas de doublon (garde serveur) : un 2ᵉ rattachement au même projet est
    // rejeté avec un message clair. Déterministe, sans dépendre du sélecteur.
    const creatorsA = await convex.query(api.creators.listCreators, {});
    const creatorUserId = creatorsA.find((c) => c.email === email)?.userId;
    expect(creatorUserId).toBeTruthy();
    let dupError = "";
    try {
      await convex.mutation(api.creators.addCreatorToProject, {
        projectId: projectBId,
        creatorUserId: creatorUserId!,
      });
    } catch (e) {
      dupError = e instanceof Error ? e.message : String(e);
    }
    expect(dupError).toMatch(/déjà rattaché/i);

    // 5. Le créateur apparaît dans la liste admin du 2ᵉ projet.
    await page.goto(`/admin/${slugB}/createurs`);
    await expect(
      page.getByRole("link", { name: new RegExp(`MP ${ts}`) }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 6. Côté créateur : le switcher liste maintenant SES 2 projets.
    await creatorPage.reload();
    const switcher = creatorPage.getByRole("button", {
      name: "Changer de projet",
    });
    await expect(switcher).toBeVisible({ timeout: 10_000 });

    // Aller explicitement sur e2e-test (projet A) — l'ordre par défaut dépend
    // du tri alphabétique, on ne s'y fie pas.
    await switcher.click();
    await creatorPage
      .getByRole("menuitem", { name: "E2E Test", exact: true })
      .click();
    await creatorPage.waitForURL("**/app", { timeout: 10_000 });

    // 7. Déclare un compte sur le projet A.
    await creatorPage.goto("/app/comptes");
    await creatorPage
      .getByRole("button", { name: /déclarer un compte/i })
      .first()
      .click();
    const declareDialog = creatorPage.getByRole("dialog");
    await expect(declareDialog).toBeVisible();
    await declareDialog.getByLabel("Handle *", { exact: true }).fill(handleA);
    await declareDialog
      .getByRole("button", { name: "Déclarer", exact: true })
      .click();
    await expect(declareDialog).toBeHidden({ timeout: 8000 });
    await expect(creatorPage.getByText(handleA)).toBeVisible({ timeout: 8000 });

    // 8. ISOLATION : bascule sur le projet B → le compte de A n'y est PAS.
    await creatorPage.getByRole("button", { name: "Changer de projet" }).click();
    await creatorPage
      .getByRole("menuitem", { name: nameB, exact: true })
      .click();
    await creatorPage.waitForURL("**/app", { timeout: 10_000 });
    await creatorPage.goto("/app/comptes");
    await expect(
      creatorPage.getByText("Aucun compte déclaré.", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(creatorPage.getByText(handleA)).toHaveCount(0);

    // 9. Retour sur A → le compte est de nouveau là (données par projet).
    await creatorPage.getByRole("button", { name: "Changer de projet" }).click();
    await creatorPage
      .getByRole("menuitem", { name: "E2E Test", exact: true })
      .click();
    await creatorPage.waitForURL("**/app", { timeout: 10_000 });
    await creatorPage.goto("/app/comptes");
    await expect(creatorPage.getByText(handleA)).toBeVisible({
      timeout: 10_000,
    });

    await creatorCtx.close();

    // Teardown.
    await convex.mutation(api.creators.cleanupTestCreators, {
      secret: E2E_SECRET,
    });
    await convex.mutation(api.projects.e2eDeleteProject, {
      secret: E2E_SECRET,
      slug: slugB,
    });
  });
});

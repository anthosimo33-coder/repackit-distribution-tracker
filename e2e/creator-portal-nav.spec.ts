import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const SUBTITLES_URL = "https://sous-titre-editeur.vercel.app/";

/**
 * Portail créateur — refonte nav :
 *  - DESKTOP : sidebar gauche (réplique admin) — items existants conservés
 *    (labels exacts), déconnexion en bas, catégorie « Outils » (liens directs
 *    du projet, nouvel onglet) affichée SEULEMENT si le projet a des outils ;
 *  - MOBILE : si le projet a des outils → Guide déplacé dans le header,
 *    « Outils » prend sa place dans la bottom bar et ouvre la page /app/outils
 *    qui liste les outils ; sinon AUCUNE réorg (Guide reste dans la barre).
 *
 * Outils figés PAR PROJET (lib/creator-tools) : e2e-test n'en a pas (cas sans
 * outils), « repackit » en a un (Sous-titres). Le créateur est rattaché aux
 * deux pour exercer les deux états via le switcher. Isolation : les outils
 * suivent le projet courant.
 */
test.describe("Portail créateur — sidebar desktop + Outils + nav mobile", () => {
  test("sidebar desktop, Outils par projet, réorg mobile (Guide↔Outils)", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Nav ${ts}`;
    const email = `e2e-creator-nav-${ts}@repackit.test`;
    const password = "creator-nav-12345";

    // 1. Admin invite le créateur (sur e2e-test, projet SANS outils) → token.
    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name,
      email,
    });

    // 2. Le créateur finalise (contexte vierge → reste connecté sur /app).
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.setViewportSize(DESKTOP);
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });

    try {
      const sidebar = page.getByRole("navigation", {
        name: "Navigation créateur",
      });

      // ── DESKTOP, projet SANS outils (e2e-test) : sidebar + items conservés.
      await expect(
        sidebar.getByRole("link", { name: "Tableau de bord", exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        sidebar.getByRole("link", { name: "Mes comptes", exact: true }),
      ).toBeVisible();
      await expect(
        sidebar.getByRole("link", { name: "Mes paiements", exact: true }),
      ).toBeVisible();
      await expect(
        sidebar.getByRole("link", { name: "Comment ça marche", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Se déconnecter" }),
      ).toBeVisible();
      // Pas d'outils → pas de catégorie/lien Outils dans la sidebar.
      await expect(
        sidebar.getByRole("link", { name: "Sous-titres" }),
      ).toHaveCount(0);

      // ── MOBILE, projet SANS outils : Guide reste dans la barre, pas d'Outils,
      //    Guide n'est PAS déplacé dans le header.
      await page.setViewportSize(MOBILE);
      const bottomNav = page.getByRole("navigation", {
        name: "Navigation portail",
      });
      await expect(
        bottomNav.getByRole("link", { name: "Guide" }),
      ).toBeVisible();
      await expect(
        bottomNav.getByRole("link", { name: "Outils" }),
      ).toHaveCount(0);
      // 1 seul lien « Guide » au total (celui de la barre) → rien dans le header.
      await expect(page.getByRole("link", { name: "Guide" })).toHaveCount(1);
      await page.setViewportSize(DESKTOP);

      // 3. Rattacher le créateur à « repackit » (slug figé → 1 outil).
      const { projectId: repackitId } = await convex.mutation(
        api.projects.e2eEnsureProjectBySlug,
        { secret: E2E_SECRET, slug: "repackit", name: "RepackIt" },
      );
      await convex.mutation(api.creators.e2eAddCreatorToProject, {
        secret: E2E_SECRET,
        email,
        projectId: repackitId,
      });

      // 4. Bascule sur repackit via le switcher (2 projets désormais).
      await page.reload();
      const switcher = page.getByRole("button", { name: "Changer de projet" });
      await expect(switcher).toBeVisible({ timeout: 15_000 });
      await switcher.click();
      // L'autre projet que « E2E Test » (le nom de repackit dépend du seed).
      await page
        .getByRole("menuitem")
        .filter({ hasNotText: "E2E Test" })
        .first()
        .click();
      await page.waitForURL("**/app", { timeout: 10_000 });

      // ── DESKTOP, projet AVEC outils (repackit) : catégorie Outils + lien direct.
      const sidebarTool = sidebar.getByRole("link", { name: "Sous-titres" });
      await expect(sidebarTool).toBeVisible({ timeout: 15_000 });
      await expect(sidebarTool).toHaveAttribute("href", SUBTITLES_URL);
      await expect(sidebarTool).toHaveAttribute("target", "_blank");
      await expect(sidebarTool).toHaveAttribute("rel", /noopener/);

      // ── MOBILE, projet AVEC outils : Outils dans la barre, Guide dans le header.
      await page.setViewportSize(MOBILE);
      const bottomNav2 = page.getByRole("navigation", {
        name: "Navigation portail",
      });
      await expect(
        bottomNav2.getByRole("link", { name: "Outils" }),
      ).toBeVisible();
      await expect(
        bottomNav2.getByRole("link", { name: "Guide" }),
      ).toHaveCount(0);
      // Guide déplacé dans le header : 1 seul lien Guide, hors de la barre.
      await expect(page.getByRole("link", { name: "Guide" })).toHaveCount(1);

      // Cliquer « Outils » → page /app/outils qui liste l'outil (lien externe).
      await bottomNav2.getByRole("link", { name: "Outils" }).click();
      await page.waitForURL("**/app/outils", { timeout: 10_000 });
      const pageTool = page.getByRole("link", { name: "Sous-titres" });
      await expect(pageTool).toBeVisible({ timeout: 10_000 });
      await expect(pageTool).toHaveAttribute("href", SUBTITLES_URL);
      await expect(pageTool).toHaveAttribute("target", "_blank");
      await expect(pageTool).toHaveAttribute("rel", /noopener/);
    } finally {
      await ctx.close();
      await convex.mutation(api.creators.cleanupTestCreators, {
        secret: E2E_SECRET,
      });
    }
  });
});

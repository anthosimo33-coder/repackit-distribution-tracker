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
const ONGLETS = ["Aujourd'hui", "Missions", "Gains", "Moi"];

/**
 * Portail créateur — navigation à QUATRE onglets (Aujourd'hui, Missions, Gains,
 * Moi), identiques sur desktop (sidebar) et mobile (barre du bas).
 *
 *  - Le guide et les outils ne sont plus des onglets : ils vivent sous « Moi »,
 *    quel que soit le projet. Sur desktop, les outils restent AUSSI en lien
 *    direct dans la sidebar (nouvel onglet) — il y a la place.
 *  - Outils figés PAR PROJET (lib/creator-tools) : e2e-test n'en a pas,
 *    « repackit » en a un (Sous-titres). Le créateur est rattaché aux deux.
 */
test.describe("Portail créateur — quatre onglets + Outils", () => {
  test("sidebar et barre à quatre onglets, guide et outils sous « Moi »", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Nav ${ts}`;
    const email = `e2e-creator-nav-${ts}@repackit.test`;
    const password = "creator-nav-12345";

    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name,
      email,
    });

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

      // ── DESKTOP, projet SANS outils : les quatre onglets, et rien d'autre.
      for (const onglet of ONGLETS) {
        await expect(
          sidebar.getByRole("link", { name: onglet, exact: true }),
        ).toBeVisible({ timeout: 15_000 });
      }
      await expect(sidebar.getByRole("link")).toHaveCount(ONGLETS.length);
      // L'onglet de la page courante est allumé, les autres non.
      await expect(
        sidebar.getByRole("link", { name: "Aujourd'hui", exact: true }),
      ).toHaveClass(/text-primary/);
      await expect(
        sidebar.getByRole("link", { name: "Moi", exact: true }),
      ).not.toHaveClass(/text-primary/);
      await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();

      // ── MOBILE, projet SANS outils : quatre cellules, pas de Guide ni d'Outils.
      await page.setViewportSize(MOBILE);
      const bottomNav = page.getByRole("navigation", { name: "Navigation portail" });
      await expect(bottomNav.locator("> ul > li")).toHaveCount(4);
      for (const onglet of ONGLETS) {
        await expect(bottomNav.getByRole("link", { name: onglet, exact: true })).toBeVisible();
      }
      await expect(bottomNav.getByRole("link", { name: "Guide" })).toHaveCount(0);

      // Sous « Moi » : le guide est là, les outils non (ce projet n'en a pas).
      await bottomNav.getByRole("link", { name: "Moi", exact: true }).click();
      await page.waitForURL("**/app/moi", { timeout: 15_000 });
      await expect(
        page.getByRole("link", { name: "Comment ça marche", exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("link", { name: "Outils", exact: true })).toHaveCount(0);
      await expect(bottomNav.getByRole("link", { name: "Moi", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await page.setViewportSize(DESKTOP);

      // Rattacher le créateur à « repackit » (slug figé → 1 outil).
      const { projectId: repackitId } = await convex.mutation(
        api.projects.e2eEnsureProjectBySlug,
        { secret: E2E_SECRET, slug: "repackit", name: "RepackIt" },
      );
      await convex.mutation(api.creators.e2eAddCreatorToProject, {
        secret: E2E_SECRET,
        email,
        projectId: repackitId,
      });

      await page.goto("/app");
      const switcher = page.getByRole("button", { name: "Changer de projet" });
      await expect(switcher).toBeVisible({ timeout: 15_000 });
      await switcher.click();
      await page
        .getByRole("menuitem")
        .filter({ hasNotText: "E2E Test" })
        .first()
        .click();
      await page.waitForURL("**/app", { timeout: 10_000 });

      // ── DESKTOP, projet AVEC outils : lien direct dans la sidebar.
      const sidebarTool = sidebar.getByRole("link", { name: "Sous-titres" });
      await expect(sidebarTool).toBeVisible({ timeout: 15_000 });
      await expect(sidebarTool).toHaveAttribute("href", SUBTITLES_URL);
      await expect(sidebarTool).toHaveAttribute("target", "_blank");
      await expect(sidebarTool).toHaveAttribute("rel", /noopener/);

      // ── MOBILE, projet AVEC outils : toujours quatre onglets ; « Outils » est
      //    sous « Moi » et mène à la page qui liste l'outil.
      await page.setViewportSize(MOBILE);
      await expect(bottomNav.locator("> ul > li")).toHaveCount(4);
      await expect(bottomNav.getByRole("link", { name: "Outils" })).toHaveCount(0);
      await bottomNav.getByRole("link", { name: "Moi", exact: true }).click();
      await page.waitForURL("**/app/moi", { timeout: 15_000 });
      await page.getByRole("link", { name: "Outils", exact: true }).click();
      await page.waitForURL("**/app/outils", { timeout: 10_000 });
      // Sous-page d'« Moi » : l'onglet reste allumé.
      await expect(bottomNav.getByRole("link", { name: "Moi", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
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

import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Chantier branding projet — logo + liens externes CONFIGURABLES PAR PROJET.
 *  - un projet jetable reçoit logoUrl + un sidebarLink "Carrousel Studio" ;
 *  - le switcher affiche le LOGO (img) à la place de l'initiale ;
 *  - la sidebar montre le lien externe (target=_blank, href, nouvel onglet) ;
 *  - ISOLATION : le projet par défaut (e2e-test, sans branding) ne montre NI
 *    logo NI le lien → rien n'est hardcodé, tout est scopé au projet courant.
 */
test.describe("Branding projet — logo + liens externes de sidebar", () => {
  test("logo dans le switcher + lien externe, scopés au projet", async ({
    page,
  }) => {
    const ts = Date.now();
    const slug = `e2e-brand-${ts}`;
    const name = `E2E Brand ${ts}`;
    const linkUrl = "https://carrouselstudio.vercel.app/";
    const logoUrl = "/brand/snytch-logo.jpeg";

    await convex.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name,
    });
    await convex.mutation(api.projects.e2eSetProjectBranding, {
      secret: E2E_SECRET,
      slug,
      logoUrl,
      sidebarLinks: [
        { label: "Carrousel Studio", url: linkUrl, icon: "carousel" },
      ],
    });

    try {
      // Projet brandé → logo (img alt = nom) dans le switcher + lien externe.
      await page.goto(`/admin/${slug}/dashboard`);

      const logo = page.getByRole("img", { name });
      await expect(logo).toBeVisible({ timeout: 10000 });
      await expect(logo).toHaveAttribute("src", logoUrl);

      const studioLink = page.getByRole("link", { name: /carrousel studio/i });
      await expect(studioLink).toBeVisible();
      await expect(studioLink).toHaveAttribute("href", linkUrl);
      await expect(studioLink).toHaveAttribute("target", "_blank");
      await expect(studioLink).toHaveAttribute(
        "rel",
        /noopener/,
      );

      // ISOLATION : le projet par défaut (sans branding) → ni logo ni lien.
      await page.goto(adminPath("/dashboard"));
      await expect(
        page.getByRole("link", { name: /carrousel studio/i }),
      ).toHaveCount(0);
    } finally {
      await convex.mutation(api.projects.e2eDeleteProject, {
        secret: E2E_SECRET,
        slug,
      });
    }
  });
});

import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const MOBILE = { width: 375, height: 812 };
const SNYTCH_NOM = "E2E Snytch (nav)";

/**
 * BARRE MOBILE — quatre onglets, partout.
 *
 * LE DÉFAUT QU'ELLE VERROUILLE. La barre montait à six cellules, sept sur Snytch
 * (Fichiers et Vidéos derrière « Plus »). Elle est désormais à QUATRE, et doit le
 * rester sur Snytch : les écrans en plus ne sont plus des onglets mais des
 * sous-pages — Fichiers sous « Moi », Vidéos sous « Gains ».
 *
 * 375 px : la largeur la plus étroite du parc (iPhone SE/13 mini).
 *
 * L'assertion qui compte n'est pas « quatre onglets existent » mais « la barre
 * reste à quatre sur Snytch » et « l'onglet reste allumé sur une sous-page » :
 * ce sont elles qui tombent si quelqu'un remet un écran dans la barre ou casse le
 * découpage de lib/creator-nav.
 */
test.describe("Créateur — barre mobile à quatre onglets", () => {
  test("quatre onglets sur Snytch aussi, et l'onglet parent allumé sur ses sous-pages", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    await admin.mutation(api.projects.e2eDeleteProject, {
      secret: E2E_SECRET,
      slug: "snytch",
    });
    const email = `e2e-nav-tabs-${ts}@repackit.test`;
    const password = "nav-tabs-12345";
    await createCreatorSession(url, {
      name: `[E2E_TEST] NavTabs ${ts}`,
      email,
      password,
    });

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: MOBILE,
    });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/mot de passe/i).fill(password);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await page.waitForURL("**/app", { timeout: 30_000 });

    const barre = page.getByRole("navigation", { name: "Navigation portail" });
    const cellules = barre.locator("> ul > li");
    const onglet = (name: string) => barre.getByRole("link", { name, exact: true });

    // ── Projet ordinaire : quatre cellules, libellés entiers.
    await expect(cellules).toHaveCount(4, { timeout: 20_000 });
    for (const name of ["Aujourd'hui", "Missions", "Gains", "Moi"]) {
      await expect(onglet(name)).toBeVisible();
    }

    // ── Projet SNYTCH : toujours quatre. Projet courant posé dans le stockage
    // local plutôt que par le switcher — cf l'hydratation différée de
    // CreatorProjectProvider (écrans gatés par slug, build de production).
    const { projectId } = await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug: "snytch",
      name: SNYTCH_NOM,
    });
    await admin.mutation(api.creators.e2eAddCreatorToProject, {
      secret: E2E_SECRET,
      email,
      projectId,
    });
    await page.addInitScript(
      ([key, id]) => window.localStorage.setItem(key, id),
      ["creator-current-project", projectId as string] as const,
    );
    await page.goto("/app");
    await expect(cellules).toHaveCount(4, { timeout: 20_000 });
    await expect(barre.getByRole("link", { name: "Fichiers" })).toHaveCount(0);
    await expect(barre.getByRole("link", { name: "Vidéos" })).toHaveCount(0);

    // ── Fichiers vit sous « Moi » (Snytch), et y mène.
    await onglet("Moi").click();
    await page.waitForURL("**/app/moi", { timeout: 20_000 });
    await page.getByRole("link", { name: "Mes fichiers", exact: true }).click();
    await page.waitForURL("**/app/fichiers", { timeout: 20_000 });
    // Sous-page de « Moi » : l'onglet reste allumé…
    await expect(onglet("Moi")).toHaveAttribute("aria-current", "page");
    // …et « Aujourd'hui » ne l'est pas (deux tests opposés, même condition).
    await expect(onglet("Aujourd'hui")).not.toHaveAttribute("aria-current", "page");

    // ── Vidéos est une sous-page de « Gains ».
    await page.goto("/app/videos");
    await expect(
      page.getByRole("heading", { level: 1, name: "Mes vidéos" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(onglet("Gains")).toHaveAttribute("aria-current", "page");
    await expect(onglet("Moi")).not.toHaveAttribute("aria-current", "page");

    await ctx.close();
    await admin.mutation(api.projects.e2eDeleteProject, {
      secret: E2E_SECRET,
      slug: "snytch",
    });
    await admin.mutation(api.creators.cleanupTestCreators, {
      secret: E2E_SECRET,
    });
  });
});

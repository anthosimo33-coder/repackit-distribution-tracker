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

/**
 * Nom FIXE du projet de test à slug « snytch ».
 *
 * ⚠️ Pas de `${ts}` ici, et ce n'est pas un détail. `e2eEnsureProjectBySlug` est
 * idempotent PAR SLUG : si un run précédent est mort avant son nettoyage, le
 * projet survit avec SON nom, et un nom horodaté ne serait plus jamais trouvé
 * dans le switcher — le test échouerait ensuite à chaque exécution, pour une
 * raison étrangère à ce qu'il mesure. C'est le piège de la base locale polluée,
 * déjà payé une fois sur ce chantier.
 */
const SNYTCH_NOM = "E2E Snytch (nav)";

/**
 * BARRE MOBILE — le débordement passe derrière « Plus ».
 *
 * LE DÉFAUT QU'ELLE VERROUILLE. Snytch porte deux écrans de plus (Fichiers,
 * Vidéos). Posés en onglets, la barre montait à HUIT colonnes : 47 px chacune
 * sur 375 px, et « Comptes » — une destination quotidienne — se coupait en
 * « Compt… ».
 *
 * 375 px et pas 390 : c'est la largeur de l'iPhone SE/13 mini, le cas le plus
 * étroit du parc. Tester à 390 laisserait passer une barre qui casse à 375.
 *
 * L'assertion qui compte n'est pas « Plus existe » mais « Fichiers et Vidéos ne
 * sont PLUS des onglets » : c'est elle qui tombe si quelqu'un les y remet.
 */
test.describe("Créateur — barre mobile et entrée « Plus »", () => {
  test("Fichiers/Vidéos derrière « Plus » sur Snytch, absente ailleurs", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    // Ceinture ET bretelles : on repart d'un projet neuf même si un run
    // précédent est mort avant son nettoyage (no-op si absent).
    await admin.mutation(api.projects.e2eDeleteProject, {
      secret: E2E_SECRET,
      slug: "snytch",
    });
    const email = `e2e-nav-plus-${ts}@repackit.test`;
    const password = "nav-plus-12345";
    await createCreatorSession(url, {
      name: `[E2E_TEST] NavPlus ${ts}`,
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

    // ── Projet SANS écrans supplémentaires : 6 onglets, aucune entrée « Plus ».
    await expect(cellules).toHaveCount(6, { timeout: 20_000 });
    await expect(page.getByTestId("bottom-nav-more")).toHaveCount(0);

    // ── Projet SNYTCH : 7 cellules, dont « Plus ». JAMAIS 8.
    const { projectId } = await admin.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: "snytch", name: SNYTCH_NOM },
    );
    await admin.mutation(api.creators.e2eAddCreatorToProject, {
      secret: E2E_SECRET,
      email,
      projectId,
    });
    await page.goto("/app");
    await page.getByRole("button", { name: "Changer de projet" }).click();
    await page.getByRole("menuitem", { name: SNYTCH_NOM }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });
    await expect(cellules).toHaveCount(7, { timeout: 20_000 });

    // L'ASSERTION CENTRALE : les deux écrans ne sont plus des onglets.
    await expect(barre.getByRole("link", { name: "Fichiers" })).toHaveCount(0);
    await expect(barre.getByRole("link", { name: "Vidéos" })).toHaveCount(0);
    // Contrôle de PRÉSENCE apparié : les onglets quotidiens, eux, sont intacts
    // et portent leur libellé ENTIER (c'est « Comptes » qui se coupait).
    await expect(barre.getByRole("link", { name: "Comptes" })).toBeVisible();
    await expect(barre.getByRole("link", { name: "Missions" })).toBeVisible();

    // ── La feuille « Plus » contient bien les deux écrans, et ils marchent.
    const plus = page.getByTestId("bottom-nav-more");
    await expect(plus).toBeVisible();
    await plus.click();
    const feuille = page.getByRole("dialog");
    await expect(feuille.getByRole("link", { name: "Fichiers" })).toBeVisible({
      timeout: 10_000,
    });
    await feuille.getByRole("link", { name: "Vidéos" }).click();
    await page.waitForURL("**/app/videos", { timeout: 20_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: "Mes vidéos" }),
    ).toBeVisible({ timeout: 20_000 });

    // ── « Plus » est ACTIVE sur un écran qu'elle contient : sans ça, la barre
    //    n'indiquerait plus où on est dès qu'on navigue dedans.
    await expect(plus).toHaveAttribute("aria-current", "page");
    // Et l'accueil ne l'est plus (deux tests opposés sur la même condition).
    await expect(barre.getByRole("link", { name: "Accueil" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );

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

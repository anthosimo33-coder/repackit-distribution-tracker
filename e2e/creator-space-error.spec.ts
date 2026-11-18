import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Espace créatrice — une query en échec affiche la page d'erreur DANS l'espace,
 * au lieu d'une page blanche (app/(app)/app/error.tsx).
 *
 * Déclencheur réel, sans rien casser côté backend : une fiche mission ouverte
 * avec un identifiant qui n'en est pas un (lien tronqué, copié de travers).
 * `assignments:getMyAssignment` valide `v.id("assignments")` et LANCE ; avant
 * la frontière, React démontait tout l'espace — onglets compris.
 */
test.describe("Espace créatrice — page d'erreur", () => {
  test("une query en échec garde les onglets et propose de réessayer", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const email = `e2e-creator-erreur-${ts}@repackit.test`;
    const password = "creator-erreur-12345";
    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Erreur ${ts}`,
      email,
    });

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });

    // Preuve que c'est bien la query qui a échoué (et pas un écran vide pour
    // une autre raison) : son nom passe dans la console du navigateur.
    const erreurs: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") erreurs.push(m.text());
    });
    page.on("pageerror", (e) => erreurs.push(e.message));

    try {
      await page.goto("/app/assignments/pas-un-identifiant");

      await expect(
        page.getByRole("heading", { name: "Cet écran n'a pas pu s'afficher" }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
      expect(erreurs.some((e) => e.includes("getMyAssignment"))).toBe(true);
      // Le code de requête Convex, seul détail technique montré : c'est lui qui
      // retrouve l'appel dans les journaux quand la créatrice le transmet.
      await expect(page.getByText("Si ça continue, envoie ce code à l'équipe :")).toBeVisible();
      const code = page.locator("main code");
      await expect(code).toHaveText(/^[0-9a-f]{8,}$/);

      // « Réessayer » rejoue vraiment la query : un nouvel appel, donc un
      // nouveau code (ici elle échoue encore — l'identifiant reste faux).
      const premier = await code.textContent();
      await page.getByRole("button", { name: "Réessayer" }).click();
      await expect(code).toHaveText(/^[0-9a-f]{8,}$/);
      await expect(code).not.toHaveText(premier ?? "", { timeout: 15_000 });

      // Les onglets sont restés montés : on repart sans recharger.
      const sidebar = page.getByRole("navigation", { name: "Navigation créateur" });
      await sidebar.getByRole("link", { name: "Missions", exact: true }).click();
      await page.waitForURL("**/app/missions", { timeout: 15_000 });
      await expect(page.getByRole("heading", { name: "Mes missions" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByRole("heading", { name: "Cet écran n'a pas pu s'afficher" }),
      ).toHaveCount(0);
    } finally {
      await ctx.close();
      await convex.mutation(api.creators.cleanupTestCreators, {
        secret: E2E_SECRET,
      });
    }
  });
});

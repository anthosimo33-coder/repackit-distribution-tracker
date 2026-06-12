import { test as setup, expect } from "@playwright/test";
import path from "path";
import { E2E_EMAIL, E2E_PASSWORD } from "./helpers/authed-client";

export const STORAGE_STATE = path.join(__dirname, ".auth", "user.json");

/**
 * Remédiation sécurité — projet Playwright "setup" (dépendance du projet
 * chromium) : connecte le user e2e via l'UI /login et sauvegarde le
 * storageState (cookies de session Convex Auth posés par le proxy Next).
 * Toutes les specs réutilisent ce state → une seule authentification par run.
 *
 * Premier run sur un deployment fraîchement provisionné : le user n'existe
 * pas → bascule sur la création bootstrap (table users vide → superadmin).
 * Si le sign-in ET le sign-up échouent, le message d'erreur du run pointe
 * vers la cause probable (E2E_SECRET changé après création du user, ou
 * users non vide sans le user e2e).
 */
setup("authentifie le user e2e", async ({ page }) => {
  if (E2E_PASSWORD.length === 0) {
    throw new Error(
      "E2E_SECRET (ou E2E_PASSWORD) manquant — impossible d'authentifier le user e2e.",
    );
  }

  // Tentative de connexion d'un compte existant.
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_EMAIL);
  await page.getByLabel("Mot de passe").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();

  // Issue : soit on quitte /login (succès → push /dashboard), soit on reste
  // sur /login avec une alerte (échec → user inexistant). On distingue les
  // deux par l'URL FINALE plutôt que par une alerte transitoire (la redirection
  // peut détacher l'alerte au moment où on la lit).
  await page
    .waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    })
    .catch(() => {
      /* resté sur /login → bootstrap ci-dessous */
    });

  if (new URL(page.url()).pathname.startsWith("/login")) {
    // User inexistant → fenêtre bootstrap (premier compte = superadmin).
    await page
      .getByRole("button", {
        name: "Premier démarrage ? Créer le compte initial",
      })
      .click();
    await page.getByRole("button", { name: "Créer le compte" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    });
  }

  // Confirme que l'app authentifiée est bien montée avant de figer le state.
  await expect(
    page.getByRole("heading", { name: "Dashboard" }),
  ).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: STORAGE_STATE });
});

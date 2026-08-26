import { test, expect } from "./fixtures/auth-fixture";
import { api } from "../convex/_generated/api";
import { createE2eClient } from "./helpers/authed-client";
import { formatUtcDay } from "../convex/accountPhase";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * ESPACE CLIPPEUR — l'écran, par une SESSION RÉELLE.
 *
 * Aucun harnais de rendu hors session : le clippeur passe par /join comme une
 * personne réelle, et ce qui est vérifié l'est sur la vraie garde de rôle
 * (`usePortalGate` + `clipperQuery`). Un harnais qui rend des écrans sans
 * identifiant est une route réelle qui authentifie sans identifiant — la classe
 * d'objet qui survit une fois sur vingt.
 *
 * Nommage `[E2E_TEST]` + emails `e2e-creator-*` : ramassés par le cleanup existant.
 */

const JOUR = 86_400_000;

test.describe("Espace clippeur — /clip", () => {
  test("déclarer un compte, le voir en attente, puis lire son quota du jour", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const email = `e2e-creator-clipper-espace-${ts}@repackit.test`;
    const password = `clip-espace-${ts}`;
    const handle = `@e2eclip${ts}`;

    const { creatorId, token } = await convex.mutation(
      api.creators.inviteCreator,
      { name: `[E2E_TEST] clippeur espace ${ts}`, email, kind: "clipper" },
    );

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    // La matrice de redirection par rôle envoie un clippeur sur /clip, pas /app.
    await page.waitForURL("**/clip", { timeout: 20_000 });

    // L'espace est vide et le DIT — pas une page blanche.
    await expect(page.getByText(/aucun compte déclaré/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/rien à monter pour l'instant/i)).toBeVisible();

    // Déclaration.
    await page.getByRole("button", { name: /déclarer un compte/i }).click();
    await page.getByLabel(/pseudo du compte/i).fill(handle);
    await page.getByRole("button", { name: "Déclarer", exact: true }).click();

    // Tant que l'admin n'a pas validé, rien ne peut sortir — et l'écran l'écrit.
    await expect(page.getByText(handle)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/en attente de validation/i)).toBeVisible();

    // L'admin valide, et l'ancre est antidatée de 13 jours → croisière (2/jour).
    const comptes = await convex.query(api.comptes.listComptes, {});
    const compte = comptes.find((c) => c.handle === handle);
    expect(compte).toBeTruthy();
    await convex.mutation(api.comptes.e2eSeedAvailableCompte, {
      secret: process.env.E2E_SECRET!,
      creatorId,
      plateforme: "TikTok",
      handle,
      validatedAt: ts - 13 * JOUR,
    });

    await page.reload();
    // Le compteur nomme la journée UTC — LE MÊME repère que le refus serveur.
    await expect(page.getByText(/phase de croisière/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(new RegExp(`0 publication sur 2 pour le ${formatUtcDay(ts, "fr")}`, "i")),
    ).toBeVisible();
    await expect(page.getByText(/2 publications possibles aujourd'hui/i)).toBeVisible();

    await ctx.close();
  });

  test("un clippeur ne voit pas les comptes d'un autre clippeur", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const handleA = `@e2eclipa${ts}`;

    const a = await convex.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] clippeur A ${ts}`,
      email: `e2e-creator-clipper-a-${ts}@repackit.test`,
      kind: "clipper",
    });
    const b = await convex.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] clippeur B ${ts}`,
      email: `e2e-creator-clipper-b-${ts}@repackit.test`,
      kind: "clipper",
    });
    // Un compte appartenant à A.
    await convex.mutation(api.comptes.e2eSeedAvailableCompte, {
      secret: process.env.E2E_SECRET!,
      creatorId: a.creatorId,
      plateforme: "TikTok",
      handle: handleA,
      validatedAt: ts - 13 * JOUR,
    });

    // B ouvre SON espace : le compte de A n'y est pas. Le filtrage est serveur
    // (clipperQuery + ctx.creatorId), pas un masquage d'écran.
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${b.token}`);
    await page.getByLabel("Mot de passe").fill(`clip-b-${ts}`);
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/clip", { timeout: 20_000 });

    await expect(page.getByText(/aucun compte déclaré/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(handleA)).toHaveCount(0);

    await ctx.close();
  });
});

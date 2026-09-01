import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * FICHE CRÉATRICE — le fuseau horaire se saisit, et son ABSENCE ne bloque rien.
 *
 * Deux garanties demandées avant de renseigner les 7 fiches restantes à la main :
 *   1. l'écran admin permet réellement de poser un fuseau, et il l'enregistre ;
 *   2. une fiche SANS fuseau (« Antho Test », compte de test qui restera vide)
 *      ne casse aucun écran — ni la fiche, ni la liste, ni l'espace créatrice.
 *
 * ⚠️ Le point 2 est le vrai sujet. Une valeur nulle qui remonte dans un
 * `Intl.DateTimeFormat` lève, et une exception dans un rendu React vide la page
 * entière — pas seulement le champ. C'est le mode de panne qu'on vérifie, et
 * c'est pour ça que les assertions portent sur la PRÉSENCE d'autre chose à
 * l'écran, jamais sur la seule absence d'erreur.
 */
test.describe("Fiche créatrice — fuseau horaire", () => {
  test("l'admin peut poser un fuseau, et la provenance passe à « saisi »", async ({
    page,
  }) => {
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] TZ admin ${ts}`,
      email: `e2e-tzadmin-${ts}@repackit.test`,
      password: "creator-tzadm-12345",
    });

    await page.goto(adminPath(`/createurs/${A.creatorId}`));

    const select = page.getByRole("combobox", { name: "Fuseau horaire" });
    await expect(select).toBeVisible({ timeout: 10000 });
    // Fiche neuve, sans compte : aucun fuseau déductible → « à définir ».
    await expect(page.getByText("à définir")).toBeVisible();

    await select.click();
    await page.getByRole("option", { name: /Los Angeles/ }).click();
    await page.getByRole("button", { name: /Enregistrer/ }).first().click();

    // La valeur est bien PERSISTÉE côté serveur, avec la provenance « admin » —
    // une saisie humaine n'est pas une confirmation par la créatrice.
    await expect
      .poll(
        async () =>
          (
            await convex.query(api.creators.getCreatorTimezone, {
              id: A.creatorId,
            })
          ).timezone,
        { timeout: 10000 },
      )
      .toBe("America/Los_Angeles");
    expect(
      (await convex.query(api.creators.getCreatorTimezone, { id: A.creatorId }))
        .source,
    ).toBe("admin");

    // Et l'écran le dit : « à confirmer » tant que ce n'est pas elle.
    await page.reload();
    await expect(page.getByText("saisi — à confirmer")).toBeVisible({
      timeout: 10000,
    });
  });

  test("le fuseau peut être REMIS à « non défini »", async ({ page }) => {
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] TZ reset ${ts}`,
      email: `e2e-tzreset-${ts}@repackit.test`,
      password: "creator-tzres-12345",
    });
    await A.client.mutation(api.creators.confirmMyTimezone, {
      projectId: A.projectId,
      timezone: "America/New_York",
    });

    await page.goto(adminPath(`/createurs/${A.creatorId}`));
    const select = page.getByRole("combobox", { name: "Fuseau horaire" });
    await expect(select).toBeVisible({ timeout: 10000 });
    await select.click();
    await page.getByRole("option", { name: "Non défini", exact: true }).click();
    await page.getByRole("button", { name: /Enregistrer/ }).first().click();

    await expect
      .poll(
        async () =>
          (
            await convex.query(api.creators.getCreatorTimezone, {
              id: A.creatorId,
            })
          ).timezone,
        { timeout: 10000 },
      )
      .toBeNull();
  });

  test("une fiche SANS fuseau ne casse ni la fiche, ni la liste (cas « Antho Test »)", async ({
    page,
  }) => {
    const ts = Date.now();
    const nom = `[E2E_TEST] Antho Test ${ts}`;
    const A = await createCreatorSession(convexUrl, {
      name: nom,
      email: `e2e-antho-${ts}@repackit.test`,
      password: "creator-antho-12345",
    });
    // Un compte SANS pays : rien à déduire, le fuseau restera vide.
    await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2eantho${ts}`,
    });

    // 1. La FICHE se rend entièrement — on exige la présence de champs qui
    //    vivent APRÈS le bloc fuseau dans le DOM : si le rendu avait levé, ils
    //    seraient absents.
    await page.goto(adminPath(`/createurs/${A.creatorId}`));
    await expect(page.getByRole("combobox", { name: "Fuseau horaire" })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("à définir")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Langue" })).toBeVisible();
    // « Population » vit dans un bloc PLUS BAS que le fuseau : si le rendu avait
    // levé sur un fuseau nul, ce sélecteur-là n'existerait pas.
    await expect(
      page.getByRole("combobox", { name: "Population" }),
    ).toBeVisible();

    // 2. La LISTE des créateurs la rend aussi.
    await page.goto(adminPath("/createurs"));
    await expect(page.getByText(nom)).toBeVisible({ timeout: 10000 });

    // 3. La liste des COMPTES admin (elle sert `creatorTimezone: null`).
    await page.goto(adminPath("/comptes"));
    await expect(
      page.getByRole("row").filter({ hasText: `@e2eantho${ts}` }),
    ).toBeVisible({ timeout: 10000 });

    // 4. Et le serveur reste utilisable : elle peut cocher son warmup, en UTC.
    const comptes = await A.client.query(api.comptes.listMyComptes, {
      projectId: A.projectId,
    });
    expect(comptes[0].creatorTimezone).toBeNull();
    expect(comptes[0].dueToday).toBe(true);
  });
});

import { test, expect } from "./fixtures/auth-fixture";
import { api } from "../convex/_generated/api";
import { createE2eClient, adminPath } from "./helpers/authed-client";
import { config } from "dotenv";
config({ path: ".env.local" });
const admin = createE2eClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const MARKER = "[E2E_TEST]";

/**
 * COLONNE POPULATION et son filtre.
 *
 * Deux moitiés, et la première est nouvelle : une colonne qui rend la MÊME
 * pastille sur toutes les lignes n'est pas une colonne, c'est du bruit. Sur un
 * projet 100 % partenaires elle occupait une colonne entière et un menu pour
 * zéro information. Elle DOIT donc disparaître — et DOIT revenir dès qu'une
 * seconde population existe, sinon on aurait juste supprimé une fonctionnalité.
 *
 * La seconde moitié est l'invariant historique : filtrer ne doit pas toucher aux
 * compteurs. S'ils se recalculaient sur la liste visible, le filtre effacerait en
 * le posant l'information qu'il est censé donner.
 *
 * ⚠️ ORDRE SIGNIFICATIF. Le premier test s'appuie sur une base sans talent ni
 * clippeur ; la fixture nettoie par FICHIER, donc il doit passer AVANT que le
 * second en sème. Les inverser rendrait le premier vert pour la mauvaise raison.
 */
test.describe("Créateurs — population dans la liste", () => {
  test("un projet d'une seule population n'affiche NI colonne NI filtre", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    for (const n of ["solo-a", "solo-b"]) {
      await admin.mutation(api.creators.inviteCreator, {
        name: `${MARKER} ${n} ${ts}`,
        email: `e2e-creator-pop-${ts}-${n}@repackit.test`,
        // Aucun `kind` : partenaire, comme les dix-sept fiches de la prod.
      });
    }
    await page.goto(adminPath("/createurs"));

    // ASSERTION DE PRÉSENCE d'abord : sans elle, un écran vide ou en erreur
    // ferait passer les deux absences ci-dessous pour un succès.
    await expect(page.getByRole("columnheader", { name: "Nom" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("cell", { name: `${MARKER} solo-a ${ts}`, exact: true }),
    ).toHaveCount(1);

    await expect(
      page.getByRole("columnheader", { name: "Population" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("filtre-population")).toHaveCount(0);

    // Et l'axe disparaît AUSSI du regroupement : proposer « grouper par
    // population » sur un projet qui n'en a qu'une produirait un seul groupe,
    // au titre redondant avec l'écran entier.
    await expect(
      page.getByTestId("grouper-par").locator("option[value='kind']"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("grouper-par").locator("option[value='region']"),
    ).toHaveCount(1);
  });

  test("dès qu'une 2e population existe : colonne, menu, et compteurs intacts", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    for (const k of ["partner", "talent", "clipper"] as const) {
      await admin.mutation(api.creators.inviteCreator, {
        name: `${MARKER} pop ${k} ${ts}`,
        email: `e2e-creator-pop2-${ts}-${k}@repackit.test`,
        kind: k,
      });
    }
    await page.goto(adminPath("/createurs"));

    await expect(
      page.getByRole("columnheader", { name: "Population" }),
    ).toBeVisible({ timeout: 15_000 });
    // Assertions portées sur LES LIGNES DE CE TEST, pas sur un compte global
    // de cellules : le test précédent du même fichier a déjà semé deux
    // partenaires (la fixture nettoie par FICHIER, pas par test), et un
    // `toHaveCount(1)` sur « Partenaire » compterait les siens.
    const ligne = (k: string) =>
      page.getByRole("row").filter({ hasText: `${MARKER} pop ${k} ${ts}` });
    await expect(ligne("partner")).toContainText("Partenaire");
    await expect(ligne("talent")).toContainText("Talent");
    await expect(ligne("clipper")).toContainText("Clippeur");

    // Le déclencheur du menu n'est PAS atteignable par `getByRole("combobox")`
    // (le `render` de base-ui écrase le rôle) et son libellé visible — « Toutes »
    // — est partagé par plusieurs menus. D'où l'enveloppe `data-testid`.
    const menu = page.getByTestId("filtre-population");
    await menu.locator("button").click();

    // Options cherchées DANS le popover : les `<select>` natifs de la barre
    // d'outils exposent eux aussi des `role="option"`.
    const options = page.getByTestId("filtre-options");
    const optionPartenaire = options.getByRole("option", {
      name: /^Créateur partenaire/,
    });
    await expect(optionPartenaire).toBeVisible();
    const avant = (await optionPartenaire.textContent())?.match(/(\d+)\s*$/)?.[1];
    expect(avant, "le compteur Partenaire doit être lisible").toBeTruthy();

    await options.getByRole("option", { name: /^Talent/ }).click();

    // Le filtre a bien réduit la liste…
    await expect(ligne("talent")).toHaveCount(1);
    await expect(ligne("partner"), "le partenaire sort").toHaveCount(0);
    await expect(ligne("clipper"), "le clippeur sort").toHaveCount(0);

    // …ET le compteur de l'axe qu'on vient de filtrer n'a pas bougé. C'est
    // précisément la règle : un axe ne se compte JAMAIS sur lui-même, sinon
    // cocher « Talent » ferait tomber « Partenaire » à zéro et on ne saurait
    // plus quoi cocher pour revenir.
    const apres = (await optionPartenaire.textContent())?.match(/(\d+)\s*$/)?.[1];
    expect(apres, "filtrer un axe ne touche pas à ses propres compteurs").toBe(
      avant,
    );
  });
});

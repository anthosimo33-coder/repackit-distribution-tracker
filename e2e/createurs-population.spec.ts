import { test, expect } from "./fixtures/auth-fixture";
import { api } from "../convex/_generated/api";
import { createE2eClient, adminPath } from "./helpers/authed-client";
import { config } from "dotenv";
config({ path: ".env.local" });
const admin = createE2eClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
/**
 * Colonne POPULATION et son filtre. À 20 créateurs, une liste qui mélange trois
 * populations pilotées différemment n'est plus lisible ; le compte par
 * population est autant l'information que le filtre.
 *
 * L'assertion qui compte est la DERNIÈRE : filtrer ne doit pas toucher aux
 * compteurs. S'ils se recalculaient sur la liste visible, le filtre effacerait
 * en le posant l'information qu'il est censé donner.
 */
test.describe("Créateurs — population dans la liste", () => {
test("colonne, pastilles, et filtre qui ne touche pas aux compteurs", async ({ page }) => {
  test.setTimeout(90_000);
  const ts = Date.now();
  let i = 0;
  for (const k of ["partner","talent","clipper"] as const) {
    i++;
    await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] pop ${k} ${i}`,
      email: `e2e-creator-pop-${ts}-${i}@repackit.test`, kind: k,
    });
  }
  await page.goto(adminPath("/createurs"));
  // La colonne existe et chaque population a sa pastille.
  await expect(page.getByRole("columnheader", { name: "Population" })).toBeVisible({ timeout: 15000 });
  for (const label of ["Partenaire", "Talent", "Clippeur"]) {
    await expect(page.getByRole("cell", { name: label, exact: true })).toHaveCount(1);
  }
  // Le filtre réduit la liste sans toucher aux compteurs.
  await page.getByRole("button", { name: /^Talent/ }).click();
  await expect(page.getByRole("cell", { name: "Talent", exact: true })).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "Partenaire", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Partenaire/ })).toContainText("1");
});
});

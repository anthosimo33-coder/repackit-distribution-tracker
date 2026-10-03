import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * LIEN DU PROFIL — modifiable, et signalé quand il ouvre un autre compte que le @.
 *
 * Cas de prod du 03/10/2026 : `@Sarah_snytch` déclaré avec un lien de partage
 * vers `sarah_snitch1`. Le clic sur le @ suit le LIEN (il prime, cf
 * lib/compte-profile-url) : il ouvrait le mauvais profil, et rien ne permettait
 * de corriger un lien après la déclaration.
 */
test("un lien qui ouvre un autre compte que le @ est signalé, puis corrigé", async ({ page }) => {
  const ts = Date.now();
  const handle = `@test_e2e_lien${ts}`;
  const id = await convex.mutation(api.comptes.createCompte, {
    handle,
    plateforme: "Instagram",
    notes: "[E2E_TEST] lien profil",
  });
  // Le lien de partage avec sa coquille, tel que collé en prod.
  await convex.mutation(api.comptes.updateCompte, {
    id,
    url: `https://www.instagram.com/test_e2e_lien${ts}_coquille?igsh=MWx5ZjQ0YXkyOTBvcA%3D%3D`,
  });

  await page.goto(adminPath("/comptes"));
  const row = page.getByRole("row").filter({ hasText: handle });
  // Le clic sur le @ suit le lien : il ouvre bien la coquille.
  await expect(row.getByRole("link", { name: handle })).toHaveAttribute(
    "href",
    `https://www.instagram.com/test_e2e_lien${ts}_coquille/`,
  );

  await row.getByRole("button").last().click();
  await page.getByRole("menuitem", { name: "Modifier" }).click();
  const avertissement = page.getByTestId("compte-lien-divergent");
  // PRÉSENT tant que le lien ouvre un autre compte…
  await expect(avertissement).toContainText(`test_e2e_lien${ts}_coquille`);
  await expect(avertissement).toContainText(handle);
  // … ABSENT dès que le lien désigne le même compte (casse ignorée).
  await page.getByLabel("Lien du profil").fill(`https://www.instagram.com/TEST_e2e_lien${ts}/`);
  await expect(avertissement).toHaveCount(0);
  await page.getByRole("button", { name: /^enregistrer$/i }).click();

  // Autorité : la base, puis le lien rendu.
  await expect
    .poll(async () => (await convex.query(api.comptes.listComptes, {})).find((c) => c._id === id)?.url)
    .toBe(`https://www.instagram.com/TEST_e2e_lien${ts}/`);
  // Le lien rendu est reconstruit (canonique, minuscules) : il ouvre le bon compte.
  await expect(row.getByRole("link", { name: handle })).toHaveAttribute(
    "href",
    `https://www.instagram.com/test_e2e_lien${ts}/`,
  );

  // Vider le lien le RETIRE : le @ redevient le lien.
  await convex.mutation(api.comptes.updateCompte, { id, url: null });
  await expect(row.getByRole("link", { name: handle })).toHaveAttribute(
    "href",
    `https://www.instagram.com/test_e2e_lien${ts}/`,
  );
  expect((await convex.query(api.comptes.listComptes, {})).find((c) => c._id === id)?.url).toBeUndefined();
});

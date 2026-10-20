import { test, expect } from "./fixtures/auth-fixture";
import { api } from "../convex/_generated/api";
import { adminPath, createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * « RETIRER DU PROJET », DANS L'ÉCRAN — la garde de la saisie, et le geste.
 *
 * Le serveur est éprouvé dans team-roles.spec.ts. Ici, ce que seul l'écran
 * peut casser : le bouton n'est proposé qu'à qui peut partir, la confirmation
 * reste fermée tant que l'e-mail recopié n'est pas EXACTEMENT le sien, et le
 * clic retire bien CETTE ligne-là, pas une voisine.
 */
test("retirer un admin exige son e-mail recopié, et ne retire que lui", async ({ page }) => {
  test.setTimeout(120_000);
  const ts = Date.now();
  const projectId = await admin.getProjectId();
  // Forme de prod : deux administrateurs d'équipe, adresses complètes.
  const partant = `e2e-retrait-ui-camille.bertrand-${ts}@repackit.test`;
  const reste = `e2e-retrait-ui-yanis.haddad-${ts}@repackit.test`;
  const creatrice = `e2e-retrait-ui-creatrice-${ts}@repackit.test`;
  for (const email of [partant, reste]) {
    await admin.mutation(api.projects.e2eEnsureMemberUser, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "admin",
    });
  }
  await admin.mutation(api.projects.e2eEnsureMemberUser, {
    secret: E2E_SECRET,
    email: creatrice,
    projectId,
    role: "creator",
  });

  await page.goto(adminPath("/equipe"));
  const bouton = (email: string) =>
    page.getByRole("button", { name: `Retirer du projet : ${email}` });
  await expect(bouton(partant)).toBeVisible({ timeout: 30_000 });
  await expect(bouton(reste)).toBeVisible();
  // Un espace créateur ne se retire pas d'ici (on archive sa fiche) : pas de
  // bouton — sa ligne, elle, est bien rendue.
  await expect(page.getByText(creatrice, { exact: true })).toBeVisible();
  await expect(bouton(creatrice)).toHaveCount(0);

  await bouton(partant).click();
  const dialogue = page.getByRole("alertdialog");
  await expect(dialogue).toContainText(`Retirer ${partant} de`);
  const confirmer = dialogue.getByRole("button", { name: "Retirer du projet" });
  await expect(confirmer).toBeDisabled();
  // L'e-mail d'un AUTRE membre ne déverrouille rien.
  await dialogue.getByLabel("Recopie son e-mail pour confirmer").fill(reste);
  await expect(confirmer).toBeDisabled();
  await dialogue.getByLabel("Recopie son e-mail pour confirmer").fill(partant);
  await expect(confirmer).toBeEnabled();
  await confirmer.click();

  await expect(page.getByText(`${partant} n'est plus membre de`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(partant, { exact: true })).toHaveCount(0);
  // PRÉSENCE en regard : l'autre administrateur est toujours là, à l'écran
  // comme en base.
  await expect(page.getByText(reste, { exact: true })).toBeVisible();
  expect(
    await admin.mutation(api.permissionProbe.e2eReadMembership, {
      secret: E2E_SECRET,
      email: partant,
      projectId,
    }),
  ).toBeNull();
  expect(
    (
      await admin.mutation(api.permissionProbe.e2eReadMembership, {
        secret: E2E_SECRET,
        email: reste,
        projectId,
      })
    )?.effectifs,
  ).toEqual(["admin"]);
});

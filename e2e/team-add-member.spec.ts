import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { adminPath, createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * « AJOUTER UN MEMBRE D'ÉQUIPE », DANS L'ÉCRAN.
 *
 * Le serveur est éprouvé dans team-roles.spec.ts. Ici, ce que seul l'écran peut
 * casser : le lien d'un compte neuf est AFFICHÉ (c'est le seul moyen qu'il a
 * d'entrer — rien ne lui est envoyé), et « Administrateur » ne passe pas sans
 * la confirmation qui dit ce qu'il ouvre.
 */
test("ajouter : un compte neuf repart avec son lien, un admin passe par la confirmation", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ts = Date.now();
  const projectId = await admin.getProjectId();
  const neuf = `e2e-ajout-ui-lea.marchand-${ts}@repackit.test`;

  // Un compte EXISTANT, sans ligne sur ce projet (invité puis retiré d'ici).
  const existant = `e2e-ajout-ui-yanis.haddad-${ts}@repackit.test`;
  const { token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ajout ui ${ts}`,
    email: existant,
  });
  await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
    provider: "password",
    params: { email: existant, password: `ajout-${ts}`, flow: "signUp", inviteToken: token },
  });
  await admin.mutation(api.permissionProbe.e2eDropMembership, {
    secret: E2E_SECRET,
    email: existant,
    projectId,
  });

  await page.goto(adminPath("/equipe"));
  const champ = page.getByLabel("E-mail", { exact: true });
  await expect(champ).toBeVisible({ timeout: 30_000 });

  // ── 1. Compte NEUF, manager : le lien s'affiche ────────────────────────────
  await champ.fill(neuf);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const dialogueLien = page.getByRole("dialog");
  await expect(dialogueLien).toContainText(`Compte créé pour ${neuf}`, { timeout: 15_000 });
  await expect(
    dialogueLien.getByLabel("Lien pour choisir son mot de passe"),
  ).toHaveValue(/\/reset-password\/[0-9a-f]{64}$/);
  await page.keyboard.press("Escape");
  await expect(dialogueLien).toHaveCount(0);
  // Sa carte de manager est là.
  await expect(page.getByText(neuf, { exact: true })).toBeVisible();

  // ── 2. Compte EXISTANT, administrateur : confirmation obligatoire ──────────
  await champ.fill(existant);
  await page.getByRole("radio", { name: "Administrateur" }).click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText(`Ajouter ${existant} comme administrateur`);
  // Annuler n'écrit rien.
  await confirmation.getByRole("button", { name: "Annuler" }).click();
  expect(
    await admin.mutation(api.permissionProbe.e2eReadMembership, {
      secret: E2E_SECRET,
      email: existant,
      projectId,
    }),
  ).toBeNull();

  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Ajouter comme administrateur" })
    .click();
  await expect(page.getByText(`${existant} est administrateur de`)).toBeVisible({
    timeout: 15_000,
  });
  // Pas de lien pour un compte qui en a déjà un.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (
      await admin.mutation(api.permissionProbe.e2eReadMembership, {
        secret: E2E_SECRET,
        email: existant,
        projectId,
      })
    )?.effectifs,
  ).toEqual(["admin"]);
});

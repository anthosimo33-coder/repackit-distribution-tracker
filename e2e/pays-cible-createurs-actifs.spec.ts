import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createCreatorSession } from "./helpers/creator-client";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

/**
 * Pays ciblé filtrable (Comptes + Assignments), et filtres créateur qui ne
 * listent plus les créatrices SORTIES du parc.
 *
 * Deux créatrices à la forme de la prod : une ACTIVE qui cible l'Islande, une
 * PARTIE (« churned ») qui ciblait Malte — son compte et son assignation
 * restent en base, comme ceux de Cinthia ou Marine sur Snytch. Des pays rares
 * pour que la base e2e partagée ne mette personne d'autre sous le filtre.
 */
async function semer(ts: number) {
  const nomActive = `[E2E_TEST] Pays Active ${ts}`;
  const nomPartie = `[E2E_TEST] Pays Partie ${ts}`;
  // Une créatrice ASSIGNABLE a un compte utilisateur : d'où la session.
  const { creatorId: activeId } = await createCreatorSession(convexUrl!, {
    name: nomActive,
    email: `e2e-pays-active-${ts}@repackit.test`,
    password: "creator-pays-12345",
  });
  const { creatorId: partieId } = await createCreatorSession(convexUrl!, {
    name: nomPartie,
    email: `e2e-pays-partie-${ts}@repackit.test`,
    password: "creator-pays-12345",
  });
  // Les DEUX sont actives au départ : on n'assigne pas une invitée (refus
  // serveur), et la partie a bien travaillé avant de partir.
  for (const id of [activeId, partieId]) {
    await admin.mutation(api.creators.updateCreator, { id, status: "active" });
  }
  const handleIS = `@e2epaysis${ts}`;
  const handleMT = `@e2epaysmt${ts}`;
  const cibleIS = await availableTarget({
    e2eClient: admin,
    creatorId: activeId,
    platform: "TikTok",
    handle: handleIS,
  });
  const cibleMT = await availableTarget({
    e2eClient: admin,
    creatorId: partieId,
    platform: "TikTok",
    handle: handleMT,
  });
  await admin.mutation(api.comptes.updateCompte, {
    id: cibleIS.accountId,
    targetCountry: "IS",
  });
  await admin.mutation(api.comptes.updateCompte, {
    id: cibleMT.accountId,
    targetCountry: "MT",
  });
  const formatId = (await createFormatWithRate(admin, {
    name: `[E2E_TEST] Pays Fmt ${ts}`,
    type: "short",
    rateModel: { basePerPost: 30 },
  })) as Id<"formats">;
  for (const [creatorId, cible] of [
    [activeId, cibleIS],
    [partieId, cibleMT],
  ] as const) {
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId,
      targets: [cible],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
  }
  // Elle part APRÈS avoir reçu sa vidéo : c'est l'assignation d'une créatrice
  // sortie qui doit rester retrouvable, pas une assignation impossible.
  await admin.mutation(api.creators.updateCreator, {
    id: partieId,
    status: "churned",
  });
  return { nomActive, nomPartie, handleIS, handleMT };
}

test.describe("Pays ciblé + créatrices actives dans les filtres", () => {
  test("Comptes : filtre et regroupement par pays ; une créatrice partie n'est plus proposée", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { nomActive, nomPartie, handleIS, handleMT } = await semer(Date.now());

    await page.goto(adminPath("/comptes"));
    const ligneIS = page.getByRole("row").filter({ hasText: handleIS });
    const ligneMT = page.getByRole("row").filter({ hasText: handleMT });
    // PRÉSENCE des deux comptes d'abord : la créatrice partie garde le sien
    // dans la table — c'est seulement le FILTRE qui ne la propose plus.
    await expect(ligneIS).toBeVisible({ timeout: 15_000 });
    await expect(ligneMT).toBeVisible();

    await page.getByRole("combobox", { name: "Filtrer par créateur" }).click();
    await expect(
      page.getByRole("option", { name: nomActive, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: nomPartie, exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByRole("combobox", { name: "Filtrer par pays ciblé" }).click();
    await page.getByRole("option", { name: /Islande/ }).click();
    await expect(ligneIS).toBeVisible();
    await expect(ligneMT).toBeHidden();

    // Regroupé par pays, le groupe porte le NOM du pays, pas son code.
    await page.getByRole("combobox", { name: "Grouper les comptes" }).click();
    await page.getByRole("option", { name: "Par pays", exact: true }).click();
    await expect(
      page.getByTestId("entete-groupe").filter({ hasText: "Islande" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("entete-groupe").filter({ hasText: "Malte" }),
    ).toHaveCount(0);
  });

  test("Assignments : filtre pays ; les créatrices sorties sont repliées, à un clic", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { nomActive, nomPartie } = await semer(Date.now());

    await page.goto(adminPath("/assignments"));
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();
    await page.getByRole("radio", { name: "Liste" }).click();

    // ── Filtre créateur : la partie est REPLIÉE, pas supprimée ─────────────
    await page.locator("button").filter({ hasText: "Tous créateurs" }).click();
    const options = page.getByTestId("filtre-options");
    await expect(
      options.getByRole("option", { name: nomActive }),
    ).toBeVisible();
    await expect(options.getByRole("option", { name: nomPartie })).toHaveCount(0);
    await options.getByRole("button", { name: /Afficher les inactives/ }).click();
    await expect(options.getByRole("option", { name: nomPartie })).toBeVisible();

    // Recherche : on vise un prénom, la liste se réduit à lui.
    await page.getByRole("searchbox", { name: /Rechercher dans/ }).fill(
      `Pays Active`,
    );
    await expect(
      options.getByRole("option", { name: nomActive }),
    ).toBeVisible();
    await expect(options.getByRole("option", { name: nomPartie })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // ── Filtre pays ─────────────────────────────────────────────────────────
    await page.locator("button").filter({ hasText: "Tous pays" }).click();
    await page
      .getByTestId("filtre-options")
      .getByRole("option", { name: /Islande/ })
      .click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("cell").filter({ hasText: nomActive }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("cell").filter({ hasText: nomPartie }),
    ).toHaveCount(0);
  });
});

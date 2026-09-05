import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * Suppression d'un créateur (Approche C) — cascade opérationnelle + historique
 * conservé et lisible. Setup : 1 créateur avec
 *   - une mission SCRIPT en cours (combo occupé) → SUPPRIMÉE (combo libéré),
 *   - une mission FORMAT publiée → publication + paiement → CONSERVÉS,
 *   - 2 comptes liés → SUPPRIMÉS.
 * Vérifie la confirmation par saisie du nom (UI), la cascade et la lisibilité
 * (nom dénormalisé) après disparition de la fiche.
 */
test.describe("Suppression d'un créateur — cascade + historique conservé", () => {
  test("supprime l'opérationnel, conserve et rend lisible l'historique", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] DelCreator ${ts}`;

    const c = await createCreatorSession(url, {
      name: creatorName,
      email: `e2e-creator-del-${ts}@repackit.test`,
      password: "del-creator-12345",
    });
    const projectId = c.projectId;

    // ── Mission SCRIPT en cours (1 hook × 1 flux × 1 cta = 1 combo) ──
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] DelCamp ${ts}`,
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "hook",
      label: "H1",
      content: "H1 contenu",
      tier: "S",
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "flux",
      label: "F1",
      content: "F1 contenu",
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "cta",
      label: "C1",
      content: "C1 contenu",
    });
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] DelPricing ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const scriptTarget = await availableTarget({
      e2eClient: admin,
      creatorId: c.creatorId,
      platform: "TikTok",
      handle: `@e2edelscript${ts}`,
    });
    const assigned = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: c.creatorId,
      targets: [scriptTarget],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(assigned.created).toBe(1);
    // L'unique combo est désormais occupé pour ce créateur sur TikTok.
    expect(
      await admin.query(api.scripts.availableCombosForAssignment, {
        campaignId,
        creatorId: c.creatorId,
        platforms: ["TikTok"],
      }),
    ).toEqual({ total: 1, available: 0 });

    // ── Mission FORMAT publiée → publication + paiement (CONSERVÉS) ──
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] DelFmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10 },
    });
    const fmtTarget = await availableTarget({
      e2eClient: admin,
      creatorId: c.creatorId,
      platform: "TikTok",
      handle: `@e2edelfmt${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: c.creatorId,
      targets: [fmtTarget],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const fmtAssignment = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((a) => a.formatId === formatId && a.creatorId === c.creatorId)!;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: fmtAssignment._id,
      status: "to_publish",
    });
    await c.client.mutation(api.assignments.confirmPublication, {
      projectId,
      id: fmtAssignment._id,
      urls: [
        {
          platform: "TikTok",
          url: `https://www.tiktok.com/@e2edelfmt/video/${ts}`,
        },
      ],
    });

    // ── État pré-suppression ──
    expect(
      (await admin.query(api.creators.listCreators, {})).some(
        (x) => x._id === c.creatorId,
      ),
    ).toBe(true);
    const paymentBefore = (
      await admin.query(api.payments.listPayments, {})
    ).find((p) => p.creatorId === c.creatorId)!;
    expect(paymentBefore.creatorName).toBe(creatorName);
    const pubHandle = `@e2edelfmt${ts}`;
    expect(
      (await admin.query(api.publications.listPublications, {})).some(
        (p) => p.compte === pubHandle,
      ),
    ).toBe(true);

    // ── UI : confirmation par saisie du nom ──
    await page.goto(adminPath("/createurs"));
    await page.getByRole("button", { name: `Actions ${creatorName}` }).click();
    await page
      .getByRole("menuitem", { name: /Supprimer le créateur/i })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const confirmBtn = dialog.getByRole("button", {
      name: /Supprimer définitivement/i,
    });
    // Bouton désactivé tant que la saisie ne correspond pas au nom exact.
    await expect(confirmBtn).toBeDisabled();
    const nameInput = dialog.getByLabel("Nom du créateur à confirmer");
    await nameInput.fill("mauvais nom");
    await expect(confirmBtn).toBeDisabled();
    await nameInput.fill(creatorName);
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // ── État post-suppression : cascade ──
    // Fiche créateur supprimée.
    expect(
      (await admin.query(api.creators.listCreators, {})).some(
        (x) => x._id === c.creatorId,
      ),
    ).toBe(false);
    // Comptes supprimés.
    const comptes = await admin.query(api.comptes.listComptes, {});
    expect(comptes.some((cc) => cc.handle === `@e2edelscript${ts}`)).toBe(false);
    expect(comptes.some((cc) => cc.handle === pubHandle)).toBe(false);

    const assignmentsAfter = (
      await admin.query(api.assignments.listAssignments, {})
    ).filter((a) => a.creatorId === c.creatorId);
    // Mission script (en cours) supprimée → combo libéré : plus aucune row
    // occupante (l'unicité combo×créateur×plateforme est purement basée sur
    // l'existence de la row, cf assertComboFreeForCreatorPlatforms).
    expect(
      assignmentsAfter.some((a) => a.scriptCombo?.campaignId === campaignId),
    ).toBe(false);

    // ── État post-suppression : historique CONSERVÉ et LISIBLE ──
    // Mission format publiée conservée, nom dénormalisé lisible (pas "—").
    const keptAssignment = assignmentsAfter.find((a) => a._id === fmtAssignment._id);
    expect(keptAssignment).toBeTruthy();
    expect(keptAssignment!.creatorName).toBe(creatorName);
    // Paiement conservé + lisible via le snapshot (fiche disparue).
    const paymentAfter = (
      await admin.query(api.payments.listPayments, {})
    ).find((p) => p.creatorId === c.creatorId)!;
    expect(paymentAfter).toBeTruthy();
    expect(paymentAfter.creatorName).toBe(creatorName);
    // Publication conservée (handle string indépendant du compte supprimé).
    expect(
      (await admin.query(api.publications.listPublications, {})).some(
        (p) => p.compte === pubHandle,
      ),
    ).toBe(true);

    // Idempotent : re-supprimer ne crashe pas.
    const again = await admin.mutation(api.creators.deleteCreator, {
      id: c.creatorId,
    });
    expect(again.alreadyGone).toBe(true);
  });
});

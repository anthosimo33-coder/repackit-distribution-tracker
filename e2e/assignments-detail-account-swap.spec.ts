import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { minuitParis } from "./helpers/paris-day";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const DAY = 86_400_000;

/**
 * Panneau de détail du calendrier — CHANGER LE COMPTE d'une cible.
 *
 * La créatrice a plusieurs comptes TikTok ; la vidéo doit partir sur un autre
 * que celui choisi à l'assignation. Le sélecteur liste ses comptes de la MÊME
 * plateforme : les choisissables, et — grisés, avec leur raison — ceux que le
 * serveur refuserait (en chauffe, géré par l'équipe). Les archivés n'y sont pas.
 * Une fois le post publié, le compte est figé (vues et paie en dépendent).
 */
test.describe("Admin — panneau de détail : changer le compte d'une cible", () => {
  test("choisir un autre compte TikTok de la créatrice, refus serveur, verrou après publication", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] Kelly Chapters ${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-creator-accswap-${ts}@repackit.test`,
      password: "creator-accswap-12345",
    });
    const other = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Autre créatrice ${ts}`,
      email: `e2e-creator-accswap-other-${ts}@repackit.test`,
      password: "creator-accswap-other-12345",
    });

    // Handles à la forme de la prod : suffixés, points, underscore final.
    const hA = `@thekellychapters_${ts}`;
    const hB = `@kelly.leydie${ts}`;
    const hWarmup = `@kelly.chauffe${ts}`;
    const hManaged = `@kelly.equipe${ts}`;
    const hArchived = `@kelly.archive${ts}`;
    const hInsta = `@kelly.dgtl${ts}`;
    const tA = await availableTarget({ e2eClient: admin, creatorId: C.creatorId, platform: "TikTok", handle: hA });
    const tB = await availableTarget({ e2eClient: admin, creatorId: C.creatorId, platform: "TikTok", handle: hB });
    const tWarmup = await availableTarget({ e2eClient: admin, creatorId: C.creatorId, platform: "TikTok", handle: hWarmup });
    const tManaged = await availableTarget({ e2eClient: admin, creatorId: C.creatorId, platform: "TikTok", handle: hManaged });
    const tArchived = await availableTarget({ e2eClient: admin, creatorId: C.creatorId, platform: "TikTok", handle: hArchived });
    const tInsta = await availableTarget({ e2eClient: admin, creatorId: C.creatorId, platform: "Instagram", handle: hInsta });
    const tForeign = await availableTarget({ e2eClient: admin, creatorId: other.creatorId, platform: "TikTok", handle: `@autre.createur${ts}` });
    // Remis en chauffe aujourd'hui → indisponible (même refus qu'à la création).
    await admin.mutation(api.comptes.updateCompte, {
      id: tWarmup.accountId,
      status: "warmup",
      warmupStartedAt: ts,
    });
    await admin.mutation(api.comptes.updateCompte, {
      id: tManaged.accountId,
      managedByAdmin: true,
    });
    await admin.mutation(api.comptes.updateCompte, {
      id: tArchived.accountId,
      status: "archived",
    });

    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] AccSwap ${ts}`,
    });
    const addBrick = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    await addBrick("hook", "H", `hook ${ts}`);
    await addBrick("flux", "F", "flux contenu");
    await addBrick("cta", "C", "cta contenu");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingAccSwap ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: C.creatorId,
      targets: [tA, tInsta],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      postDates: [minuitParis()],
    });

    const rowOf = async () => {
      const rows = await admin.query(api.assignments.listAssignments, {});
      const row = rows.find((r) => r.creatorId === C.creatorId);
      if (!row) throw new Error("assignation de test introuvable");
      return row;
    };
    const handleOn = (
      row: Awaited<ReturnType<typeof rowOf>>,
      platform: "TikTok" | "Instagram",
    ) => row.targets.find((t) => t.platform === platform)?.accountHandle;
    const assignmentId = (await rowOf())._id as Id<"assignments">;
    expect(handleOn(await rowOf(), "TikTok")).toBe(hA);

    // ── UI : ouvrir le panneau ──────────────────────────────────────────────
    await page.goto(adminPath("/assignments"));
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();
    await page.locator("button").filter({ hasText: "Tous créateurs" }).click();
    await page.locator('[role="option"]').filter({ hasText: creatorName }).click();
    await page.keyboard.press("Escape");
    await page
      .getByTitle(new RegExp(creatorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .click();
    const sheet = page.getByTestId("assignment-detail-sheet");
    await expect(sheet).toBeVisible();

    const tiktokSelect = sheet.getByTestId("assignment-detail-account-TikTok");
    await expect(tiktokSelect).toContainText(hA);
    await tiktokSelect.click();

    const option = (h: string) => page.getByRole("option").filter({ hasText: h });
    // Présents : le compte actuel, l'autre compte actif, et les deux refusés.
    await expect(option(hA)).toBeVisible();
    await expect(option(hB)).toBeVisible();
    await expect(option(hB)).toBeEnabled();
    // Refusés : LISTÉS, grisés, avec leur raison.
    await expect(option(hWarmup)).toBeDisabled();
    await expect(option(hWarmup)).toContainText("indisponible");
    await expect(option(hManaged)).toBeDisabled();
    await expect(option(hManaged)).toContainText("géré par l’équipe");
    // Archivé et compte Instagram : absents de la liste TikTok (les présences
    // ci-dessus prouvent que la liste est bien rendue).
    await expect(option(hArchived)).toHaveCount(0);
    await expect(option(hInsta)).toHaveCount(0);

    await option(hB).click();
    await expect(page.getByText(`Compte TikTok changé : ${hB}.`)).toBeVisible();
    await expect(tiktokSelect).toContainText(hB);

    // Serveur : la cible TikTok pointe B, l'Instagram n'a pas bougé.
    const after = await rowOf();
    expect(handleOn(after, "TikTok")).toBe(hB);
    expect(handleOn(after, "Instagram")).toBe(hInsta);
    // La créatrice voit le nouveau compte dans SA mission.
    const mine = await C.client.query(api.assignments.listMyAssignments, {
      projectId: C.projectId,
    });
    const myRow = mine.find((a) => a._id === assignmentId);
    expect(myRow?.targets.find((t) => t.platform === "TikTok")?.accountHandle).toBe(hB);

    // ── Refus serveur — la règle ne dépend pas du grisé de l'écran ──────────
    const swap = (platform: "TikTok" | "Facebook", accountId: Id<"comptes">) =>
      admin.mutation(api.assignments.setAssignmentTargetAccount, {
        id: assignmentId,
        platform,
        accountId,
      });
    await expect(swap("TikTok", tWarmup.accountId)).rejects.toThrow(/ERR_ACCOUNT_UNAVAILABLE/);
    await expect(swap("TikTok", tManaged.accountId)).rejects.toThrow(/ERR_TARGET_ACCOUNT_MANAGED_MISMATCH/);
    await expect(swap("TikTok", tInsta.accountId)).rejects.toThrow(/ERR_ACCOUNT_WRONG_PLATFORM/);
    await expect(swap("TikTok", tForeign.accountId)).rejects.toThrow(/ERR_TARGET_ACCOUNT_NOT_FOUND_FOR_CREATOR/);
    await expect(swap("Facebook", tB.accountId)).rejects.toThrow(/ERR_TARGET_NOT_ON_ASSIGNMENT/);
    // Même compte → no-op, pas un refus.
    await expect(swap("TikTok", tB.accountId)).resolves.toEqual({ changed: false });
    expect(handleOn(await rowOf(), "TikTok")).toBe(hB);

    // ── Publié → compte figé ────────────────────────────────────────────────
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: assignmentId,
      urls: [
        { platform: "TikTok", url: `https://www.tiktok.com/${hB}/video/${ts}` },
        { platform: "Instagram", url: `https://www.instagram.com/reel/AccSwap${ts}/` },
      ],
    });
    await expect(swap("TikTok", tA.accountId)).rejects.toThrow(/ERR_TARGET_ACCOUNT_LOCKED_PUBLISHED/);
    expect(handleOn(await rowOf(), "TikTok")).toBe(hB);
    // L'écran repasse en lecture seule : plus de sélecteur, le compte reste lu.
    await expect(sheet.getByTestId("detail-publication-published")).toBeVisible();
    await expect(tiktokSelect).toHaveCount(0);
    await expect(sheet).toContainText(hB);
  });
});

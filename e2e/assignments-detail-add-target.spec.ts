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
 * Panneau de détail du calendrier — AJOUTER un compte sur une plateforme que
 * l'assignation ne visait pas (compte Facebook disponible, oublié à
 * l'assignation).
 *
 * Le menu liste les comptes de la créatrice sur les AUTRES plateformes : les
 * ajoutables, et — grisés, avec leur raison — ceux que le serveur refuserait
 * (en chauffe, géré par l'équipe, script déjà utilisé sur cette plateforme).
 * La cible ajoutée devient exigible à la publication ; une fois publiée,
 * l'assignation ne prend plus de cible.
 */
test.describe("Admin — panneau de détail : ajouter un compte sur une autre plateforme", () => {
  test("ajouter un compte Facebook de la créatrice, refus serveur, verrou après publication", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] Kelly Chapters ${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-creator-addtarget-${ts}@repackit.test`,
      password: "creator-addtarget-12345",
    });
    const other = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Autre créatrice ${ts}`,
      email: `e2e-creator-addtarget-other-${ts}@repackit.test`,
      password: "creator-addtarget-other-12345",
    });

    // Handles à la forme de la prod : suffixés, points, underscore final.
    const hTiktok = `@thekellychapters_${ts}`;
    const hInsta = `@thekellychapters${ts}`;
    const hFacebook = `@kelly.chapters.fb${ts}`;
    const hSnap = `@kelly.snap${ts}`;
    const hSnapArchived = `@kelly.snap.old${ts}`;
    const hYtWarmup = `@kelly.yt.chauffe${ts}`;
    const hYtManaged = `@kelly.yt.equipe${ts}`;
    const hTiktok2 = `@kelly.leydie${ts}`;
    const seed = (platform: "TikTok" | "Instagram" | "Facebook" | "Snapchat" | "YouTube", handle: string) =>
      availableTarget({ e2eClient: admin, creatorId: C.creatorId, platform, handle });
    const tTiktok = await seed("TikTok", hTiktok);
    const tInsta = await seed("Instagram", hInsta);
    const tFacebook = await seed("Facebook", hFacebook);
    const tSnap = await seed("Snapchat", hSnap);
    const tSnapArchived = await seed("Snapchat", hSnapArchived);
    const tYtWarmup = await seed("YouTube", hYtWarmup);
    const tYtManaged = await seed("YouTube", hYtManaged);
    const tTiktok2 = await seed("TikTok", hTiktok2);
    const tForeign = await availableTarget({
      e2eClient: admin,
      creatorId: other.creatorId,
      platform: "Facebook",
      handle: `@autre.createur${ts}`,
    });
    await admin.mutation(api.comptes.updateCompte, {
      id: tYtWarmup.accountId,
      status: "warmup",
      warmupStartedAt: ts,
    });
    await admin.mutation(api.comptes.updateCompte, {
      id: tYtManaged.accountId,
      managedByAdmin: true,
    });
    await admin.mutation(api.comptes.updateCompte, {
      id: tSnapArchived.accountId,
      status: "archived",
    });

    // Campagne à UN seul combo : les deux assignations portent le même script.
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] AddTarget ${ts}`,
    });
    const addBrick = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    await addBrick("hook", "H", `hook ${ts}`);
    await addBrick("flux", "F", "flux contenu");
    await addBrick("cta", "C", "cta contenu");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingAddTarget ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    // 1) Ce script part déjà sur Snapchat (sans date : aucune fenêtre de cooldown).
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: C.creatorId,
      targets: [tSnap],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    // 2) Le même script, sur TikTok + Instagram, prévu aujourd'hui.
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: C.creatorId,
      targets: [tTiktok, tInsta],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      postDates: [minuitParis()],
    });

    const rowOf = async () => {
      const rows = await admin.query(api.assignments.listAssignments, {});
      const row = rows.find(
        (r) => r.creatorId === C.creatorId && r.postDate !== undefined,
      );
      if (!row) throw new Error("assignation de test introuvable");
      return row;
    };
    const assignmentId = (await rowOf())._id as Id<"assignments">;
    expect((await rowOf()).targets.map((t) => t.platform)).toEqual(["TikTok", "Instagram"]);

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
    await expect(sheet.getByTestId("assignment-detail-account-Facebook")).toHaveCount(0);

    const addTrigger = sheet.getByTestId("assignment-detail-add-target");
    await addTrigger.click();
    const item = (h: string) => page.getByRole("menuitem").filter({ hasText: h });
    // Ajoutable : le compte Facebook.
    await expect(item(hFacebook)).toBeVisible();
    await expect(item(hFacebook)).toBeEnabled();
    // Refusés : LISTÉS, grisés, avec leur raison.
    await expect(item(hSnap)).toBeDisabled();
    await expect(item(hSnap)).toContainText("script déjà utilisé sur Snapchat");
    await expect(item(hYtWarmup)).toBeDisabled();
    await expect(item(hYtWarmup)).toContainText("indisponible");
    await expect(item(hYtManaged)).toBeDisabled();
    await expect(item(hYtManaged)).toContainText("géré par l’équipe");
    // Absents : plateformes déjà visées (TikTok, même un 2e compte) et archivés.
    await expect(item(hTiktok2)).toHaveCount(0);
    await expect(item(hTiktok)).toHaveCount(0);
    await expect(item(hInsta)).toHaveCount(0);
    await expect(item(hSnapArchived)).toHaveCount(0);

    await item(hFacebook).click();
    await expect(page.getByText(`Compte Facebook ajouté : ${hFacebook}.`)).toBeVisible();
    // La nouvelle cible apparaît, avec son propre sélecteur.
    await expect(sheet.getByTestId("assignment-detail-account-Facebook")).toContainText(hFacebook);

    // Serveur : ajoutée EN FIN de liste, les cibles existantes intactes.
    const after = await rowOf();
    expect(after.targets.map((t) => [t.platform, t.accountHandle])).toEqual([
      ["TikTok", hTiktok],
      ["Instagram", hInsta],
      ["Facebook", hFacebook],
    ]);
    // La créatrice voit la nouvelle plateforme dans SA mission.
    const mine = await C.client.query(api.assignments.listMyAssignments, {
      projectId: C.projectId,
    });
    expect(
      mine
        .find((a) => a._id === assignmentId)
        ?.targets.find((t) => t.platform === "Facebook")?.accountHandle,
    ).toBe(hFacebook);

    // ── Refus serveur — la règle ne dépend pas du grisé de l'écran ──────────
    const add = (accountId: Id<"comptes">) =>
      admin.mutation(api.assignments.addAssignmentTarget, { id: assignmentId, accountId });
    await expect(add(tSnap.accountId)).rejects.toThrow(/ERR_COMBO_ALREADY_USED/);
    await expect(add(tTiktok2.accountId)).rejects.toThrow(/ERR_TARGET_PLATFORM_DUPLICATE/);
    await expect(add(tFacebook.accountId)).rejects.toThrow(/ERR_TARGET_PLATFORM_DUPLICATE/);
    await expect(add(tYtWarmup.accountId)).rejects.toThrow(/ERR_ACCOUNT_UNAVAILABLE/);
    await expect(add(tYtManaged.accountId)).rejects.toThrow(/ERR_TARGET_ACCOUNT_MANAGED_MISMATCH/);
    await expect(add(tForeign.accountId)).rejects.toThrow(/ERR_TARGET_ACCOUNT_NOT_FOUND_FOR_CREATOR/);
    expect((await rowOf()).targets).toHaveLength(3);

    // ── La cible ajoutée est EXIGÉE à la publication ────────────────────────
    const urls = {
      TikTok: { platform: "TikTok" as const, url: `https://www.tiktok.com/${hTiktok}/video/${ts}` },
      Instagram: { platform: "Instagram" as const, url: `https://www.instagram.com/reel/AddTarget${ts}/` },
      Facebook: { platform: "Facebook" as const, url: `https://www.facebook.com/reel/${ts}` },
    };
    await expect(
      admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id: assignmentId,
        urls: [urls.TikTok, urls.Instagram],
      }),
    ).rejects.toThrow(/ERR_POST_URL_MISSING/);
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: assignmentId,
      urls: [urls.TikTok, urls.Instagram, urls.Facebook],
    });

    // ── Publié → plus d'ajout ───────────────────────────────────────────────
    await expect(add(tSnap.accountId)).rejects.toThrow(/ERR_TARGET_ADD_LOCKED/);
    await expect(sheet.getByTestId("detail-publication-published")).toBeVisible();
    await expect(addTrigger).toHaveCount(0);
  });
});

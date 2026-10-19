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
 * Panneau de détail du calendrier — vidéo DÉJÀ SORTIE : ajouter le compte où
 * elle l'a AUSSI postée, avec le lien de ce post.
 *
 * Le cas réel (Kelly, 19/10) : mission cochée TikTok seul, publiée sur TikTok,
 * et le même reel posté sur son Instagram. Avant ce geste, l'ajout de compte
 * était refusé après la sortie : le post Instagram n'était ni suivi ni payé.
 *
 * Ce que la spec verrouille :
 *  1. le menu « Ajouter un compte » reste offert sur une vidéo publiée, et
 *     demande le LIEN du post ;
 *  2. la cible arrive PUBLIÉE (lien + publication au handle du compte), les
 *     cibles existantes intactes, la créatrice la voit ;
 *  3. ses vues entrent dans la paie de la vidéo (présence avant : les vues
 *     TikTok seules) ;
 *  4. refus serveur : vidéo pas sortie, mauvaise plateforme, lien de profil,
 *     jour antérieur à la sortie, futur, compte indisponible, plateforme déjà
 *     visée — et cycle de paie payé.
 */
test.describe("Admin — panneau de détail : ajouter un compte après la sortie", () => {
  test("Kelly : TikTok publié, le reel Instagram s'ajoute avec son lien et compte dans la paie", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] Kelly Blush ${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-creator-addpublished-${ts}@repackit.test`,
      password: "creator-addpublished-12345",
    });

    // Handles à la forme de la prod.
    const hTiktok = `@kelly.blush${ts}`;
    const hInsta = `@kellly.blush${ts}`;
    const hFacebook = `@kelly.blush.fb${ts}`;
    const hYtWarmup = `@kelly.yt.chauffe${ts}`;
    const hTiktok2 = `@kelly.blush.bis${ts}`;
    const seed = (platform: "TikTok" | "Instagram" | "Facebook" | "YouTube", handle: string) =>
      availableTarget({ e2eClient: admin, creatorId: C.creatorId, platform, handle });
    const tTiktok = await seed("TikTok", hTiktok);
    const tInsta = await seed("Instagram", hInsta);
    const tFacebook = await seed("Facebook", hFacebook);
    const tYtWarmup = await seed("YouTube", hYtWarmup);
    const tTiktok2 = await seed("TikTok", hTiktok2);
    await admin.mutation(api.comptes.updateCompte, {
      id: tYtWarmup.accountId,
      status: "warmup",
      warmupStartedAt: ts,
    });

    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] AddPublished ${ts}`,
    });
    const addBrick = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    await addBrick("hook", "H1", `hook un ${ts}`);
    await addBrick("hook", "H2", `hook deux ${ts}`);
    await addBrick("flux", "F", "flux contenu");
    await addBrick("cta", "C", "cta contenu");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingAddPublished ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    // A — TikTok SEUL, prévue aujourd'hui (c'est elle qui sort).
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: C.creatorId,
      targets: [tTiktok],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      postDates: [minuitParis()],
    });
    // B — une autre vidéo, pas encore sortie.
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: C.creatorId,
      targets: [tTiktok],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });

    const rowsOf = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (r) => r.creatorId === C.creatorId,
      );
    const rowA = async () => {
      const row = (await rowsOf()).find((r) => r.postDate !== undefined);
      if (!row) throw new Error("assignation A introuvable");
      return row;
    };
    const A = (await rowA())._id as Id<"assignments">;
    const B = (await rowsOf()).find((r) => r._id !== A)!._id as Id<"assignments">;

    // ── La vidéo sort sur TikTok ────────────────────────────────────────────
    const urlTiktok = `https://www.tiktok.com/${hTiktok}/video/7560000000000000001`;
    const { publicationIds } = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: A,
      urls: [{ platform: "TikTok", url: urlTiktok }],
    });
    const pubTiktok = publicationIds[0];
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: pubTiktok,
      capturedAt: Date.now(),
      vues: 10_000,
      likes: 500,
    });
    const tiktokAvant = (await rowA()).targets.find((t) => t.platform === "TikTok")!;

    const viewsOfA = async () => {
      const payments = await C.client.query(api.payments.getMyPayments, {
        projectId: C.projectId,
      });
      for (const p of payments) {
        const row = p.pricingBreakdown.perAssignment.find((x) => x.assignmentId === A);
        if (row) return row.totalViews;
      }
      throw new Error("assignation A absente des paiements");
    };
    // PRÉSENCE d'abord : les vues TikTok seules.
    expect(await viewsOfA()).toBe(10_000);

    // ── Refus serveur — rien ne s'écrit ─────────────────────────────────────
    const urlInsta = `https://www.instagram.com/reel/DKelly${ts}/`;
    const addPublished = (
      id: Id<"assignments">,
      accountId: Id<"comptes">,
      url: string,
      publishedAt?: number,
    ) =>
      admin.mutation(api.assignments.addPublishedTarget, {
        id,
        accountId,
        url,
        ...(publishedAt !== undefined ? { publishedAt } : {}),
      });
    await expect(addPublished(B, tInsta.accountId, urlInsta)).rejects.toThrow(
      /ERR_PUBLISHED_TARGET_ADD_LOCKED/,
    );
    await expect(addPublished(A, tInsta.accountId, urlTiktok)).rejects.toThrow(
      /ERR_POST_URL_WRONG_PLATFORM/,
    );
    await expect(
      addPublished(A, tInsta.accountId, `https://www.instagram.com/kellly.blush${ts}/`),
    ).rejects.toThrow(/ERR_POST_URL_IS_ACCOUNT/);
    await expect(
      addPublished(A, tInsta.accountId, urlInsta, Date.now() - 2 * DAY),
    ).rejects.toThrow(/ERR_PUBLISHED_AT_BEFORE_RELEASE/);
    await expect(
      addPublished(A, tInsta.accountId, urlInsta, Date.now() + DAY),
    ).rejects.toThrow(/ERR_PUBLISHED_AT_IN_FUTURE/);
    await expect(
      addPublished(A, tYtWarmup.accountId, `https://www.youtube.com/shorts/kelly${ts}`),
    ).rejects.toThrow(/ERR_ACCOUNT_UNAVAILABLE/);
    await expect(
      addPublished(A, tTiktok2.accountId, `https://www.tiktok.com/${hTiktok2}/video/7560000000000000002`),
    ).rejects.toThrow(/ERR_TARGET_PLATFORM_DUPLICATE/);
    // L'ajout SANS lien reste refusé après la sortie.
    await expect(
      admin.mutation(api.assignments.addAssignmentTarget, { id: A, accountId: tInsta.accountId }),
    ).rejects.toThrow(/ERR_TARGET_ADD_LOCKED/);
    expect((await rowA()).targets).toHaveLength(1);

    // ── UI : ouvrir le panneau de la vidéo publiée ──────────────────────────
    await page.goto(adminPath("/assignments"));
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();
    await page.locator("button").filter({ hasText: "Tous créateurs" }).click();
    await page.locator('[role="option"]').filter({ hasText: creatorName }).click();
    await page.keyboard.press("Escape");
    await page
      .getByTitle(new RegExp(creatorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .first()
      .click();
    const sheet = page.getByTestId("assignment-detail-sheet");
    await expect(sheet.getByTestId("detail-publication-published")).toBeVisible();
    // Le mode « avant la sortie » n'est plus offert ; celui d'après, si.
    await expect(sheet.getByTestId("assignment-detail-add-target")).toHaveCount(0);
    const trigger = sheet.getByTestId("assignment-detail-add-published-target");
    await expect(trigger).toBeVisible();
    await trigger.click();
    const item = (h: string) => page.getByRole("menuitem").filter({ hasText: h });
    await expect(item(hInsta)).toBeEnabled();
    await expect(item(hYtWarmup)).toBeDisabled();
    await expect(item(hTiktok2)).toHaveCount(0);
    await item(hInsta).click();

    const dialog = page.getByTestId("add-published-target-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("https://…").fill(urlInsta);
    await dialog.getByTestId("add-published-target-submit").click();
    await expect(
      page.getByText(`Post Instagram ajouté : ${hInsta} — ses vues seront relevées.`),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    // Le panneau montre le post Instagram à côté du TikTok.
    await expect(sheet.getByRole("link", { name: "Voir le post Instagram" })).toHaveAttribute(
      "href",
      urlInsta,
    );

    // ── Serveur : la cible est née PUBLIÉE, le reste n'a pas bougé ──────────
    const after = await rowA();
    expect(after.status).toBe("published");
    expect(after.targets.map((t) => [t.platform, t.accountHandle])).toEqual([
      ["TikTok", hTiktok],
      ["Instagram", hInsta],
    ]);
    const insta = after.targets.find((t) => t.platform === "Instagram")!;
    expect(insta.publishedUrl).toBe(urlInsta);
    expect(after.targets.find((t) => t.platform === "TikTok")).toEqual(tiktokAvant);
    // La publication suit le post Instagram, au handle du compte.
    const pubInsta = (await admin.query(api.publications.listPublications, {})).find(
      (p) => p.postUrl === urlInsta,
    );
    expect(pubInsta).toMatchObject({ plateforme: "Instagram", compte: hInsta });
    // La créatrice la voit dans SA mission.
    const mine = await C.client.query(api.assignments.listMyAssignments, {
      projectId: C.projectId,
    });
    expect(
      mine.find((a) => a._id === A)?.targets.find((t) => t.platform === "Instagram")
        ?.publishedUrl,
    ).toBe(urlInsta);

    // ── Ses vues comptent dans la paie de la vidéo ──────────────────────────
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: pubInsta!._id,
      capturedAt: Date.now(),
      vues: 4_000,
      likes: 120,
    });
    expect(await viewsOfA()).toBe(14_000);

    // ── Cycle payé : plus d'ajout ───────────────────────────────────────────
    await admin.mutation(api.payments.markCyclePaid, {
      creatorId: C.creatorId,
      cycleIndex: 0,
    });
    await expect(
      addPublished(A, tFacebook.accountId, `https://www.facebook.com/reel/${ts}`),
    ).rejects.toThrow(/ERR_PAY_CYCLE_LOCKED/);
    expect((await rowA()).targets).toHaveLength(2);
  });
});

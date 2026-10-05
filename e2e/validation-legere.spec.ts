import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * Page Validation allégée (05/10/2026 : 16 780 nœuds sur Snytch).
 *   - « Bonus de vues » ne propose que les vidéos que le serveur accepte : SANS
 *     barème. Les 631 vidéos publiées de la prod en avaient toutes un — la
 *     section listait 602 lignes dont aucun calcul ne pouvait aboutir.
 *   - « Publiées récemment » se lit par pages de 100.
 */
test.describe("Validation allégée", () => {
  test("bonus de vues : la vidéo à barème n'est pas proposée, celle sans barème l'est", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] BonusLeger ${ts}`;
    const creator = await createCreatorSession(url, {
      name: creatorName,
      email: `e2e-creator-bonusleger-${ts}@repackit.test`,
      password: "bonusleger-12345",
    });
    const projectId = creator.projectId;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2ebonusleger${ts}`,
    });
    const publier = async (id: Id<"assignments">, suffixe: string) => {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id,
        status: "to_publish",
      });
      await creator.client.mutation(api.assignments.confirmPublication, {
        projectId,
        id,
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}${suffixe}` }],
      });
    };

    // Une mission FORMAT (sans barème) …
    const formatId = (await createFormatWithRate(admin, {
      name: `[E2E_TEST] BonusLeger Fmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10, viewBonusPer1k: 2 },
    })) as Id<"formats">;
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    // … et une mission SCRIPT (avec barème).
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] BonusLeger ${ts}`,
    });
    for (const kind of ["hook", "flux", "cta"] as const) {
      await admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label: kind,
        content: `${kind} ${ts}`,
      });
    }
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] BonusLeger ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.creatorId === creator.creatorId,
    );
    const sansBareme = mine.find((a) => a.formatId === formatId)!;
    const avecBareme = mine.find((a) => a.scriptCombo?.campaignId === campaignId)!;
    expect(sansBareme.pricingSnapshot).toBeUndefined();
    expect(avecBareme.pricingSnapshot).toBeDefined();
    await publier(sansBareme._id, "1");
    await publier(avecBareme._id, "2");

    // Serveur : seule la vidéo sans barème est proposée — c'est aussi la seule
    // que le calcul accepte.
    const proposees = (await admin.query(api.assignments.listValidatedForBonus, {})).map(
      (r) => r.assignmentId,
    );
    expect(proposees).toContain(sansBareme._id);
    expect(proposees).not.toContain(avecBareme._id);
    await expect(
      admin.mutation(api.assignments.computeViewBonus, { id: avecBareme._id, views: 5000 }),
    ).rejects.toThrow(/automatiquement/i);

    // Écran : une seule ligne de bonus pour cette créatrice.
    await page.goto(adminPath("/validation"));
    const bonus = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Bonus de vues" }) });
    await expect(bonus.getByRole("row").filter({ hasText: creatorName })).toHaveCount(1, {
      timeout: 15_000,
    });
  });

  test("« Publiées récemment » se lit par pages de 100", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] PubliePages ${ts}`,
      email: `e2e-creator-publiepages-${ts}@repackit.test`,
      password: "publiepages-12345",
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2epubliepages${ts}`,
    });
    const formatId = (await createFormatWithRate(admin, {
      name: `[E2E_TEST] PubliePages Fmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10 },
    })) as Id<"formats">;
    for (let i = 0; i < 3; i++) {
      await admin.mutation(api.assignments.assignFormat, {
        formatId,
        creatorId: creator.creatorId,
        targets: [target],
        postsPerCreator: 35,
        dueDate: ts + 7 * DAY,
      });
    }
    const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.formatId === formatId,
    );
    expect(mine).toHaveLength(105);
    for (const a of mine) {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: a._id,
        status: "published",
      });
    }
    const total = (await admin.query(api.assignments.listPublished, {})).length;
    expect(total).toBeGreaterThan(100);

    await page.goto(adminPath("/validation"));
    const publiees = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Publiées récemment" }) });
    const range = publiees.getByTestId("list-pager-range");
    await expect(range).toHaveText(`1–100 sur ${total}`, { timeout: 15_000 });
    await expect(publiees.locator("tbody tr")).toHaveCount(100);
    await publiees.getByRole("button", { name: "Suivante" }).click();
    await expect(range).toHaveText(`101–${total} sur ${total}`);
    await expect(publiees.locator("tbody tr")).toHaveCount(total - 100);
  });
});

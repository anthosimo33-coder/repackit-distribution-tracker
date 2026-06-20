import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * Dashboard créateur orienté ACTION (/app), scopé au PROJET COURANT.
 *  - sur e2e-test : 2 à produire + 1 à publier + 1 à refaire (feedback) →
 *    les blocs affichent les bons compteurs, chaque item mène au détail ;
 *  - SCOPE PROJET : on rattache le créateur à un 2ᵉ projet VIDE → en switchant
 *    dessus, « tout à jour » s'affiche (compteurs distincts par projet, 0 vs 2),
 *    aucune fuite ; retour sur e2e-test → les compteurs reviennent.
 */
test.describe("Créateur — dashboard orienté action (scopé projet)", () => {
  test("blocs + compteurs + scope projet courant + tout à jour", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Dash ${ts}`;
    const email = `e2e-creator-dash-${ts}@repackit.test`;
    const password = "creator-dash-12345";
    const slugB = `e2e-dash-${ts}`;
    const nameB = `E2E Dash Projet ${ts}`;

    // ── Invite + finalisation (contexte créateur authentifié sur /app). ──
    const { creatorId, token } = await admin.mutation(
      api.creators.inviteCreator,
      { name, email },
    );
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const cpage = await ctx.newPage();
    await cpage.goto(`/join/${token}`);
    await cpage.getByLabel("Mot de passe").fill(password);
    await cpage.getByRole("button", { name: /activer mon compte/i }).click();
    await cpage.waitForURL("**/app", { timeout: 20_000 });

    // ── Seed e2e-test : 4 assignments → 2 todo, 1 to_publish, 1 video_rejected. ──
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Format Dash ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId,
      platform: "TikTok",
      handle: `@e2edash${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId,
      targets: [target],
      postsPerCreator: 4,
      dueDate: ts + 5 * DAY,
    });
    const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.formatId === formatId && a.creatorId === creatorId,
    );
    expect(mine.length).toBe(4);
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: mine[0]._id,
      status: "to_publish",
    });
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: mine[1]._id,
      status: "video_rejected",
      videoReviewFeedback: `Refais le hook ${ts}`,
    });

    // ── Dashboard e2e-test : compteurs justes + feedback + navigation. ──
    await cpage.goto("/app");
    await expect(cpage.getByTestId("produce-count")).toHaveText("2", {
      timeout: 15_000,
    });
    await expect(cpage.getByTestId("publish-count")).toHaveText("1");
    await expect(cpage.getByTestId("redo-count")).toHaveText("1");
    await expect(cpage.getByText(`Refais le hook ${ts}`)).toBeVisible();
    await expect(cpage.getByTestId("dashboard-due")).toBeVisible();

    // Un item « à produire » mène au détail de l'assignment.
    await cpage
      .getByTestId("block-produce")
      .getByRole("link")
      .first()
      .click();
    await expect(cpage).toHaveURL(/\/app\/assignments\/.+/, { timeout: 10_000 });

    // ── Rattachement à un 2ᵉ projet VIDE. ──
    const { projectId: projectBId } = await admin.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: slugB, name: nameB },
    );
    await admin.mutation(api.creators.e2eAddCreatorToProject, {
      secret: E2E_SECRET,
      email,
      projectId: projectBId,
    });

    // ── Switch sur le projet B (vide) → « tout à jour », bloc produce absent. ──
    await cpage.goto("/app");
    await cpage.getByRole("button", { name: "Changer de projet" }).click();
    await cpage.getByRole("menuitem", { name: nameB }).click();
    await cpage.waitForURL("**/app", { timeout: 10_000 });
    await expect(cpage.getByTestId("all-clear")).toBeVisible({ timeout: 15_000 });
    await expect(cpage.getByTestId("block-produce")).toHaveCount(0);

    // ── Retour sur e2e-test → compteurs de nouveau présents (scope projet). ──
    await cpage.getByRole("button", { name: "Changer de projet" }).click();
    await cpage.getByRole("menuitem", { name: "E2E Test" }).click();
    await cpage.waitForURL("**/app", { timeout: 10_000 });
    await expect(cpage.getByTestId("produce-count")).toHaveText("2", {
      timeout: 15_000,
    });

    await ctx.close();

    // ── Cleanup. ──
    await admin.mutation(api.assignments.cleanupTestAssignments, {
      secret: E2E_SECRET,
    });
    await admin.mutation(api.creators.cleanupTestCreators, {
      secret: E2E_SECRET,
    });
    await admin.mutation(api.projects.e2eDeleteProject, {
      secret: E2E_SECRET,
      slug: slugB,
    });
  });
});

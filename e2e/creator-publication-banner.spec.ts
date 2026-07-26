import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const DAY = 86_400_000;

/**
 * Brique D — dashboard créatrice : bandeau « Aujourd'hui tu postes : [format] »
 * (LA réponse à « je poste quoi ? ») + mini-calendrier de publication. On assigne
 * un format avec une date de post = aujourd'hui ; la page /app se met à jour en
 * réactif (Convex) et le bandeau + le calendrier apparaissent.
 */
test.describe("Portail créateur — calendrier de publication (brique D)", () => {
  test("bandeau du jour + mini-calendrier avec la date de post", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const formatName = `[E2E_TEST] PubBanner Fmt ${ts}`;
    const fid = (await admin.mutation(api.formats.createFormat, {
      name: formatName,
      type: "short",
      rateModel: { basePerPost: 40 },
    })) as Id<"formats">;

    const email = `e2e-creator-pubbanner-${ts}@repackit.test`;
    const { creatorId, token } = await admin.mutation(
      api.creators.inviteCreator,
      { name: `[E2E_TEST] PubBanner Crea ${ts}`, email },
    );

    // Onboarding créateur (navigation privée) → devient assignable, arrive sur /app.
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill("creator-pubbanner-12345");
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });

    // Assignment + date de post = AUJOURD'HUI (après onboarding).
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creatorId as Id<"creators">,
      platform: "TikTok",
      handle: `@e2epubbanner${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: creatorId as Id<"creators">,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.formatId === fid && a.creatorId === creatorId,
    )!;
    // postDate = MINUIT LOCAL DU NAVIGATEUR (même horloge/TZ Europe/Paris que le
    // composant) : évite la dérive TZ entre le process de test (runner, UTC) et le
    // navigateur, qui faisait tomber la date « d'aujourd'hui » un autre jour.
    const postDate = await page.evaluate(() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    });
    await admin.mutation(api.assignments.setAssignmentPostDate, {
      id: row._id,
      postDate,
    });

    // Le dashboard se met à jour en réactif : bandeau du jour avec le format.
    const banner = page.getByTestId("today-post-banner");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner.getByText("Aujourd'hui tu postes")).toBeVisible();
    await expect(banner.getByText(formatName)).toBeVisible();

    // Le mini-calendrier de publication est présent.
    await expect(
      page.getByTestId("creator-publication-calendar"),
    ).toBeVisible();

    // Clic sur le post du bandeau → ouvre le brief de la mission.
    await banner.getByText(formatName).click();
    await page.waitForURL(/\/app\/assignments\/[a-z0-9]+$/i, {
      timeout: 10_000,
    });

    await ctx.close();
  });
});

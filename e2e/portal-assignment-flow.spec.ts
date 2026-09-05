import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * P7 — boucle créateur complète (UI) : assignment en retard visible au
 * dashboard → fiche brief (FormatBriefPreview + vidéo + calculateur) →
 * « Je commence » → soumission URL → « soumis » des deux côtés.
 */
test.describe("Portail créateur — boucle assignment", () => {
  test("dashboard → brief → je commence → soumission URL", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();

    // Admin : format (brief + hook + vidéo YouTube + grille) puis invitation.
    const formatName = `[E2E_TEST] BoucleFmt ${ts}`;
    const fid = (await createFormatWithRate(admin, {
      name: formatName,
      type: "short",
      brief: `Brief E2E ${ts}`,
      hooks: [`Hook E2E ${ts}`],
      exampleVideos: [
        {
          kind: "url",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          platform: "youtube",
          title: "Exemple",
        },
      ],
      rateModel: { basePerPost: 50, viewBonusPer1k: 2 },
    })) as Id<"formats">;

    const email = `e2e-creator-boucle-${ts}@repackit.test`;
    const { creatorId, token } = await admin.mutation(
      api.creators.inviteCreator,
      { name: `[E2E_TEST] BoucleCrea ${ts}`, email },
    );

    // Onboarding créateur en navigation privée (devient assignable : userId +
    // status onboarding — l'assignation se fait APRÈS le join).
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill("creator-boucle-12345");
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });

    // Assignment EN RETARD (dueDate passée) une fois le créateur onboardé.
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creatorId as Id<"creators">,
      platform: "TikTok",
      handle: `@e2eboucle${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: creatorId as Id<"creators">,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts - 2 * 86_400_000,
    });

    // Dashboard : l'assignment ressort dans « À produire » + badge En retard.
    await expect(page.getByText(`${formatName}`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("En retard").first()).toBeVisible();

    // Ouvre la fiche brief.
    await page.getByText(`${formatName}`).first().click();
    await page.waitForURL(/\/app\/assignments\/[a-z0-9]+$/i, { timeout: 10_000 });

    // Brief rendu (FormatBriefPreview) : texte + hook + section vidéos exemples
    // (lisible in-app côté créateur) + calc.
    await expect(page.getByText(`Brief E2E ${ts}`)).toBeVisible();
    await expect(page.getByText(`Hook E2E ${ts}`)).toBeVisible();
    await expect(page.getByText("Vidéos exemples")).toBeVisible();
    await expect(page.getByTestId("youtube-embed")).toBeVisible();
    // Calculateur : 10k vues × (50 base + 2$/1k) = 70 $ par défaut.
    await expect(page.getByTestId("earnings-total")).toContainText("70");

    // Je commence → in_progress → l'action devient « Soumettre ma vidéo »
    // (upload MP4). Le parcours complet upload→publication est couvert par
    // mp4-workflow ; ici on prouve le câblage brief + démarrage.
    await page.getByRole("button", { name: /je commence/i }).click();
    await expect(
      page.getByRole("button", { name: /soumettre ma vidéo/i }),
    ).toBeVisible({ timeout: 8000 });

    // Côté admin : statut in_progress.
    const list = await admin.query(api.assignments.listAssignments, {});
    const mine = list.filter((a) => a.formatId === fid);
    expect(mine.length).toBe(1);
    expect(mine[0].status).toBe("in_progress");

    await ctx.close();
  });
});

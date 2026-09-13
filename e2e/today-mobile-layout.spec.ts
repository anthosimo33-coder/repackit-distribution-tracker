import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const MOBILE = { width: 375, height: 667 };
const DESKTOP = { width: 1280, height: 900 };
const SHOTS = process.env.E2E_SHOTS_DIR;

/**
 * ACCUEIL « AUJOURD'HUI » — deux dispositions, pas une grille qui s'empile.
 *
 * LE DÉFAUT QU'ELLE VERROUILLE. Sur mobile, la colonne de droite (gains, vues
 * d'hier, série, classement) tombait SOUS tout l'écran, en grosses cartes. Sur
 * mobile désormais : les gains en BANDE juste sous les compteurs, le classement
 * en bas ; les cartes de la colonne de droite ne sont pas montées. Sur desktop,
 * rien ne change.
 *
 * Les deux assertions opposées (mobile / desktop) portent sur la même page, pour
 * que l'une ne puisse pas passer parce que l'autre disposition a disparu.
 */
test.describe("Aujourd'hui — disposition mobile", () => {
  test("mobile : bande des gains sous l'action ; desktop : colonne de droite", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const fid = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Tournage plage ${ts}`,
      type: "short",
      rateModel: { basePerPost: 50, viewBonusPer1k: 2, bounties: [] },
    });
    const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Veljko Marković ${ts}`,
      email: `e2e-creator-today-mobile-${ts}@repackit.test`,
    });
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: MOBILE,
      // Captures fidèles : sans le fondu d'entrée des écrans (sinon l'image est
      // prise à mi-transition, texte délavé). Sans effet sur les assertions.
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill("creator-today-mobile-12345");
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });

    // Deux missions : une à tourner (la prochaine action), une dans « Ensuite ».
    const target = await availableTarget({
      e2eClient: admin,
      creatorId,
      platform: "TikTok",
      handle: `@e2etodaymobile${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid as Id<"formats">,
      creatorId,
      targets: [target],
      postsPerCreator: 2,
      dueDate: ts + 4 * 86_400_000,
    });

    await page.goto("/app");
    const action = page.getByTestId("home-next-action");
    const gains = page.getByTestId("cycle-gains-card");
    await expect(action).toBeVisible({ timeout: 20_000 });
    await expect(gains).toBeVisible();

    // ── MOBILE : les gains sont une BANDE (un lien vers Gains), placée SOUS
    //    l'action et AU-DESSUS de « Ensuite ».
    expect(await gains.evaluate((el) => el.tagName)).toBe("A");
    const yAction = (await action.boundingBox())!.y;
    const yGains = (await gains.boundingBox())!.y;
    const yEnsuite = (await page.getByTestId("home-upcoming").boundingBox())!.y;
    expect(yGains).toBeGreaterThan(yAction);
    expect(yGains).toBeLessThan(yEnsuite);
    // Un seul montant dans la page : la carte desktop n'est pas montée cachée.
    await expect(page.getByTestId("dashboard-due")).toHaveCount(1);
    // Écran par écran et non `fullPage` : la barre d'onglets est fixe, une
    // capture pleine page la dessinerait au milieu du contenu.
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/today-mobile-1.png` });
      await page.getByTestId("home-upcoming").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/today-mobile-2.png` });
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    // ── DESKTOP, même page : la carte complète revient dans la colonne de
    //    droite, à côté de l'action (même hauteur de départ), et la bande part.
    await page.setViewportSize(DESKTOP);
    await expect(gains).toBeVisible();
    await expect.poll(() => gains.evaluate((el) => el.tagName)).toBe("SECTION");
    const boxAction = (await action.boundingBox())!;
    const boxGains = (await gains.boundingBox())!;
    expect(boxGains.x).toBeGreaterThan(boxAction.x + boxAction.width);
    await expect(page.getByTestId("dashboard-due")).toHaveCount(1);
    await expect(page.getByTestId("today-chips")).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/today-desktop.png`, fullPage: true });

    await ctx.close();
  });
});

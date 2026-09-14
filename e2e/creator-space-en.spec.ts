import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
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
 * ESPACE CRÉATRICE EN ANGLAIS — les libellés que la garde statique ne voyait pas.
 *
 * Le 2026-09-14, un balayage de l'espace d'une créatrice anglophone a trouvé du
 * français sur des écrans que `check-i18n` déclarait extraits : le bouton
 * « Je commence », l'écran Fichiers entier, « entre 21h et 23h », un calendrier
 * « septembre 2026 / Lun Mar Mer ». (« Published il y a 3 jours » est tenu par
 * `lib/video-tracking.test.ts` : l'écran Vidéos n'est pas ouvert sur le projet e2e.)
 *
 * Chaque absence de français est appariée à la PRÉSENCE du libellé anglais qui
 * le remplace : une page vide ou démontée passerait sinon toutes les absences.
 */
test("une créatrice anglophone lit son espace en anglais, heures et calendrier compris", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const ts = Date.now();
  const formatName = `[E2E_TEST] EnSpace Fmt ${ts}`;
  const email = `e2e-creator-enspace-${ts}@repackit.test`;
  const password = "enspace-12345";

  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] EnSpace ${ts}`,
    email,
    locale: "en",
  });

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto(`/join/${token}`);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /activate my account/i }).click();
  await page.waitForURL("**/app", { timeout: 30_000 });

  const fid = (await createFormatWithRate(admin, {
    name: formatName,
    type: "short",
    rateModel: { basePerPost: 40 },
  })) as Id<"formats">;
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: creatorId as Id<"creators">,
    platform: "TikTok",
    handle: `@e2eenspace${ts}`,
  });
  await admin.mutation(api.assignments.assignFormat, {
    formatId: fid,
    creatorId: creatorId as Id<"creators">,
    targets: [target],
    postsPerCreator: 1,
    dueDate: ts + 7 * DAY,
  });
  const planned = (await admin.query(api.assignments.listAssignments, {})).find(
    (a) => a.formatId === fid && a.creatorId === creatorId,
  )!;

  // ── Mission planifiée aujourd'hui, de 21h30 à 23h ────────────────────────────
  // Minuit LOCAL du navigateur (même horloge que le composant), cf
  // creator-publication-banner.spec.ts.
  const postDate = await page.evaluate(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });
  await admin.mutation(api.assignments.setAssignmentPostDate, { id: planned._id, postDate });
  await admin.mutation(api.assignments.setAssignmentPostWindow, {
    id: planned._id,
    postWindow: { startMin: 21 * 60 + 30, endMin: 23 * 60 },
  });

  // ── Tableau de bord : créneau et calendrier ─────────────────────────────────
  await page.goto("/app");
  const calendar = page.getByTestId("creator-publication-calendar");
  await expect(calendar).toBeVisible({ timeout: 30_000 });
  const month = await page.evaluate(() =>
    new Date().toLocaleDateString("en-US", { month: "long" }),
  );
  await expect(calendar).toContainText(new RegExp(month, "i"));
  await expect(calendar.getByText("Mon", { exact: true })).toBeVisible();
  await expect(calendar.getByText("Lun", { exact: true })).toHaveCount(0);
  // Le créneau vit dans le survol de la vignette.
  const chip = calendar.locator(`a[title*="${formatName}"]`).first();
  await expect(chip).toHaveAttribute("title", /between 9:30pm and 11pm/);
  await expect(chip).not.toHaveAttribute("title", /entre|21h/);

  // ── Fiche mission : le bouton de départ ─────────────────────────────────────
  await page.goto(`/app/assignments/${planned._id}`);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Je commence")).toHaveCount(0);

  // ── Fichiers (hors Snytch) : l'écran répond en anglais ──────────────────────
  await page.goto("/app/fichiers");
  await expect(page.getByText("File upload isn't available for this project.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Dépôt de contenu")).toHaveCount(0);

  await ctx.close();
});

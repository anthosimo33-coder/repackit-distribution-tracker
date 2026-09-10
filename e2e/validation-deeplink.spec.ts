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
 * Lien profond `?soumission=<assignmentId>` de l'écran Validation.
 *
 * C'est la moitié UI de l'exigence « un lien direct vers l'écran de validation
 * de CETTE soumission, pas vers la liste » : les notifications hors-app
 * construisent cette URL (cf convex/notificationMessage.validationUrl), la page
 * doit surligner la bonne carte — et le dire quand la cible n'est plus en file.
 */
test.describe("Validation — lien profond vers une soumission", () => {
  test("la carte ciblée est surlignée, les autres non", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Deeplink ${ts}`,
      email: `e2e-creator-deeplink-${ts}@repackit.test`,
      password: "deeplink-12345",
    });

    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Format DL ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });

    // Deux soumissions en attente : sans une seconde carte, « surligner LA
    // bonne » ne prouverait rien.
    const ids: string[] = [];
    for (const suffix of ["a", "b"]) {
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: creator.creatorId,
        platform: "TikTok",
        handle: `@e2edl${suffix}${ts}`,
      });
      await admin.mutation(api.assignments.assignFormat, {
        formatId,
        creatorId: creator.creatorId,
        targets: [target],
        postsPerCreator: 1,
        dueDate: ts + 7 * DAY,
      });
      const row = (await admin.query(api.assignments.listAssignments, {}))
        .filter((x) => x.formatId === formatId && !ids.includes(x._id))
        .at(-1)!;
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: row._id,
        status: "video_submitted",
      });
      ids.push(row._id);
    }
    const [cible, autre] = ids;

    await page.goto(adminPath(`/validation?soumission=${cible}`));

    const surlignee = page.getByTestId("submission-highlighted");
    // Le compte D'ABORD : en mode strict, toBeVisible() sur un locator multiple
    // échouerait sur une violation de strict mode plutôt que sur le vrai grief.
    await expect(surlignee).toHaveCount(1, { timeout: 15_000 });
    await expect(surlignee).toBeVisible();
    await expect(surlignee.getByTestId(`submission-media-${cible}`)).toBeAttached();
    await expect(
      surlignee.getByTestId(`submission-media-${autre}`),
    ).toHaveCount(0);
  });

  test("sans le paramètre, aucune carte n'est surlignée", async ({ page }) => {
    await page.goto(adminPath("/validation"));
    await expect(
      page.getByRole("heading", { name: "Validation", level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("submission-highlighted")).toHaveCount(0);
  });

  test("une soumission déjà traitée le DIT au lieu de ne rien faire", async ({
    page,
  }) => {
    // Id syntaxiquement valide mais absent de la file : c'est le cas réel d'une
    // notification ouverte après coup (vidéo déjà validée entre-temps).
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] DeeplinkGone ${ts}`,
      email: `e2e-creator-dlgone-${ts}@repackit.test`,
      password: "dlgone-12345",
    });
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Format DLG ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2edlg${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    // Laissé en `todo` : l'assignment existe mais n'est PAS en attente de revue.
    const orphelin = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === formatId,
    )!._id;

    await page.goto(adminPath(`/validation?soumission=${orphelin}`));
    await expect(
      page.getByText("n'est plus en attente de revue"),
    ).toBeVisible({ timeout: 15_000 });
  });
});

import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const DAY = 86_400_000;
const todayMidnight = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Brique C — la page Assignments bascule Liste/Calendrier, avec des filtres
 * PARTAGÉS (dont le filtre créateur MULTI). Filtrer sur une créatrice restreint
 * la liste ET le calendrier. Le calendrier affiche le post planifié (statut). On
 * filtre sur la créatrice de test pour être robuste à la base e2e partagée.
 */
test.describe("Admin — vue calendrier de publication", () => {
  test("bascule Liste/Calendrier + filtre créateur partagé", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] CalView ${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-creator-calview-${ts}@repackit.test`,
      password: "creator-calview-12345",
    });
    const fid = (await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] CalView Fmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 30 },
    })) as Id<"formats">;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: `@e2ecalview${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    // Date de post = aujourd'hui (dans le mois courant du calendrier).
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.formatId === fid && a.creatorId === C.creatorId,
    )!;
    await admin.mutation(api.assignments.setAssignmentPostDate, {
      id: row._id,
      postDate: todayMidnight(),
    });

    await page.goto(adminPath("/assignments"));

    // Attendre le chargement (la ligne de la créatrice apparaît dans la liste
    // non filtrée → assignments chargés, options du filtre peuplées).
    await expect(
      page.getByRole("cell").filter({ hasText: creatorName }),
    ).toBeVisible();

    // Filtre créateur MULTI (partagé) → ne garder que la créatrice de test.
    // Trigger ciblé par le TAG button + libellé (role varie selon base-ui).
    await page.locator("button").filter({ hasText: "Tous créateurs" }).click();
    await page.locator('[role="option"]').filter({ hasText: creatorName }).click();
    await page.keyboard.press("Escape");

    // Bascule CALENDRIER : le filtre restreint la vue à 1 post → chip trouvable ;
    // stats + navigation mensuelle rendues.
    await page.getByRole("radio", { name: "Calendrier" }).click();
    await expect(
      page.getByRole("button", { name: "Mois suivant" }),
    ).toBeVisible();
    await expect(
      page.getByText("Taux à l'heure", { exact: true }),
    ).toBeVisible();
    const chipTitle = new RegExp(
      creatorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    await expect(page.getByTitle(chipTitle)).toBeVisible();

    // Retour LISTE : la colonne « Post » de la table réapparaît.
    await page.getByRole("radio", { name: "Liste" }).click();
    await expect(
      page.getByRole("columnheader", { name: "Post" }),
    ).toBeVisible();
  });
});

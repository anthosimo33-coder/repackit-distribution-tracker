import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
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
 * Panneau de DÉTAIL au clic sur un post du calendrier de pilotage (page
 * Assignments). Ouvre le panneau, vérifie que le SCRIPT est lisible, que la date
 * de post est éditable (calendrier), et que — sur un compte de CRÉATRICE (non
 * géré) — la publication reste son geste (état en lecture seule, pas de saisie de
 * lien admin). On filtre sur la créatrice de test pour être robuste à la base e2e
 * partagée. Le calendrier étant la vue par DÉFAUT, aucune bascule n'est nécessaire.
 */
test.describe("Admin — panneau de détail du calendrier", () => {
  test("clic sur un post → script + date éditable + publication créatrice en lecture seule", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] CalDetail ${ts}`;
    const marker = `SCRIPTMARK${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-creator-caldetail-${ts}@repackit.test`,
      password: "creator-caldetail-12345",
    });

    // Campagne de script (1 hook × 1 flux × 1 cta = 1 combo) — le hook porte un
    // marqueur unique retrouvé dans le script monté affiché par le panneau.
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] CalDetail ${ts}`,
    });
    const addBrick = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    await addBrick("hook", "H", `${marker} hook`);
    await addBrick("flux", "F", "flux contenu");
    await addBrick("cta", "C", "cta contenu");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingCalDetail ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: `@e2ecaldetail${ts}`,
    });

    // 1 vidéo, planifiée AUJOURD'HUI (dans le mois courant du calendrier).
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: C.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      postDates: [todayMidnight()],
    });

    await page.goto(adminPath("/assignments"));
    // Chargement (compteur d'en-tête) — indépendant de la vue (défaut = calendrier).
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();

    // Filtre créateur MULTI (partagé) → ne garder que la créatrice de test.
    await page.locator("button").filter({ hasText: "Tous créateurs" }).click();
    await page.locator('[role="option"]').filter({ hasText: creatorName }).click();
    await page.keyboard.press("Escape");

    // Clic sur le post (chip titré par la créatrice) → ouvre le panneau de détail.
    const chipTitle = new RegExp(
      creatorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    await page.getByTitle(chipTitle).click();

    const sheet = page.getByTestId("assignment-detail-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(creatorName);

    // Le SCRIPT monté est lisible directement dans le panneau (marqueur du hook).
    await expect(sheet.getByTestId("assignment-detail-script")).toContainText(
      marker,
    );

    // La DATE DE POST est éditable : le bouton ouvre un calendrier (option
    // « Retirer la date » visible dans le popover).
    await sheet
      .getByRole("button", { name: "Modifier la date de publication" })
      .click();
    await expect(
      page.getByRole("button", { name: "Retirer la date" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Compte de CRÉATRICE (non géré) : pas de saisie de lien admin — la
    // publication reste son geste (état en lecture seule).
    await expect(
      sheet.getByTestId("detail-publication-creator"),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /Publier \(coller le lien\)/ }),
    ).toHaveCount(0);
  });
});

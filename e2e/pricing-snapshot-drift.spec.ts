import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * DÉRIVE DE SNAPSHOT — un barème édité EN PLACE ne touche pas les assignations
 * déjà attribuées (leur snapshot est figé). Rien ne le montrait : en prod,
 * 56 assignations sont restées à 100 $/60 + 1,1 alors que l'écran affichait
 * 0 $/60 + 1,0, le pricingId identique masquant l'écart.
 */
test.describe("Barèmes — dérive des snapshots figés", () => {
  test("une édition en place laisse l'ancien barème sur les assignations déjà faites", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Drift ${ts}`,
      email: `e2e-creator-drift-${ts}@repackit.test`,
      password: "drift-12345",
    });

    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Drift ${ts}`,
      montantFixe: 100,
      nbVideosCible: 60,
      tauxCPM: 1.1,
    });

    // Une assignation attribuée SOUS les termes d'origine → snapshot figé.
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Drift ${ts}`,
    });
    for (const [kind, label] of [
      ["hook", "H"],
      ["flux", "F"],
      ["cta", "C"],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} drift ${ts}`,
        ...(kind === "hook" ? { tier: "S" as const } : {}),
      });
    }
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2edrift${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });

    // Tant que le barème n'a pas bougé, aucune dérive.
    let drift = await admin.query(api.pricing.listPricingSnapshotDrift, {});
    expect(drift.find((d) => d.pricingId === pricingId)).toBeUndefined();

    // ÉDITION EN PLACE — c'est le geste qui crée l'écart invisible.
    await admin.mutation(api.pricing.updatePricing, {
      id: pricingId,
      name: `[E2E_TEST] Drift ${ts}`,
      montantFixe: 0,
      nbVideosCible: 60,
      tauxCPM: 1,
    });

    drift = await admin.query(api.pricing.listPricingSnapshotDrift, {});
    const d = drift.find((x) => x.pricingId === pricingId);
    expect(d).toBeDefined();
    expect(d!.driftCount).toBe(1);
    // Les termes ACTUELS et les termes FIGÉS sont tous deux exposés — c'est la
    // comparaison des deux qui rend l'écart lisible à l'écran.
    expect(d!.current).toMatchObject({ montantFixe: 0, tauxCPM: 1 });
    expect(d!.generations).toHaveLength(1);
    expect(d!.generations[0]).toMatchObject({
      montantFixe: 100,
      nbVideosCible: 60,
      tauxCPM: 1.1,
      count: 1,
    });
    // Le détail au clic nomme la créatrice concernée.
    expect(d!.generations[0].sample[0].creatorName).toContain("Drift");
  });
});

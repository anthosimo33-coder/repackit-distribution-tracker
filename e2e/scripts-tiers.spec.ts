import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/**
 * Chantier 2 tiers visuels (Argent/Autre) :
 *  (A) UI — la page d'une campagne affiche les hooks en badges « Argent »
 *      (ex-S) / « Autre » (ex-A), jamais "Tier S/A/B" brut ; le sélecteur de
 *      tier de la modale d'assignation ne propose que Tous / Argent / Autre.
 *  (B) Migration — migrateTierBToA reclasse un hook "B" legacy en "A" (affiché
 *      « Autre »), idempotente, sans toucher au reste.
 */
test.describe("Tiers de hook — visuels Argent/Autre + migration B→A", () => {
  test("UI : badges Argent/Autre, sélecteur d'assignation 2 tiers (pas de B)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Tiers UI ${ts}`,
    });
    const mk = (kind: "hook" | "flux" | "cta", label: string, tier?: "S" | "A") =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} contenu`,
        ...(tier ? { tier } : {}),
      });
    await mk("hook", "H argent", "S");
    await mk("hook", "H autre", "A");
    await mk("flux", "F1");
    await mk("cta", "C1");

    await page.goto(adminPath(`/scripts/${campaignId}`));

    // Badges visuels présents, libellés bruts S/A/B absents.
    await expect(page.getByText("Argent").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Autre").first()).toBeVisible();
    await expect(page.getByText(/\bTier [SAB]\b/)).toHaveCount(0);

    // Modale d'assignation : le sélecteur "Tier de hook" propose Tous/Argent/
    // Autre, jamais B.
    await page.getByRole("button", { name: /assigner cette campagne/i }).click();
    await page.getByLabel("Tier de hook").click();
    await expect(page.getByRole("option", { name: "Tous" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Argent" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Autre" })).toBeVisible();
    await expect(page.getByRole("option", { name: /Tier B|Tier S/ })).toHaveCount(
      0,
    );
  });

  test("migration : un hook B legacy passe en A (« Autre »), idempotente", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Tiers Mig ${ts}`,
    });
    // Hook créé en "B" LEGACY (toléré par l'API ; l'UI ne le propose plus).
    const hookB = await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "hook",
      label: "H legacy B",
      content: "contenu",
      tier: "B",
    });

    const tierOf = async () => {
      const c = await admin.query(api.scripts.getCampaign, { id: campaignId });
      return c!.bricks.find((b) => b._id === hookB)!.tier ?? null;
    };
    expect(await tierOf()).toBe("B");

    // Migration → reclasse B en A.
    await admin.mutation(api.scripts.e2eMigrateTierBToA, { secret: E2E_SECRET });
    expect(await tierOf()).toBe("A");

    // Idempotente : relancer ne change rien (le hook reste en A).
    await admin.mutation(api.scripts.e2eMigrateTierBToA, { secret: E2E_SECRET });
    expect(await tierOf()).toBe("A");
  });
});

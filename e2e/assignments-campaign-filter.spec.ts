import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * Filtre CAMPAGNE de la vue Assignments — remplace l'ancien « Tous formats »,
 * qui ne filtrait que les assignations d'origine FORMAT (il n'en existe aucune
 * en prod : son menu était vide).
 *
 * Les specs verrouillent les trois propriétés qui le rendent utilisable : les
 * campagnes ARCHIVÉES restent sélectionnables (elles portent 23 % des livrables
 * sur Snytch), le filtre survit au rechargement, et un filtre actif se VOIT
 * (déclencheur nommé + bouton de réinitialisation) — sans quoi revenir sur une
 * liste restreinte se lit comme « des assignations ont disparu ».
 */
test.describe("Assignments — filtre par campagne de scripts", () => {
  /** Crée une campagne minimale (1 hook/flux/cta) + N assignations publiables. */
  async function makeCampaign(
    name: string,
    creatorId: Id<"creators">,
    count: number,
    ts: number,
    pricingId: Id<"pricings">,
  ): Promise<Id<"scriptCampaigns">> {
    const campaignId = await admin.mutation(api.scripts.createCampaign, { name });
    const brick = (kind: "hook" | "flux" | "cta", label: string, tier?: "S") =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} ${name}`,
        ...(tier ? { tier } : {}),
      });
    await brick("hook", "H", "S");
    await brick("flux", "F");
    await brick("cta", "C");
    const targets = [];
    for (let i = 0; i < count; i++) {
      targets.push(
        await availableTarget({
          e2eClient: admin,
          creatorId,
          platform: "TikTok",
          handle: `@e2ecf${ts}${name.slice(-2)}${i}`,
        }),
      );
    }
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId,
      targets,
      videosPerCreator: count,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    return campaignId;
  }

  test("archivées sélectionnables, filtre persistant et visible", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] CampFilter ${ts}`,
      email: `e2e-creator-campfilter-${ts}@repackit.test`,
      password: "campfilter-12345",
    });
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingCF ${ts}`,
      montantFixe: 100,
      nbVideosCible: 60,
      tauxCPM: 1.1,
    });

    // Une campagne ACTIVE à 3 assignations, une ARCHIVÉE à 1 : l'écart de
    // volume vérifie aussi le tri par effectif décroissant.
    const grosse = `[E2E_TEST] Grosse ${ts}`;
    const petite = `[E2E_TEST] Archivee ${ts}`;
    await makeCampaign(grosse, creator.creatorId, 3, ts, pricingId);
    const archivedId = await makeCampaign(petite, creator.creatorId, 1, ts, pricingId);
    await admin.mutation(api.scripts.updateCampaign, {
      id: archivedId,
      status: "archived",
    });

    await page.goto(adminPath("/assignments"));
    // Vue LISTE (le défaut est le calendrier).
    await page.getByRole("radio", { name: "Liste" }).click();
    const compteur = page.getByText(/\d+ \/ \d+ livrable/);
    await expect(compteur).toBeVisible({ timeout: 15_000 });

    // Aucun filtre au départ → pas de bouton de réinitialisation.
    await expect(
      page.getByRole("button", { name: /Réinitialiser/ }),
    ).toHaveCount(0);

    // Trigger ciblé par le TAG button + libellé (role varie selon base-ui).
    const trigger = page.locator("button").filter({ hasText: "Toutes campagnes" });
    await trigger.click();

    // Les deux sections sont là, et l'ARCHIVÉE est proposée avec son effectif.
    await expect(page.getByText("Actives", { exact: true })).toBeVisible();
    await expect(page.getByText("Archivées", { exact: true })).toBeVisible();
    const optionArchivee = page
      .locator('[role="option"]')
      .filter({ hasText: petite });
    await expect(optionArchivee).toHaveCount(1);

    // On coche l'ARCHIVÉE : c'est le cas qui rendrait ses livrables introuvables
    // si elle n'était pas sélectionnable.
    await optionArchivee.click();
    await page.keyboard.press("Escape");

    // Le déclencheur NOMME la campagne (jamais « 1 sélectionné »).
    await expect(
      page.locator("button").filter({ hasText: petite }),
    ).toHaveCount(1);
    // Le compteur reflète le filtre : 1 seule assignation sur cette campagne.
    await expect(page.getByText(/^1 \/ \d+ livrable/)).toBeVisible();
    // Et le filtre actif se VOIT.
    await expect(
      page.getByRole("button", { name: /Réinitialiser 1 filtre/ }),
    ).toBeVisible();

    // PERSISTANCE : rechargement → filtre toujours actif et toujours visible.
    await page.reload();
    await page.getByRole("radio", { name: "Liste" }).click();
    await expect(page.getByText(/^1 \/ \d+ livrable/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: /Réinitialiser 1 filtre/ }),
    ).toBeVisible();

    // Le filtre s'applique AUSSI en calendrier (les deux vues consomment la même
    // liste filtrée) : basculer ne doit pas le faire sauter en silence.
    await page.getByRole("radio", { name: "Calendrier" }).click();
    await expect(page.getByText(/^1 \/ \d+ livrable/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Réinitialiser 1 filtre/ }),
    ).toBeVisible();

    // Réinitialisation → tout revient, le bouton disparaît.
    await page.getByRole("button", { name: /Réinitialiser/ }).click();
    await expect(
      page.getByRole("button", { name: /Réinitialiser/ }),
    ).toHaveCount(0);
    await expect(
      page.locator("button").filter({ hasText: "Toutes campagnes" }),
    ).toHaveCount(1);
  });
});

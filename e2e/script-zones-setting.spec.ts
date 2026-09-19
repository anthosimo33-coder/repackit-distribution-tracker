import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const envUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!envUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const url: string = envUrl;
const admin = createE2eClient(url);

// Les titres de zone portent leur emoji DANS le même élément (« 🎬Dans la
// vidéo ») : un `exact` sur le texte seul ne les trouve jamais.
const ZONE_VIDEO = /Dans la vidéo$/;
const ZONE_DESCRIPTION = /En description$/;

const DAY = 86_400_000;

/**
 * SCRIPT EN DEUX ZONES — l'affichage devient un RÉGLAGE du projet.
 *
 * LE DÉFAUT QU'ELLE VERROUILLE. Les zones 🎬 / 📝 étaient réservées à
 * `slug === "snytch"`, côté serveur ET côté aperçu admin. Le projet de test porte
 * `e2e-test` : sous l'ancien code, allumer le réglage ne change rien et la
 * branche « allumé » ci-dessous est ROUGE (scriptZones reste null).
 *
 * Deux tests opposés sur la MÊME mission : le texte figé ne bouge pas, seul
 * l'affichage bascule — dans les deux sens.
 */

// Textes de forme réelle : ponctuation, @, hashtags, pas de « contenu 1 ».
const HOOK = "Tu sais qui a arrêté de te suivre cette semaine ?";
const FLUX = "J'ouvre l'app, je colle mon @ et en 10 secondes j'ai la liste.";
const CTA = "Lien en bio 👀 #instagram #unfollow";

async function missionScriptée(ts: number) {
  const creator = await createCreatorSession(url, {
    name: `[E2E_TEST] Léa Deux-Zones ${ts}`,
    email: `e2e-script-zones-${ts}@repackit.test`,
    password: "zones-12345",
  });
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Deux zones ${ts}`,
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId, kind: "hook", label: "Hook unfollow", content: HOOK, mode: "afficher",
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId, kind: "flux", label: "Flux démo", content: FLUX, mode: "dire",
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId, kind: "cta", label: "CTA bio", content: CTA,
  });
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Pricing zones ${ts}`,
    montantFixe: 100,
    nbVideosCible: 10,
    tauxCPM: 2,
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: creator.creatorId,
    platform: "TikTok",
    handle: `@lea.zones_${ts}`,
  });
  await admin.mutation(api.scripts.assignScriptCampaign, {
    campaignId,
    creatorId: creator.creatorId,
    targets: [target],
    videosPerCreator: 1,
    dueDate: ts + 7 * DAY,
    pricingId,
  });
  const mission = (await admin.query(api.assignments.listAssignments, {})).find(
    (a) => a.creatorId === creator.creatorId,
  )!;
  return { creator, campaignId, missionId: mission._id as Id<"assignments"> };
}

test.describe("Script en deux zones — réglage du projet", () => {
  test.afterAll(async () => {
    // Projet e2e PARTAGÉ : rendu en bloc unique, son état d'origine.
    await admin.mutation(api.projects.setScriptZonesEnabled, { enabled: false });
  });

  test("la même mission bascule entre bloc unique et deux zones, texte intact", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    await admin.mutation(api.projects.setScriptZonesEnabled, { enabled: false });
    const { creator, missionId } = await missionScriptée(ts);
    const lire = () =>
      creator.client.query(api.assignments.getMyAssignment, {
        projectId: creator.projectId,
        id: missionId,
      });

    // ── ÉTEINT : bloc unique.
    const eteint = await lire();
    expect(eteint!.scriptZones).toBeNull();
    expect(eteint!.assembledScript).toContain(HOOK);

    // ── ALLUMÉ : deux zones, modes de chaque brique, cta en description.
    await admin.mutation(api.projects.setScriptZonesEnabled, { enabled: true });
    const allume = await lire();
    expect(allume!.scriptZones).toEqual({
      videoBlocks: [
        { text: HOOK, mode: "afficher" },
        { text: FLUX, mode: "dire" },
      ],
      descriptionScript: CTA,
    });
    // Affichage seulement : le texte figé de la mission n'a pas bougé.
    expect(allume!.assembledScript).toBe(eteint!.assembledScript);

    // ── Ce que voit la créatrice, dans les deux sens.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(`e2e-script-zones-${ts}@repackit.test`);
    await page.getByLabel(/mot de passe/i).fill("zones-12345");
    await page.getByRole("button", { name: /se connecter/i }).click();
    await page.waitForURL("**/app", { timeout: 30_000 });

    await page.goto(`/app/assignments/${missionId}`);
    await expect(page.getByText(ZONE_VIDEO)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(ZONE_DESCRIPTION)).toBeVisible();
    await expect(page.getByText("À afficher en texte à l'écran")).toBeVisible();
    await expect(page.getByText("Vidéo à tourner", { exact: true })).toHaveCount(0);

    await admin.mutation(api.projects.setScriptZonesEnabled, { enabled: false });
    await page.reload();
    await expect(page.getByText("Vidéo à tourner", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(HOOK)).toBeVisible();
    await expect(page.getByText(ZONE_VIDEO)).toHaveCount(0);
    await ctx.close();
  });

  test("l'interrupteur de la page Scripts pilote l'aperçu admin", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    await admin.mutation(api.projects.setScriptZonesEnabled, { enabled: false });
    const { campaignId } = await missionScriptée(ts);

    const ouvrirApercu = async () => {
      await page.goto(adminPath(`/scripts/${campaignId}`));
      await page.getByRole("button", { name: "Aperçu d'un script" }).click();
      return page.getByTestId("preview-output");
    };

    // Éteint : l'aperçu montre le bloc enchaîné, sans zones.
    let apercu = await ouvrirApercu();
    await expect(apercu.getByText(HOOK)).toBeVisible({ timeout: 20_000 });
    await expect(apercu.getByText(ZONE_DESCRIPTION)).toHaveCount(0);

    // Allumer depuis l'écran.
    await page.goto(adminPath("/scripts"));
    await page.getByRole("button", { name: "Réglages des scripts" }).click();
    const interrupteur = page.getByRole("switch", { name: "Script en deux zones" });
    await expect(interrupteur).not.toBeChecked({ timeout: 20_000 });
    await interrupteur.click();
    await expect(page.getByText("Réglage enregistré")).toBeVisible({ timeout: 10_000 });
    await expect(interrupteur).toBeChecked();

    // Allumé : l'aperçu montre ce que verra la créatrice.
    apercu = await ouvrirApercu();
    await expect(apercu.getByText(ZONE_DESCRIPTION)).toBeVisible({ timeout: 20_000 });
    await expect(apercu.getByText(CTA)).toBeVisible();
  });
});

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

const DAY = 86_400_000;

/**
 * HOOK LIBRE — un hook donné comme une DIRECTION (convex/hookLibre.ts).
 *
 * CE QU'ELLE VERROUILLE, absent avant la PR :
 *  1. la fiche créatrice reçoit la direction et les exemples, et le reste du
 *     script SANS l'exemple principal — alors que le texte figé de la mission,
 *     lui, ne bouge pas (il garde l'exemple : c'est le repli) ;
 *  2. l'interrupteur est lu EN DIRECT : éteint, la même mission redevient une
 *     phrase à dire (absence adossée à la présence, même page) ;
 *  3. l'éditeur admin écrit les trois champs en base et l'aperçu les montre.
 *
 * Sous l'ancien code, `createBrick` refuse `libre` (argument inconnu) et la
 * fiche n'a pas de `scriptHookLibre` : la spec est rouge dès sa première ligne.
 */

// Textes de forme réelle (BLUSH) : ponctuation, majuscules, emojis, hashtags.
const HOOK = "8 mois de situationship et je découvre ÇA ??!!";
const AUTRE = "On se parle depuis 3 semaines et je viens de voir ÇA…";
const DIRECTION = "Une relation qui dure (la durée, tu choisis), puis tu tombes sur un truc qui change tout.";
const FLUX = "Il me disait qu'il était « pas prêt »…\nSpoiler : il l'était, mais pas avec moi.";
const CTA = "mon intuition avait donc raison #crush #pourlesfilles";

async function missionLibre(ts: number) {
  const email = `e2e-hook-libre-${ts}@repackit.test`;
  const password = "libre-12345";
  const creator = await createCreatorSession(url, {
    name: `[E2E_TEST] Inès Hook-Libre ${ts}`,
    email,
    password,
  });
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Hook libre ${ts}`,
  });
  const hookId = await admin.mutation(api.scripts.createBrick, {
    campaignId,
    kind: "hook",
    label: "Situationship",
    content: HOOK,
    libre: true,
    direction: DIRECTION,
    // Saisie brute : l'exemple principal répété et une ligne vide sont écartés.
    autresExemples: [AUTRE, "  ", HOOK],
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId, kind: "flux", label: "Flux pas prêt", content: FLUX,
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId, kind: "cta", label: "CTA intuition", content: CTA,
  });
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Pricing hook libre ${ts}`,
    montantFixe: 100,
    nbVideosCible: 10,
    tauxCPM: 2,
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: creator.creatorId,
    platform: "TikTok",
    handle: `@ines.libre_${ts}`,
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
  return {
    creator,
    email,
    password,
    campaignId,
    hookId,
    missionId: mission._id as Id<"assignments">,
  };
}

test.describe("Hook libre", () => {
  test("la fiche montre une direction ; éteint, la même mission redevient une phrase", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const { creator, email, password, hookId, missionId } = await missionLibre(ts);
    const lire = () =>
      creator.client.query(api.assignments.getMyAssignment, {
        projectId: creator.projectId,
        id: missionId,
      });

    // ── Serveur : direction + exemples + suite ; texte figé intact.
    const libre = await lire();
    expect(libre!.scriptHookLibre).toEqual({
      direction: DIRECTION,
      exemples: [HOOK, AUTRE],
      reste: `${FLUX}\n\n${CTA}`,
    });
    expect(libre!.assembledScript).toBe(`${HOOK}\n\n${FLUX}\n\n${CTA}`);

    // ── Écran créatrice.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/mot de passe/i).fill(password);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await page.waitForURL("**/app", { timeout: 30_000 });

    await page.goto(`/app/assignments/${missionId}`);
    const bloc = page.getByTestId("hook-libre");
    await expect(bloc).toBeVisible({ timeout: 20_000 });
    await expect(bloc).toContainText("Ton hook, avec tes mots");
    await expect(bloc).toContainText(DIRECTION);
    await expect(bloc.getByRole("listitem")).toHaveText([HOOK, AUTRE]);
    // L'exemple n'apparaît QU'une fois, dans les exemples : il n'est pas
    // réaffiché au-dessus du flux comme une phrase à dire.
    await expect(page.getByText(HOOK, { exact: true })).toHaveCount(1);
    await expect(page.getByText(CTA)).toBeVisible();

    // ── Éteint : la même mission, sans réassigner, redevient une phrase.
    await admin.mutation(api.scripts.updateBrick, { id: hookId, libre: false });
    const eteint = await lire();
    expect(eteint!.scriptHookLibre).toBeNull();
    expect(eteint!.assembledScript).toBe(libre!.assembledScript);
    await page.reload();
    await expect(page.getByText(CTA)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("hook-libre")).toHaveCount(0);
    await expect(page.getByText(HOOK)).toBeVisible();
    await ctx.close();
  });

  test("les champs libres ne valent que pour un hook, et les exemples sont bornés", async () => {
    const ts = Date.now();
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Hook libre bornes ${ts}`,
    });
    // Un flux n'est jamais libre, même si on le demande.
    const fluxId = await admin.mutation(api.scripts.createBrick, {
      campaignId, kind: "flux", label: "Flux", content: FLUX,
      libre: true, direction: DIRECTION,
    });
    // Six autres exemples : refusé, jamais tronqué en silence.
    await expect(
      admin.mutation(api.scripts.createBrick, {
        campaignId, kind: "hook", label: "Trop", content: HOOK, libre: true,
        autresExemples: [1, 2, 3, 4, 5, 6].map((n) => `${n} mois et je découvre ÇA`),
      }),
    ).rejects.toThrow(/ERR_HOOK_EXAMPLES_TOO_MANY/);
    // Cinq passent.
    const hookId = await admin.mutation(api.scripts.createBrick, {
      campaignId, kind: "hook", label: "Cinq", content: HOOK, libre: true,
      autresExemples: [1, 2, 3, 4, 5].map((n) => `${n} mois et je découvre ÇA`),
    });
    const camp = await admin.query(api.scripts.getCampaign, { id: campaignId });
    const flux = camp!.bricks.find((b) => b._id === fluxId)!;
    const hook = camp!.bricks.find((b) => b._id === hookId)!;
    expect([flux.libre, flux.direction]).toEqual([undefined, undefined]);
    expect([hook.libre, hook.autresExemples?.length]).toEqual([true, 5]);
  });

  test("l'éditeur de campagne bascule un hook en libre, l'aperçu suit", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Hook libre éditeur ${ts}`,
    });
    const hook = `${HOOK} ${ts}`;
    const hookId = await admin.mutation(api.scripts.createBrick, {
      campaignId, kind: "hook", label: `H ${ts}`, content: hook,
    });
    await admin.mutation(api.scripts.createBrick, { campaignId, kind: "flux", label: "F", content: FLUX });
    await admin.mutation(api.scripts.createBrick, { campaignId, kind: "cta", label: "C", content: CTA });

    await page.goto(adminPath(`/scripts/${campaignId}`));
    const ligne = page.getByTestId("brick-list").getByTestId("brick-row").filter({ hasText: hook.slice(0, 40) });
    await ligne.getByRole("button").first().click();
    await expect(page.locator("#brick-content")).toHaveValue(hook, { timeout: 15_000 });

    // Éteint : ni champ de direction, ni bloc libre dans l'aperçu.
    await expect(page.locator("#brick-direction")).toHaveCount(0);
    await expect(page.getByTestId("editor-preview").getByTestId("hook-libre")).toHaveCount(0);

    await page.getByRole("switch", { name: "Hook libre" }).click();
    await page.locator("#brick-direction").fill(DIRECTION);
    await page.locator("#brick-autres-exemples").fill(`${AUTRE}\n\n`);
    const apercu = page.getByTestId("editor-preview").getByTestId("hook-libre");
    await expect(apercu).toContainText(DIRECTION);
    await expect(apercu.getByRole("listitem")).toHaveText([hook, AUTRE]);
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByTestId("brick-dirty")).toHaveCount(0, { timeout: 15_000 });

    await expect(ligne.getByTestId("brick-libre-tag")).toBeVisible();
    await expect
      .poll(async () => {
        const camp = await admin.query(api.scripts.getCampaign, { id: campaignId });
        const b = camp!.bricks.find((x) => x._id === hookId)!;
        return [b.libre, b.direction, b.autresExemples];
      }, { timeout: 15_000 })
      .toEqual([true, DIRECTION, [AUTRE]]);
  });
});

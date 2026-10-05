import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
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
 * Campagne à DEUX hooks (pour qu'un combo se distingue de l'autre), deux flux,
 * un CTA, un barème — et `n` missions pour une créatrice.
 */
async function seed(ts: number, n: number) {
  const creatorName = `[E2E_TEST] Pilotage ${ts}`;
  const creator = await createCreatorSession(url!, {
    name: creatorName,
    email: `e2e-creator-pilotage-${ts}@repackit.test`,
    password: "pilotage-12345",
  });
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Pilotage ${ts}`,
  });
  const brick = (kind: "hook" | "flux" | "cta", label: string) =>
    admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind,
      label,
      content: `${label} contenu`,
    });
  const hooks = [
    { id: await brick("hook", `H1 ${ts}`), label: `H1 ${ts}` },
    { id: await brick("hook", `H2 ${ts}`), label: `H2 ${ts}` },
  ];
  // Deux flux : 2 × 2 = 4 combos distincts, assez pour 3 missions (la règle
  // d'unicité n'en crée pas plus qu'il n'existe de combos).
  await brick("flux", `F1 ${ts}`);
  await brick("flux", `F2 ${ts}`);
  await brick("cta", `C ${ts}`);
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Pilotage ${ts}`,
    montantFixe: 100,
    nbVideosCible: 10,
    tauxCPM: 2,
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: creator.creatorId,
    platform: "TikTok",
    handle: `@e2epilotage${ts}`,
  });
  await admin.mutation(api.scripts.assignScriptCampaign, {
    campaignId,
    creatorId: creator.creatorId,
    targets: [target],
    videosPerCreator: n,
    dueDate: ts + 7 * DAY,
    pricingId,
  });
  const full = (await admin.query(api.assignments.listAssignments, {})).filter(
    (a) => a.scriptCombo?.campaignId === campaignId,
  );
  expect(full).toHaveLength(n);
  return { creatorName, hooks, full };
}

/**
 * L'écran Missions lit `listAssignmentsPilotage`, projection LÉGÈRE de la même
 * ligne (1 443 → 892 Kio sur Snytch le 05/10/2026). Les champs retirés y sont
 * ABSENTS alors qu'ils existent dans la complète ; ceux qui restent ont la MÊME
 * valeur ; le combo se demande à part ; l'accueil compte sans lire la liste.
 */
test.describe("Écran Missions — liste légère", () => {
  test("ni tarif ni combo dans la liste ; mêmes valeurs ; combo à la demande ; compte de l'accueil", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    // Trois missions dont UNE soumise : un compteur qui compterait autre chose
    // que les vidéos soumises ne tomberait pas juste par hasard.
    const { full } = await seed(ts, 3);
    const [m, other] = full;

    await admin.mutation(api.assignments.addModelVideoToAssignment, {
      id: m._id,
      url: `https://www.tiktok.com/@e2e/video/${ts}`,
      title: "Ref",
    });
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: other._id,
      status: "video_submitted",
    });

    const complete = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a._id === m._id,
    )!;
    const pilotage = await admin.query(api.assignments.listAssignmentsPilotage, {});
    const light = pilotage.find((a) => a._id === m._id)!;

    // Retirés : présents dans la complète (sinon l'absence ne prouverait rien)…
    const retires = [
      "pricingSnapshot",
      "rateSnapshot",
      "comboKey",
      "scriptCombo",
      "projectId",
      "_creationTime",
    ] as const;
    for (const k of retires) expect(complete[k], k).toBeDefined();
    // … et absents de la légère.
    for (const k of retires) expect(Object.keys(light), k).not.toContain(k);

    // Gardés : même valeur que la complète, champ par champ.
    for (const [k, v] of Object.entries(light)) {
      if (k === "modelVideos") continue;
      expect(v, k).toEqual(complete[k as keyof typeof complete]);
    }
    // Vidéos modèles : tout sauf la date d'ajout (jamais affichée).
    expect(complete.modelVideos?.[0]?.addedAt).toBeGreaterThan(0);
    expect(light.modelVideos).toEqual([
      { id: complete.modelVideos![0].id, url: complete.modelVideos![0].url, title: "Ref" },
    ]);

    // Même ensemble de lignes, même ordre.
    expect(pilotage.map((a) => a._id)).toEqual(
      (await admin.query(api.assignments.listAssignments, {})).map((a) => a._id),
    );

    // Le combo, à la demande : exactement celui de la ligne complète.
    expect(await admin.query(api.assignments.getAssignmentCombo, { id: m._id })).toEqual(
      complete.scriptCombo,
    );

    // L'accueil : le même compte que la liste, sans la lire (1 sur 3, pour prouver).
    const soumises = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.status === "video_submitted",
    ).length;
    expect(soumises).toBe(1);
    expect(
      await admin.query(api.assignments.countVideoSubmittedForDashboard, {}),
    ).toBe(soumises);
  });

  test("les modales de combo, ouvertes depuis la liste, chargent le BON combo", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { creatorName, hooks, full } = await seed(ts, 1);
    const [m] = full;
    const combo = (await admin.query(api.assignments.getAssignmentCombo, {
      id: m._id,
    }))!;
    const current = hooks.find((h) => h.id === combo.hookBrickId)!;
    const autre = hooks.find((h) => h.id !== combo.hookBrickId)!;

    await page.goto(adminPath("/assignments"));
    await page.getByRole("radio", { name: "Liste" }).click();
    const row = page.getByRole("row").filter({ hasText: creatorName });
    await expect(row).toHaveCount(1, { timeout: 10_000 });

    // « Éditer le texte » : pré-rempli avec le texte du hook EN PLACE.
    await row.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Éditer le texte" }).click();
    const texte = page.getByRole("dialog", { name: `Éditer le texte — ${creatorName}` });
    await expect(texte.getByLabel("Texte")).toHaveValue(`${current.label} contenu`, {
      timeout: 10_000,
    });
    await texte.getByRole("button", { name: "Annuler" }).click();
    await expect(texte).toBeHidden();

    // « Modifier le combo » : seule l'AUTRE brique est proposée — la modale
    // connaît donc le hook en place. On la choisit, le serveur suit.
    await row.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Modifier le combo" }).click();
    const dialog = page.getByRole("dialog", { name: `Modifier le combo — ${creatorName}` });
    await dialog.getByRole("combobox", { name: "Nouvelle brique" }).click();
    const options = page.getByRole("option");
    await expect(options).toHaveText([autre.label]);
    await options.first().click();
    await dialog.getByRole("button", { name: "Corriger le combo" }).click();
    await expect(page.getByText("Combo corrigé — script mis à jour.")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await admin.query(api.assignments.getAssignmentCombo, { id: m._id }))
            ?.hookBrickId,
        { timeout: 10_000 },
      )
      .toBe(autre.id as Id<"scriptBricks">);
  });
});

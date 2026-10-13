import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { parisDayKey } from "../convex/viewsDaily";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);
const DAY = 86_400_000;

const BIBLE_C2 = readFileSync(path.resolve(__dirname, "../docs/scenarios/bibles/bible_C2.json"), "utf8");
const bibleSous = (code: string) => BIBLE_C2.replace('"id": "C2"', `"id": "${code}"`);
/** « [JJ/MM/AAAA » du jour de Paris : la conv d'une mission finit le jour où on la récupère. */
function crochetDuJour(): string {
  const [a, m, j] = parisDayKey(Date.now()).split("-");
  return `[${j}/${m}/${a}`;
}

async function campagneAvecScenario(ts: number) {
  const code = `M${ts.toString(36).toUpperCase()}`.slice(0, 12);
  const scenarioId = await admin.mutation(api.scenarios.creerScenario, { bible: bibleSous(code), theme: "La dispute" });
  const campaignId = await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] Scénario ${ts}` });
  const add = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
    admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
  await add("hook", "Situationship", `4 ans de situationship et je découvre ÇA ${ts}`);
  await add("hook", "Ruiner", `Ce site va RUINER tellement de couples ${ts}`);
  await add("flux", "S1", `Montre la conv comme si c'était normal, puis importe-la ${ts}`);
  await add("cta", "Bio", `Le site est en bio 💬 ${ts}`);
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] PricingScenario ${ts}`,
    montantFixe: 100,
    nbVideosCible: 10,
    tauxCPM: 2,
  });
  return { code, scenarioId, campaignId, pricingId };
}

/**
 * Scénarios dans les campagnes (étape 2) — une brique « conversation » reliée à
 * un scénario : tirée en rotation tant que le scénario est ACTIF, générée au
 * prénom de la créatrice, différente pour chaque mission, finissant le jour où
 * elle la récupère. Le moteur est couvert par lib/scenario-engine.test.ts.
 */
test.describe("Scénarios dans les missions", () => {
  test("rotation si actif, conv au prénom et du jour, une par mission, isolation", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const { scenarioId, campaignId, pricingId } = await campagneAvecScenario(ts);
    const juliette = await createCreatorSession(url, {
      name: `Juliette Chetrit [E2E_TEST] ${ts}`,
      email: `e2e-creator-scen-${ts}@repackit.test`,
      password: "scen-12345",
    });
    const ines = await createCreatorSession(url, {
      name: `Inès Garnier [E2E_TEST] ${ts}`,
      email: `e2e-creator-scen2-${ts}@repackit.test`,
      password: "scen2-12345",
    });
    const assign = async (creatorId: Id<"creators">, handle: string, n: number) => {
      const target = await availableTarget({ e2eClient: admin, creatorId, platform: "TikTok", handle });
      return admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId,
        targets: [target],
        videosPerCreator: n,
        dueDate: ts + 7 * DAY,
        pricingId,
      });
    };
    const rowsFor = async (creatorId: Id<"creators">) =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) => a.scriptCombo?.campaignId === campaignId && a.creatorId === creatorId,
      );

    await admin.mutation(api.scripts.updateCampaign, { id: campaignId, conversationEnabled: true });
    const brique = await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "conversation",
      label: "C2 · Le like de l'ex",
      content: "",
      scenarioId,
    });

    // ── Scénario en BROUILLON : pas tirable, l'assignation est refusée.
    await expect(assign(juliette.creatorId, `@e2escen${ts}`, 1)).rejects.toThrow(/ERR_NO_ACTIVE_CONVERSATION/);
    expect(await rowsFor(juliette.creatorId)).toHaveLength(0);

    // ── Actif : deux vidéos, la conv du scénario sur chacune.
    await admin.mutation(api.scenarios.changerStatutScenario, { id: scenarioId, statut: "actif" });
    expect((await assign(juliette.creatorId, `@e2escen${ts}`, 2)).created).toBe(2);
    const [a, b] = await rowsFor(juliette.creatorId);
    expect([a!.conversationBrickId, b!.conversationBrickId]).toEqual([brique, brique]);

    // ── Fiche : une conv GÉNÉRÉE, rien du scénario lui-même.
    const fiche = await juliette.client.query(api.assignments.getMyAssignment, {
      projectId: juliette.projectId,
      id: a!._id,
    });
    expect(fiche!.scriptConversation).toEqual({ text: "", instruction: null, files: [], genere: true });
    expect(JSON.stringify(fiche)).not.toContain(scenarioId);

    // ── La conv : à SON prénom, qui finit aujourd'hui, la même à chaque fois.
    const generer = (id: Id<"assignments">) =>
      juliette.client.action(api.scenarioMission.genererConversationMission, {
        projectId: juliette.projectId,
        assignmentId: id,
      });
    const convA = await generer(a!._id);
    expect(convA).toMatchObject({ nomFichier: "WhatsApp Chat - Juliette, Yanis.txt", prenom: "Juliette", lui: "Yanis" });
    const finA = convA.texte.trimEnd().split("\n").slice(-5);
    expect(finA[4]).toBe(`${crochetDuJour()} 22:33:05] Juliette: t'as raison pardon`);
    expect(convA.texte).not.toContain("Kelly");
    expect((await generer(a!._id)).texte).toBe(convA.texte);

    // ── Une AUTRE mission : un autre remplissage, le même écran choc.
    const convB = await generer(b!._id);
    expect(convB.texte).not.toBe(convA.texte);
    expect(convB.texte.trimEnd().split("\n").slice(-5)).toEqual(finA);

    // ── Isolation : la mission d'une autre créatrice est introuvable.
    await assign(ines.creatorId, `@e2escen2${ts}`, 1);
    const [missionInes] = await rowsFor(ines.creatorId);
    await expect(generer(missionInes!._id)).rejects.toThrow(/ERR_SCENARIO_NOT_FOUND/);

    // ── Archivé : plus de nouvelle vidéo ; les missions déjà assignées gardent leur conv.
    await admin.mutation(api.scenarios.changerStatutScenario, { id: scenarioId, statut: "archive" });
    // (Inès a encore une combinaison libre : le refus vient bien du scénario.)
    await expect(assign(ines.creatorId, `@e2escen2${ts}`, 1)).rejects.toThrow(/ERR_NO_ACTIVE_CONVERSATION/);
    expect((await generer(a!._id)).texte).toBe(convA.texte);
  });

  test("écran campagne : choisir le scénario ; fiche : préparer puis télécharger la conv", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const { code, scenarioId, campaignId, pricingId } = await campagneAvecScenario(ts);
    await admin.mutation(api.scenarios.changerStatutScenario, { id: scenarioId, statut: "actif" });

    await page.goto(adminPath(`/scripts/${campaignId}`));
    await expect(page.getByTestId("combo-count")).toContainText("2", { timeout: 15_000 });
    await page.getByTestId("conversation-toggle").click();
    await expect(page.getByTestId("conversation-missing")).toBeVisible();
    await page.getByRole("tab", { name: /^Scénario/ }).click();
    await page.getByRole("button", { name: "Ajouter" }).first().click();
    const volet = page.getByRole("region", { name: "Édition de la brique sélectionnée" });
    await volet.getByTestId("brick-scenario").click();
    await page.getByRole("option", { name: new RegExp(`^${code} · `) }).click();
    // Le nom court se remplit avec le scénario ; pas de dépôt de fichiers.
    await expect(volet.locator("#brick-label")).toHaveValue(`${code} · Le like de l'ex`);
    await expect(volet.getByTestId("conversation-files")).toHaveCount(0);
    await volet.getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByTestId("brick-scenario-tag")).toHaveText(`scénario ${code}`, { timeout: 15_000 });
    await expect(page.getByTestId("conversation-missing")).toHaveCount(0);
    await expect
      .poll(async () =>
        (await admin.query(api.scripts.getCampaign, { id: campaignId }))!.bricks
          .filter((x) => x.kind === "conversation")
          .map((x) => x.scenarioId),
      )
      .toEqual([scenarioId]);

    // Fiche de la créatrice (vue observée) : 1. préparer, 2. télécharger.
    const creator = await createCreatorSession(url, {
      name: `Kelly [E2E_TEST] ${ts}`,
      email: `e2e-creator-scenui-${ts}@repackit.test`,
      password: "scenui-12345",
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2escenui${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.scriptCombo?.campaignId === campaignId,
    )!;
    await page.goto(`/admin/voir/${E2E_PROJECT_SLUG}/${creator.creatorId}/assignments/${row._id}`);
    const carte = page.getByTestId("mission-scenario");
    await expect(carte).toBeVisible({ timeout: 20_000 });
    await expect(carte).toContainText("1. Récupère la conv");
    await carte.getByTestId("mission-scenario-preparer").click();
    await expect(carte.getByTestId("mission-scenario-ecran")).toBeVisible({ timeout: 30_000 });
    const telechargement = page.waitForEvent("download");
    await carte.getByTestId("mission-scenario-txt").click();
    const fichier = await telechargement;
    expect(fichier.suggestedFilename()).toBe("WhatsApp Chat - Kelly, Yanis.txt");
    const texte = readFileSync((await fichier.path())!, "utf8");
    expect(texte.trimEnd().split("\n").slice(-1)[0]).toBe(`${crochetDuJour()} 22:33:05] Kelly: t'as raison pardon`);
  });
});

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
  // Thème propre à ce test : la base e2e garde les scénarios des autres.
  const theme = `Dispute ${ts}`;
  const scenarioId = await admin.mutation(api.scenarios.creerScenario, { bible: bibleSous(code), theme });
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
  return { code, theme, scenarioId, campaignId, pricingId, add };
}

/**
 * Conversations dans les campagnes — la campagne coche des THÈMES ; chaque
 * vidéo tire un scénario ACTIF de ces thèmes, en rotation, posé sur la mission
 * (`scenarioId`). La conv est générée au prénom de la créatrice, différente
 * pour chaque mission, et finit le jour où elle la récupère. Le moteur est
 * couvert par lib/scenario-engine.test.ts.
 */
test.describe("Scénarios dans les missions", () => {
  test("thème coché : actifs tirés en rotation, conv au prénom et du jour, une par mission, isolation", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const { theme, scenarioId, campaignId, pricingId, add } = await campagneAvecScenario(ts);
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

    // Thème coché tel qu'on le tape : la casse et les espaces ne comptent pas.
    await admin.mutation(api.scripts.updateCampaign, {
      id: campaignId,
      conversationEnabled: true,
      conversationThemes: [` ${theme.toLowerCase()} `],
    });

    // ── Scénario en BROUILLON : pas tirable, l'assignation est refusée.
    await expect(assign(juliette.creatorId, `@e2escen${ts}`, 1)).rejects.toThrow(/ERR_NO_ACTIVE_CONVERSATION/);
    expect(await rowsFor(juliette.creatorId)).toHaveLength(0);

    // ── Actif : deux vidéos, le scénario du thème sur chacune.
    await admin.mutation(api.scenarios.changerStatutScenario, { id: scenarioId, statut: "actif" });
    expect((await assign(juliette.creatorId, `@e2escen${ts}`, 2)).created).toBe(2);
    const [a, b] = await rowsFor(juliette.creatorId);
    expect([a!.scenarioId, b!.scenarioId]).toEqual([scenarioId, scenarioId]);

    // ── Un 2e scénario du thème passé en « Actif » part tout seul, en rotation :
    // le moins servi sur la campagne d'abord.
    const second = await admin.mutation(api.scenarios.creerScenario, {
      bible: bibleSous(`N${ts.toString(36).toUpperCase()}`.slice(0, 12)),
      theme,
    });
    await admin.mutation(api.scenarios.changerStatutScenario, { id: second, statut: "actif" });
    expect((await assign(ines.creatorId, `@e2escen2${ts}`, 2)).created).toBe(2);
    expect(new Set((await rowsFor(ines.creatorId)).map((r) => r.scenarioId))).toEqual(new Set([second, scenarioId]));

    // ── Fiche : une conv GÉNÉRÉE, rien du scénario lui-même.
    const fiche = await juliette.client.query(api.assignments.getMyAssignment, {
      projectId: juliette.projectId,
      id: a!._id,
    });
    expect(fiche!.scriptConversation).toEqual({ genere: true });
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
    const [missionInes] = await rowsFor(ines.creatorId);
    await expect(generer(missionInes!._id)).rejects.toThrow(/ERR_SCENARIO_NOT_FOUND/);

    // ── À la main (panneau de mission) : changer, retirer ; un archivé ne se donne pas.
    await admin.mutation(api.scripts.setAssignmentScenario, { id: b!._id, scenarioId: second });
    expect(await admin.query(api.assignments.getAssignmentScenario, { id: b!._id })).toEqual({ scenarioId: second });
    await admin.mutation(api.scripts.setAssignmentScenario, { id: b!._id, scenarioId: null });
    expect(await admin.query(api.assignments.getAssignmentScenario, { id: b!._id })).toEqual({ scenarioId: null });
    expect(
      await juliette.client.query(api.assignments.getMyAssignment, { projectId: juliette.projectId, id: b!._id }),
    ).toMatchObject({ scriptConversation: null });

    // ── Archivés : plus de nouvelle vidéo ; les missions déjà assignées gardent leur conv.
    for (const id of [scenarioId, second]) {
      await admin.mutation(api.scenarios.changerStatutScenario, { id, statut: "archive" });
    }
    await expect(
      admin.mutation(api.scripts.setAssignmentScenario, { id: b!._id, scenarioId }),
    ).rejects.toThrow(/ERR_SCENARIO_ARCHIVED/);
    // Un 3e hook libère une combinaison : le refus vient bien des scénarios.
    await add("hook", "Remplaçant", `Il m'a remplacée en 3 jours ${ts}`);
    await expect(assign(juliette.creatorId, `@e2escen${ts}`, 1)).rejects.toThrow(/ERR_NO_ACTIVE_CONVERSATION/);
    expect((await generer(a!._id)).texte).toBe(convA.texte);
  });

  test("écran campagne : cocher un thème ; fiche : préparer puis télécharger la conv", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const { theme, scenarioId, campaignId, pricingId } = await campagneAvecScenario(ts);
    await admin.mutation(api.scenarios.changerStatutScenario, { id: scenarioId, statut: "actif" });

    await page.goto(adminPath(`/scripts/${campaignId}`));
    await expect(page.getByTestId("combo-count")).toContainText("2", { timeout: 15_000 });
    // Plus d'onglet de brique pour la conversation : les thèmes sont sous l'interrupteur.
    await expect(page.getByRole("tab", { name: /^Scénario/ })).toHaveCount(0);
    await page.getByTestId("conversation-toggle").click();
    const themes = page.getByTestId("conversation-themes");
    // Nom accessible = le libellé entier (« thème · N scénarios actifs »).
    const coche = themes.getByRole("checkbox", { name: new RegExp(`^${theme}(\\s|$)`) });
    await expect(coche).toBeVisible({ timeout: 15_000 });
    await expect(themes.locator("label").filter({ hasText: theme })).toContainText("1 scénario actif");
    // Aucun thème coché : l'assignation est bloquée, et l'écran le dit.
    await expect(page.getByTestId("conversation-missing")).toBeVisible();
    await expect(page.getByRole("button", { name: "Assigner cette campagne" })).toBeDisabled();
    await coche.click();
    await expect(coche).toBeChecked();
    await expect(page.getByTestId("conversation-missing")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Assigner cette campagne" })).toBeEnabled();
    await expect
      .poll(async () => (await admin.query(api.scripts.getCampaign, { id: campaignId }))!.conversationThemes)
      .toEqual([theme]);

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
    expect(row.scenarioId).toBe(scenarioId);
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

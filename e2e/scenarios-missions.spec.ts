import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
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

const BIBLE_C2 = readFileSync(path.resolve(__dirname, "../docs/scenarios/bibles/bible_C2.json"), "utf8");
const bibleSous = (code: string) => BIBLE_C2.replace('"id": "C2"', `"id": "${code}"`);

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
 * Conversations dans les missions — le THÈME se choisit à l'assignation
 * (fenêtre « Assigner », argument `conversationTheme`) ; chaque vidéo tire un
 * scénario de ce thème (sauf archivé), en rotation, posé sur la mission
 * (`scenarioId`). La conv est générée au prénom de la créatrice, différente
 * pour chaque mission, et finit le jour où elle la récupère. Le moteur est
 * couvert par lib/scenario-engine.test.ts.
 */
test.describe("Scénarios dans les missions", () => {
  test("thème choisi à l'assignation : rotation, conv au prénom et du jour, une par mission, isolation", async () => {
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
    const assign = async (creatorId: Id<"creators">, handle: string, n: number, conversationTheme?: string) => {
      const target = await availableTarget({ e2eClient: admin, creatorId, platform: "TikTok", handle });
      return admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId,
        targets: [target],
        videosPerCreator: n,
        dueDate: ts + 7 * DAY,
        pricingId,
        ...(conversationTheme !== undefined ? { conversationTheme } : {}),
      });
    };
    const rowsFor = async (creatorId: Id<"creators">) =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) => a.scriptCombo?.campaignId === campaignId && a.creatorId === creatorId,
      );

    // ── Créé = tiré : le thème apparaît pour l'assignation, avec son nombre.
    expect((await admin.query(api.scenarios.themesPourAssignation, {})).find((t) => t.theme === theme)).toEqual({ theme, scenarios: 1 });

    // ── Archivé : plus rien dans le thème, l'assignation avec ce thème est refusée.
    await admin.mutation(api.scenarios.changerStatutScenario, { id: scenarioId, statut: "archive" });
    expect((await admin.query(api.scenarios.themesPourAssignation, {})).map((t) => t.theme)).not.toContain(theme);
    await expect(assign(juliette.creatorId, `@e2escen${ts}`, 1, theme)).rejects.toThrow(/ERR_NO_ACTIVE_CONVERSATION/);
    expect(await rowsFor(juliette.creatorId)).toHaveLength(0);

    // ── Remis en service : deux vidéos, le scénario du thème sur chacune (thème
    // tapé avec une autre casse et des espaces : ça ne compte pas).
    await admin.mutation(api.scenarios.changerStatutScenario, { id: scenarioId, statut: "actif" });
    expect((await assign(juliette.creatorId, `@e2escen${ts}`, 2, ` ${theme.toLowerCase()} `)).created).toBe(2);
    const [a, b] = await rowsFor(juliette.creatorId);
    expect([a!.scenarioId, b!.scenarioId]).toEqual([scenarioId, scenarioId]);
    // Donné à des missions : il ne se supprime plus (elles en génèrent leur conv).
    await expect(admin.mutation(api.scenarios.supprimerScenario, { id: scenarioId })).rejects.toThrow(/ERR_SCENARIO_IN_USE/);

    // ── Un 2e scénario du thème part tout seul, en rotation : le moins servi d'abord.
    const second = await admin.mutation(api.scenarios.creerScenario, {
      bible: bibleSous(`N${ts.toString(36).toUpperCase()}`.slice(0, 12)),
      theme,
    });
    expect((await assign(ines.creatorId, `@e2escen2${ts}`, 2, theme)).created).toBe(2);
    expect(new Set((await rowsFor(ines.creatorId)).map((r) => r.scenarioId))).toEqual(new Set([second, scenarioId]));

    // ── Fiche : l'histoire et sa fiche, rien du scénario lui-même ; pas encore de tournage.
    const fiche = await juliette.client.query(api.assignments.getMyAssignment, {
      projectId: juliette.projectId,
      id: a!._id,
    });
    expect(fiche!.scriptConversation).toEqual({
      genere: true,
      fiche: {
        duree: "14 mois",
        lui: "Yanis",
        relation: "ton copain",
        resume: "Yanis a liké la photo de son ex, et c'est toi qui t'excuses.",
      },
      tournage: null,
    });
    expect(JSON.stringify(fiche)).not.toContain(scenarioId);

    // ── La conv : rien à récupérer tant que son lien de tournage n'est pas
    // collé (le mode tournage est couvert par e2e/scenarios-tournage.spec.ts).
    const recuperer = (id: Id<"assignments">) =>
      juliette.client.action(api.scenarioMission.conversationMission, {
        projectId: juliette.projectId,
        assignmentId: id,
      });
    await expect(recuperer(a!._id)).rejects.toThrow(/ERR_TOURNAGE_NOT_READY/);

    // ── Isolation : la mission d'une autre créatrice est introuvable.
    const [missionInes] = await rowsFor(ines.creatorId);
    await expect(recuperer(missionInes!._id)).rejects.toThrow(/ERR_SCENARIO_NOT_FOUND/);

    // ── À la main (panneau de mission) : changer, retirer ; un archivé ne se donne pas.
    await admin.mutation(api.scripts.setAssignmentScenario, { id: b!._id, scenarioId: second });
    expect(await admin.query(api.assignments.getAssignmentScenario, { id: b!._id })).toEqual({ scenarioId: second });
    await admin.mutation(api.scripts.setAssignmentScenario, { id: b!._id, scenarioId: null });
    expect(await admin.query(api.assignments.getAssignmentScenario, { id: b!._id })).toEqual({ scenarioId: null });
    expect(
      await juliette.client.query(api.assignments.getMyAssignment, { projectId: juliette.projectId, id: b!._id }),
    ).toMatchObject({ scriptConversation: null });

    // ── Tout archivé : plus de nouvelle vidéo avec ce thème ; les missions déjà
    // assignées gardent leur conv ; sans thème, l'assignation part sans conv.
    for (const id of [scenarioId, second]) {
      await admin.mutation(api.scenarios.changerStatutScenario, { id, statut: "archive" });
    }
    await expect(
      admin.mutation(api.scripts.setAssignmentScenario, { id: b!._id, scenarioId }),
    ).rejects.toThrow(/ERR_SCENARIO_ARCHIVED/);
    // Un 3e hook libère une combinaison : le refus vient bien des scénarios.
    await add("hook", "Remplaçant", `Il m'a remplacée en 3 jours ${ts}`);
    await expect(assign(juliette.creatorId, `@e2escen${ts}`, 1, theme)).rejects.toThrow(/ERR_NO_ACTIVE_CONVERSATION/);
    expect(
      (await juliette.client.query(api.assignments.getMyAssignment, { projectId: juliette.projectId, id: a!._id }))!
        .scriptConversation,
    ).toMatchObject({ genere: true });
    expect((await assign(juliette.creatorId, `@e2escen${ts}`, 1)).created).toBe(1);
    const sansConv = (await rowsFor(juliette.creatorId)).filter((r) => r._id !== a!._id && r._id !== b!._id);
    expect(sansConv.map((r) => r.scenarioId)).toEqual([undefined]);
  });

  test("fenêtre « Assigner » : choisir le thème donne la conv ; fiche : rien avant le lien de tournage", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const { theme, scenarioId, campaignId } = await campagneAvecScenario(ts);
    const nom = `Kelly Martin [E2E_TEST] ${ts}`;
    const handle = `@e2escenui${ts}`;
    const creator = await createCreatorSession(url, {
      name: nom,
      email: `e2e-creator-scenui-${ts}@repackit.test`,
      password: "scenui-12345",
    });
    await availableTarget({ e2eClient: admin, creatorId: creator.creatorId, platform: "TikTok", handle });

    await page.goto(adminPath(`/scripts/${campaignId}`));
    await expect(page.getByTestId("combo-count")).toContainText("2", { timeout: 15_000 });
    // Plus rien à régler sur la campagne : ni onglet, ni interrupteur, ni thèmes.
    await expect(page.getByTestId("conversation-toggle")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /^Scénario/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Assigner cette campagne" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Créateur" }).click();
    await page.getByRole("option", { name: nom }).click();
    await dialog.getByRole("combobox", { name: "Compte TikTok" }).click();
    await page.getByRole("option", { name: handle }).click();
    await dialog.locator("#videos").fill("1");
    // La vidéo sur un jour du calendrier (dans 3 jours ; mois suivant au besoin).
    const slot = dialog.getByRole("button", { name: "Vidéo 1 à placer" });
    if ((await slot.getAttribute("aria-pressed")) !== "true") await slot.click();
    const jour = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
      new Date(ts + 3 * DAY),
    );
    const cellule = dialog.locator(`[aria-label="${jour}"]`);
    if ((await cellule.count()) === 0) await dialog.getByRole("button", { name: "Mois suivant" }).click();
    await cellule.first().click();
    await dialog.getByRole("combobox", { name: "Pricing" }).click();
    await page.getByRole("option", { name: new RegExp(`PricingScenario ${ts}`) }).click();
    // Le thème : « Aucune » par défaut, puis celui du scénario, avec son nombre.
    const choixTheme = dialog.getByTestId("assign-conversation-theme");
    await expect(choixTheme).toContainText("Aucune");
    await choixTheme.click();
    await expect(page.getByRole("option", { name: new RegExp(`^${theme}`) })).toContainText("1 scénario");
    await page.getByRole("option", { name: new RegExp(`^${theme}`) }).click();
    await expect(choixTheme).toContainText(theme);
    await dialog.getByRole("button", { name: "Assigner", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    // La mission a reçu le scénario du thème choisi.
    const lignes = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter((x) => x.scriptCombo?.campaignId === campaignId);
    await expect.poll(async () => (await lignes()).map((x) => x.scenarioId)).toEqual([scenarioId]);
    const row = (await lignes())[0]!;

    // Le choix est retenu pour la prochaine fois, dans ce navigateur.
    await page.getByRole("button", { name: "Assigner cette campagne" }).click();
    await expect(page.getByRole("dialog").getByTestId("assign-conversation-theme")).toContainText(theme);
    await page.keyboard.press("Escape");

    // Fiche de la créatrice (vue observée) : sans lien de tournage, rien à
    // télécharger ni à ouvrir — importer sans lui serait une lecture payée.
    await page.goto(`/admin/voir/${E2E_PROJECT_SLUG}/${creator.creatorId}/assignments/${row._id}`);
    const carte = page.getByTestId("mission-scenario");
    await expect(carte).toBeVisible({ timeout: 20_000 });
    await expect(carte).toContainText("1. Récupère la conv");
    await expect(carte.getByTestId("mission-scenario-attente")).toContainText("Ta conv et ton lien de tournage arrivent");
    await expect(carte.getByTestId("mission-scenario-preparer")).toHaveCount(0);
    await expect(carte.getByTestId("mission-scenario-tournage")).toHaveCount(0);
  });
});

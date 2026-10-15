import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { pilote } from "./helpers/faux-blush";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const port = Number(process.env.BLUSH_TOURNAGE_FAUX_PORT);
const admin = createE2eClient(url);
const DAY = 86_400_000;
const BIBLE_C2 = readFileSync(path.resolve(__dirname, "../docs/scenarios/bibles/bible_C2.json"), "utf8");

/**
 * API TOURNAGE DE BLUSH — « Préparer » envoie le fichier figé à BLUSH (la FAUSSE
 * API en e2e, cf e2e/helpers/faux-blush) et pose le lien quand BLUSH dit
 * « prêt » ; un échec s'affiche avec « Réessayer » (nouvelle ref, nouvelle
 * lecture) ; supprimer l'histoire arrête son lien.
 */
test.describe("Scénarios — liens de tournage par l'API BLUSH", () => {
  test.skip(!port, "fausse API BLUSH absente (eval \"$(./scripts/convex-local.sh env)\")");

  test("préparer = fichier + lien automatique ; échec puis réessayer ; suppression = lien arrêté", async ({ page }) => {
    test.setTimeout(240_000);
    const blush = pilote(port);
    const ts = Date.now();
    const code = `P${ts.toString(36).toUpperCase()}`.slice(0, 12);
    const code2 = `Q${code.slice(1)}`;
    const theme = `Tournage API ${ts}`;
    const scenarioId = await admin.mutation(api.scenarios.creerScenario, { bible: BIBLE_C2.replace('"id": "C2"', `"id": "${code}"`), theme });
    // Une 2e histoire, d'un autre thème, jamais donnée à une mission (supprimable).
    const scenario2 = await admin.mutation(api.scenarios.creerScenario, {
      bible: BIBLE_C2.replace('"id": "C2"', `"id": "${code2}"`),
      theme: `${theme} bis`,
    });
    const campaignId = await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] Tournage API ${ts}` });
    for (const [kind, content] of [
      ["hook", `On s'est disputés ${ts}`],
      ["flux", `Montre la conv ${ts}`],
      ["cta", `je vois ça que maintenant ${ts}`],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label: kind, content });
    }
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Barème tournage API ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const nom = `Kelly Martin [E2E_TEST] ${ts}`;
    const kelly = await createCreatorSession(url, { name: nom, email: `e2e-tournage-api-${ts}@repackit.test`, password: "tournapi-12345" });
    const target = await availableTarget({ e2eClient: admin, creatorId: kelly.creatorId, platform: "TikTok", handle: `@e2etournapi${ts}` });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: kelly.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      conversationTheme: theme,
    });
    const mission = (await admin.query(api.assignments.listAssignments, {})).find((a) => a.creatorId === kelly.creatorId)!;
    const tournageMission = async () =>
      (await kelly.client.query(api.assignments.getMyAssignment, { projectId: kelly.projectId, id: mission._id as Id<"assignments"> }))!
        .scriptConversation!.tournage;
    const paire = async (sid: string) =>
      (await admin.query(api.scenarioTournage.tournagesDuProjet, {})).createatrices
        .find((c) => c._id === kelly.creatorId)!
        .tournages.find((t) => t.scenarioId === sid)!;
    const demandeDe = async (c: string) => (await blush.demandes()).filter((d) => d.nom.startsWith(`Kelly · ${c} ·`));

    expect((await admin.query(api.scenarioTournage.tournagesDuProjet, {})).apiBlush).toBe(true);

    // ── Préparer : le fichier figé part chez BLUSH, tel quel, au prénom de Kelly.
    const projectId = await admin.getProjectId();
    await admin.action(api.scenarioTournage.preparerTournages, { projectId, creatorId: kelly.creatorId, scenarioIds: [scenarioId] });
    await expect.poll(async () => (await demandeDe(code)).length, { timeout: 20_000 }).toBe(1);
    const [d] = await demandeDe(code);
    const fige = await (await fetch((await paire(scenarioId)).url!)).text();
    expect(d).toMatchObject({ nom: `Kelly · ${code} · Le like de l'ex`, moi: "Kelly", fichier: fige, statut: "en_lecture" });
    expect(d!.ref).toMatch(/^jarvia-.+-v1$/);
    await expect.poll(async () => (await paire(scenarioId)).blush?.statut, { timeout: 20_000 }).toBe("en_lecture");
    // En lecture : rien pour elle.
    expect((await paire(scenarioId)).lien).toBeNull();
    expect(await tournageMission()).toBeNull();

    // ── BLUSH dit « prêt » : le lien se pose tout seul, la mission le reçoit.
    await blush.pret(d!.ref);
    const lien = `https://askblush.test/tournage/${d!.ref}`;
    await expect.poll(async () => (await paire(scenarioId)).lien, { timeout: 45_000 }).toBe(lien);
    expect(await tournageMission()).toEqual({ lien, prenom: "Kelly" });
    // Redemander : rien ne repart (le lien est là, pas de 2e lecture).
    expect(await admin.mutation(api.scenarioTournage.demanderLiensTournage, { creatorId: kelly.creatorId })).toEqual({ demandes: 0 });

    // ── Échec côté BLUSH : la raison s'affiche, « Réessayer » repart avec une NOUVELLE ref.
    await admin.action(api.scenarioTournage.preparerTournages, { projectId, creatorId: kelly.creatorId, scenarioIds: [scenario2] });
    await expect.poll(async () => (await demandeDe(code2)).length, { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => (await paire(scenario2)).blush?.statut, { timeout: 20_000 }).toBe("en_lecture");
    await blush.echec((await demandeDe(code2))[0]!.ref, "conv illisible");
    await expect.poll(async () => (await paire(scenario2)).blush?.statut, { timeout: 45_000 }).toBe("echec");
    await page.goto(adminPath("/scenarios/tournage"));
    const carte = page.getByTestId("tournage-createatrice").filter({ hasText: nom });
    const entete = carte.getByRole("button", { name: new RegExp(`Kelly Martin \\[E2E_TEST\\] ${ts}`) });
    await expect(entete).toBeVisible({ timeout: 20_000 });
    if ((await entete.getAttribute("aria-expanded")) !== "true") await entete.click();
    const ligne = carte.getByTestId("tournage-ligne").filter({ hasText: code2 });
    await expect(ligne.getByTestId("tournage-echec")).toContainText("La lecture BLUSH a échoué : conv illisible");
    await ligne.getByRole("button", { name: "Réessayer" }).click();
    await expect(ligne.getByTestId("tournage-en-creation")).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await demandeDe(code2)).map((x) => x.ref.slice(-3)), { timeout: 20_000 }).toEqual(["-v1", "-v2"]);

    await expect.poll(async () => (await paire(scenario2)).blush?.statut, { timeout: 20_000 }).toBe("en_lecture");

    // ── Supprimer l'histoire arrête son lien dans BLUSH.
    await admin.mutation(api.scenarios.supprimerScenario, { id: scenario2 });
    await expect.poll(async () => (await demandeDe(code2)).filter((x) => x.arrete).length, { timeout: 20_000 }).toBe(1);
  });
});

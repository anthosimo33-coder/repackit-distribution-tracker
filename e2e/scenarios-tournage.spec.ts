import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { parisDayKey } from "../convex/viewsDaily";
import { veille } from "../convex/scenarioTournageRegles";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);
const DAY = 86_400_000;
const BIBLE_C2 = readFileSync(path.resolve(__dirname, "../docs/scenarios/bibles/bible_C2.json"), "utf8");

/** « [JJ/MM/AAAA » de la VEILLE (Paris) : le fichier figé finit la veille de sa préparation. */
function crochetDeLaVeille(): string {
  const [a, m, j] = veille(parisDayKey(Date.now())).split("-");
  return `[${j}/${m}/${a}`;
}

/**
 * MODE TOURNAGE BLUSH — BLUSH rejoue le rapport d'un import fait par l'équipe :
 * la créatrice doit importer EXACTEMENT ce fichier. Pour chaque créatrice et
 * chaque histoire : un fichier figé à son prénom (préparé une fois, jamais
 * régénéré), puis le lien de tournage collé ; sa mission sert ce fichier et ce
 * lien, et rien tant que le lien manque.
 */
test.describe("Scénarios — mode tournage", () => {
  test("préparer, coller le lien, la mission sert le fichier figé ; rien sans lien ; une paire par créatrice", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const code = `T${ts.toString(36).toUpperCase()}`.slice(0, 12);
    const theme = `Tournage ${ts}`;
    const scenarioId = await admin.mutation(api.scenarios.creerScenario, {
      bible: BIBLE_C2.replace('"id": "C2"', `"id": "${code}"`),
      theme,
    });
    const campaignId = await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] Tournage ${ts}` });
    for (const [kind, content] of [
      ["hook", `On s'est disputés hier soir ${ts}`],
      ["hook", `Il m'a dit que je faisais un drame ${ts}`],
      ["flux", `Montre la conv, puis importe-la ${ts}`],
      ["cta", `je vois ça que maintenant 😭 ${ts}`],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label: kind, content });
    }
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Barème tournage ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const nom = `Juliette Chetrit [E2E_TEST] ${ts}`;
    const juliette = await createCreatorSession(url, {
      name: nom,
      email: `e2e-tournage-${ts}@repackit.test`,
      password: "tournage-12345",
    });
    const ines = await createCreatorSession(url, {
      name: `Inès Garnier [E2E_TEST] ${ts}`,
      email: `e2e-tournage2-${ts}@repackit.test`,
      password: "tournage2-12345",
    });
    const assigner = async (creatorId: Id<"creators">, handle: string, n: number) => {
      const target = await availableTarget({ e2eClient: admin, creatorId, platform: "TikTok", handle });
      return admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId,
        targets: [target],
        videosPerCreator: n,
        dueDate: ts + 7 * DAY,
        pricingId,
        conversationTheme: theme,
      });
    };
    expect((await assigner(juliette.creatorId, `@e2etourn${ts}`, 2)).created).toBe(2);
    expect((await assigner(ines.creatorId, `@e2etourn2${ts}`, 1)).created).toBe(1);
    const missions = async (creatorId: Id<"creators">) =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) => a.scriptCombo?.campaignId === campaignId && a.creatorId === creatorId,
      );
    const [a, b] = await missions(juliette.creatorId);
    const [c] = await missions(ines.creatorId);
    const vue = async (s: typeof juliette, id: Id<"assignments">) =>
      (await s.client.query(api.assignments.getMyAssignment, { projectId: s.projectId, id }))!.scriptConversation;
    const recuperer = (s: typeof juliette, id: Id<"assignments">) =>
      s.client.action(api.scenarioMission.conversationMission, { projectId: s.projectId, assignmentId: id });

    // ── Rien de préparé : pas de lien, rien à récupérer.
    expect((await vue(juliette, a!._id))!.tournage).toBeNull();
    await expect(recuperer(juliette, a!._id)).rejects.toThrow(/ERR_TOURNAGE_NOT_READY/);

    // ── Écran « Mode tournage » (depuis Scénarios) : préparer CE fichier pour Juliette.
    await page.goto(adminPath("/scenarios"));
    await page.getByTestId("scenarios-tournage").click();
    await expect(page.getByRole("heading", { name: "Mode tournage" })).toBeVisible({ timeout: 20_000 });
    const carte = page.getByTestId("tournage-createatrice").filter({ hasText: nom });
    const entete = carte.getByRole("button", { name: new RegExp(`Juliette Chetrit \\[E2E_TEST\\] ${ts}`) });
    if ((await entete.getAttribute("aria-expanded")) !== "true") await entete.click();
    const ligne = carte.getByTestId("tournage-ligne").filter({ hasText: code });
    await ligne.getByRole("button", { name: `Préparer le fichier ${code} pour Juliette` }).click();
    await expect(ligne.getByRole("button", { name: "Fichier" })).toBeVisible({ timeout: 60_000 });

    // Le fichier pour l'équipe : à SON prénom, qui finit LA VEILLE.
    const dl = page.waitForEvent("download");
    await ligne.getByRole("button", { name: "Fichier" }).click();
    const fichier = await dl;
    expect(fichier.suggestedFilename()).toBe(`Juliette · ${code} · Le like de l'ex.txt`);
    const fige = readFileSync((await fichier.path())!, "utf8");
    expect(fige.trimEnd().split("\n").at(-1)).toBe(`${crochetDeLaVeille()} 22:33:05] Juliette: t'as raison pardon`);
    // Deux locuteurs : elle et lui (les potes cités dans les messages ne parlent pas).
    expect(new Set([...fige.matchAll(/^\[[^\]]+\] ([^:]+):/gm)].map((m) => m[1]))).toEqual(new Set(["Yanis", "Juliette"]));

    // Préparé mais sans lien : toujours rien pour elle.
    expect((await vue(juliette, a!._id))!.tournage).toBeNull();
    await expect(recuperer(juliette, a!._id)).rejects.toThrow(/ERR_TOURNAGE_NOT_READY/);

    // ── Le lien : un faux est refusé, le vrai est gardé.
    const champ = ligne.getByRole("textbox", { name: `Lien de tournage ${code} pour Juliette` });
    await champ.fill("askblush.com/tournage/pas-un-lien");
    await ligne.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Ce n’est pas un lien https : colle le lien copié dans BLUSH.")).toBeVisible();
    const lien = `https://askblush.com/tournage/e2e-${ts}`;
    await champ.fill(lien);
    await ligne.getByRole("button", { name: "Enregistrer" }).click();
    await expect(ligne.getByLabel("Prêt")).toBeVisible({ timeout: 15_000 });

    // ── Sa mission : CE fichier, octet pour octet, et CE lien — les deux missions de la paire.
    // Le lien de SA mission porte son prénom : un lien BLUSH se partage entre créatrices.
    expect(await vue(juliette, a!._id)).toMatchObject({ tournage: { lien: `${lien}?prenom=Juliette`, prenom: "Juliette" } });
    const convA = await recuperer(juliette, a!._id);
    expect(convA).toEqual({ nomFichier: "WhatsApp Chat - Juliette, Yanis.txt", texte: fige });
    expect((await recuperer(juliette, b!._id)).texte).toBe(fige);

    // ── Une paire par créatrice : Inès, même histoire, n'a rien tant que la sienne n'est pas prête.
    expect((await vue(ines, c!._id))!.tournage).toBeNull();
    await expect(recuperer(ines, c!._id)).rejects.toThrow(/ERR_TOURNAGE_NOT_READY/);

    // ── FIGÉ : repréparer ne refait rien, corriger la bible ne change pas le fichier.
    expect(
      await admin.action(api.scenarioTournage.preparerTournages, { projectId: await admin.getProjectId(), creatorId: juliette.creatorId, scenarioIds: [scenarioId] }),
    ).toEqual({ prepares: 0 });
    await admin.mutation(api.scenarios.modifierScenario, {
      id: scenarioId,
      bible: BIBLE_C2.replace('"id": "C2"', `"id": "${code}"`).replace('"lui": "Yanis"', '"lui": "Yanis-Bis"'),
    });
    expect((await recuperer(juliette, a!._id)).texte).toBe(fige);

    // ── Fiche de la créatrice (vue observée) : 1. la conv, 2. le mode tournage, 3. filmer.
    await page.goto(`/admin/voir/${E2E_PROJECT_SLUG}/${juliette.creatorId}/assignments/${a!._id}`);
    const fiche = page.getByTestId("mission-scenario");
    await expect(fiche).toBeVisible({ timeout: 20_000 });
    await expect(fiche.getByTestId("mission-scenario-tournage")).toHaveAttribute("href", `${lien}?prenom=Juliette`);
    await expect(fiche).toContainText("à « Qui es-tu ? », choisis Juliette");
    await fiche.getByTestId("mission-scenario-preparer").click();
    await expect(fiche.getByTestId("mission-scenario-txt")).toBeVisible({ timeout: 30_000 });
    const dl2 = page.waitForEvent("download");
    await fiche.getByTestId("mission-scenario-txt").click();
    const recu = await dl2;
    expect(recu.suggestedFilename()).toBe("WhatsApp Chat - Juliette, Yanis.txt");
    expect(readFileSync((await recu.path())!, "utf8")).toBe(fige);

    // ── Retirer le lien : la mission ne propose plus rien.
    const tournage = (await admin.query(api.scenarioTournage.tournagesDuProjet, {})).createatrices
      .find((x) => x._id === juliette.creatorId)!
      .tournages.find((t) => t.scenarioId === scenarioId)!;
    await admin.mutation(api.scenarioTournage.poserLienTournage, { id: tournage._id, lien: "  " });
    expect((await vue(juliette, a!._id))!.tournage).toBeNull();
    await expect(recuperer(juliette, a!._id)).rejects.toThrow(/ERR_TOURNAGE_NOT_READY/);

    // ── Une histoire supprimée emporte ses fichiers figés.
    const autre = await admin.mutation(api.scenarios.creerScenario, {
      bible: BIBLE_C2.replace('"id": "C2"', `"id": "U${code.slice(1)}"`),
      theme: `${theme} bis`,
    });
    expect(
      await admin.action(api.scenarioTournage.preparerTournages, { projectId: await admin.getProjectId(), creatorId: juliette.creatorId, scenarioIds: [autre] }),
    ).toEqual({ prepares: 1 });
    const tournagesDe = async () =>
      (await admin.query(api.scenarioTournage.tournagesDuProjet, {})).createatrices
        .find((x) => x._id === juliette.creatorId)!
        .tournages.map((t) => t.scenarioId);
    expect(await tournagesDe()).toContain(autre);
    await admin.mutation(api.scenarios.supprimerScenario, { id: autre });
    expect(await tournagesDe()).not.toContain(autre);
  });
});

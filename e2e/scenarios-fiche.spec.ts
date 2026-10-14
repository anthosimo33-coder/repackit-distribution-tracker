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

/** Un scénario C2 (14 mois avec Yanis, « mon copain ») dans un thème propre au test. */
async function scenarioC2(ts: number) {
  const code = `F${ts.toString(36).toUpperCase()}`.slice(0, 12);
  const theme = `Fiche ${ts}`;
  const id = await admin.mutation(api.scenarios.creerScenario, {
    bible: BIBLE_C2.replace('"id": "C2"', `"id": "${code}"`),
    theme,
  });
  return { id, theme };
}

async function campagne(ts: number, nom: string, briques: [("hook" | "flux" | "cta"), string][]) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${nom} ${ts}` });
  for (const [kind, content] of briques) {
    await admin.mutation(api.scripts.createBrick, { campaignId, kind, label: kind, content });
  }
  return campaignId;
}

async function bareme(ts: number) {
  return (
    await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Barème fiche ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    })
  ).pricingId;
}

/**
 * FICHE ET VARIABLES — à l'assignation, le scénario est tiré D'ABORD, puis le
 * script parmi les briques que sa fiche remplit, puis le texte est rempli : le
 * script ne contredit plus la conv (« 3 ANS QU'IL ME DIT QUE J'EXAGÈRE » sur une
 * conv de 14 mois). Sans fiche, une brique à variables n'est pas tirable.
 */
test.describe("Scénarios — fiche et variables des briques", () => {
  test("le texte de la mission est rempli avec la fiche de SA conv ; sans conv, les briques à variables ne partent pas", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const { id: scenarioId, theme } = await scenarioC2(ts);
    const pricingId = await bareme(ts);
    const juliette = await createCreatorSession(url, {
      name: `Juliette Chetrit [E2E_TEST] ${ts}`,
      email: `e2e-fiche-${ts}@repackit.test`,
      password: "fiche-12345",
    });
    const ines = await createCreatorSession(url, {
      name: `Inès Garnier [E2E_TEST] ${ts}`,
      email: `e2e-fiche2-${ts}@repackit.test`,
      password: "fiche2-12345",
    });
    const assigner = async (
      campaignId: Id<"scriptCampaigns">,
      creatorId: Id<"creators">,
      handle: string,
      n: number,
      conversationTheme?: string,
    ) => {
      const target = await availableTarget({ e2eClient: admin, creatorId, platform: "TikTok", handle });
      return admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId,
        targets: [target],
        videosPerCreator: n,
        dueDate: ts + 7 * DAY,
        pricingId,
        ...(conversationTheme ? { conversationTheme } : {}),
      });
    };
    const textes = async (campaignId: Id<"scriptCampaigns">, creatorId: Id<"creators">) => {
      const rows = (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) => a.scriptCombo?.campaignId === campaignId && a.creatorId === creatorId,
      );
      return Promise.all(rows.map(async (r) => (await admin.query(api.assignments.getAssignmentScript, { id: r._id }))!.assembledScript));
    };

    // ── Campagne MIXTE : un hook cite la conv, l'autre non.
    const mixte = await campagne(ts, "Fiche mixte", [
      ["hook", `{DUREE} QU'IL ME DIT QUE J'EXAGÈRE ${ts}`],
      ["hook", `On s'est disputés hier soir ${ts}`],
      ["flux", `Montre la conv, puis importe-la ${ts}`],
      ["cta", `je vois ça que maintenant 😭 ${ts}`],
    ]);
    // Sans conversation : seul le hook sans variable part (1 vidéo sur 2).
    const sans = await assigner(mixte, juliette.creatorId, `@e2efiche${ts}`, 2);
    expect(sans.created).toBe(1);
    const [texteSans] = await textes(mixte, juliette.creatorId);
    expect(texteSans).toContain("On s'est disputés hier soir");
    expect(texteSans).not.toContain("{");
    // Avec la conv : les deux hooks partent, celui à variables REMPLI.
    expect((await assigner(mixte, ines.creatorId, `@e2efiche2${ts}`, 2, theme)).created).toBe(2);
    const textesInes = await textes(mixte, ines.creatorId);
    expect(textesInes.some((t) => t.startsWith(`14 MOIS QU'IL ME DIT QUE J'EXAGÈRE ${ts}`))).toBe(true);
    expect(textesInes.join("\n")).not.toContain("{DUREE}");

    // ── Campagne qui cite la conv partout.
    const pleine = await campagne(ts, "Fiche pleine", [
      ["hook", `{DUREE} AVEC {lui} ET JE DÉCOUVRE ÇA ${ts}`],
      ["flux", `Montre la conv comme si de rien n'était (« {cest_normal} »), puis demande à BLUSH : « {question_chat} » ${ts}`],
      ["cta", `{duree} avec {relation} et je vois ça que maintenant 😭 ${ts}`],
    ]);
    // L'aperçu de la fenêtre « Assigner » suit le même ordre.
    const apercu = await admin.query(api.scripts.previewCombosForAssignment, {
      campaignId: pleine,
      creatorId: juliette.creatorId,
      targets: [await availableTarget({ e2eClient: admin, creatorId: juliette.creatorId, platform: "TikTok", handle: `@e2efiche${ts}` })],
      videosPerCreator: 1,
      conversationTheme: theme,
    });
    expect(apercu.combos[0]!.assembledScript).toContain(`14 MOIS AVEC Yanis ET JE DÉCOUVRE ÇA ${ts}`);
    // Sans conversation : refus en clair, rien de créé.
    await expect(assigner(pleine, juliette.creatorId, `@e2efiche${ts}`, 1)).rejects.toThrow(/ERR_SCRIPT_NEEDS_CONVERSATION/);
    expect(await textes(pleine, juliette.creatorId)).toEqual([]);
    // Avec la conv : tout est rempli, et la fiche suit côté créatrice.
    expect((await assigner(pleine, juliette.creatorId, `@e2efiche${ts}`, 1, theme)).created).toBe(1);
    const [rempli] = await textes(pleine, juliette.creatorId);
    expect(rempli).toBe(
      [
        `14 MOIS AVEC Yanis ET JE DÉCOUVRE ÇA ${ts}`,
        `Montre la conv comme si de rien n'était (« c'est juste un like »), puis demande à BLUSH : « est-ce que j'ai eu tort de m'excuser ? » ${ts}`,
        `14 mois avec mon copain et je vois ça que maintenant 😭 ${ts}`,
      ].join("\n\n"),
    );
    const mission = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.scriptCombo?.campaignId === pleine && a.creatorId === juliette.creatorId,
    )!;
    expect(mission.scenarioId).toBe(scenarioId);
    const vue = await juliette.client.query(api.assignments.getMyAssignment, { projectId: juliette.projectId, id: mission._id });
    expect(vue!.assembledScript).toBe(rempli);
    expect(vue!.scriptConversation).toEqual({
      genere: true,
      fiche: { duree: "14 mois", lui: "Yanis", relation: "ton copain", resume: "Yanis a liké la photo de son ex, et c'est toi qui t'excuses." },
    });
    // Retirer la conv d'une mission dont le script la cite : refusé.
    await expect(admin.mutation(api.scripts.setAssignmentScenario, { id: mission._id, scenarioId: null })).rejects.toThrow(
      /ERR_SCRIPT_NEEDS_CONVERSATION/,
    );
  });

  test("écran campagne : durée en dur signalée ; fiche créatrice au-dessus de sa conv", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const { theme } = await scenarioC2(ts);
    const pricingId = await bareme(ts);
    const campaignId = await campagne(ts, "Fiche écran", [
      ["hook", `8 ANS D'AMITIÉ ET JE DÉCOUVRE ÇA ${ts}`],
      ["hook", `{DUREE} QU'IL ME DIT QUE J'EXAGÈRE ${ts}`],
      ["flux", `Montre la conv, puis importe-la ${ts}`],
      ["cta", `je vois ça que maintenant 😭 ${ts}`],
    ]);
    await page.goto(adminPath(`/scripts/${campaignId}`));
    await expect(page.getByTestId("campagne-en-dur")).toContainText("1 brique écrit une durée ou une relation en dur", { timeout: 15_000 });
    const enDur = page.getByTestId("brick-row").filter({ hasText: `8 ANS D'AMITIÉ ET JE DÉCOUVRE ÇA ${ts}` });
    await expect(enDur.getByTestId("brick-en-dur-tag")).toHaveText("« 8 ANS » en dur");
    const avecVariable = page.getByTestId("brick-row").filter({ hasText: `{DUREE} QU'IL ME DIT` });
    await expect(avecVariable.getByTestId("brick-variables-tag")).toHaveText("conv : {DUREE}");
    await expect(avecVariable.getByTestId("brick-en-dur-tag")).toHaveCount(0);

    // La créatrice lit sa fiche au-dessus de sa conv.
    const kelly = await createCreatorSession(url, {
      name: `Kelly Martin [E2E_TEST] ${ts}`,
      email: `e2e-fiche-ui-${ts}@repackit.test`,
      password: "ficheui-12345",
    });
    const target = await availableTarget({ e2eClient: admin, creatorId: kelly.creatorId, platform: "TikTok", handle: `@e2eficheui${ts}` });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: kelly.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      conversationTheme: theme,
    });
    const row = (await admin.query(api.assignments.listAssignments, {})).find((x) => x.scriptCombo?.campaignId === campaignId)!;
    await page.goto(`/admin/voir/${E2E_PROJECT_SLUG}/${kelly.creatorId}/assignments/${row._id}`);
    const fiche = page.getByTestId("mission-scenario-fiche");
    await expect(fiche).toContainText("Ta conv : 14 mois avec Yanis, ton copain", { timeout: 20_000 });
    await expect(fiche).toContainText("Yanis a liké la photo de son ex, et c'est toi qui t'excuses.");
  });
});

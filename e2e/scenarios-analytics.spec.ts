import path from "node:path";
import { readFileSync } from "node:fs";
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
const BIBLE_C2 = readFileSync(path.resolve(__dirname, "../docs/scenarios/bibles/bible_C2.json"), "utf8");

/**
 * Analytics PAR SCÉNARIO (étape 3) — un scénario qui tourne dans deux campagnes
 * est mesuré TOUTES CAMPAGNES CONFONDUES (posts, médiane à J+7, verdict), avec
 * le détail par campagne. Le moteur de verdict est celui des briques.
 */
test.describe("Scénarios — analytics", () => {
  test("un scénario cumule ses campagnes ; la liste et la fiche le montrent", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const base = ts.toString(36).toUpperCase();
    const s1Code = `P${base}`.slice(0, 12);
    const s2Code = `Q${base}`.slice(0, 12);
    // Un thème par scénario, propres à ce test (la base e2e en garde d'autres).
    const dispute = `Dispute ${ts}`;
    const jalousie = `Jalousie ${ts}`;
    const s1 = await admin.mutation(api.scenarios.creerScenario, {
      bible: BIBLE_C2.replace('"id": "C2"', `"id": "${s1Code}"`),
      theme: dispute,
    });
    const s2 = await admin.mutation(api.scenarios.creerScenario, {
      bible: BIBLE_C2.replace('"id": "C2"', `"id": "${s2Code}"`),
      theme: jalousie,
    });
    for (const id of [s1, s2]) await admin.mutation(api.scenarios.changerStatutScenario, { id, statut: "actif" });

    const creator = await createCreatorSession(url, {
      name: `Charlyse [E2E_TEST] ${ts}`,
      email: `e2e-creator-scenan-${ts}@repackit.test`,
      password: "scenan-12345",
    });
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingScenAn ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2escenan${ts}`,
    });

    // Deux campagnes : X coche les deux thèmes (S1 et S2), Y seulement celui de S1.
    async function campagne(nom: string, themes: string[], videos: number) {
      const campaignId = await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${nom} ${ts}` });
      const add = (kind: "hook" | "flux" | "cta", content: string) =>
        admin.mutation(api.scripts.createBrick, { campaignId, kind, label: kind, content: `${content} ${nom} ${ts}` });
      await add("hook", "4 ans de situationship et je découvre ÇA");
      await add("hook", "Ce site va RUINER tellement de couples");
      await add("flux", "Montre la conv, puis importe-la");
      await add("cta", "Le site est en bio 💬");
      await admin.mutation(api.scripts.updateCampaign, {
        id: campaignId,
        conversationEnabled: true,
        conversationThemes: themes,
      });
      await admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: creator.creatorId,
        targets: [target],
        videosPerCreator: videos,
        dueDate: ts + 7 * DAY,
        pricingId,
      });
      const rows = (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) => a.scriptCombo?.campaignId === campaignId,
      );
      return { campaignId, rows };
    }
    const x = await campagne("X", [dispute, jalousie], 2);
    const y = await campagne("Y", [dispute], 1);

    // Publication + relevé à J+7, des vues de forme réelle.
    const vues: Record<string, number[]> = { [s1]: [], [s2]: [] };
    const valeurs = [48_211, 2_904, 131_877];
    let k = 0;
    for (const { rows } of [x, y]) {
      for (const r of rows) {
        const v = valeurs[k++]!;
        const res = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
          id: r._id,
          urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@e2escenan${ts}/video/${ts}${k}` }],
        });
        await admin.mutation(api.metricSnapshots.createSnapshot, {
          publicationId: res.publicationIds[0],
          capturedAt: Date.now() + 7 * DAY,
          vues: v,
          likes: 0,
        });
        vues[r.scenarioId as Id<"scenarios">]!.push(v);
      }
    }
    expect(vues[s1]).toHaveLength(2);
    expect(vues[s2]).toHaveLength(1);
    const med = (xs: number[]) => (xs.length === 2 ? (xs[0]! + xs[1]!) / 2 : xs[0]!);

    // ── Serveur : S1 cumule X et Y ; S2 n'a que X ; < 50 posts = en test.
    const perf = await admin.query(api.scenarioAnalytics.perfParScenario, {});
    const p1 = perf.scenarios.find((s) => s.scenarioId === s1)!;
    const p2 = perf.scenarios.find((s) => s.scenarioId === s2)!;
    expect(p1).toMatchObject({ posts: 2, vuesMediane: med(vues[s1]!), verdict: "en_test" });
    expect(p1.campagnes.map((c) => c.campaignId).sort()).toEqual([x.campaignId, y.campaignId].sort());
    expect(p1.campagnes.find((c) => c.campaignId === y.campaignId)).toMatchObject({
      nom: `[E2E_TEST] Y ${ts}`,
      posts: 1,
    });
    expect(p2).toMatchObject({ posts: 1, vuesMediane: vues[s2]![0], verdict: "en_test" });
    expect(perf.fenetre).toBe("j7");

    // ── Écran : la liste montre posts et médiane ; la fiche, le détail par campagne.
    await page.goto(adminPath("/scenarios"));
    const ligne = page.getByTestId("scenario-row").filter({ hasText: s1Code });
    await expect(ligne.getByTestId("scenario-perf")).toContainText("2 posts", { timeout: 20_000 });
    await expect(ligne.getByTestId("scenario-verdict")).toHaveText("en test");
    await ligne.click();
    const carte = page.getByTestId("scenario-performance");
    await expect(carte).toContainText("2 posts", { timeout: 20_000 });
    await expect(carte.getByTestId("scenario-perf-campagne")).toHaveCount(2);
    await expect(carte).toContainText(`[E2E_TEST] Y ${ts}`);
  });
});

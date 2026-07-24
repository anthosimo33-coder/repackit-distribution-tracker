import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/** Crée une campagne de test avec 3 hooks (S/A/B) + 2 flux + 2 cta
 *  → 3×2×2 = 12 combos (refonte 3 briques). Retourne campaignId. */
async function makeCampaign(ts: number) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Assign ${ts}`,
  });
  const add = (
    kind: "hook" | "flux" | "cta",
    label: string,
    content: string,
    tier?: "S" | "A" | "B",
  ) =>
    admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind,
      label,
      content,
      ...(tier ? { tier } : {}),
    });
  await add("hook", "H-S", "Hook S contenu", "S");
  await add("hook", "H-A", "Hook A contenu", "A");
  await add("hook", "H-B", "Hook B contenu", "B");
  await add("flux", "F1", "Flux 1");
  await add("flux", "F2", "Flux 2");
  await add("cta", "T1", "Cta 1");
  await add("cta", "T2", "Cta 2");
  return campaignId;
}

test.describe("S2 — assignation anti-coordination", () => {
  test("anti-coord par créateur, combo figé, réassignation, épuisement, isolation, admin", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const a = await createCreatorSession(url, {
      name: `[E2E_TEST] AssignA ${ts}`,
      email: `e2e-creator-assign-a-${ts}@repackit.test`,
      password: "assign-a-12345",
    });
    const b = await createCreatorSession(url, {
      name: `[E2E_TEST] AssignB ${ts}`,
      email: `e2e-creator-assign-b-${ts}@repackit.test`,
      password: "assign-b-12345",
    });
    const projectId = a.projectId;
    const campaignId = await makeCampaign(ts);

    // Pricing OBLIGATOIRE : barème de paie figé à l'attribution.
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Pricing ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });

    // Cibles TikTok disponibles (1 par créateur).
    const tA = await availableTarget({
      e2eClient: admin,
      creatorId: a.creatorId,
      platform: "TikTok",
      handle: `@e2escA${ts}`,
    });
    const tB = await availableTarget({
      e2eClient: admin,
      creatorId: b.creatorId,
      platform: "TikTok",
      handle: `@e2escB${ts}`,
    });
    // PRICING OBLIGATOIRE : sans pricing → rejet serveur clair.
    await expect(
      admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: a.creatorId,
        targets: [tA],
        videosPerCreator: 1,
        dueDate: ts + 7 * DAY,
      }),
    ).rejects.toThrow(/barème de paie est requis/);

    // Chantier C — 1 créateur/action : 5 vidéos à A + 5 à B → 10 assignments.
    const r1a = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: a.creatorId,
      targets: [tA],
      videosPerCreator: 5,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    const r1b = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: b.creatorId,
      targets: [tB],
      videosPerCreator: 5,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r1a.created + r1b.created).toBe(10);
    expect(r1a.totalCombos).toBe(12);
    expect(r1a.shortages.length).toBe(0);
    expect(r1b.shortages.length).toBe(0);

    const forCampaign = async (creatorId: string) =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (x) => x.scriptCombo?.campaignId === campaignId && x.creatorId === creatorId,
      );

    let aRows = await forCampaign(a.creatorId);
    const bRows = await forCampaign(b.creatorId);
    expect(aRows.length).toBe(5);
    expect(bRows.length).toBe(5);
    // Combos DISTINCTS par créateur (anti-coordination par-créateur).
    expect(new Set(aRows.map((x) => x.comboKey)).size).toBe(5);
    expect(new Set(bRows.map((x) => x.comboKey)).size).toBe(5);
    // assembledScript figé (hook+flux+cta, sans démo) + pricingSnapshot figé.
    for (const x of aRows) {
      expect(x.scriptCombo?.assembledScript).toMatch(/Flux [12]/);
      expect(x.scriptCombo?.assembledScript).not.toContain("## ");
      // Pricing = source de paie ; rateSnapshot = placeholder neutre (jamais lu).
      expect(x.pricingSnapshot?.pricingId).toBe(pricingId);
      expect(x.rateSnapshot.basePerPost).toBe(0);
      expect(x.status).toBe("todo");
      expect(x.formatId ?? null).toBeNull();
    }

    // Réassignation au même créateur (A) : nouveaux combos, aucun chevauchement.
    const aKeysBefore = new Set(aRows.map((x) => x.comboKey));
    const r2 = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: a.creatorId,
      targets: [tA],
      videosPerCreator: 5,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r2.created).toBe(5);
    aRows = await forCampaign(a.creatorId);
    expect(aRows.length).toBe(10);
    expect(new Set(aRows.map((x) => x.comboKey)).size).toBe(10); // tous distincts
    // Les 5 nouveaux n'étaient pas dans les 5 premiers.
    const aNew = aRows.filter((x) => !aKeysBefore.has(x.comboKey));
    expect(aNew.length).toBe(5);

    // Épuisement : A a 10/12 ; demander 20 → 2 assignés + shortage.
    const r3 = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: a.creatorId,
      targets: [tA],
      videosPerCreator: 20,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r3.created).toBe(2);
    expect(r3.shortages).toEqual([
      { name: `[E2E_TEST] AssignA ${ts}`, requested: 20, assigned: 2 },
    ]);
    aRows = await forCampaign(a.creatorId);
    expect(aRows.length).toBe(12); // tous les combos épuisés
    expect(new Set(aRows.map((x) => x.comboKey)).size).toBe(12);

    // Au-delà du stock → 0 assigné, shortage.
    const r4 = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: a.creatorId,
      targets: [tA],
      videosPerCreator: 3,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r4.created).toBe(0);
    expect(r4.shortages[0].assigned).toBe(0);

    // ISOLATION créateur : A voit le script monté, JAMAIS la décomposition.
    const aSample = aRows[0]._id;
    const myA = await a.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: aSample,
    });
    expect(myA).toBeTruthy();
    expect(myA!.assembledScript).toBeTruthy();
    // L'objet renvoyé au créateur ne contient PAS scriptCombo/comboKey.
    expect(
      (myA!.assignment as Record<string, unknown>).scriptCombo,
    ).toBeUndefined();
    expect(
      (myA!.assignment as Record<string, unknown>).comboKey,
    ).toBeUndefined();
    // Script naturel : pas d'étiquette de section ni de tier.
    expect(myA!.assembledScript).not.toContain("## Hook");
    expect(myA!.assembledScript).not.toContain("Tier");
    // Le NOM DE CAMPAGNE est réexposé comme libellé de mission (pour savoir quel
    // format produire) — SANS la décomposition. Fiche détail : formatName + origin.
    expect(myA!.formatName).toBe(`[E2E_TEST] Assign ${ts}`);
    expect(myA!.origin).toBe("script");
    // listMyAssignments : pas de scriptCombo, MAIS le nom de campagne en formatName.
    const myList = await a.client.query(api.assignments.listMyAssignments, {
      projectId,
    });
    for (const it of myList) {
      expect((it as Record<string, unknown>).scriptCombo).toBeUndefined();
      expect(it.formatName).toBe(`[E2E_TEST] Assign ${ts}`);
    }

    // B ne voit pas l'assignment de A (isolation serveur).
    const bSeesA = await b.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: aSample,
    });
    expect(bSeesA).toBeNull();

    // PRICING + ISOLATION paiement : publier un script crée une période de paie
    // PRICING (fixe/CPM via le barème figé), JAMAIS la voie legacy "Vidéo —", et
    // ne fuite PAS le nom de campagne au créateur.
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: aSample,
      status: "to_publish",
    });
    await a.client.mutation(api.assignments.confirmPublication, {
      projectId,
      id: aSample,
      urls: [
        { platform: "TikTok", url: `https://www.tiktok.com/@a/video/sc${ts}` },
      ],
    });
    const myPayments = await a.client.query(api.payments.getMyPayments, {
      projectId,
    });
    // Le barème pilote la paie : une période avec un FIXE > 0 (pricing choisi).
    expect(myPayments.length).toBeGreaterThan(0);
    expect(myPayments.some((p) => p.pricingBreakdown.fixedTotal > 0)).toBe(true);
    // Plus aucune lineItem legacy "Vidéo —" (modèle pricing, pas base-par-post).
    const labels = myPayments.flatMap((p) => p.lineItems.map((li) => li.label));
    expect(labels.some((l) => l.startsWith("Vidéo —"))).toBe(false);
    // Isolation PAIE : le nom de campagne ne fuite PAS dans les PAIEMENTS
    // (lineItems génériques). Il est en revanche affiché comme libellé de mission
    // côté créateur (cf. formatName ci-dessus) — ce sont deux surfaces distinctes.
    expect(JSON.stringify(myPayments)).not.toContain(`[E2E_TEST] Assign ${ts}`);

    // ADMIN : la décomposition du combo est visible (résumé).
    const adminRows = await forCampaign(a.creatorId);
    expect(adminRows[0].scriptCampaignName).toContain("[E2E_TEST] Assign");
    // Résumé combo en libellés visuels (2 tiers) : « Argent »/« Autre » · …
    expect(adminRows[0].comboSummary).toMatch(/^(Argent|Autre) · /);

    // P7 — assignment de FORMAT classique fonctionne toujours.
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] FmtAssign ${ts}`,
      type: "short",
      rateModel: { basePerPost: 7 },
    });
    const rFmt = await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: b.creatorId,
      targets: [tB],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    expect(rFmt.created).toBe(1);
    const bAll = await admin.query(api.assignments.listAssignments, {});
    const fmtRow = bAll.find(
      (x) => x.formatId === formatId && x.creatorId === b.creatorId,
    )!;
    expect(fmtRow.origin).toBe("format");
    expect(fmtRow.scriptCombo ?? null).toBeNull();
    expect(fmtRow.formatName).toContain("[E2E_TEST] FmtAssign");
  });
});

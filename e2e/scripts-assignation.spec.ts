import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/** Crée une campagne de test avec 3 hooks (S/A/B) + 2 corps + 2 flux + 2 cta
 *  → 24 combos. Retourne campaignId. */
async function makeCampaign(ts: number) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Assign ${ts}`,
    demoBlock: "SOCLE DEMO ASSIGN",
  });
  const add = (
    kind: "hook" | "corps" | "flux" | "cta",
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
  await add("corps", "C1", "Corps 1");
  await add("corps", "C2", "Corps 2");
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

    // Assigne 2 créateurs × 5 vidéos → 10 assignments.
    const r1 = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorIds: [a.creatorId, b.creatorId],
      videosPerCreator: 5,
      dueDate: ts + 7 * DAY,
      rateModel: { basePerPost: 10 },
    });
    expect(r1.created).toBe(10);
    expect(r1.totalCombos).toBe(24);
    expect(r1.shortages.length).toBe(0);

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
    // assembledScript figé + rateSnapshot figé + status todo.
    for (const x of aRows) {
      expect(x.scriptCombo?.assembledScript).toContain("SOCLE DEMO ASSIGN");
      expect(x.rateSnapshot.basePerPost).toBe(10);
      expect(x.status).toBe("todo");
      expect(x.formatId ?? null).toBeNull();
    }

    // Réassignation au même créateur (A) : nouveaux combos, aucun chevauchement.
    const aKeysBefore = new Set(aRows.map((x) => x.comboKey));
    const r2 = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorIds: [a.creatorId],
      videosPerCreator: 5,
      dueDate: ts + 7 * DAY,
      rateModel: { basePerPost: 10 },
    });
    expect(r2.created).toBe(5);
    aRows = await forCampaign(a.creatorId);
    expect(aRows.length).toBe(10);
    expect(new Set(aRows.map((x) => x.comboKey)).size).toBe(10); // tous distincts
    // Les 5 nouveaux n'étaient pas dans les 5 premiers.
    const aNew = aRows.filter((x) => !aKeysBefore.has(x.comboKey));
    expect(aNew.length).toBe(5);

    // Épuisement : A a 10/24 ; demander 20 → 14 assignés + shortage.
    const r3 = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorIds: [a.creatorId],
      videosPerCreator: 20,
      dueDate: ts + 7 * DAY,
      rateModel: { basePerPost: 10 },
    });
    expect(r3.created).toBe(14);
    expect(r3.shortages).toEqual([
      { name: `[E2E_TEST] AssignA ${ts}`, requested: 20, assigned: 14 },
    ]);
    aRows = await forCampaign(a.creatorId);
    expect(aRows.length).toBe(24); // tous les combos épuisés
    expect(new Set(aRows.map((x) => x.comboKey)).size).toBe(24);

    // Au-delà du stock → 0 assigné, shortage.
    const r4 = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorIds: [a.creatorId],
      videosPerCreator: 3,
      dueDate: ts + 7 * DAY,
      rateModel: { basePerPost: 10 },
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
    // listMyAssignments : pas de scriptCombo non plus.
    const myList = await a.client.query(api.assignments.listMyAssignments, {
      projectId,
    });
    for (const it of myList) {
      expect((it as Record<string, unknown>).scriptCombo).toBeUndefined();
    }

    // B ne voit pas l'assignment de A (isolation serveur).
    const bSeesA = await b.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: aSample,
    });
    expect(bSeesA).toBeNull();

    // ISOLATION paiement : valider un script ne doit PAS exposer le nom de
    // campagne au créateur via le label de la lineItem (getMyPayments).
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: aSample,
      status: "to_publish",
    });
    await a.client.mutation(api.assignments.confirmPublication, {
      projectId,
      id: aSample,
      url: `https://www.tiktok.com/@a/video/sc${ts}`,
    });
    const myPayments = await a.client.query(api.payments.getMyPayments, {
      projectId,
    });
    const labels = myPayments.flatMap((p) => p.lineItems.map((li) => li.label));
    expect(labels.length).toBeGreaterThan(0);
    for (const lbl of labels) {
      expect(lbl).not.toContain(`[E2E_TEST] Assign ${ts}`); // pas de campagne
    }
    expect(labels.some((l) => l.startsWith("Vidéo —"))).toBe(true);

    // ADMIN : la décomposition du combo est visible (résumé).
    const adminRows = await forCampaign(a.creatorId);
    expect(adminRows[0].scriptCampaignName).toContain("[E2E_TEST] Assign");
    expect(adminRows[0].comboSummary).toMatch(/Tier [SAB] · /);

    // P7 — assignment de FORMAT classique fonctionne toujours.
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] FmtAssign ${ts}`,
      type: "short",
      rateModel: { basePerPost: 7 },
    });
    const rFmt = await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorIds: [b.creatorId],
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

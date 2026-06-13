import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * P8 — validation + accrual + matérialisation (logique d'argent). Prouvé au
 * niveau SERVEUR (mutations via clients admin/créateur) pour un test
 * déterministe de l'idempotence :
 *   1. submit → validate → publication matérialisée (visible tracker) + lineItem
 *      base + total corrects ;
 *   2. double-validation = IDEMPOTENTE (une seule pub, une seule lineItem) ;
 *   3. reject → feedback → resoumission → revalidation OK (2e base) ;
 *   4. bonus calculé puis recalculé = REMPLACEMENT de la ligne (pas d'ajout).
 */
test.describe("P8 — validation, accrual, matérialisation", () => {
  test("submit→validate idempotent, reject→resubmit, bonus replace", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Validation ${ts}`,
      email: `e2e-creator-validation-${ts}@repackit.test`,
      password: "creator-validation-123",
    });
    const projectId = creator.projectId;
    const u1 = `https://www.tiktok.com/@e2e/video/${ts}1`;

    // Admin : format short (base 10 €, bonus 2 €/1k vues) + 2 assignments.
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Format Val ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10, viewBonusPer1k: 2 },
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorIds: [creator.creatorId],
      postsPerCreator: 2,
      dueDate: ts + 7 * DAY,
    });
    const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.formatId === formatId && a.creatorId === creator.creatorId,
    );
    expect(mine.length).toBe(2);
    const [a1, a2] = mine;

    // ─── 1. submit → validate (matérialise + crédite) ───────────────────────
    await creator.client.mutation(api.assignments.startAssignment, {
      projectId,
      id: a1._id,
    });
    await creator.client.mutation(api.assignments.submitAssignment, {
      projectId,
      id: a1._id,
      url: u1,
    });
    // KPI dashboard AVANT validation (workers:1 serial → le delta = notre seule
    // matérialisation).
    const kpiBefore = await admin.query(api.dashboard.dashboardKpis, {});
    const v1 = await admin.mutation(api.assignments.validateAssignment, {
      id: a1._id,
    });
    expect(v1.alreadyValidated).toBe(false);
    expect(v1.publicationId).toBeTruthy();

    const a1Now = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a._id === a1._id,
    )!;
    expect(a1Now.status).toBe("validated");
    expect(a1Now.publicationId).toBeTruthy();

    // Publication matérialisée VISIBLE dans le tracker, postUrl = URL soumise.
    const pub1 = (await admin.query(api.publications.listPublications, {})).find(
      (p) => p._id === a1Now.publicationId,
    );
    expect(pub1).toBeTruthy();
    expect(pub1!.postUrl).toBe(u1);
    expect(pub1!.plateforme).toBe("TikTok");
    expect(pub1!.mediaType).toBe("short");

    // KPI dashboard : le post matérialisé est compté comme publié (+1).
    const kpiAfter = await admin.query(api.dashboard.dashboardKpis, {});
    expect(kpiAfter.totalPublished).toBe(kpiBefore.totalPublished + 1);

    // Paiement : 1 lineItem base = 10, total = 10.
    const payOf = async () =>
      (await admin.query(api.payments.listPayments, {})).find(
        (p) => p.creatorId === creator.creatorId,
      )!;
    let pay = await payOf();
    expect(pay).toBeTruthy();
    expect(
      pay.lineItems.filter(
        (li) => li.kind === "base" && li.assignmentId === a1._id,
      ).length,
    ).toBe(1);
    expect(pay.totalDue).toBe(10);

    // ─── 2. double-validation IDEMPOTENTE ───────────────────────────────────
    const v1bis = await admin.mutation(api.assignments.validateAssignment, {
      id: a1._id,
    });
    expect(v1bis.alreadyValidated).toBe(true);
    const pub1Count = (
      await admin.query(api.publications.listPublications, {})
    ).filter((p) => p.postUrl === u1).length;
    expect(pub1Count).toBe(1); // pas de 2e publication
    pay = await payOf();
    expect(
      pay.lineItems.filter(
        (li) => li.kind === "base" && li.assignmentId === a1._id,
      ).length,
    ).toBe(1); // pas de 2e lineItem
    expect(pay.totalDue).toBe(10); // total inchangé

    // ─── 3. reject → feedback → resoumission → revalidation ─────────────────
    await creator.client.mutation(api.assignments.startAssignment, {
      projectId,
      id: a2._id,
    });
    await creator.client.mutation(api.assignments.submitAssignment, {
      projectId,
      id: a2._id,
      url: `https://www.tiktok.com/@e2e/video/${ts}2a`,
    });
    await admin.mutation(api.assignments.rejectAssignment, {
      id: a2._id,
      feedback: "Hook hors brief, refais.",
    });
    let a2Now = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a._id === a2._id,
    )!;
    expect(a2Now.status).toBe("rejected");
    expect(a2Now.adminFeedback).toBe("Hook hors brief, refais.");

    // Resoumission (depuis rejected) → feedback purgé.
    await creator.client.mutation(api.assignments.submitAssignment, {
      projectId,
      id: a2._id,
      url: `https://www.tiktok.com/@e2e/video/${ts}2b`,
    });
    a2Now = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a._id === a2._id,
    )!;
    expect(a2Now.status).toBe("submitted");
    expect(a2Now.adminFeedback ?? null).toBeNull();

    // Revalidation → 2e lineItem base, total = 20.
    await admin.mutation(api.assignments.validateAssignment, { id: a2._id });
    pay = await payOf();
    expect(pay.lineItems.filter((li) => li.kind === "base").length).toBe(2);
    expect(pay.totalDue).toBe(20);

    // ─── 4. bonus de vues : calcul puis RECALCUL = remplacement ─────────────
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: a1Now.publicationId!,
      capturedAt: ts + 2 * DAY,
      vues: 5000,
      likes: 100,
    });
    const b1 = await admin.mutation(api.assignments.computeViewBonus, {
      id: a1._id,
      views: 5000,
    });
    expect(b1.bonus).toBe(10); // 2 €/1k × 5000 = 10
    pay = await payOf();
    expect(
      pay.lineItems.filter(
        (li) => li.kind === "bonus" && li.assignmentId === a1._id,
      ).length,
    ).toBe(1);
    expect(pay.totalDue).toBe(30); // base 10 + base 10 + bonus 10

    // Recalcul avec 10000 vues → 20, REMPLACE (toujours 1 seule ligne bonus).
    const b2 = await admin.mutation(api.assignments.computeViewBonus, {
      id: a1._id,
      views: 10000,
    });
    expect(b2.bonus).toBe(20);
    pay = await payOf();
    expect(
      pay.lineItems.filter(
        (li) => li.kind === "bonus" && li.assignmentId === a1._id,
      ).length,
    ).toBe(1); // pas d'ajout : remplacement
    expect(pay.totalDue).toBe(40); // base 10 + base 10 + bonus 20
  });

  // Câblage UI : l'admin valide depuis /validation (le bouton appelle bien la
  // mutation). Le reste de la logique d'argent est prouvé par le test serveur.
  test("UI : l'admin valide un post soumis depuis /validation", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] ValidUI ${ts}`,
      email: `e2e-creator-validation-ui-${ts}@repackit.test`,
      password: "creator-validation-ui-123",
    });
    const projectId = creator.projectId;
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Format ValUI ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorIds: [creator.creatorId],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const a = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === formatId && x.creatorId === creator.creatorId,
    )!;
    await creator.client.mutation(api.assignments.startAssignment, {
      projectId,
      id: a._id,
    });
    await creator.client.mutation(api.assignments.submitAssignment, {
      projectId,
      id: a._id,
      url: `https://www.tiktok.com/@e2eui/video/${ts}`,
    });

    await page.goto(adminPath("/validation"));
    // Le post soumis apparaît (carte avec son bouton Valider ciblé par testid).
    const validateBtn = page.getByTestId(`validate-${a._id}`);
    await expect(validateBtn).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`[E2E_TEST] ValidUI ${ts}`)).toBeVisible();

    await validateBtn.click();
    // Après validation, la carte « à valider » disparaît (query réactive).
    await expect(validateBtn).toBeHidden({ timeout: 10_000 });

    // Vérif serveur : assignment validé + publication matérialisée.
    const aNow = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x._id === a._id,
    )!;
    expect(aNow.status).toBe("validated");
    expect(aNow.publicationId).toBeTruthy();
  });
});

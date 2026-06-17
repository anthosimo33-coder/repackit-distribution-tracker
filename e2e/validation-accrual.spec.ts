import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * Accrual + matérialisation au DÉCLENCHEUR `published` (le créateur fournit
 * l'URL après validation de sa vidéo). Test SERVEUR déterministe :
 *   1. to_publish → confirmPublication → publication matérialisée (tracker) +
 *      lineItem base + total ;
 *   2. re-confirmer = IDEMPOTENT (une seule pub, une seule lineItem) ;
 *   3. un 2e post publié → 2e base ;
 *   4. bonus calculé puis recalculé = REMPLACEMENT.
 * Le cycle revue vidéo (upload/refus/re-upload) est couvert par mp4-workflow.
 */
test.describe("Accrual & matérialisation à la publication", () => {
  test("publish idempotent, 2e base, bonus replace", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Validation ${ts}`,
      email: `e2e-creator-validation-${ts}@repackit.test`,
      password: "creator-validation-123",
    });
    const projectId = creator.projectId;
    const u1 = `https://www.tiktok.com/@e2e/video/${ts}1`;

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

    const setToPublish = (id: typeof a1._id) =>
      admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id,
        status: "to_publish",
      });

    // ─── 1. to_publish → confirmPublication (matérialise + crédite) ──────────
    await setToPublish(a1._id);
    const kpiBefore = await admin.query(api.dashboard.dashboardKpis, {});
    const v1 = await creator.client.mutation(
      api.assignments.confirmPublication,
      { projectId, id: a1._id, url: u1 },
    );
    expect(v1.alreadyPublished).toBe(false);
    expect(v1.publicationId).toBeTruthy();

    const a1Now = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a._id === a1._id,
    )!;
    expect(a1Now.status).toBe("published");
    expect(a1Now.publicationId).toBeTruthy();
    expect(a1Now.publishedUrl).toBe(u1);

    const pub1 = (await admin.query(api.publications.listPublications, {})).find(
      (p) => p._id === a1Now.publicationId,
    );
    expect(pub1).toBeTruthy();
    expect(pub1!.postUrl).toBe(u1);
    expect(pub1!.plateforme).toBe("TikTok");
    expect(pub1!.mediaType).toBe("short");

    const kpiAfter = await admin.query(api.dashboard.dashboardKpis, {});
    expect(kpiAfter.totalPublished).toBe(kpiBefore.totalPublished + 1);

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

    // ─── 2. re-confirmer IDEMPOTENT ─────────────────────────────────────────
    const v1bis = await creator.client.mutation(
      api.assignments.confirmPublication,
      { projectId, id: a1._id, url: u1 },
    );
    expect(v1bis.alreadyPublished).toBe(true);
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
    expect(pay.totalDue).toBe(10);

    // ─── 3. un 2e post publié → 2e base, total = 20 ─────────────────────────
    await setToPublish(a2._id);
    await creator.client.mutation(api.assignments.confirmPublication, {
      projectId,
      id: a2._id,
      url: `https://www.tiktok.com/@e2e/video/${ts}2b`,
    });
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

  // Câblage UI : l'admin valide une vidéo depuis /validation (le bouton appelle
  // bien reviewVideoApprove). Le reste de la logique d'argent est prouvé au-dessus.
  test("UI : l'admin valide une vidéo depuis /validation", async ({ page }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] ValidUI ${ts}`,
      email: `e2e-creator-validation-ui-${ts}@repackit.test`,
      password: "creator-validation-ui-123",
    });
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
    // Vidéo en attente de revue (sans MP4 : la carte rend quand même le bouton).
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: a._id,
      status: "video_submitted",
    });

    await page.goto(adminPath("/validation"));
    const approveBtn = page.getByTestId(`approve-${a._id}`);
    await expect(approveBtn).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`[E2E_TEST] ValidUI ${ts}`)).toBeVisible();

    await approveBtn.click();
    // Après validation, la carte « à valider » disparaît (query réactive).
    await expect(approveBtn).toBeHidden({ timeout: 10_000 });

    // Vérif serveur : la vidéo est validée → to_publish (paiement PAS encore).
    const aNow = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x._id === a._id,
    )!;
    expect(aNow.status).toBe("to_publish");
    expect(aNow.publicationId).toBeFalsy(); // rien de matérialisé à la validation
  });
});

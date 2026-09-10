import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * P9 — portail gains créateur + vue admin paiements, MODÈLE CYCLE J+30 GLISSANT
 * (ancré sur le 1er post de chaque créateur). Le cœur (accrual, isolation,
 * idempotence du marquage payé PAR CYCLE) est prouvé au niveau SERVEUR ; un test
 * UI vérifie le câblage des pages (dashboard, /app/paiements, /app/profil,
 * /admin/paiements). Les 2 posts publiés « maintenant » tombent dans le cycle 0.
 */
test.describe("P9 — paiements & gains (cycle J+30)", () => {
  test("serveur : gains groupés par cycle, isolation, marquer cycle payé idempotent, profil + CSV data", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const a = await createCreatorSession(url, {
      name: `[E2E_TEST] PayA ${ts}`,
      email: `e2e-creator-pay-a-${ts}@repackit.test`,
      password: "pay-a-12345",
    });
    const b = await createCreatorSession(url, {
      name: `[E2E_TEST] PayB ${ts}`,
      email: `e2e-creator-pay-b-${ts}@repackit.test`,
      password: "pay-b-12345",
    });
    const projectId = a.projectId;

    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] PayFmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10 },
    });
    const tA = await availableTarget({
      e2eClient: admin,
      creatorId: a.creatorId,
      platform: "TikTok",
      handle: `@e2epaya${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: a.creatorId,
      targets: [tA],
      postsPerCreator: 2,
      dueDate: ts + 7 * DAY,
    });
    const aAssigns = (
      await admin.query(api.assignments.listAssignments, {})
    ).filter((x) => x.formatId === formatId && x.creatorId === a.creatorId);
    expect(aAssigns.length).toBe(2);

    // Vidéo validée (to_publish) puis A PUBLIE → accrual à la publication + ancre
    // firstPostAt figée à la 1re publi (cycle 0 démarre là).
    for (let i = 0; i < 2; i++) {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: aAssigns[i]._id,
        status: "to_publish",
      });
      await a.client.mutation(api.assignments.confirmPublication, {
        projectId,
        id: aAssigns[i]._id,
        urls: [
          { platform: "TikTok", url: `https://www.tiktok.com/@a/video/${ts}${i}` },
        ],
      });
    }

    // A voit SON cycle courant (cycle 0) : 2 lignes base, total 20.
    const aPays = await a.client.query(api.payments.getMyPayments, {
      projectId,
    });
    expect(aPays.length).toBe(1);
    expect(aPays[0].cycleIndex).toBe(0);
    expect(aPays[0].lineItems.filter((li) => li.kind === "base").length).toBe(2);
    expect(aPays[0].totalDue).toBe(20);

    // ISOLATION : B ne voit AUCUN cycle de A (filtré serveur par creatorId).
    const bPays = await b.client.query(api.payments.getMyPayments, {
      projectId,
    });
    expect(bPays.length).toBe(0);

    // A édite son profil de paiement (filtré serveur sur sa propre fiche).
    await a.client.mutation(api.creators.updateMyProfile, {
      projectId,
      phone: "+33612345678",
      paymentMethod: "sepa",
      paymentDetails: "FR76 1234 5678",
    });
    const aProfile = await a.client.query(api.creators.getMyProfile, {
      projectId,
    });
    expect(aProfile?.paymentMethod).toBe("sepa");
    expect(aProfile?.paymentDetails).toBe("FR76 1234 5678");
    expect(aProfile?.phone).toBe("+33612345678");

    // Admin : le cycle de A porte les infos (source CSV) + total.
    const findRow = async () =>
      (await admin.query(api.payments.listPayments, {})).find(
        (p) => p.creatorId === a.creatorId && p.cycleIndex === 0,
      )!;
    const aRow = await findRow();
    expect(aRow.totalDue).toBe(20);
    expect(aRow.creatorPaymentMethod).toBe("sepa");
    expect(aRow.creatorPaymentDetails).toBe("FR76 1234 5678");
    expect(aRow.creatorEmail).toContain("e2e-creator-pay-a");

    // Marquer le CYCLE payé — idempotent (re-marquer ne change pas paidAt).
    const r1 = await admin.mutation(api.payments.markCyclePaid, {
      creatorId: a.creatorId,
      cycleIndex: 0,
    });
    expect(r1.alreadyPaid).toBe(false);
    const paid1 = await findRow();
    expect(paid1.status).toBe("paid");
    expect(paid1.paidAt).toBeTruthy();
    expect(paid1.totalDue).toBe(20); // les 2 lignes base sont capturées dans le gel

    const r2 = await admin.mutation(api.payments.markCyclePaid, {
      creatorId: a.creatorId,
      cycleIndex: 0,
    });
    expect(r2.alreadyPaid).toBe(true);
    const paid2 = await findRow();
    expect(paid2.paidAt).toBe(paid1.paidAt); // inchangé
  });

  test("UI : dashboard gains, /app/paiements, /app/profil, admin marquer cycle payé", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] PayUI ${ts}`;
    const email = `e2e-creator-pay-ui-${ts}@repackit.test`;
    const password = "pay-ui-12345";

    // Invitation + onboarding navigateur (session créateur).
    const { token } = await admin.mutation(api.creators.inviteCreator, {
      name,
      email,
    });
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const cpage = await ctx.newPage();
    await cpage.goto(`/join/${token}`);
    await cpage.getByLabel("Mot de passe").fill(password);
    await cpage.getByRole("button", { name: /activer mon compte/i }).click();
    await cpage.waitForURL("**/app", { timeout: 20_000 });

    // Client convex créateur (sign-in) + setup d'un paiement de 15 $.
    const creatorClient = createE2eClient(url, { email, password });
    const creatorId = (await admin.query(api.creators.listCreators, {})).find(
      (c) => c.email === email,
    )!._id;
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] PayUIFmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 15 },
    });
    const tUI = await availableTarget({
      e2eClient: admin,
      creatorId,
      platform: "TikTok",
      handle: `@e2epayui${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId,
      targets: [tUI],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const assignment = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((x) => x.formatId === formatId && x.creatorId === creatorId)!;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignment._id,
      status: "to_publish",
    });
    await creatorClient.mutation(api.assignments.confirmPublication, {
      id: assignment._id,
      urls: [
        { platform: "TikTok", url: `https://www.tiktok.com/@payui/video/${ts}` },
      ],
    });

    // Dashboard créateur : bloc « Mes gains » montre 15 $.
    await cpage.goto("/app");
    await expect(cpage.getByTestId("dashboard-due")).toContainText("15", {
      timeout: 15_000,
    });

    // /app/paiements : montant dû du cycle en cours + ligne de détail.
    await cpage.goto("/app/paiements");
    await expect(cpage.getByTestId("due-now")).toContainText("15", {
      timeout: 15_000,
    });
    await expect(cpage.getByText("[E2E_TEST] PayUIFmt " + ts)).toBeVisible();

    // /app/profil : édition + enregistrement.
    await cpage.goto("/app/profil");
    await cpage.getByLabel("Téléphone").fill("+33700000000");
    await cpage.getByRole("button", { name: /enregistrer/i }).click();
    await expect(cpage.getByText(/profil enregistré/i)).toBeVisible({
      timeout: 10_000,
    });

    // Admin UI : la page paiements liste le cycle du créateur ; marquer payé.
    const payRow = (await admin.query(api.payments.listPayments, {})).find(
      (p) => p.creatorId === creatorId,
    )!;
    await page.goto(adminPath("/paiements"));
    const markBtn = page.getByTestId(`mark-paid-${payRow.key}`);
    await expect(markBtn).toBeVisible({ timeout: 15_000 });
    await markBtn.click();
    await expect(markBtn).toBeHidden({ timeout: 10_000 });

    // Vérif serveur : cycle payé.
    const paid = (await admin.query(api.payments.listPayments, {})).find(
      (p) => p.creatorId === creatorId && p.cycleIndex === payRow.cycleIndex,
    )!;
    expect(paid.status).toBe("paid");

    await ctx.close();
  });
});

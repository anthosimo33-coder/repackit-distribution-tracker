import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * EFFACER LE DÛ d'une créatrice (25/11/2026) — une créatrice manque à une
 * clause de son contrat, on ne la paie pas, et rien ne doit passer pour payé.
 *
 * Ce que la spec verrouille :
 *  1. le motif est obligatoire, et un montant vu qui n'est plus le montant dû
 *     n'efface rien (même garde que le paiement) ;
 *  2. effacé = 0, hors du total dû, détail et motif gardés ; les acomptes déjà
 *     versés restent versés ;
 *  3. un dû effacé ne se paie pas et ne reçoit pas d'acompte ;
 *  4. l'espace de la créatrice lit « annulé » SANS le motif ;
 *  5. rétablir rend le cycle dû, recalculé, et le journal garde les deux gestes ;
 *     on peut ré-effacer et rétablir encore (« à tout moment ») ;
 *  6. à l'écran : le geste dans le bloc de la créatrice, la fenêtre et son motif,
 *     la ligne « Dû effacé » dans « Réglé », « Rétablir ».
 *
 * ⚠️ Base e2e partagée : tout est scopé à NOS créatrices, aucun total global
 * n'est lu autrement qu'en écart.
 */

async function creatriceQuiPublie(ts: number, suffixe: string, montant: number) {
  const creator = await createCreatorSession(url!, {
    name: `[E2E_TEST] Efface ${suffixe} ${ts}`,
    email: `e2e-efface-${suffixe}-${ts}@repackit.test`,
    password: "efface-12345",
  });
  // Format à FIXE par post : montant prévisible, sans CPM qui bouge.
  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] FmtEfface ${suffixe} ${ts}`,
    type: "short",
    rateModel: { basePerPost: montant },
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: creator.creatorId,
    platform: "TikTok",
    handle: `@e2eefface${suffixe}${ts}`,
  });
  await admin.mutation(api.assignments.assignFormat, {
    formatId,
    creatorId: creator.creatorId,
    targets: [target],
    dueDate: ts + 7 * DAY,
    postsPerCreator: 1,
  });
  const a = (await admin.query(api.assignments.listAssignments, {})).find(
    (x) => x.creatorId === creator.creatorId,
  )!;
  await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
    secret: E2E_SECRET,
    id: a._id,
    status: "to_publish",
  });
  await creator.client.mutation(api.assignments.confirmPublication, {
    projectId: creator.projectId,
    id: a._id,
    urls: [
      { platform: "TikTok", url: `https://www.tiktok.com/@e/video/ef${suffixe}${ts}` },
    ],
  });
  return creator;
}

test.describe("Paiements — effacer le dû", () => {
  test("motif obligatoire, 0 sans faux payé, vue créatrice sans motif, rétablir", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await creatriceQuiPublie(ts, "api", 40);
    const cycleOf = async () =>
      (await admin.query(api.payments.listPayments, {})).find(
        (p) => p.creatorId === creator.creatorId && p.cycleIndex === 0,
      )!;

    // PRÉSENCE : le cycle doit quelque chose, sinon tout le reste est vrai par vacuité.
    const avant = await cycleOf();
    expect(avant.status).toBe("accruing");
    expect(avant.totalDue).toBe(40);
    await admin.mutation(api.payments.recordAdvance, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
      amount: 10,
    });
    expect((await cycleOf()).remainingDue).toBe(30);
    const dueAvant = (await admin.query(api.payments.getDueTotal, {})).dueTotal;

    // ── 1. Motif obligatoire ; montant vu ≠ montant dû → rien n'est effacé ──
    await expect(
      admin.mutation(api.payments.cancelCycleDue, {
        creatorId: creator.creatorId,
        cycleIndex: 0,
        reason: "   ",
      }),
    ).rejects.toThrow();
    const vuAutre = await admin.mutation(api.payments.cancelCycleDue, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
      reason: "Clause du contrat",
      expectedTotalDue: 39,
    });
    expect(vuAutre).toMatchObject({ ok: false, amountChanged: { seen: 39, current: 40 } });
    expect((await cycleOf()).status).toBe("accruing");

    // ── 2. Effacer ───────────────────────────────────────────────────────────
    const motif = `A manqué à une clause de son contrat ${ts}`;
    const r = await admin.mutation(api.payments.cancelCycleDue, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
      reason: motif,
      expectedTotalDue: 40,
    });
    expect(r).toMatchObject({ ok: true, amount: 40, remaining: 30 });
    const efface = await cycleOf();
    expect(efface.status).toBe("cancelled");
    expect(efface.totalDue).toBe(0);
    expect(efface.remainingDue).toBe(0);
    expect(efface.paidAt).toBeNull();
    expect(efface.cancellation).toMatchObject({ reason: motif, amount: 40, remaining: 30 });
    expect(efface.cancellation!.lineItems.reduce((s, li) => s + li.amount, 0)).toBe(40);
    // L'acompte a été versé : il reste lisible.
    expect(efface.advances.map((a) => a.amount)).toEqual([10]);
    expect(efface.cancellationLog.map((e) => e.kind)).toEqual(["cancel"]);
    // Le total dû du projet perd exactement ce qui restait à verser.
    expect((await admin.query(api.payments.getDueTotal, {})).dueTotal).toBeCloseTo(
      dueAvant - 30,
      2,
    );
    // Ré-effacer ne double rien.
    expect(
      await admin.mutation(api.payments.cancelCycleDue, {
        creatorId: creator.creatorId,
        cycleIndex: 0,
        reason: motif,
      }),
    ).toMatchObject({ ok: true, alreadyCancelled: true });

    // ── 3. Ni payé, ni acompte ───────────────────────────────────────────────
    await expect(
      admin.mutation(api.payments.markCyclePaid, {
        creatorId: creator.creatorId,
        cycleIndex: 0,
      }),
    ).rejects.toThrow(/effacé|ERR_PAYMENT_DUE_CANCELLED/);
    await expect(
      admin.mutation(api.payments.recordAdvance, {
        creatorId: creator.creatorId,
        cycleIndex: 0,
        amount: 5,
      }),
    ).rejects.toThrow(/effacé|ERR_PAYMENT_DUE_CANCELLED/);
    expect((await cycleOf()).status).toBe("cancelled");

    // ── 4. Ce que voit la créatrice : annulé, sans motif ─────────────────────
    const siens = await creator.client.query(api.payments.getMyPayments, {
      projectId: creator.projectId,
    });
    const sonCycle = siens.find((p) => p.cycleIndex === 0)!;
    expect(sonCycle.status).toBe("cancelled");
    expect(sonCycle.cancellation).toEqual({ at: efface.cancellation!.at });
    expect(JSON.stringify(siens)).not.toContain(motif);

    // ── 5. Rétablir, ré-effacer, rétablir ────────────────────────────────────
    const apercu = await admin.query(api.payments.restoreCycleDuePreview, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
    });
    expect(apercu.totalDue).toBe(40);
    await admin.mutation(api.payments.restoreCycleDue, { id: efface.paymentId! });
    const retabli = await cycleOf();
    expect(retabli.status).toBe("accruing");
    expect(retabli.totalDue).toBe(40);
    expect(retabli.remainingDue).toBe(30);
    expect(retabli.cancellation).toBeNull();
    expect(retabli.cancellationLog.map((e) => e.kind)).toEqual(["cancel", "restore"]);
    await expect(
      admin.mutation(api.payments.restoreCycleDue, { id: efface.paymentId! }),
    ).rejects.toThrow();
    await admin.mutation(api.payments.cancelCycleDue, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
      reason: "Second effacement",
    });
    expect((await cycleOf()).status).toBe("cancelled");
    await admin.mutation(api.payments.restoreCycleDue, { id: efface.paymentId! });
    const final = await cycleOf();
    expect(final.status).toBe("accruing");
    expect(final.cancellationLog.map((e) => e.kind)).toEqual([
      "cancel",
      "restore",
      "cancel",
      "restore",
    ]);
  });

  test("à l'écran : effacer avec un motif, lire « Dû effacé », rétablir", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await creatriceQuiPublie(ts, "ui", 55);
    const motif = `Clause du contrat non tenue ${ts}`;

    await page.goto(adminPath("/paiements"));
    const carte = page.getByTestId(`creator-card-${creator.creatorId}`);
    await expect(carte).toBeVisible({ timeout: 30_000 });

    // Le geste est dans le bloc de la créatrice.
    await carte.getByTestId("cancel-due-open").click();
    const fenetre = page.getByRole("dialog");
    await expect(fenetre).toContainText("Effacer le dû");
    await expect(fenetre).toContainText("Cycles à effacer");
    // Sans motif, le bouton reste éteint.
    const confirmer = fenetre.getByTestId("cancel-due-confirm");
    await expect(confirmer).toBeDisabled();
    await fenetre.getByLabel(/Motif/).fill(motif);
    await expect(confirmer).toBeEnabled();
    await expect(confirmer).toContainText("55");
    await confirmer.click();
    await expect(fenetre).toBeHidden({ timeout: 15_000 });

    // Plus dans « À payer » : la carte disparaît…
    await expect(carte).toHaveCount(0, { timeout: 15_000 });
    // …et le cycle se lit « Dû effacé » dans « Réglé », avec son motif.
    const regle = page.getByRole("region", { name: "Cycles réglés" });
    const ligne = regle
      .getByTestId(/^cycle-/)
      .filter({ hasText: `Efface ui ${ts}` });
    await expect(ligne).toHaveCount(1);
    await expect(ligne).toContainText("Dû effacé");
    await ligne.getByRole("button", { name: new RegExp(`Efface ui ${ts}`) }).click();
    await expect(ligne).toContainText(motif);

    // Rétablir : la fenêtre dit ce que le cycle vaut aujourd'hui.
    await ligne.getByRole("button", { name: "Rétablir…" }).click();
    const retablir = page.getByRole("dialog");
    await expect(retablir.getByTestId("restore-due-now")).toContainText("55", {
      timeout: 15_000,
    });
    await retablir.getByTestId("restore-due-confirm").click();
    await expect(retablir).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId(`creator-card-${creator.creatorId}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(ligne).toHaveCount(0);
  });
});

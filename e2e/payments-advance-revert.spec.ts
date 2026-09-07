import { test, expect } from "./fixtures/auth-fixture";
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
 * ACOMPTE et ANNULATION sur un cycle de paie.
 *
 * Deux gestes que l'admin n'avait pas, et deux erreurs qu'ils réparent :
 *  — « j'ai viré 100 $ sur les 276 $, je ne veux pas marquer le cycle payé » ;
 *  — « j'ai marqué payé alors que je n'avais rien viré ».
 *
 * Ce que la spec verrouille :
 *  1. ACOMPTE — le cycle RESTE dû, son montant ne bouge pas, mais le RESTE
 *     diminue d'autant (dû du jour − versé) ; deux acomptes s'additionnent ;
 *  2. l'acompte n'est PAS une ligne de paie : les `lineItems` (ce qui est GAGNÉ)
 *     sont intacts — sans quoi le grand livre se mettrait à baisser à chaque
 *     virement ;
 *  3. ANNULATION — le cycle repasse dû, avec le total et les lignes d'AVANT ;
 *  4. une seule fois : la deuxième annulation est refusée ;
 *  5. un cycle jamais payé ne s'annule pas ;
 *  6. un acompte sur un cycle soldé est refusé, et un montant négatif aussi.
 */
test.describe("Paiements — acompte et annulation", () => {
  test("acompte sans figer, lignes intactes, annulation unique et fidèle", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Acompte ${ts}`,
      email: `e2e-acompte-${ts}@repackit.test`,
      password: "acompte-12345",
    });
    const projectId = creator.projectId;

    // Un format à FIXE par post : le montant du cycle est prévisible (pas de
    // CPM qui bougerait sous les pieds de la spec), et il reste réaliste.
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] FmtAcompte ${ts}`,
      type: "short",
      rateModel: { basePerPost: 40 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2eacompte${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets: [target],
      dueDate: ts + 7 * DAY,
      postsPerCreator: 1,
    });
    const assignment = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((a) => a.creatorId === creator.creatorId)!;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignment._id,
      status: "to_publish",
    });
    await creator.client.mutation(api.assignments.confirmPublication, {
      projectId,
      id: assignment._id,
      urls: [
        {
          platform: "TikTok",
          url: `https://www.tiktok.com/@a/video/ac${ts}`,
        },
      ],
    });

    const cycleOf = async () =>
      (await admin.query(api.payments.listPayments, {})).find(
        (p) => p.creatorId === creator.creatorId && p.cycleIndex === 0,
      )!;

    const avant = await cycleOf();
    expect(avant.status).toBe("accruing");
    expect(avant.totalDue).toBe(40);
    expect(avant.remainingDue).toBe(40);
    expect(avant.advances).toHaveLength(0);
    const lignesAvant = JSON.stringify(avant.lineItems);
    const dueAvant = (await admin.query(api.payments.getDueTotal, {})).dueTotal;

    // ── 6. Ce qui est REFUSÉ ────────────────────────────────────────────────
    await expect(
      admin.mutation(api.payments.recordAdvance, {
        creatorId: creator.creatorId,
        cycleIndex: 0,
        amount: -10,
      }),
    ).rejects.toThrow();

    // ── 1 & 2. ACOMPTE ──────────────────────────────────────────────────────
    await admin.mutation(api.payments.recordAdvance, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
      amount: 15,
    });
    const apres1 = await cycleOf();
    // Le cycle RESTE dû, et il vaut toujours 40 : un acompte ne fige rien.
    expect(apres1.status).toBe("accruing");
    expect(apres1.totalDue).toBe(40);
    expect(apres1.remainingDue).toBe(25);
    expect(apres1.advances.map((a) => a.amount)).toEqual([15]);
    // Les lignes de paie (ce qui est GAGNÉ) sont INTACTES.
    expect(JSON.stringify(apres1.lineItems)).toBe(lignesAvant);
    // Le total dû du projet baisse d'autant — c'est l'argent déjà sorti.
    expect(
      (await admin.query(api.payments.getDueTotal, {})).dueTotal,
    ).toBeCloseTo(dueAvant - 15, 2);

    // Deux acomptes s'additionnent.
    await admin.mutation(api.payments.recordAdvance, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
      amount: 10.5,
    });
    const apres2 = await cycleOf();
    expect(apres2.advances.map((a) => a.amount)).toEqual([15, 10.5]);
    expect(apres2.remainingDue).toBe(14.5);

    // ── 5. Un cycle jamais payé ne s'annule pas ─────────────────────────────
    expect(apres2.canRevert).toBe(false);
    await expect(
      admin.mutation(api.payments.revertCyclePayment, {
        id: apres2.paymentId!,
      }),
    ).rejects.toThrow();

    // ── 3. SOLDE puis ANNULATION ────────────────────────────────────────────
    await admin.mutation(api.payments.markCyclePaid, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
    });
    const paye = await cycleOf();
    expect(paye.status).toBe("paid");
    expect(paye.canRevert).toBe(true);
    expect(paye.remainingDue).toBe(0);
    const totalPaye = paye.totalDue;
    expect(totalPaye).toBe(40);

    // 6 bis — un acompte sur un cycle soldé n'a plus d'objet.
    await expect(
      admin.mutation(api.payments.recordAdvance, {
        creatorId: creator.creatorId,
        cycleIndex: 0,
        amount: 5,
      }),
    ).rejects.toThrow();

    await admin.mutation(api.payments.revertCyclePayment, {
      id: paye.paymentId!,
    });
    const annule = await cycleOf();
    // Le cycle est redevenu DÛ, avec le même montant qu'avant le paiement…
    expect(annule.status).toBe("accruing");
    expect(annule.totalDue).toBe(40);
    // …et les acomptes, eux, n'ont pas été inventés ni perdus.
    expect(annule.advances.map((a) => a.amount)).toEqual([15, 10.5]);
    expect(annule.remainingDue).toBe(14.5);
    // Les lignes gelées au paiement ont bien été RETIRÉES : sans ça, le cycle
    // porterait à la fois ses lignes live et leur copie gelée — donc le double.
    expect(JSON.stringify(annule.lineItems)).toBe(lignesAvant);

    // ── 4. UNE SEULE FOIS ───────────────────────────────────────────────────
    expect(annule.canRevert).toBe(false);
    await admin.mutation(api.payments.markCyclePaid, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
    });
    const repaye = await cycleOf();
    expect(repaye.status).toBe("paid");
    // Re-payer ne redonne PAS une annulation : le reçu se consomme une fois.
    expect(repaye.canRevert).toBe(false);
    await expect(
      admin.mutation(api.payments.revertCyclePayment, {
        id: repaye.paymentId!,
      }),
    ).rejects.toThrow(/annul/i);
  });
});

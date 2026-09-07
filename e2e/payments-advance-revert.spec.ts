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
 *  6. un acompte sur un cycle soldé est refusé, et un montant négatif aussi ;
 *  7. un paiement ANTÉRIEUR au reçu d'annulation (toute la prod d'avant ce
 *     chantier) s'annule quand même, par reconstruction.
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

  test("un paiement antérieur au reçu s'annule quand même", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] SansRecu ${ts}`,
      email: `e2e-sansrecu-${ts}@repackit.test`,
      password: "sansrecu-12345",
    });

    // Modèle PRICING (et non un format à fixe par post) : c'est LUI qui produit
    // les lignes GELÉES au paiement (« Fixe », « CPM »). Avec le modèle legacy,
    // la ligne existe déjà avant le paiement et le chemin reconstruit n'aurait
    // rien à retirer — le test serait vert sans rien prouver.
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] SansRecu ${ts}`,
    });
    for (const [kind, label] of [
      ["hook", "H1"],
      ["flux", "F1"],
      ["cta", "C1"],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label: `${label} ${ts}`,
        content: `${label} contenu`,
      });
    }
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingSansRecu ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2esansrecu${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
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
        { platform: "TikTok", url: `https://www.tiktok.com/@s/video/sr${ts}` },
      ],
    });

    const cycleOf = async () =>
      (await admin.query(api.payments.listPayments, {})).find(
        (p) => p.creatorId === creator.creatorId && p.cycleIndex === 0,
      )!;

    const avant = await cycleOf();
    const duAvant = avant.totalDue;
    // PRÉSENCE : le cycle vaut bien quelque chose avant qu'on le paie, sinon
    // tout ce qui suit serait vrai par vacuité.
    expect(duAvant).toBeGreaterThan(0);
    expect(avant.lineItems.filter((li) => li.kind === "fixed")).toHaveLength(0);

    await admin.mutation(api.payments.markCyclePaid, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
    });
    const paye = await cycleOf();
    expect(paye.status).toBe("paid");
    // Le paiement a bien GELÉ une ligne « Fixe » : c'est elle que l'annulation
    // reconstruite devra retirer.
    expect(
      paye.lineItems.filter((li) => li.kind === "fixed").length,
    ).toBeGreaterThan(0);

    // On efface le reçu : la row ressemble maintenant à un paiement fait AVANT
    // que le reçu existe — c'est-à-dire à tout l'historique de production.
    await admin.mutation(api.payments.e2eForgetUndoReceipt, {
      secret: E2E_SECRET,
      id: paye.paymentId!,
    });
    const sansRecu = await cycleOf();
    // L'annulation reste offerte : c'est TOUT l'objet de la reconstruction.
    expect(sansRecu.canRevert).toBe(true);

    await admin.mutation(api.payments.revertCyclePayment, {
      id: sansRecu.paymentId!,
    });
    const annule = await cycleOf();
    expect(annule.status).toBe("accruing");
    // Le cycle retrouve exactement son montant d'avant — recalculé live.
    expect(annule.totalDue).toBe(duAvant);
    // Et toujours une seule fois.
    expect(annule.canRevert).toBe(false);

    // LE PIÈGE que le retrait des lignes gelées évite : re-payer ne doit pas
    // RE-empiler celles de la première fois. Sans lui, la row garderait son
    // « Fixe » et le second paiement en ajouterait un autre — le double versé
    // pour une seule vidéo. Invisible tant qu'on ne re-paie pas, d'où cette
    // assertion plutôt qu'une lecture des lignes.
    await admin.mutation(api.payments.markCyclePaid, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
    });
    const repaye = await cycleOf();
    expect(repaye.status).toBe("paid");
    expect(repaye.totalDue).toBe(duAvant);
  });
});

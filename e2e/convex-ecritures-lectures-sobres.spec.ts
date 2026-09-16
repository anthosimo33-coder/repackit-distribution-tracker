import { test, expect } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * COÛTS CONVEX, ÉTAPE 2 — ne plus écrire ni relire pour rien.
 *
 * La facture Convex est la bande passante base : chaque octet lu, et chaque
 * écriture qui relance les queries abonnées. Trois gaspillages retirés ici :
 *   1. la synchro Whop réécrivait chaque heure ~1 900 lignes inchangées ;
 *   2. chaque relevé de vues relisait toutes les assignations du projet pour
 *      retrouver la créatrice d'une publication ;
 *   3. les listes déroulantes de comptes relisaient publications et
 *      assignations pour afficher un @.
 * Chaque optimisation a son risque ; chaque test ci-dessous en vise un.
 */
test.describe("Coûts Convex — écritures et lectures sobres", () => {
  test("Whop : une ligne inchangée n'est pas réécrite, un remboursement l'est", async () => {
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const hier = ts - DAY - 2 * HOUR - 17_000;
    const paiements = [
      {
        whopId: `pay_e2e_sobre_a_${ts}`,
        status: "paid" as const,
        rawStatus: "paid",
        currency: "EUR",
        grossAmount: 16.9,
        feeAmount: 1.53,
        netAmount: 15.37,
        refundedAmount: 0,
        paidAt: hier,
        membershipId: `mem_e2e_sobre_a_${ts}`,
        billingCountry: "RS",
        memberName: "Jovana Petrović",
      },
      {
        whopId: `pay_e2e_sobre_b_${ts}`,
        status: "paid" as const,
        rawStatus: "paid",
        currency: "EUR",
        grossAmount: 9.99,
        feeAmount: 0.91,
        netAmount: 9.08,
        refundedAmount: 0,
        paidAt: hier - 3 * HOUR,
        planId: `plan_e2e_sobre_${ts}`,
        billingCountry: "HR",
      },
    ];

    const premier = await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
      secret: E2E_SECRET,
      projectId,
      payments: paiements,
    });
    expect(premier).toMatchObject({ inserted: 2, updated: 0, unchanged: 0 });

    // La synchro relit la même chose l'heure suivante : RIEN n'est écrit.
    const relu = await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
      secret: E2E_SECRET,
      projectId,
      payments: paiements,
    });
    expect(relu).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });

    // Un remboursement arrive : CETTE ligne est écrite, l'autre non.
    const rembourse = await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
      secret: E2E_SECRET,
      projectId,
      payments: [
        { ...paiements[0], status: "refunded" as const, rawStatus: "refunded", refundedAmount: 16.9 },
        paiements[1],
      ],
    });
    expect(rembourse).toMatchObject({ inserted: 0, updated: 1, unchanged: 1 });
  });

  test("Whop : la fraîcheur suit le PASSAGE de la synchro, pas la dernière ligne écrite", async () => {
    const projectId = await admin.getProjectId();
    // Un passage daté DANS UNE HEURE : aucune ligne de paiement ne peut porter
    // un `updatedAt` aussi récent, donc seul le marqueur peut produire ce
    // chiffre. C'est ce qui prouve qu'il est lu.
    const passage = Date.now() + HOUR + 4_321;
    await admin.mutation(api.whopSync.e2eMarkWhopSynced, {
      secret: E2E_SECRET,
      projectId,
      at: passage,
    });
    const conversions = await admin.query(api.conversionSync.readConversionAllTime, {});
    expect(conversions?.salesSyncMs).toBe(passage);
  });

  test("Sélecteurs de comptes : la version légère rend les mêmes comptes que listComptes", async () => {
    const ts = Date.now();
    const creator = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Aleksandra Nikolić-Varga ${ts}`,
      email: `e2e-comptes-choix-${ts}@repackit.test`,
    });
    const handle = `@e2e.choix_compte${ts}`;
    const { accountId } = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "Instagram",
      handle,
    });
    // Un pays posé, comme sur les comptes de prod : sans lui, un champ oublié
    // dans la projection passerait inaperçu (undefined des deux côtés).
    await admin.mutation(api.comptes.updateCompte, {
      id: accountId,
      targetCountry: "RS",
    });

    for (const args of [{}, { actifOnly: true }] as const) {
      const complet = await admin.query(api.comptes.listComptes, args);
      const leger = await admin.query(api.comptes.listComptesChoix, args);
      // PRÉSENCE : le compte semé est bien là, AVEC son pays — sinon l'égalité
      // passerait sur deux listes qui l'ont perdu toutes les deux.
      expect(
        leger.find((c) => c.handle === handle)?.targetCountry,
      ).toBe("RS");
      expect(leger).toEqual(
        complet.map((c) => ({
          _id: c._id,
          handle: c.handle,
          plateforme: c.plateforme,
          creatorId: c.creatorId,
          status: c.status,
          actif: c.actif,
          targetCountry: c.targetCountry,
        })),
      );
    }
  });

  test("Relevé : le palier revient à la créatrice de la VIDÉO, même quand son compte a été réassigné", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const autrice = await createCreatorSession(url, {
      name: `[E2E_TEST] Léa Fontaine-Marchetti ${ts}`,
      email: `e2e-sobre-autrice-${ts}@repackit.test`,
      password: "sobre-autrice-12345",
    });
    const reprise = await createCreatorSession(url, {
      name: `[E2E_TEST] Camille Oyelaran ${ts}`,
      email: `e2e-sobre-reprise-${ts}@repackit.test`,
      password: "sobre-reprise-12345",
    });
    const projectId = autrice.projectId;

    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Palier réassigné ${ts}`,
      montantFixe: 0,
      nbVideosCible: 1,
      tauxCPM: 0,
      bonusTiers: [
        { seuilVues: 1_850_000, rewardType: "nature", libelle: "AirPods Pro" },
      ],
    });
    for (const c of [autrice, reprise]) {
      await admin.mutation(api.creators.updateCreatorPayTerms, {
        id: c.creatorId,
        bonusPricingId: pricingId,
      });
    }

    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Format palier réassigné ${ts}`,
      type: "short",
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: autrice.creatorId,
      platform: "TikTok",
      handle: `@lea.fontaine_${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: autrice.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 5 * DAY,
      pricingId,
    });
    const assignmentId = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((a) => a.formatId === formatId && a.creatorId === autrice.creatorId)!._id;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignmentId,
      status: "to_publish",
    });
    const { publicationIds } = await autrice.client.mutation(
      api.assignments.confirmPublication,
      {
        projectId,
        id: assignmentId,
        urls: [
          {
            platform: "TikTok",
            url: `https://www.tiktok.com/@lea.fontaine_${ts}/video/7349${ts % 1_000_000}`,
          },
        ],
      },
    );

    // Le compte passe à une AUTRE créatrice APRÈS la publication. La
    // réassignation est prospective : la vidéo reste celle de l'autrice.
    await admin.mutation(api.comptes.updateCompte, {
      id: target.accountId,
      creatorId: reprise.creatorId,
    });

    await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
      secret: E2E_SECRET,
      publicationId: publicationIds[0],
      vues: 2_047_318,
      capturedAt: Date.now(),
      source: "tiktok",
    });

    const chezAutrice = await autrice.client.query(api.pricing.getMyBonusStatus, {
      projectId,
    });
    expect(chezAutrice!.natureUnlocked.map((r) => r.libelle)).toEqual([
      "AirPods Pro",
    ]);
    const chezReprise = await reprise.client.query(api.pricing.getMyBonusStatus, {
      projectId,
    });
    expect(chezReprise?.natureUnlocked ?? []).toEqual([]);
  });
});

import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const DAY = 86_400_000;

/**
 * RENTABILITÉ × CRÉATRICE SUPPRIMÉE — l'argent versé ne fond pas avec la fiche.
 *
 * La carte parcourait la table `creators` : supprimer une créatrice DÉJÀ PAYÉE
 * retirait son coût de la marge et ses vues facturées du RPM, alors que
 * l'argent était parti. À l'inverse, une créatrice supprimée AVANT paiement ne
 * sera jamais payée (#270) : son coût doit disparaître. Les deux cas sont
 * joués ici, parce qu'ils se trahissent l'un l'autre — lire les fiches
 * conservait le second et perdait le premier, lire toutes les vidéos sans le
 * drapeau de #270 conserverait les deux.
 *
 * Barème à la forme de la prod : fixe au contrat (60 $ / 30 vidéos = 2 $) et
 * CPM à décimale (2,5 $ / 1 000 vues), sur un nombre de vues non rond.
 */
async function creatriceAvecVideo(ts: number, prenom: string) {
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Rentab ${prenom} ${ts}`,
    montantFixe: 60,
    nbVideosCible: 30,
    tauxCPM: 2.5,
  });
  const formatId = (await createFormatWithRate(admin, {
    name: `[E2E_TEST] Rentab ${prenom} ${ts}`,
    type: "short",
    rateModel: { basePerPost: 0 },
  })) as Id<"formats">;
  const c = await createCreatorSession(convexUrl!, {
    name: `[E2E_TEST] ${prenom} Moreau ${ts}`,
    email: `e2e-rentab-${prenom.toLowerCase()}-${ts}@repackit.test`,
    password: `rentab-${ts}-12345`,
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: c.creatorId,
    platform: "TikTok",
    handle: `@${prenom.toLowerCase()}.moreau_${ts}`,
  });
  const r = await admin.mutation(api.assignments.assignFormat, {
    formatId,
    creatorId: c.creatorId,
    targets: [target],
    postsPerCreator: 1,
    dueDate: Date.now() + 7 * DAY,
    pricingId,
  });
  expect(r.created).toBe(1);
  const row = (await admin.query(api.assignments.listAssignments, {})).find(
    (a) => a.creatorId === c.creatorId,
  )!;
  const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
    id: row._id,
    urls: [
      {
        platform: "TikTok",
        url: `https://www.tiktok.com/@${prenom.toLowerCase()}.moreau_${ts}/video/7${ts}`,
      },
    ],
  });
  await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
    secret: E2E_SECRET,
    publicationId: (pub.publicationIds ?? [])[0] as Id<"publications">,
    vues: 47_318,
    capturedAt: Date.now(),
    source: "tiktok",
  });
  return c.creatorId;
}

// 2 $ de fixe + 47 318 vues × 2,5 $ / 1 000 = 118,295 $ de CPM.
const COUT_VIDEO = 120.3;

test.describe("Rentabilité — créatrice supprimée", () => {
  test("payée : son coût reste ; jamais payée : il disparaît", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const ancien = await admin.mutation(api.whopSync.e2eSetProjectWhop, {
      secret: E2E_SECRET,
      projectId,
      whop: { companyId: `biz_e2e_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
    });
    try {
      const total = async () => {
        const r = await admin.query(api.profitability.getProjectProfitability, {});
        expect(r.configured).toBe(true);
        return r.total;
      };
      const t0 = await total();

      // ── Payée PUIS supprimée ────────────────────────────────────────────
      const payee = await creatriceAvecVideo(ts, "Camille");
      const t1 = await total();
      // Présence d'abord : sans elle, « le coût ne bouge pas » ne prouverait rien.
      expect(t1.creatorCost - t0.creatorCost).toBeCloseTo(COUT_VIDEO, 1);
      expect(t1.paidViews - t0.paidViews).toBe(47_318);

      await admin.mutation(api.payments.markCyclePaid, {
        creatorId: payee,
        cycleIndex: 0,
      });
      await admin.mutation(api.creators.deleteCreator, { id: payee });
      const t2 = await total();
      expect(t2.creatorCost).toBeCloseTo(t1.creatorCost, 2);
      expect(t2.paidViews).toBe(t1.paidViews);

      // ── Jamais payée, supprimée ─────────────────────────────────────────
      const jamais = await creatriceAvecVideo(ts, "Ines");
      const t3 = await total();
      expect(t3.creatorCost - t2.creatorCost).toBeCloseTo(COUT_VIDEO, 1);

      await admin.mutation(api.creators.deleteCreator, { id: jamais });
      const t4 = await total();
      expect(t4.creatorCost).toBeCloseTo(t2.creatorCost, 2);
      expect(t4.paidViews).toBe(t2.paidViews);
    } finally {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        ...(ancien ? { whop: ancien } : {}),
      });
    }
  });
});

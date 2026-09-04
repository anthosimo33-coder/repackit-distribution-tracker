import { test, expect } from "./fixtures/auth-fixture";
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
 * Pricing — nouveau calcul de paie, bout en bout (serveur, sans UI fragile).
 * Cas chiffré aligné sur les tests unitaires du moteur : pricing 100$/60 vidéos,
 * CPM 2$/1000, seuil 100k → bonus 50$. 1 vidéo publiée à 120 000 vues →
 * fixe 1,67$ + CPM 240$ + bonus 50$ = 291,67$. Vérifie aussi : snapshot figé
 * (modifier le pricing ne change pas la vidéo attribuée) + suppression bloquée
 * d'un pricing utilisé.
 */
test.describe("Pricing — calcul de paie (fixe + CPM + bonus, snapshot)", () => {
  test("attribution → publication → breakdown chiffré + snapshot + delete-guard", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Pricing ${ts}`,
      email: `e2e-creator-pricing-${ts}@repackit.test`,
      password: "creator-pricing-12345",
    });
    const projectId = creator.projectId;

    // 1. Pricing 100$/60, CPM 2$/1000, seuil 100k → bonus 50$.
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Pricing ${ts}`,
      montantFixe: 100,
      nbVideosCible: 60,
      tauxCPM: 2,
    });

    // 2. Format + cible dispo + attribution AVEC pricing (snapshot figé).
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Format Pricing ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2epricing${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 5 * DAY,
      pricingId,
    });
    const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.formatId === formatId && a.creatorId === creator.creatorId,
    );
    expect(mine.length).toBe(1);
    const assignmentId = mine[0]._id;

    // 3. → to_publish (raccourci e2e), puis le créateur publie (matérialise la
    //    publication + crée la row de paiement, SANS lineItem legacy).
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignmentId,
      status: "to_publish",
    });
    const { publicationIds } = await creator.client.mutation(
      api.assignments.confirmPublication,
      {
        projectId,
        id: assignmentId,
        urls: [
          { platform: "TikTok", url: `https://www.tiktok.com/@e2epricing${ts}/video/7300000000000${ts % 1000}` },
        ],
      },
    );
    // Pose des vues sur la publication matérialisée (→ vuesLatest, pour le CPM).
    expect(publicationIds.length).toBeGreaterThan(0);
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: publicationIds[0],
      capturedAt: Date.now(),
      vues: 120_000,
      likes: 5_000,
    });

    // 4. Breakdown chiffré côté créateur — PLAFOND 150 $/vidéo (global tous
    //    projets). Brut : fixe 1,67 + CPM 240 = 241,67 > 150 → la vidéo est capée :
    //    le CPM est rogné (240 → 148,33) pour un total de 150.
    // Cycle J+30 : la vidéo publiée « maintenant » tombe dans le cycle 0 du
    // créateur (ancre = son 1er post) — remplace l'ex-« période du mois » YYYY-MM.
    const payments = await creator.client.query(api.payments.getMyPayments, {
      projectId,
    });
    const cur = payments.find((p) => p.cycleIndex === 0);
    expect(cur).toBeTruthy();
    // v2 : fixe + CPM (le bonus par vidéo de v1 est retiré ; les paliers cumulés
    // sont testés dans pricing-bonus-tiers.spec). Le fixe (1,67 < 150) est gardé,
    // le CPM absorbe le plafond → 148,33 ; total plafonné à 150.
    expect(cur!.pricingBreakdown.fixedTotal).toBe(1.67);
    expect(cur!.pricingBreakdown.cpmTotal).toBe(148.33);
    expect(cur!.pricingBreakdown.bonusTierCashTotal).toBe(0);
    expect(cur!.pricingBreakdown.total).toBe(150);

    // 5. SNAPSHOT FIGÉ : modifier le pricing (montantFixe 200) ne change PAS la
    //    vidéo déjà attribuée → le fixe reste 1,67 (100/60), pas 3,33 (200/60).
    await admin.mutation(api.pricing.updatePricing, {
      id: pricingId,
      name: `[E2E_TEST] Pricing ${ts}`,
      montantFixe: 200,
      nbVideosCible: 60,
      tauxCPM: 2,
    });
    const after = (
      await creator.client.query(api.payments.getMyPayments, { projectId })
    ).find((p) => p.cycleIndex === 0);
    expect(after!.pricingBreakdown.fixedTotal).toBe(1.67);

    // 6. Suppression d'un pricing UTILISÉ → bloquée.
    let delErr = "";
    try {
      await admin.mutation(api.pricing.deletePricing, { id: pricingId });
    } catch (e) {
      delErr = e instanceof Error ? e.message : String(e);
    }
    expect(delErr).toMatch(/attribué|archive/i);

    // Cleanup (les snapshots/pubs/payments démo partent avec l'assignment).
    await admin.mutation(api.assignments.cleanupTestAssignments, {
      secret: E2E_SECRET,
    });
    await admin.mutation(api.payments.cleanupTestPayments, { secret: E2E_SECRET });
    await admin.mutation(api.creators.cleanupTestCreators, { secret: E2E_SECRET });
    await admin.mutation(api.pricing.cleanupTestPricings, { secret: E2E_SECRET });
  });
});

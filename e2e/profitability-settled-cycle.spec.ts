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
 * CE QUI EST PAYÉ NE BOUGE PLUS — Rentabilité.
 *
 * La carte re-simulait le moteur à chaque affichage, sans jamais regarder le
 * grand livre : une vidéo continuait d'ajouter du CPM et des vues facturées au
 * mois de sa publication APRÈS le règlement de son cycle. Mesuré en prod le
 * 22/09/2026 : un cycle réglé 1 074,57 $ le 16/09 valait ~46 $ de plus six jours
 * plus tard, et le RPM d'août baissait tout seul — de l'argent dû à personne,
 * puisqu'une vidéo n'appartient qu'au cycle de sa PUBLICATION.
 *
 * Le test tient les DEUX bords : les vues bougent tant que le cycle est ouvert,
 * elles cessent au versement, et elles repartent si on annule le paiement. Sans
 * le premier et le dernier, « ça ne bouge pas » se vérifierait aussi sur une
 * carte cassée qui ne bouge jamais.
 */
test.describe("Rentabilité — cycle réglé", () => {
  test("une vidéo payée cesse de peser sur le coût et sur le RPM", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const ancien = await admin.mutation(api.whopSync.e2eSetProjectWhop, {
      secret: E2E_SECRET,
      projectId,
      whop: {
        companyId: `biz_e2e_${ts}`,
        apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE",
      },
    });
    try {
      // Barème à fixe NUL : le coût est alors purement le CPM, donc lisible à
      // l'œil (2 $/1 000 vues). Le plafond de 150 $/vidéo tombe à 75 000 vues —
      // les paliers du test restent dessous, sinon c'est LUI qui figerait les
      // vues et le test ne prouverait plus rien.
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        name: `[E2E_TEST] Cycle réglé ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 2,
      });
      const formatId = (await createFormatWithRate(admin, {
        name: `[E2E_TEST] Cycle réglé ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      })) as Id<"formats">;
      const c = await createCreatorSession(convexUrl!, {
        name: `[E2E_TEST] Nora Vidal ${ts}`,
        email: `e2e-settled-${ts}@repackit.test`,
        password: `settled-${ts}-12345`,
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: c.creatorId,
        platform: "TikTok",
        handle: `@nora.vidal_${ts}`,
      });

      const rentab = async () => {
        const d = await admin.query(api.profitability.getProjectProfitability, {});
        const mois = d.months.find((m) => m.period === d.currentPeriod);
        return {
          cost: d.total.creatorCost,
          views: d.total.paidViews,
          settled: mois?.settled ?? null,
        };
      };
      const base = await rentab();

      await admin.mutation(api.assignments.assignFormat, {
        formatId,
        creatorId: c.creatorId,
        targets: [target],
        postsPerCreator: 1,
        dueDate: Date.now() + 7 * DAY,
        pricingId,
      });
      const row = (await admin.query(api.assignments.listAssignments, {})).find(
        (a) => a.creatorId === c.creatorId && a.status !== "published",
      )!;
      const pub = await admin.mutation(
        api.assignments.confirmPublicationAsAdmin,
        {
          id: row._id,
          urls: [
            { platform: "TikTok", url: `https://www.tiktok.com/@nora.vidal_${ts}/video/71${ts}` },
          ],
        },
      );
      const publicationId = (pub.publicationIds ?? [])[0] as Id<"publications">;
      const releve = async (vues: number) =>
        admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
          secret: E2E_SECRET,
          publicationId,
          vues,
          capturedAt: Date.now(),
          source: "tiktok",
        });

      await releve(10_000);
      const t1 = await rentab();
      expect(t1.views - base.views).toBe(10_000);
      expect(t1.cost - base.cost).toBeCloseTo(20, 2);

      // ── PRÉSENCE : tant que le cycle est OUVERT, les vues pèsent ───────────
      await releve(30_000);
      const t2 = await rentab();
      expect(t2.views - base.views).toBe(30_000);
      expect(t2.cost - base.cost).toBeCloseTo(60, 2);

      // ── Le cycle est RÉGLÉ ────────────────────────────────────────────────
      const cycle = await admin.query(api.payments.getCreatorCurrentCycle, {
        creatorId: c.creatorId,
      });
      await admin.mutation(api.payments.markCyclePaid, {
        creatorId: c.creatorId,
        cycleIndex: cycle!.cycleIndex,
      });

      // ── ABSENCE : les vues d'après le versement ne comptent plus ───────────
      await releve(60_000);
      const t3 = await rentab();
      expect(t3.views - base.views).toBe(30_000);
      expect(t3.cost - base.cost).toBeCloseTo(60, 2);
      // Le mois EN COURS n'est jamais annoncé « réglé » : il reste ouvert aux
      // vidéos à venir, même si tout ce qu'il porte aujourd'hui est payé.
      expect(t3.settled).toBe(false);

      // ── PRÉSENCE : l'annulation du paiement rend la vidéo au calcul live ──
      const paye = (await admin.query(api.payments.listPayments, {})).find(
        (p) => p.creatorId === c.creatorId && p.status === "paid",
      )!;
      await admin.mutation(api.payments.revertCyclePayment, {
        id: paye.paymentId!,
      });
      const t4 = await rentab();
      expect(t4.views - base.views).toBe(60_000);
      expect(t4.cost - base.cost).toBeCloseTo(120, 2);
    } finally {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        ...(ancien ? { whop: ancien } : {}),
      });
    }
  });

  test("un mois dont les fenêtres sont closes se cadenasse, même impayé", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const ancien = await admin.mutation(api.whopSync.e2eSetProjectWhop, {
      secret: E2E_SECRET,
      projectId,
      whop: {
        companyId: `biz_e2e_fige_${ts}`,
        apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE",
      },
    });
    try {
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        name: `[E2E_TEST] Mois figé ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 2,
      });
      const formatId = (await createFormatWithRate(admin, {
        name: `[E2E_TEST] Mois figé ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      })) as Id<"formats">;

      /**
       * Publie une vidéo À UNE DATE PASSÉE et la relève à `releveA`. Deux mois
       * très anciens (−200 j, −260 j) : leurs fenêtres J+30 sont closes depuis
       * des mois, et aucun autre spec ne va semer là-bas.
       */
      const videoDatee = async (ilYA: number, releveA: number, vues: number) => {
        const publieeLe = ts - ilYA * DAY;
        const c = await createCreatorSession(convexUrl!, {
          name: `[E2E_TEST] Alix Mercier ${ilYA}-${ts}`,
          email: `e2e-fige-${ilYA}-${ts}@repackit.test`,
          password: `fige-${ilYA}-${ts}-12345`,
        });
        const target = await availableTarget({
          e2eClient: admin,
          creatorId: c.creatorId,
          platform: "TikTok",
          handle: `@alix.mercier_${ilYA}_${ts}`,
        });
        await admin.mutation(api.assignments.assignFormat, {
          formatId,
          creatorId: c.creatorId,
          targets: [target],
          postsPerCreator: 1,
          dueDate: ts + 7 * DAY,
          pricingId,
        });
        const row = (await admin.query(api.assignments.listAssignments, {})).find(
          (a) => a.creatorId === c.creatorId && a.status !== "published",
        )!;
        const pub = await admin.mutation(
          api.assignments.confirmPublicationAsAdmin,
          {
            id: row._id,
            urls: [
              {
                platform: "TikTok",
                url: `https://www.tiktok.com/@alix.mercier_${ilYA}_${ts}/video/7${ilYA}${ts}`,
              },
            ],
            publishedAt: publieeLe,
            allowBackdate: true,
          },
        );
        await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
          secret: E2E_SECRET,
          publicationId: (pub.publicationIds ?? [])[0] as Id<"publications">,
          vues,
          capturedAt: releveA,
          source: "tiktok",
        });
        return publieeLe;
      };

      const moisDe = (at: number) =>
        new Intl.DateTimeFormat("fr-CA", {
          timeZone: "Europe/Paris",
          year: "numeric",
          month: "2-digit",
        }).format(new Date(at));
      const moisRendu = async (period: string) =>
        (
          await admin.query(api.profitability.getProjectProfitability, {})
        ).months.find((m) => m.period === period);

      // ── PRÉSENCE : relevée DANS sa fenêtre, donc assiette définitive ───────
      const figee = await videoDatee(200, ts - 195 * DAY, 41_800);
      const moisFige = await moisRendu(moisDe(figee));
      expect(moisFige?.paidViews).toBe(41_800);
      expect(moisFige?.settled).toBe(true);

      // ── ABSENCE : fenêtre close mais JAMAIS relevée dedans (lien collé des
      // semaines après). On retient ses vues mesurées, qui montent encore
      // jusqu'à J+90 : ce mois-là ne peut pas être annoncé figé.
      const flottante = await videoDatee(260, ts, 12_400);
      const moisOuvert = await moisRendu(moisDe(flottante));
      expect(moisOuvert?.paidViews).toBe(12_400);
      expect(moisOuvert?.settled).toBe(false);
    } finally {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        ...(ancien ? { whop: ancien } : {}),
      });
    }
  });
});

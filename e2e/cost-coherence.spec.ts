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
 * UN SEUL COÛT PAR VIDÉO — Rentabilité, Vue d'ensemble et onglet Pays.
 *
 * La Vue d'ensemble facturait le fixe du CONTRAT à chaque vidéo, budget ignoré :
 * sur la prod du 2026-09-19, 76 vidéos de Kelly au-delà de son budget d'août
 * coûtaient 126,92 $ de plus dans Analytics que dans la Rentabilité. Ici, un
 * contrat de 45 $ pour UNE vidéo, et DEUX vidéos publiées : la seconde ne coûte
 * que son CPM. Les trois écrans doivent dire le même montant.
 */
async function video(
  creatorId: Id<"creators">,
  target: { platform: "TikTok" | "Instagram" | "YouTube"; accountId: Id<"comptes"> },
  formatId: Id<"formats">,
  pricingId: Id<"pricings">,
  url: string,
  vues: number,
  /** Publication ANTIDATÉE — une vidéo d'un mois révolu. */
  publishedAt?: number,
) {
  await admin.mutation(api.assignments.assignFormat, {
    formatId,
    creatorId,
    targets: [target],
    postsPerCreator: 1,
    dueDate: Date.now() + 7 * DAY,
    pricingId,
  });
  const row = (await admin.query(api.assignments.listAssignments, {})).find(
    (a) => a.creatorId === creatorId && a.status !== "published",
  )!;
  const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
    id: row._id,
    urls: [{ platform: "TikTok", url }],
    ...(publishedAt !== undefined ? { publishedAt, allowBackdate: true } : {}),
  });
  const publicationId = (pub.publicationIds ?? [])[0] as Id<"publications">;
  await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
    secret: E2E_SECRET,
    publicationId,
    vues,
    capturedAt: Date.now(),
    source: "tiktok",
  });
  return { id: row._id, publicationId };
}

test.describe("Coût d'une vidéo — le même sur tous les écrans", () => {
  test("au-delà du budget du contrat, la vidéo ne coûte que son CPM, partout", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const ancien = await admin.mutation(api.whopSync.e2eSetProjectWhop, {
      secret: E2E_SECRET,
      projectId,
      whop: { companyId: `biz_e2e_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
    });
    try {
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        name: `[E2E_TEST] Budget ${ts}`,
        montantFixe: 45,
        nbVideosCible: 1,
        tauxCPM: 1.5,
      });
      const formatId = (await createFormatWithRate(admin, {
        name: `[E2E_TEST] Budget ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      })) as Id<"formats">;
      const c = await createCreatorSession(convexUrl!, {
        name: `[E2E_TEST] Léa Fontaine ${ts}`,
        email: `e2e-budget-${ts}@repackit.test`,
        password: `budget-${ts}-12345`,
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: c.creatorId,
        platform: "TikTok",
        handle: `@lea.fontaine_${ts}`,
      });
      await admin.mutation(api.comptes.updateCompte, {
        id: target.accountId,
        targetCountry: "BE",
      });

      const coutRentab = async () =>
        (await admin.query(api.profitability.getProjectProfitability, {})).total
          .creatorCost;
      const coutsAnalytics = async () =>
        new Map(
          (await admin.query(api.analyticsHub.getAttribution, {})).rows.map(
            (r) => [r.assignmentId as string, r.cost],
          ),
        );
      const belgique = async () =>
        (await admin.query(api.marketPnl.getMarketPnl, {})).rows.find(
          (r) => r.country === "BE",
        );
      const coutPays = async () => (await belgique())?.cost ?? 0;

      const r0 = await coutRentab();
      const p0 = await coutPays();
      const { id: v1 } = await video(c.creatorId, target, formatId, pricingId,
        `https://www.tiktok.com/@lea.fontaine_${ts}/video/71${ts}`, 12_437);
      const { id: v2 } = await video(c.creatorId, target, formatId, pricingId,
        `https://www.tiktok.com/@lea.fontaine_${ts}/video/72${ts}`, 8_906);

      // Paie : 45 $ de fixe (UNE fois) + 12 437 et 8 906 vues à 1,5 $/1 000.
      const attendu = 45 + (12_437 * 1.5) / 1000 + (8_906 * 1.5) / 1000;
      expect((await coutRentab()) - r0).toBeCloseTo(attendu, 1);

      const a = await coutsAnalytics();
      // Présence : la vidéo DANS le budget porte bien le fixe…
      expect(a.get(v1 as string)!).toBeCloseTo(45 + (12_437 * 1.5) / 1000, 1);
      // …et celle au-delà n'a plus que son CPM : 13,36 $, pas 58,36 $.
      expect(a.get(v2 as string)!).toBeCloseTo((8_906 * 1.5) / 1000, 1);
      expect(a.get(v1 as string)! + a.get(v2 as string)!).toBeCloseTo(attendu, 1);

      expect((await coutPays()) - p0).toBeCloseTo(attendu, 1);

      // ── Vidéo RETIRÉE de la paie : 0 $, mais ses vues promo restent ────────
      // L'onglet Pays sautait toute vidéo à coût nul AVANT de compter ses vues :
      // 402 323 vues promo manquaient à ses marchés (prod du 2026-09-19).
      const vuesAvant = (await belgique())?.promoViews ?? 0;
      const coutAvant = await coutPays();
      const v3 = await video(c.creatorId, target, formatId, pricingId,
        `https://www.tiktok.com/@lea.fontaine_${ts}/video/73${ts}`, 5_309);
      await admin.mutation(api.publications.setPublicationRemuneration, {
        publicationId: v3.publicationId,
        remunere: false,
      });
      expect((await coutsAnalytics()).get(v3.id as string)).toBe(0);
      expect(await coutPays()).toBeCloseTo(coutAvant, 2);
      expect(((await belgique())?.promoViews ?? 0) - vuesAvant).toBe(5_309);
    } finally {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        ...(ancien ? { whop: ancien } : {}),
      });
    }
  });

  test("un cycle payé dont les vues montent ensuite garde le même coût dans l'onglet Pays et dans la Rentabilité", async () => {
    // Septembre 2026 coûtait 2 297,68 $ dans l'onglet Pays et 2 255,80 $ dans la
    // Rentabilité (prod du 2026-10-15) : l'onglet Pays recalculait le CPM des
    // vidéos déjà payées avec les vues du jour, la Rentabilité reprenait
    // l'assiette du versement. Barème à fixe nul : le coût est le CPM seul,
    // 1,85 $/1 000 vues — plafond de 150 $ à 81 081 vues, les relevés restent
    // dessous (sinon c'est LUI qui figerait le coût).
    test.setTimeout(180_000);
    const ts = Date.now() + 3;
    const projectId = await admin.getProjectId();
    const ancien = await admin.mutation(api.whopSync.e2eSetProjectWhop, {
      secret: E2E_SECRET,
      projectId,
      whop: { companyId: `biz_e2e_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
    });
    try {
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        name: `[E2E_TEST] Cycle payé ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 1.85,
      });
      const formatId = (await createFormatWithRate(admin, {
        name: `[E2E_TEST] Cycle payé ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      })) as Id<"formats">;
      const c = await createCreatorSession(convexUrl!, {
        name: `[E2E_TEST] Maëlle Lefèvre ${ts}`,
        email: `e2e-cycle-paye-${ts}@repackit.test`,
        password: `cycle-paye-${ts}-12345`,
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: c.creatorId,
        platform: "TikTok",
        handle: `@maelle.lefevre_${ts}`,
      });
      // Un marché que le reste de la suite ne touche pas : la ligne ne porte
      // que la créatrice de ce test (lue en écart, la base e2e est partagée).
      await admin.mutation(api.comptes.updateCompte, {
        id: target.accountId,
        targetCountry: "EE",
      });
      const rentab = async () =>
        (await admin.query(api.profitability.getProjectProfitability, {})).total
          .creatorCost;
      const estonie = async () =>
        (
          await admin.query(api.marketPnl.getMarketPnl, {
            from: ts - DAY,
            to: Date.now() + DAY,
          })
        ).rows.find((r) => r.country === "EE")?.cost ?? 0;
      const cpm = (vues: number) => (vues * 1.85) / 1000;
      const r0 = await rentab();
      const p0 = await estonie();

      const { publicationId } = await video(c.creatorId, target, formatId, pricingId,
        `https://www.tiktok.com/@maelle.lefevre_${ts}/video/76${ts}`, 23_417);
      const releve = (vues: number) =>
        admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
          secret: E2E_SECRET,
          publicationId,
          vues,
          capturedAt: Date.now(),
          source: "tiktok",
        });

      // ── PRÉSENCE : cycle OUVERT, les vues pèsent sur les deux écrans ───────
      expect((await rentab()) - r0).toBeCloseTo(cpm(23_417), 2);
      expect((await estonie()) - p0).toBeCloseTo(cpm(23_417), 2);
      await releve(31_862);
      expect((await rentab()) - r0).toBeCloseTo(cpm(31_862), 2);
      expect((await estonie()) - p0).toBeCloseTo(cpm(31_862), 2);

      // ── Le cycle est PAYÉ, puis la vidéo prend encore des vues ─────────────
      const cycle = await admin.query(api.payments.getCreatorCurrentCycle, {
        creatorId: c.creatorId,
      });
      await admin.mutation(api.payments.markCyclePaid, {
        creatorId: c.creatorId,
        cycleIndex: cycle!.cycleIndex,
      });
      await releve(58_209);

      // ── ABSENCE : les vues d'après le versement ne coûtent rien, ni à la
      // Rentabilité (déjà le cas) ni à l'onglet Pays (le défaut) ─────────────
      expect((await rentab()) - r0).toBeCloseTo(cpm(31_862), 2);
      expect((await estonie()) - p0).toBeCloseTo(cpm(31_862), 2);

      // ── PRÉSENCE : l'annulation du paiement rend la vidéo au calcul live,
      // sur les deux écrans — sans ce bord, « ça ne bouge pas » se vérifierait
      // aussi sur un onglet qui ne bouge jamais ─────────────────────────────
      const paye = (await admin.query(api.payments.listPayments, {})).find(
        (p) => p.creatorId === c.creatorId && p.status === "paid",
      )!;
      await admin.mutation(api.payments.revertCyclePayment, { id: paye.paymentId! });
      expect((await rentab()) - r0).toBeCloseTo(cpm(58_209), 2);
      expect((await estonie()) - p0).toBeCloseTo(cpm(58_209), 2);
    } finally {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        ...(ancien ? { whop: ancien } : {}),
      });
    }
  });

  test("un palier débloqué ce mois-ci pèse dans la Rentabilité comme dans Analytics", async () => {
    // Le mois EN COURS prenait le coût ENGAGÉ, qui ne porte que fixe + CPM : les
    // 200 $ de bonus de septembre 2026 manquaient à la marge. Barème à fixe et CPM
    // nuls pour isoler le palier. (Un palier est rangé sous son mois UTC : ce
    // test peut se tromper de mois dans les 2 h qui précèdent minuit Paris un
    // dernier jour du mois — résidu connu, cf profitability.creatorCostByMonth.)
    test.setTimeout(180_000);
    const ts = Date.now() + 1;
    const projectId = await admin.getProjectId();
    const ancien = await admin.mutation(api.whopSync.e2eSetProjectWhop, {
      secret: E2E_SECRET,
      projectId,
      whop: { companyId: `biz_e2e_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
    });
    try {
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        name: `[E2E_TEST] Palier ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 0,
        bonusTiers: [{ seuilVues: 60_000, rewardType: "cash", montant: 187.5 }],
      });
      const formatId = (await createFormatWithRate(admin, {
        name: `[E2E_TEST] Palier ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      })) as Id<"formats">;
      const c = await createCreatorSession(convexUrl!, {
        name: `[E2E_TEST] Nora Benali ${ts}`,
        email: `e2e-palier-${ts}@repackit.test`,
        password: `palier-${ts}-12345`,
      });
      await admin.mutation(api.creators.updateCreatorPayTerms, {
        id: c.creatorId,
        bonusPricingId: pricingId,
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: c.creatorId,
        platform: "TikTok",
        handle: `@nora.benali_${ts}`,
      });
      // Un marché que le reste de la spec ne touche pas : la ligne ne porte que
      // la créatrice de ce test (lue en écart, la base e2e est partagée).
      await admin.mutation(api.comptes.updateCompte, {
        id: target.accountId,
        targetCountry: "LU",
      });
      const rentab = async () =>
        (await admin.query(api.profitability.getProjectProfitability, {})).total
          .creatorCost;
      const analytics = async () =>
        (await admin.query(api.analyticsHub.getAttribution, {})).costs;
      const luxembourg = async () =>
        (
          await admin.query(api.marketPnl.getMarketPnl, {
            from: ts - DAY,
            to: Date.now() + DAY,
          })
        ).rows.find((r) => r.country === "LU");
      const r0 = await rentab();
      const a0 = await analytics();
      const p0 = await luxembourg();

      await video(c.creatorId, target, formatId, pricingId,
        `https://www.tiktok.com/@nora.benali_${ts}/video/74${ts}`, 63_418);

      // Présence : le palier est bien débloqué, et Analytics le compte…
      const a1 = await analytics();
      // …dans le bonus qui nourrit le coût PROMO complet (RPM promo, coût
      // d'acquisition) — lu sur `bonusTotal`, jamais nul : `promoBonus` passe à
      // null dès qu'UNE vidéo promo du projet a un coût inconnu, ce que la base
      // e2e partagée finit par contenir (écart lu 0 − 0 en CI)…
      expect(a1.bonusTotal - a0.bonusTotal).toBeCloseTo(187.5, 2);
      expect(a1.total - a0.total).toBeCloseTo(187.5, 2);
      // …la Rentabilité aussi…
      expect((await rentab()) - r0).toBeCloseTo(187.5, 2);
      // …et l'onglet Pays, sur le marché de son compte. Il en était EXCLU : la
      // vidéo ne coûte rien par le fixe/CPM, son coût / 1 000 vues affichait 0.
      const p1 = await luxembourg();
      expect((p1?.cost ?? 0) - (p0?.cost ?? 0)).toBeCloseTo(187.5, 2);
      expect((p1?.promoCost ?? 0) - (p0?.promoCost ?? 0)).toBeCloseTo(187.5, 2);
      const nora = p1?.creatorsDetail.find(
        (d) => d.name === `[E2E_TEST] Nora Benali ${ts}`,
      );
      expect(nora?.promoCost).toBeCloseTo(187.5, 2);
      expect(nora?.promoViews).toBe(63_418);
    } finally {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        ...(ancien ? { whop: ancien } : {}),
      });
    }
  });

  test("un palier débloqué un mois SANS publication compte partout", async () => {
    // La vidéo date du mois dernier, ses vues franchissent le palier aujourd'hui :
    // le palier est rattaché au mois EN COURS, où la créatrice n'a rien publié.
    // La Vue d'ensemble ne lisait que les mois qui ont des vidéos (le palier
    // sortait du coût d'acquisition et du RPM coût) ; l'onglet Pays sautait la
    // créatrice faute de publication dans la période. La Rentabilité, elle, le
    // comptait déjà : c'est la référence.
    test.setTimeout(180_000);
    const ts = Date.now() + 2;
    const projectId = await admin.getProjectId();
    const ancien = await admin.mutation(api.whopSync.e2eSetProjectWhop, {
      secret: E2E_SECRET,
      projectId,
      whop: { companyId: `biz_e2e_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
    });
    try {
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        name: `[E2E_TEST] Palier tardif ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 0,
        bonusTiers: [{ seuilVues: 60_000, rewardType: "cash", montant: 212.4 }],
      });
      const formatId = (await createFormatWithRate(admin, {
        name: `[E2E_TEST] Palier tardif ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      })) as Id<"formats">;
      const c = await createCreatorSession(convexUrl!, {
        name: `[E2E_TEST] Inès Morel ${ts}`,
        email: `e2e-palier-tardif-${ts}@repackit.test`,
        password: `palier-tardif-${ts}-12345`,
      });
      await admin.mutation(api.creators.updateCreatorPayTerms, {
        id: c.creatorId,
        bonusPricingId: pricingId,
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: c.creatorId,
        platform: "TikTok",
        handle: `@ines.morel_${ts}`,
      });
      await admin.mutation(api.comptes.updateCompte, {
        id: target.accountId,
        targetCountry: "CY",
      });
      const rentab = async () =>
        (await admin.query(api.profitability.getProjectProfitability, {})).total
          .creatorCost;
      const analytics = async () =>
        (await admin.query(api.analyticsHub.getAttribution, {})).costs;
      // Période = les 7 derniers jours : la vidéo (40 jours) en est HORS, le
      // palier (aujourd'hui) DEDANS.
      const chypre = async () =>
        (
          await admin.query(api.marketPnl.getMarketPnl, {
            from: ts - 7 * DAY,
            to: Date.now() + DAY,
          })
        ).rows.find((r) => r.country === "CY");
      const r0 = await rentab();
      const a0 = await analytics();
      const p0 = await chypre();

      await video(c.creatorId, target, formatId, pricingId,
        `https://www.tiktok.com/@ines.morel_${ts}/video/75${ts}`, 61_907,
        ts - 40 * DAY);

      expect((await rentab()) - r0).toBeCloseTo(212.4, 2);
      const a1 = await analytics();
      // `bonusTotal` et non `promoBonus` (cf le test précédent).
      expect(a1.bonusTotal - a0.bonusTotal).toBeCloseTo(212.4, 2);
      expect(a1.total - a0.total).toBeCloseTo(212.4, 2);
      const p1 = await chypre();
      expect((p1?.promoCost ?? 0) - (p0?.promoCost ?? 0)).toBeCloseTo(212.4, 2);
      // La vidéo est hors période : ni vue ni vidéo de plus, seulement la prime.
      expect((p1?.promoViews ?? 0) - (p0?.promoViews ?? 0)).toBe(0);
      const ines = p1?.creatorsDetail.find(
        (d) => d.name === `[E2E_TEST] Inès Morel ${ts}`,
      );
      expect(ines?.promoCost).toBeCloseTo(212.4, 2);
      expect(ines?.videos).toBe(0);
    } finally {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        ...(ancien ? { whop: ancien } : {}),
      });
    }
  });
});

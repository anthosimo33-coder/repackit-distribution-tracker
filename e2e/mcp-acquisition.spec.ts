import { ConvexHttpClient } from "convex/browser";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { parisDayKey } from "../convex/viewsDaily";
import { shiftDay } from "../convex/analyticsDates";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const MIN = 60_000;
const DAY = 86_400_000;

async function outil(url: string, token: string, args: Record<string, unknown>) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "acquisition", arguments: args } }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError === true, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text);
}

type Efficacite = { createatrice: string; videosPromo: number; vuesMedianes: number | null; videosAuDessusDe50k: number; vuesPromo: number };
type JourSolo = { jour: string; createatrice?: string; createatrices?: number; vuesPromo: number; visiteurs?: number; inscrits?: number; clients?: number; attribuable?: boolean };

/**
 * Outil MCP `acquisition` — l'onglet Acquisition (efficacité par créatrice,
 * jours solo, compteurs de vues, récompenses en nature) par les MÊMES calculs,
 * plus la conversion par créatrice du dashboard.
 *
 * Deux créatrices, quatre vidéos promo placées à des jours précis :
 *   Inès : J-5 (81 234 vues, seule ce jour-là) et J-3 (21 470) ;
 *   Léa  : J-3 (55 310, avec Inès — non attribuable) et J-12 (9 870).
 * Sur J-10 → J-1, Léa n'a qu'UNE vidéo ; sur la période de l'écran (30 jours),
 * elle en a deux. Paliers en nature hors de portée (250 000 et 1 000 000 vues) :
 * rien de dû, tout engagé, et la plus proche est Inès (102 704 vues).
 */
test.describe("Outil MCP acquisition", () => {
  test("efficacité et jours solo sur la période, compteurs, nature, conversion par ref", async ({ page }) => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const slug = `e2e-mcp-acq-${ts}`;
    const nom = `E2E MCP Acquisition ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };
    const jourDe = (joursAvant: number) => parisDayKey(ts - joursAvant * DAY);
    const refInes = `inesm${ts}`;

    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_acq_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: 0.86,
      });

      // ── Whop : une vente venue du lien d'Inès, une sans source ─────────────
      await admin.mutation(api.whopSync.e2eSeedWhopMembership, {
        secret: E2E_SECRET,
        projectId,
        whopMembershipId: `mem_e2e_acq_${ts}_ref`,
        ref: refInes,
        createdAt: ts - 4 * DAY,
      });
      await admin.mutation(api.whopSync.e2eSeedWhopMembership, {
        secret: E2E_SECRET,
        projectId,
        whopMembershipId: `mem_e2e_acq_${ts}_sans`,
        createdAt: ts - 2 * DAY,
      });
      await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
        secret: E2E_SECRET,
        projectId,
        payments: [
          ["ref", 4, 19.99, 18.37],
          ["sans", 2, 7.99, 7.24],
        ].map(([n, jours, brut, net]) => ({
          whopId: `pay_e2e_acq_${ts}_${n}`,
          status: "paid" as const,
          rawStatus: "paid",
          currency: "eur",
          grossAmount: brut as number,
          feeAmount: Math.round(((brut as number) - (net as number)) * 100) / 100,
          netAmount: net as number,
          refundedAmount: 0,
          paidAt: ts - (jours as number) * DAY,
          planId: "plan_mois",
          membershipId: `mem_e2e_acq_${ts}_${n}`,
          billingReason: "subscription_create",
        })),
      });

      // ── Barème : CPM 2 $, deux paliers en nature hors de portée ────────────
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] MCP Acq ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 2,
        bonusTiers: [
          { seuilVues: 250_000, rewardType: "nature", libelle: "AirPods Pro", coutReel: 189 },
          { seuilVues: 1_000_000, rewardType: "nature", libelle: "iPhone 17", coutReel: 1_129 },
        ],
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] MCP Acq ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });

      const creatrice = async (prenomNom: string, handle: string, videos: [number, number][]) => {
        const email = `e2e-mcp-acq-${handle}-${ts}@repackit.test`;
        const nomComplet = `[E2E_TEST] ${prenomNom} ${ts}`;
        const { creatorId, token: invite } = await admin.mutation(api.creators.inviteCreator, {
          projectId,
          name: nomComplet,
          email,
        });
        await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
          provider: "password",
          params: { email, password: `acq-${ts}-12345`, flow: "signUp", inviteToken: invite },
        });
        await admin.mutation(api.creators.updateCreatorPayTerms, { projectId, id: creatorId, bonusPricingId: pricingId });
        const target = await availableTarget({
          e2eClient: admin,
          creatorId,
          platform: "TikTok",
          handle: `@${handle}_${ts}`,
        });
        await admin.mutation(api.assignments.assignFormat, {
          projectId,
          formatId,
          creatorId,
          targets: [target],
          postsPerCreator: videos.length,
          dueDate: ts + 7 * DAY,
          pricingId,
        });
        const lignes = (await admin.query(api.assignments.listAssignments, { projectId })).filter(
          (a) => a.creatorId === creatorId,
        );
        expect(lignes).toHaveLength(videos.length);
        for (const [i, [joursAvant, vues]] of videos.entries()) {
          const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
            projectId,
            id: lignes[i]._id,
            urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@${handle}_${ts}/video/74${ts}${i}` }],
            publishedAt: ts - joursAvant * DAY,
            allowBackdate: true,
          });
          await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
            secret: E2E_SECRET,
            publicationId: (pub.publicationIds ?? [])[0] as Id<"publications">,
            vues,
            capturedAt: Date.now(),
            source: "tiktok",
          });
        }
        return { creatorId, nom: nomComplet };
      };
      const ines = await creatrice("Inès Moreau", "ines.moreau", [[5, 81_234], [3, 21_470]]);
      const lea = await creatrice("Léa Fontaine", "lea.fontaine", [[3, 55_310], [12, 9_870]]);
      await admin.mutation(api.creators.updateCreator, { projectId, id: ines.creatorId, refSlug: refInes });

      // ── PostHog : 60 jours de série quotidienne ────────────────────────────
      await admin.mutation(api.posthogSync.e2eSeedPosthogCache, {
        secret: E2E_SECRET,
        projectId,
        entries: [
          {
            key: "overview",
            computedAt: ts - 30 * MIN,
            json: JSON.stringify({
              daily: Array.from({ length: 60 }, (_, i) => {
                const joursAvant = 59 - i;
                return {
                  ts: ts - joursAvant * DAY,
                  visitors: joursAvant === 5 ? 211 : 83,
                  signups: joursAvant === 5 ? 38 : 17,
                  checkouts: 6,
                  subs: joursAvant === 5 ? 4 : 1,
                };
              }),
            }),
          },
        ],
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E acquisition ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];

      // ── J-10 → J-1 : Léa n'y a qu'une vidéo ────────────────────────────────
      const r = await outil(url, token, { projet: slug, du: jourDe(10), au: jourDe(1) });
      expect(r.periode).toEqual({ du: jourDe(10), au: jourDe(1) });
      expect(r.efficaciteParCreatrice).toEqual([
        { createatrice: ines.nom, videosPromo: 2, vuesMedianes: 51_352, videosAuDessusDe50k: 1, vuesPromo: 102_704 },
        { createatrice: lea.nom, videosPromo: 1, vuesMedianes: 55_310, videosAuDessusDe50k: 1, vuesPromo: 55_310 },
      ]);
      const solo = r.joursSolo as JourSolo[];
      expect(solo.find((d) => d.jour === jourDe(5))).toEqual({
        jour: jourDe(5),
        createatrice: ines.nom,
        vuesPromo: 81_234,
        visiteurs: 211,
        inscrits: 38,
        clients: 4,
      });
      expect(solo.find((d) => d.jour === jourDe(3))).toEqual({ jour: jourDe(3), createatrices: 2, vuesPromo: 76_780, attribuable: false });
      expect(solo.some((d) => d.jour === jourDe(12))).toBe(false);

      // Compteurs : ceux de l'écran, toute la profondeur (les 4 vidéos).
      const compteurs = await admin.query(api.analyticsHub.getViewCounters, { projectId });
      expect(r.compteursDeVues.promo).toEqual({ vues: compteurs.promo, sertA: compteurs.usage.promo });
      expect(r.compteursDeVues.promo.vues).toBe(167_884);

      // Nature : rien de dû, tout engagé — 2 × 189 $ + 2 × 1 129 $ = 2 636 $.
      const nature = r.recompensesEnNature;
      expect(nature.dejaDu.valeur).toBe(0);
      expect(nature.engageSiLesPaliersTombent).toEqual({ valeur: 2_266.96, devise: "eur", convertiDepuis: "2636 usd × 0.86" });
      expect(nature.paliers.map((p: { recompense: string; dues: number; engagees: number; laPlusProche: { createatrice: string; pctDuSeuil: number } }) => [
        p.recompense,
        p.dues,
        p.engagees,
        p.laPlusProche.createatrice,
        p.laPlusProche.pctDuSeuil,
      ])).toEqual([
        ["AirPods Pro", 0, 2, ines.nom, 41.1],
        ["iPhone 17", 0, 2, ines.nom, 10.3],
      ]);

      // Conversion par lien de parrainage : la vente d'Inès, et une sans source.
      const conv = r.conversionParCreatrice;
      expect(conv.lignes).toContainEqual(expect.objectContaining({ createatrice: ines.nom, ref: refInes, ventes: 1, revenuNet: 18.37 }));
      expect(conv.sansSource).toMatchObject({ ventes: 1, revenuNet: 7.24 });
      expect(conv.total).toMatchObject({ ventes: 2, revenuNet: 25.61 });

      // ── La période de l'écran (ses 30 derniers jours de données) ────────────
      const ecran = { du: shiftDay(parisDayKey(ts), -29), au: parisDayKey(ts) };
      const e = await outil(url, token, { projet: slug, ...ecran });
      const leaEcran = (e.efficaciteParCreatrice as Efficacite[]).find((c) => c.createatrice === lea.nom)!;
      expect([leaEcran.videosPromo, leaEcran.videosAuDessusDe50k]).toEqual([2, 1]);
      await page.goto(`/admin/${slug}/analytics`);
      await page.getByRole("tab", { name: "Acquisition" }).click();
      const ligneLea = page.getByRole("row").filter({ hasText: lea.nom }).first();
      await expect(ligneLea.getByRole("cell").nth(1)).toHaveText("2");
      await expect(ligneLea.getByRole("cell").nth(3)).toHaveText("1/2");
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

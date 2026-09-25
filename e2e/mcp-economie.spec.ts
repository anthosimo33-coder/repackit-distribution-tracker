import { ConvexHttpClient } from "convex/browser";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { agregatsFenetre, equationUnitaire } from "../convex/unitEconomics";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

type Montant = { valeur: number; devise: string; convertiDepuis?: string; nonConverti?: string } | null;
type Eco = {
  devises: { revenu: string; paie: string; tauxPaieVersRevenu: number | null };
  periode: { du: string; au: string; jours: number };
  margeNette: number | null;
  revenuNet: number | null;
  coutCreateurs: Montant;
  parClient: {
    clientsAcquis: number | null;
    revenuParClient?: number | null;
    coutAcquisition?: Montant;
    margeParClient?: number | null;
    retourSurAcquisition?: number | null;
    coutCompletMoteur?: Montant;
    vuesPromoParClient?: number | null;
    suspendu?: string;
  };
  periodePrecedente?: Record<string, unknown>;
  avertissements?: string[];
};

async function outil(url: string, token: string, args: Record<string, unknown>): Promise<Eco> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "economie_unitaire", arguments: args },
    }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError ?? false, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text) as Eco;
}

const jourParis = (ts: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));

/**
 * Outil MCP `economie_unitaire` — la Vue d'ensemble de l'onglet Analytics
 * (marge nette, revenu par client, coût d'acquisition, marge par client, retour
 * sur acquisition), par la MÊME fonction que l'écran (`convex/unitEconomics`).
 *
 * Projet DÉDIÉ, forme de la prod Snytch : revenu Whop en euros, paie en dollars,
 * taux 0,86 sur le projet. Deux nouveaux clients et un renouvellement dans la
 * période, une vidéo promo au CPM de 2 $ plafonnée à 150 $ publiée aujourd'hui.
 */
test.describe("Outil MCP economie_unitaire", () => {
  test("les chiffres de la Vue d'ensemble, par client et contre la période précédente", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-eco-${ts}`;
    const nom = `E2E MCP Eco ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_eco_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: 0.86,
      });

      // ── Revenu ─────────────────────────────────────────────────────────────
      const maintenant = Date.now();
      const paiement = (n: string, jours: number, membre: string, brut: number, net: number) => ({
        whopId: `pay_e2e_eco_${ts}_${n}`,
        status: "paid" as const,
        rawStatus: "paid",
        currency: "eur",
        grossAmount: brut,
        feeAmount: Math.round((brut - net) * 100) / 100,
        netAmount: net,
        refundedAmount: 0,
        paidAt: maintenant - jours * DAY,
        planId: net > 10 ? "plan_mois" : "plan_hebdo",
        membershipId: `mem_e2e_eco_${ts}_${membre}`,
      });
      await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
        secret: E2E_SECRET,
        projectId,
        payments: [
          paiement("f1", 70, "F", 7.99, 7.24), // fixe le 1er jour de données
          paiement("c1", 40, "C", 7.99, 7.24), // client acquis dans la période PRÉCÉDENTE
          paiement("c2", 12, "C", 7.99, 7.24), // son renouvellement : du revenu, pas un client de plus
          paiement("a1", 10, "A", 19.99, 18.37),
          paiement("b1", 4, "B", 19.99, 18.37),
        ],
      });

      // ── Coût : une vidéo promo au CPM de 2 $, 81 234 vues (plafond 150 $) ──
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] MCP Eco ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 2,
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] MCP Eco ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });
      const email = `e2e-mcp-eco-${ts}@repackit.test`;
      const { creatorId, token: invite } = await admin.mutation(api.creators.inviteCreator, {
        projectId,
        name: `[E2E_TEST] Inès Moreau ${ts}`,
        email,
      });
      await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
        provider: "password",
        params: { email, password: `eco-${ts}-12345`, flow: "signUp", inviteToken: invite },
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId,
        platform: "TikTok",
        handle: `@ines.moreau_${ts}`,
      });
      await admin.mutation(api.assignments.assignFormat, {
        projectId,
        formatId,
        creatorId,
        targets: [target],
        postsPerCreator: 1,
        dueDate: maintenant + 7 * DAY,
        pricingId,
      });
      const row = (await admin.query(api.assignments.listAssignments, { projectId })).find(
        (a) => a.creatorId === creatorId,
      )!;
      const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        projectId,
        id: row._id,
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@ines.moreau_${ts}/video/73${ts}` }],
      });
      await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId: (pub.publicationIds ?? [])[0] as Id<"publications">,
        vues: 81_234,
        capturedAt: Date.now(),
        source: "tiktok",
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E eco ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];

      // ── Les 30 derniers jours, aujourd'hui compris (la vidéo est d'aujourd'hui)
      const du = jourParis(maintenant - 29 * DAY);
      const au = jourParis(maintenant);
      const r = await outil(url, token, { projet: slug, du, au, comparer: true });
      expect(r.devises).toEqual({ revenu: "eur", paie: "usd", tauxPaieVersRevenu: 0.86 });
      expect(r.periode).toEqual({ du, au, jours: 30 });
      expect(r.revenuNet).toBe(43.98); // 18,37 + 18,37 + 7,24 (le renouvellement)
      // 150 $ × 0,86 = 129 € : le coût est CONVERTI avant d'être soustrait.
      expect(r.coutCreateurs).toEqual({ valeur: 129, devise: "eur", convertiDepuis: "150 usd × 0.86" });
      expect(r.margeNette).toBe(-85.02);
      expect(r.parClient).toMatchObject({
        clientsAcquis: 2, // A et B — C est un client de la période précédente
        revenuParClient: 21.99, // 43,98 ÷ 2
        coutAcquisition: { valeur: 64.5, devise: "eur", convertiDepuis: "75 usd × 0.86" },
        margeParClient: -42.51, // 21,99 − 64,50
        retourSurAcquisition: 0.3, // 21,99 ÷ 64,50
        coutCompletMoteur: { valeur: 64.5, devise: "eur" },
      });
      expect(r.parClient).not.toHaveProperty("suspendu");

      // Période précédente (J−59 → J−30) : C acquis, 7,24 de net, aucune vidéo.
      expect(r.periodePrecedente).toMatchObject({
        du: jourParis(maintenant - 59 * DAY),
        au: jourParis(maintenant - 30 * DAY),
        revenuNet: 7.24,
        margeNette: 7.24,
        evolution: {
          revenuNet: { abs: 36.74, pct: 507.5, direction: "up" },
          margeNette: { abs: -92.26, pct: -1274.3, direction: "down" },
          // Coût précédent nul : pas de pourcentage depuis zéro (jamais « +∞ »).
          coutCreateurs: null,
        },
      });

      // ── La fonction de l'écran, sur les agrégats de l'écran ────────────────
      const [revenu, attribution, fiabilite] = await Promise.all([
        admin.query(api.analyticsHub.getRevenueBreakdown, { projectId }),
        admin.query(api.analyticsHub.getAttribution, { projectId }),
        admin.query(api.analyticsHub.getReliability, { projectId }),
      ]);
      const ecran = agregatsFenetre(
        {
          dailyPaidClients: fiabilite.coherence.dailyPaidClients,
          revenu,
          attributionRows: attribution.rows,
          promoBonusByDay: attribution.costs.promoBonusByDay,
          fx: { payCurrency: attribution.payCurrency, revenueCurrency: revenu.currency, fxRateToRevenue: attribution.fxRateToRevenue },
          suspendu: false,
        },
        { from: du, to: au },
      );
      expect([r.margeNette, r.parClient.clientsAcquis, r.parClient.revenuParClient, r.parClient.vuesPromoParClient]).toEqual([
        ecran.marge,
        ecran.clients,
        ecran.revenuePer,
        ecran.viewsPer,
      ]);
      expect([r.parClient.margeParClient, r.parClient.retourSurAcquisition]).toEqual(
        Object.values(equationUnitaire(ecran)),
      );

      // ── Par défaut : jusqu'à hier — la vidéo d'aujourd'hui sort du coût ────
      const defaut = await outil(url, token, { projet: slug });
      expect(defaut.periode.au).toBe(jourParis(maintenant - DAY));
      expect(defaut.coutCreateurs?.valeur).toBe(0);
      expect(defaut.margeNette).toBe(43.98);

      // ── Sans taux de change : pas de marge inventée, et l'outil le dit ─────
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: null,
      });
      const sansTaux = await outil(url, token, { projet: slug, du, au });
      expect(sansTaux.coutCreateurs).toMatchObject({ valeur: 150, devise: "usd" });
      // Présence juste au-dessus (−85,02 avec le taux) ; ici, jamais 43,98 − 150.
      expect(sansTaux.margeNette).toBeNull();
      expect(sansTaux.parClient).toMatchObject({ margeParClient: null, retourSurAcquisition: null });
      expect(sansTaux.avertissements?.join(" ")).toMatch(/sans taux de change réglé/);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

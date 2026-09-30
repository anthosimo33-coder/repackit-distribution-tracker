import { ConvexHttpClient } from "convex/browser";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { deriverMarches } from "../convex/marketDerive";
import { windowToMs } from "../convex/marketWindow";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

type Marche = {
  marche: string;
  pays: string[];
  compose?: boolean;
  verdict: string;
  coutTotal: number | null;
  coutPromo: number | null;
  clients: number;
  revenuNet: number;
  coutParClient: number | null;
  retourAcquisition: number | null;
  offres: { offre: string; clients: number }[];
};
type Marches = {
  periode: { du: string; au: string };
  total: { coutCreateurs: { valeur: number; devise: string } | null; revenuNet: number; marge: number | null };
  marches: Marche[];
  parMois: { mois: string; coutCreateurs: number; revenuNet: number; ecart: number | null }[];
};

async function outil(url: string, token: string, args: Record<string, unknown>): Promise<Marches> {
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
      params: { name: "marches", arguments: args },
    }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError ?? false, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text) as Marches;
}

const jourParis = (ts: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));

/**
 * Outil MCP `marches` — l'onglet Pays de l'Analytics, par la MÊME dérivation
 * (`convex/marketDerive.deriverMarches`) sur les mêmes agrégats.
 *
 * Projet DÉDIÉ, forme de la prod Snytch (paie $, revenu €, taux 0,86) : la France
 * a une vidéo promo à 150 $ (compte ciblé FR) et trois clients ; la Serbie et la
 * Croatie, composées en « Balkans », ont des clients mais aucune dépense.
 */
test.describe("Outil MCP marches", () => {
  test("marchés, verdicts et totaux : les chiffres de l'onglet Pays", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-marches-${ts}`;
    const nom = `E2E MCP Marches ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_mar_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: 0.86,
      });

      // ── Revenu par pays de FACTURATION ───────────────────────────────────
      const maintenant = Date.now();
      const paiement = (n: string, jours: number, pays: string) => ({
        whopId: `pay_e2e_mar_${ts}_${n}`,
        status: "paid" as const,
        rawStatus: "paid",
        currency: "eur",
        grossAmount: 19.99,
        feeAmount: 1.62,
        netAmount: 18.37,
        refundedAmount: 0,
        paidAt: maintenant - jours * DAY,
        planId: "plan_mois",
        membershipId: `mem_e2e_mar_${ts}_${n}`,
        billingCountry: pays,
        billingReason: "subscription_create",
      });
      await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
        secret: E2E_SECRET,
        projectId,
        payments: [
          paiement("fr1", 9, "FR"),
          paiement("fr2", 6, "FR"),
          paiement("fr3", 3, "FR"),
          paiement("rs1", 5, "RS"),
          paiement("hr1", 4, "HR"),
        ],
      });
      await admin.mutation(api.marketGroups.createMarketGroup, {
        projectId,
        name: "Balkans",
        countries: ["RS", "HR"],
      });

      // ── Coût : une vidéo promo à 2 $ CPM (plafond 150 $), compte ciblé FR ─
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] MCP Marches ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 2,
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] MCP Marches ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });
      const email = `e2e-mcp-marches-${ts}@repackit.test`;
      const { creatorId, token: invite } = await admin.mutation(api.creators.inviteCreator, {
        projectId,
        name: `[E2E_TEST] Camille Dubois ${ts}`,
        email,
      });
      await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
        provider: "password",
        params: { email, password: `marches-${ts}-12345`, flow: "signUp", inviteToken: invite },
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId,
        platform: "TikTok",
        handle: `@camille.dubois_${ts}`,
      });
      await admin.mutation(api.comptes.updateCompte, { projectId, id: target.accountId, targetCountry: "FR" });
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
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@camille.dubois_${ts}/video/74${ts}` }],
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
      await page.getByLabel("Nom de la clé").fill(`E2E marches ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];

      // ── Par marché, les 30 derniers jours (aujourd'hui compris) ─────────────
      const du = jourParis(maintenant - 29 * DAY);
      const au = jourParis(maintenant);
      const r = await outil(url, token, { projet: slug, du, au });
      const fr = r.marches.find((m) => m.marche === "FR")!;
      expect(fr).toMatchObject({
        pays: ["FR"],
        clients: 3,
        revenuNet: 55.11, // 3 × 18,37
        coutTotal: 129, // 150 $ × 0,86
        coutPromo: 129,
        coutParClient: 43, // 129 ÷ 3
      });
      // Les offres listées sont celles qui se sont VENDUES, et rendent compte
      // des clients du marché (jamais les moins chères à 0 client).
      expect(fr.offres.every((o) => o.clients > 0)).toBe(true);
      expect(fr.offres.reduce((t, o) => t + o.clients, 0)).toBe(fr.clients);
      const balkans = r.marches.find((m) => m.marche === "Balkans")!;
      expect(balkans).toMatchObject({ pays: ["RS", "HR"], compose: true, clients: 2, revenuNet: 36.74, verdict: "sans dépense" });
      // 91,85 € de revenu − 150 $ convertis (129 €) = −37,15 €
      expect(r.total).toEqual({
        coutCreateurs: { valeur: 129, devise: "EUR", convertiDepuis: "150 usd × 0.86" }, // devise telle que l’agrégat Pays la rend
        revenuNet: 91.85,
        marge: -37.15,
      });

      // ── La dérivation de l'écran, sur les agrégats de l'écran ──────────────
      const [pnl, groupes, produit] = await Promise.all([
        admin.query(api.marketPnl.getMarketPnl, { projectId, ...windowToMs({ from: du, to: au }) }),
        admin.query(api.marketGroups.listMarketGroups, { projectId }),
        admin.query(api.posthogSync.getProductAnalytics, { projectId }),
      ]);
      const ecran = deriverMarches({
        pnl,
        traffic: produit.funnels.countryPersons,
        groups: groupes.map((g) => ({ id: g._id as string, nom: g.name, pays: g.countries })),
        maille: "marche",
        libellePays: (c) => c,
        libelleHorsMarche: "Aucun pays défini",
      });
      // Liste COMPLÈTE (tous_les_marches) : la parité porte sur chaque ligne de
      // l'écran, marchés sans activité compris.
      const complet = await outil(url, token, { projet: slug, du, au, tous_les_marches: true });
      expect(complet.marches.map((m) => [m.marche, m.clients, m.revenuNet, m.coutTotal, m.retourAcquisition])).toEqual(
        ecran.map((m) => [m.label, m.clients, m.revenueNet, m.costComparable, m.acquisitionReturn]),
      );

      // ── Par pays : les Balkans se séparent ─────────────────────────────────
      const parPays = await outil(url, token, { projet: slug, du, au, maille: "pays" });
      expect(parPays.marches.map((m) => m.marche).sort()).toEqual(["FR", "HR", "RS"]);

      // ── Filtre : un marché par son nom ─────────────────────────────────────
      const seul = await outil(url, token, { projet: slug, du, au, pays: "balkans" });
      expect(seul.marches.map((m) => m.marche)).toEqual(["Balkans"]);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

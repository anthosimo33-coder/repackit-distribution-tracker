import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { parisDayKey } from "../convex/viewsDaily";
import { shiftDay } from "../convex/analyticsDates";
import { windowToMs } from "../convex/marketWindow";
import { netPerAssigned } from "../convex/analyticsHubMath";
import { formatMoney } from "../convex/moneyFormat";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

async function outil(url: string, token: string, args: Record<string, unknown>) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "offres", arguments: args } }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError === true, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text);
}

type Bras = {
  bras: string;
  assignes: number;
  nouveauxClients: number;
  completionPct: number | null;
  ciblesParClient: number | null;
  netParAssigne: { valeur: number | null; devise: string | null } | null;
};

const bras = (
  variant: string,
  exposed: number,
  paywallViewers: number,
  checkouts: number,
  paid: number,
  renewals: number,
  clientTargets: number,
  armTargets: number,
  excludedFlippersMultiDevice: number,
  excludedFlippersSameDevice: number,
) => ({
  variant,
  exposed,
  paywallViewers,
  checkouts,
  paid,
  renewals,
  paidWithoutCheckout: 0,
  clientTargets,
  armTargets,
  excludedFlippers: excludedFlippersMultiDevice + excludedFlippersSameDevice,
  excludedFlippersMultiDevice,
  excludedFlippersSameDevice,
});

/**
 * Outil MCP `offres` — l'onglet Offres & tests au-delà du revenu, par les MÊMES
 * calculs (convex/analyticsHubMath, abOffers, abPurchases).
 *
 * Deux jeux PostHog : le cache du cron (test en cours depuis 40 jours, 612 / 598
 * assignés — concluant) et la période que l'ÉCRAN recalcule par défaut (214 /
 * 201 — non concluant, 245 recrues manquantes). Côté Whop, cinq abonnements
 * rattachés à un bras : le net par assigné n'a de sens que si les assignés
 * couvrent, eux aussi, toute la durée du test.
 */
test.describe("Outil MCP offres", () => {
  test("types de paywall, test A/B, offres servies, achats réels : l'onglet, sur la même période", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const slug = `e2e-mcp-offres-${ts}`;
    const nom = `E2E MCP Offres ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };
    const aujourdHui = parisDayKey(ts);
    const premier = parisDayKey(ts - 59 * DAY);
    const ecran = { from: shiftDay(aujourdHui, -29), to: aujourdHui };
    const debutTest = ts - 40 * DAY;

    try {
      // ── Whop : deux offres au catalogue, cinq abonnements rattachés à un bras ─
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_off_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.whopSync.e2eUpsertWhopPlans, {
        secret: E2E_SECRET,
        projectId,
        plans: [
          { planId: `plan_m_${ts}`, name: "Snytch mensuel", price: 16.9, currency: "eur", interval: "mois" },
          { planId: `plan_w_${ts}`, name: "Snytch hebdo", price: 4.99, currency: "eur", interval: "semaine" },
        ],
      });
      // a0 : acquis AVANT la période de l'écran (J-35) — compte sur tout le test,
      // pas sur la période. C'est lui qui distingue les deux numérateurs.
      const abonnements = [
        { n: "a0", variant: "soft", plan: `plan_m_${ts}`, brut: 16.9, net: 15.47, jours: 35 },
        { n: "a1", variant: "soft", plan: `plan_m_${ts}`, brut: 16.9, net: 15.47, jours: 10 },
        { n: "a2", variant: "soft", plan: `plan_w_${ts}`, brut: 4.99, net: 4.31, jours: 10 },
        { n: "b1", variant: "hard", plan: `plan_w_${ts}`, brut: 4.99, net: 4.31, jours: 10 },
        { n: "b2", variant: "hard", plan: `plan_w_${ts}`, brut: 4.99, net: 4.31, jours: 10 },
        { n: "b3", variant: "hard", plan: `plan_w_${ts}`, brut: 4.99, net: 4.31, jours: 10 },
      ];
      for (const a of abonnements) {
        await admin.mutation(api.whopSync.e2eSeedWhopMembership, {
          secret: E2E_SECRET,
          projectId,
          whopMembershipId: `mem_e2e_off_${ts}_${a.n}`,
          abVariant: a.variant,
          planId: a.plan,
          createdAt: ts - a.jours * DAY,
        });
      }
      await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
        secret: E2E_SECRET,
        projectId,
        payments: abonnements.map((a, i) => ({
          whopId: `pay_e2e_off_${ts}_${i}`,
          status: "paid" as const,
          rawStatus: "paid",
          currency: "eur",
          grossAmount: a.brut,
          feeAmount: Math.round((a.brut - a.net) * 100) / 100,
          netAmount: a.net,
          refundedAmount: 0,
          paidAt: ts - a.jours * DAY + i * HOUR,
          planId: a.plan,
          membershipId: `mem_e2e_off_${ts}_${a.n}`,
          billingCountry: "FR",
          billingReason: "subscription_create",
        })),
      });

      // ── PostHog : le cache du cron (90 jours) ──────────────────────────────
      const cache = (key: string, valeur: unknown) => ({ key, json: JSON.stringify(valeur), computedAt: ts - 30 * MIN });
      await admin.mutation(api.posthogSync.e2eSeedPosthogCache, {
        secret: E2E_SECRET,
        projectId,
        entries: [
          cache("overview", {
            daily: Array.from({ length: 60 }, (_, i) => ({ ts: ts - (59 - i) * DAY, visitors: 80, signups: 20, checkouts: 6, subs: 2 })),
          }),
          cache("abArms", {
            rows: [bras("soft", 612, 301, 88, 23, 4, 31, 57, 7, 2), bras("hard", 598, 287, 97, 31, 2, 88, 140, 6, 0)],
            startMs: debutTest,
          }),
          cache("abVariants", {
            rows: [
              { variant: "gate", exposed: 1_402, checkouts: 175, paid: 51, clientTargets: 112 },
              { variant: "upsell", exposed: 233, checkouts: 12, paid: 3, clientTargets: 4 },
            ],
          }),
          cache("abOffers", {
            rows: [
              { variant: "soft", plan: "snytch_monthly", price: "16.9", attributed: true, paywallViewers: 144, checkouts: 41, paid: 12, renewals: 0, firstMs: ts - 20 * DAY, lastMs: ts - HOUR },
              { variant: "hard", plan: "snytch_weekly", price: "4.99", attributed: true, paywallViewers: 157, checkouts: 52, paid: 17, renewals: 0, firstMs: ts - 38 * DAY, lastMs: ts - HOUR },
              { variant: "soft", plan: "snytch_weekly", price: "4.99", attributed: false, paywallViewers: 23, checkouts: 4, paid: 1, renewals: 0, firstMs: ts - 22 * DAY, lastMs: ts - 20 * DAY },
            ],
          }),
          cache("abPurchases", {
            rows: [
              { variant: "soft", plan: "snytch_monthly", whopPlanId: `plan_m_${ts}`, clients: 12, armClients: 23, armMultiPlan: 0 },
              { variant: "soft", plan: "snytch_weekly", whopPlanId: `plan_w_${ts}`, clients: 11, armClients: 23, armMultiPlan: 0 },
              { variant: "hard", plan: "snytch_weekly", whopPlanId: `plan_w_${ts}`, clients: 31, armClients: 31, armMultiPlan: 0 },
            ],
          }),
          cache("paywallById", {
            rows: [
              { key: "onboarding_target", n: 412, converted: 19 },
              { key: "search_first", n: 233, converted: 14 },
              { key: "menu_upsell", n: 57, converted: 6 },
            ],
            startMs: ts - 12 * DAY,
          }),
          cache("freePlan", { signups: 318, used: 142, convertedPaid: 9 }),
          cache("scanCost", {
            rows: [
              { kind: "full", runs: 5_210, withCost: 5_210, sumCostUsd: 41.68, avgCostUsd: 0.008 },
              { kind: "light", runs: 2_873, withCost: 2_873, sumCostUsd: 5.75, avgCostUsd: 0.002 },
            ],
          }),
        ],
      });

      // ── La période de l'écran, telle qu'une volée PostHog l'aurait rangée ──
      await admin.mutation(api.analyticsWindowed.e2eSeedWindowCache, {
        secret: E2E_SECRET,
        projectId,
        from: ecran.from,
        to: ecran.to,
        computedAt: ts - 10 * MIN,
        json: JSON.stringify({
          funnels: {
            global: { segments: [] },
            sequential: { segments: [] },
            source: { segments: [] },
            language: { segments: [] },
            country: { segments: [] },
            countryPersons: { segments: [] },
          },
          activation: { rows: [] },
          checkoutReliability: { rows: [] },
          serverSideSplit: { rows: [] },
          offres: {
            abVariants: { rows: [{ variant: "gate", exposed: 512, checkouts: 66, paid: 21, clientTargets: 45 }] },
            abArms: {
              rows: [bras("soft", 214, 103, 31, 9, 1, 11, 20, 2, 1), bras("hard", 201, 96, 35, 12, 0, 34, 51, 2, 0)],
              startMs: debutTest,
            },
            abOffers: {
              rows: [
                { variant: "soft", plan: "snytch_monthly", price: "16.9", attributed: true, paywallViewers: 103, checkouts: 31, paid: 9, renewals: 0, firstMs: ts - 20 * DAY, lastMs: ts - HOUR },
                { variant: "hard", plan: "snytch_weekly", price: "4.99", attributed: true, paywallViewers: 96, checkouts: 35, paid: 12, renewals: 0, firstMs: ts - 29 * DAY, lastMs: ts - HOUR },
              ],
            },
            abPurchases: {
              rows: [
                { variant: "soft", plan: "snytch_monthly", whopPlanId: `plan_m_${ts}`, clients: 5, armClients: 9, armMultiPlan: 0 },
                { variant: "soft", plan: "snytch_weekly", whopPlanId: `plan_w_${ts}`, clients: 4, armClients: 9, armMultiPlan: 0 },
                { variant: "hard", plan: "snytch_weekly", whopPlanId: `plan_w_${ts}`, clients: 12, armClients: 12, armMultiPlan: 0 },
              ],
            },
            paywallById: { rows: [{ key: "onboarding_target", n: 150, converted: 7 }], startMs: ts - 12 * DAY },
            freePlan: { signups: 97, used: 41, convertedPaid: 3 },
            scanCost: { rows: [{ kind: "light", runs: 911, withCost: 911, sumCostUsd: 1.82, avgCostUsd: 0.002 }] },
          },
          sante: {
            firstSearchAfterPay: { paid: 0, paidExcluded: 0, instrStartMs: null, searched: 0, results: [], medDelaySec: null, p90DelaySec: null, cancelJoinable: 0 },
            searchResults: { rows: [] },
            scanReliability: { rows: [] },
            scanLatency: { rows: [] },
            friction: { rows: [] },
            frictionByStep: { rows: [] },
            instrumentation: { events: [], props: [] },
          },
          from: ecran.from,
          to: ecran.to,
          elapsedMs: 3_140,
          cachedAt: null,
          stale: false,
        }),
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E offres ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];

      // ── 1. Toute la profondeur : le cache, test concluant ───────────────────
      const tout = await outil(url, token, { projet: slug, du: premier, au: aujourdHui });
      expect(tout.periode.source).toBe("cache des 90 derniers jours (la période couvre toutes les données)");
      expect(tout.typesDePaywall).toEqual([
        { type: "Bloquant (gate)", exposes: 1_402, checkouts: 175, payes: 51, completionPct: 29.1, ciblesParClient: 2.2 },
        { type: "Appoint (upsell)", exposes: 233, checkouts: 12, payes: 3, completionPct: 25, ciblesParClient: 1.3 },
      ]);
      const ab = tout.testAB;
      expect(ab).toMatchObject({ enCours: true, concluant: true, seuilParBras: 330, plusPetitBras: 598, recruesManquantes: 0 });
      expect(ab.depuis).toBe(parisDayKey(debutTest));
      expect(ab.bras.map((b: Bras) => [b.bras, b.assignes, b.nouveauxClients, b.completionPct, b.ciblesParClient])).toEqual([
        ["A — 1 cible", 612, 23, 26.1, 1.35],
        ["B — 3 cibles", 598, 31, 32, 2.84],
      ]);
      expect(ab.ecartees).toEqual({ personnes: 15, surUnSeulAppareil: 2, surPlusieursAppareils: 13 });
      // Net par assigné : le revenu du bras (Whop) ÷ les assignés — ceux de toute
      // la durée du test, comme le revenu. Le même calcul que l'écran.
      const revenu = await admin.query(api.analyticsHub.getRevenueBreakdown, { projectId });
      const netSoft = revenu.abRevenue.rows.find((r) => r.variant === "soft")!;
      expect(netSoft).toMatchObject({ memberships: 3, net: 35.25 });
      expect(ab.bras[0].netParAssigne).toEqual({ valeur: netPerAssigned(35.25, 612), devise: "eur" });
      expect(ab.bras[0].netParAssigne.valeur).toBe(0.06);
      expect(ab.bras[1].netParAssigne).toEqual({ valeur: 0.02, devise: "eur" });

      // Les bras ne servent plus la même chose : mensuel contre hebdo.
      expect(tout.offresServies.brasComparables).toBe(false);
      expect(tout.offresServies.enCeMoment).toEqual([
        { bras: "B — 3 cibles", offre: `${formatMoney(4.99, "eur")}/semaine` },
        { bras: "A — 1 cible", offre: `${formatMoney(16.9, "eur")}/mois` },
      ]);
      expect(tout.offresServies.lignes.map((o: { offre: string; devise: string; conversionPct: number; revenu1erCyclePour1000Vues: number }) => [o.offre, o.devise, o.conversionPct, o.revenu1erCyclePour1000Vues])).toEqual([
        [`${formatMoney(4.99, "eur")}/semaine`, "eur", 10.83, 540.32],
        [`${formatMoney(16.9, "eur")}/mois`, "eur", 8.33, 1408.33],
      ]);
      expect(tout.offresServies.personnesEcartees).toBe(23);
      expect(tout.achatsReels.map((b: { bras: string; clients: number; lignes: { prix: number; partPct: number }[] }) => [b.bras, b.clients, b.lignes.map((l) => [l.prix, l.partPct])])).toEqual([
        ["B — 3 cibles", 31, [[4.99, 100]]],
        ["A — 1 cible", 23, [[16.9, 52.2], [4.99, 47.8]]],
      ]);
      expect(tout.conversionParPaywall.depuis).toBe(parisDayKey(ts - 12 * DAY));
      expect(tout.conversionParPaywall.paywalls).toContainEqual({
        paywall: "menu_upsell",
        libelle: "Menu — offre (clic volontaire)",
        force: false,
        vus: 57,
        convertis: 6,
        conversionPct: 10.5,
      });
      expect(tout.planGratuit).toEqual({ ontRecuLaSemaineOfferte: 318, lontUtilisee: 142, usagePct: 44.7, sontPassesAuPayant: 9 });
      expect(tout.coutDesScansUsd.map((r: { type: string }) => r.type)).toEqual([
        "Scan léger (cible gratuite)",
        "Scan complet (détecte les désabonnements)",
      ]);
      expect((tout.avertissements ?? []).join(" ")).not.toContain("Contrôle du tableau A/B");

      // ── 2. La période de l'écran : recalculée, test NON concluant ───────────
      const p = await outil(url, token, { projet: slug, du: ecran.from, au: ecran.to });
      expect(p.periode).toEqual({ du: ecran.from, au: ecran.to, source: "recalculé sur la période (bornée aux jours de données)" });
      expect(p.testAB).toMatchObject({ concluant: false, plusPetitBras: 201, recruesManquantes: 245 });
      expect(p.testAB.bras.map((b: Bras) => [b.assignes, b.completionPct, b.ciblesParClient])).toEqual([
        [214, 29, 1.22],
        [201, 34.3, 2.83],
      ]);
      // Sur la période, le revenu des abonnements ACQUIS dedans (a0 exclu) ÷ les
      // assignés de la période : 19,78 ÷ 214 et 12,93 ÷ 201 — pas 35,25 ÷ 214.
      const auPeriode = await admin.query(api.analyticsHub.getAbRevenueForPeriod, { projectId, ...windowToMs(ecran) });
      expect(auPeriode!.rows.find((r) => r.variant === "soft")).toMatchObject({ memberships: 2, net: 19.78 });
      expect(p.testAB.bras.map((b: Bras) => b.netParAssigne)).toEqual([
        { valeur: 0.09, devise: "eur" },
        { valeur: 0.06, devise: "eur" },
      ]);
      expect(p.planGratuit.usagePct).toBe(42.3);
      expect((p.avertissements ?? []).join(" ")).not.toContain("Achats par bras incohérents");

      // ── L'écran, sur sa période par défaut, dit la même chose ──────────────
      await page.goto(`/admin/${slug}/analytics`);
      await page.getByRole("tab", { name: "Offres & tests" }).click();
      await expect(page.getByText("Non concluant.")).toBeVisible();
      await expect(page.getByText("Non concluant.").locator("..")).toContainText("245");
      const brasA = page.getByRole("row").filter({ hasText: "A — 1 cible" }).first();
      await expect(brasA).toContainText("214");
      // Le net par assigné de l'écran, sur SA période : 0,09 € (et non 0,16 €,
      // le revenu du test entier divisé par les assignés du mois).
      await expect(brasA).toContainText(formatMoney(0.09, "eur"));
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

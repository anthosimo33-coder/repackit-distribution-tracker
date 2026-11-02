import { describe, expect, it } from "vitest";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import type { ProjectQueryCtx } from "../convex/functions";
import { jarviaServer } from "../convex/mcpTools";
import { handleMcpMessage } from "../convex/mcpProtocol";
import { getProductAnalyticsCore } from "../convex/posthogSync";
import { EMPTY_AB_REVENUE } from "../convex/abRevenue";
import type { PlanEconomics, RevenueBreakdown } from "../convex/analyticsHub";

/**
 * L'outil MCP `offres` le 2026-11-02 : « Erreur interne de l'outil » sur toute
 * période. Les logs de production disaient pourquoi — `mcpTools:lireAttribution`
 * « Function execution timed out (maximum duration: 1s) », quatre appels sur
 * quatre (1,00 à 1,04 s, 6 705 documents). L'outil lisait l'attribution ENTIÈRE
 * (le moteur de paie de chaque vidéo) pour deux champs du projet. Ce test
 * rejoue la panne telle quelle : l'attribution est illisible, l'outil doit
 * répondre quand même, avec les deux bras du test en cours.
 */

const PROJET = "p_snytch" as Id<"projects">;
const USER = "u_admin" as Id<"users">;
const PANNE_PROD = "Function execution timed out (maximum duration: 1s)";

/** Minuit Paris (UTC+1 en novembre, UTC+2 avant le 26/10). */
const jourParis = (d: string) => Date.parse(`${d}T00:00:00${d >= "2026-10-26" ? "+01:00" : "+02:00"}`);

// Les agrégats A/B du cache de production au 02/11 (des compteurs, aucune
// personne) : le test `paywall_hebdo_2026_10`, bras `hard` (9,99 €) et
// `hebdo12` (11,99 €, plan_3Es43XRWkimJw sur un autre produit Whop), le même
// slug de plan des deux côtés — d'où une table famille → bras VIDE.
const CACHE: Record<string, unknown> = {
  overview: {
    daily: ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"].map((d) => ({
      ts: jourParis(d),
      visitors: 1389,
      signups: 671,
      checkouts: 119,
      subs: 26,
    })),
  },
  abArms: {
    rows: [
      { variant: "hard", exposed: 1529, paywallViewers: 934, checkouts: 164, paid: 34, renewals: 7, paidWithoutCheckout: 0, clientTargets: 29, armTargets: 32, excludedFlippers: 13, excludedFlippersMultiDevice: 13, excludedFlippersSameDevice: 0, reattributedFlippers: 12 },
      { variant: "hebdo12", exposed: 1482, paywallViewers: 913, checkouts: 159, paid: 23, renewals: 12, paidWithoutCheckout: 1, clientTargets: 34, armTargets: 44, excludedFlippers: 7, excludedFlippersMultiDevice: 7, excludedFlippersSameDevice: 0, reattributedFlippers: 39 },
    ],
    startMs: 1793186135386,
    flipperAttribution: { viaCheckout: 0, viaPaywall: 51, buyersReattributed: 6, excludedBothFamilies: 0, excludedBothPaywalls: 6, excludedNoEvidence: 14, buyersExcluded: 0 },
    planFamilies: [],
  },
  abOffers: {
    rows: [
      { variant: "hard", plan: "snytch_trio_weekly", price: "9.99", attributed: true, paywallViewers: 842, checkouts: 134, paid: 31, renewals: 2, firstMs: 1793186373086, lastMs: 1793616172459 },
      { variant: "hebdo12", plan: "snytch_trio_weekly", price: "11.99", attributed: true, paywallViewers: 795, checkouts: 122, paid: 17, renewals: 0, firstMs: 1793188446095, lastMs: 1793616162225 },
    ],
  },
  abPurchases: {
    rows: [
      { variant: "hard", plan: "snytch_trio_weekly", whopPlanId: "plan_8Eo6l4YYhkeI5", clients: 30, armClients: 34, armMultiPlan: 0 },
      { variant: "hebdo12", plan: "snytch_trio_weekly", whopPlanId: "plan_3Es43XRWkimJw", clients: 16, armClients: 23, armMultiPlan: 0 },
      { variant: "hebdo12", plan: "snytch_trio_weekly", whopPlanId: "plan_8Eo6l4YYhkeI5", clients: 4, armClients: 23, armMultiPlan: 0 },
    ],
  },
};

/** L'agrégat produit tel que l'écran le lit : le vrai cœur, sur une base réduite au cache. */
async function produit() {
  const lignes = Object.entries(CACHE).map(([key, json]) => ({
    projectId: PROJET,
    key,
    json: JSON.stringify(json),
    computedAt: Date.parse("2026-11-02T10:00:00Z"),
  }));
  const db = {
    get: async () => ({ _id: PROJET, slug: "snytch", posthog: { host: "eu", posthogProjectId: "231200", apiKeyEnvVar: "X" } }),
    query: () => ({ withIndex: () => ({ collect: async () => lignes }) }),
  };
  return getProductAnalyticsCore({ db, projectId: PROJET, userId: USER } as unknown as ProjectQueryCtx);
}

const plan = (planId: string, price: number): PlanEconomics => ({
  planId,
  name: "Snytch Pro 3 cibles — Hebdo",
  interval: "semaine",
  price,
  currency: "eur",
  active: true,
  members: 0,
  netTotal: null,
  ltv: null,
  netPerPayment: null,
  feeRate: null,
  netPerMemberMonth: null,
  netReason: null,
});

const REVENU: RevenueBreakdown = {
  configured: true,
  currency: "eur",
  mixedCurrency: false,
  conversions: [],
  fxRates: [],
  currenciesPresent: ["eur"],
  mixedCurrencyPresent: false,
  feeRate: null,
  periods: [],
  plans: [plan("plan_8Eo6l4YYhkeI5", 9.99), plan("plan_3Es43XRWkimJw", 11.99)],
  dailyNet: [],
  refunded: 0,
  refundCount: 0,
  disputedTotal: 0,
  disputes: [],
  monthlyArpu: null,
  ltv: null,
  churnAvailable: false,
  internalExcludedMembers: 0,
  offerChanges: [],
  abRevenue: { ...EMPTY_AB_REVENUE, currency: "eur", currencies: ["eur"] },
};

/** Un `ctx` d'action dont chaque lecture répond comme la production le 02/11. */
async function ctxProd() {
  const lu: string[] = [];
  const reponses: Record<string, () => unknown> = {
    "mcpTools:projetsAccessibles": () => [{ _id: PROJET, slug: "snytch", name: "Snytch", role: "superadmin" }],
    "mcpTools:lireAnalyticsProduit": () => produitLu,
    "mcpTools:lireRevenus": () => REVENU,
    "mcpTools:lireDevisesProjet": () => ({ payCurrency: "usd", fxRateToRevenue: 0.86 }),
    "mcpTools:lireAttribution": () => {
      throw new Error(PANNE_PROD);
    },
  };
  const produitLu = await produit();
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
      const nom = getFunctionName(ref);
      lu.push(nom);
      const r = reponses[nom];
      if (!r) throw new Error(`lecture non prévue : ${nom}`);
      return r();
    },
    runMutation: async () => {
      throw new Error("un outil de lecture n'écrit pas");
    },
    runAction: async () => {
      throw new Error("action non prévue");
    },
  } as unknown as ActionCtx;
  return { ctx, lu };
}

const appel = (args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "offres", arguments: { projet: "snytch", ...args } },
});

describe("outil MCP offres — l'attribution illisible ne le fait plus tomber", () => {
  it("répond sur la période du test en cours, avec ses deux bras", async () => {
    const { ctx, lu } = await ctxProd();
    const server = jarviaServer(ctx, USER, { kind: "token", id: "t", name: "t", writeScopes: [] });
    const r = (await handleMcpMessage(server, appel({ du: "2026-10-28", au: "2026-11-01" }))) as {
      result: { isError?: boolean; content: { text: string }[] };
    };
    expect(r.result.content[0].text).not.toBe("Erreur interne de l'outil.");
    expect(r.result.isError).toBeFalsy();

    const o = JSON.parse(r.result.content[0].text);
    expect(o.testAB.enCours).toBe(true);
    expect(o.testAB.depuis).toBe("2026-10-28");
    expect(o.testAB.bras.map((b: { assignes: number }) => b.assignes)).toEqual([1529, 1482]);
    expect(o.testAB.bras[1].bras).toBe("hebdo12");
    // Les achats réels des deux bras, au prix Whop de chaque plan.
    expect(o.achatsReels.map((b: { clients: number }) => b.clients)).toEqual([34, 23]);
    expect(o.achatsReels[1].lignes.map((l: { prix: number }) => l.prix)).toEqual([11.99, 9.99]);
    // Les devises viennent du projet, plus du moteur de paie.
    expect(lu).toContain("mcpTools:lireDevisesProjet");
    expect(lu).not.toContain("mcpTools:lireAttribution");
  });

  it("répond aussi sans période (30 derniers jours)", async () => {
    const { ctx } = await ctxProd();
    const server = jarviaServer(ctx, USER, { kind: "token", id: "t", name: "t", writeScopes: [] });
    const r = (await handleMcpMessage(server, appel({}))) as {
      result: { isError?: boolean; content: { text: string }[] };
    };
    expect(r.result.isError).toBeFalsy();
    expect(JSON.parse(r.result.content[0].text).testAB.bras).toHaveLength(2);
  });
});

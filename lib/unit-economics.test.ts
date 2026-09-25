import { describe, expect, it } from "vitest";
import {
  agregatsFenetre,
  computeDelta,
  ecartDashboardWhop,
  equationUnitaire,
  type EntreesEconomieUnitaire,
} from "../convex/unitEconomics";

// Forme de la prod Snytch : revenu en euros, paie en dollars, taux 0,86 sur le projet.
const FX = { payCurrency: "usd", revenueCurrency: "eur", fxRateToRevenue: 0.86 };
const W = { from: "2026-09-01", to: "2026-09-30" };

function ligne(day: string, cost: number | null, promo = true, promoViews = 12_347) {
  return {
    day,
    creatorId: "c1",
    creatorName: "Inès Moreau",
    promoViews: promo ? promoViews : 0,
    payableViews: promoViews,
    hasPromoPost: promo,
    cost,
    promoCost: promo ? cost : 0,
  };
}

const base: EntreesEconomieUnitaire = {
  dailyPaidClients: [
    { day: "2026-08-31", clients: 4 }, // hors fenêtre
    { day: "2026-09-03", clients: 2 },
    { day: "2026-09-17", clients: 1 },
  ],
  revenu: {
    configured: true,
    mixedCurrency: false,
    dailyNet: [
      { day: "2026-08-31", net: 73.48 }, // hors fenêtre
      { day: "2026-09-03", net: 36.74 },
      { day: "2026-09-12", net: 7.24 },
      { day: "2026-09-17", net: 18.37 },
    ],
  },
  attributionRows: [
    ligne("2026-09-02", 41.27),
    ligne("2026-09-10", 23.45, false), // warmup : coût complet, pas d'acquisition
    ligne("2026-10-01", 99), // hors fenêtre
  ],
  promoBonusByDay: [{ day: "2026-09-15", amount: 15 }],
  fx: FX,
  suspendu: false,
};

describe("agregatsFenetre — la Vue d'ensemble", () => {
  it("revenu, coût converti, marge, puis tout ÷ les clients acquis de la fenêtre", () => {
    const a = agregatsFenetre(base, W);
    expect(a.clients).toBe(3);
    expect(a.net).toBeCloseTo(62.35, 10);
    // (41,27 + 23,45 + 15) $ × 0,86 = 68,56 €
    expect(a.costAll).toMatchObject({ value: 68.56, currency: "eur", converted: true, sourceValue: 79.72 });
    expect(a.marge).toBe(-6.21);
    // (41,27 + 15) / 3 = 18,76 $ → 16,13 €
    expect(a.acquisition).toMatchObject({ value: 16.13, sourceValue: 18.76 });
    // (41,27 + 23,45 + 15) / 3 = 26,57 $ → 22,85 €
    expect(a.fullEngine).toMatchObject({ value: 22.85, sourceValue: 26.57 });
    expect(a.revenuePer).toBe(20.78);
    expect(a.viewsPer).toBe(4116); // 12 347 vues promo / 3
    expect(equationUnitaire(a)).toEqual({ margePerClient: 4.65, roas: 1.3 });
  });

  it("garde-fou en écart : aucune division, les totaux restent", () => {
    const a = agregatsFenetre({ ...base, suspendu: true }, W);
    expect(a.marge).toBe(-6.21);
    expect(a.canDivide).toBe(false);
    expect([a.acquisition, a.fullEngine, a.revenuePer, a.viewsPer]).toEqual([null, null, null, null]);
    expect(equationUnitaire(a)).toEqual({ margePerClient: null, roas: null });
  });

  it("sans taux de change : coût en dollars, et aucune différence entre deux monnaies", () => {
    const a = agregatsFenetre({ ...base, fx: { ...FX, fxRateToRevenue: null } }, W);
    expect(a.costAll).toMatchObject({ value: 79.72, currency: "usd", converted: false, rate: null });
    expect(a.acquisition?.currency).toBe("usd");
    // Le revenu par client reste (euros ÷ clients) ; ce qui soustrait ou divise
    // des dollars par des euros disparaît.
    expect(a.revenuePer).toBe(20.78);
    expect(a.marge).toBeNull();
    expect(equationUnitaire(a)).toEqual({ margePerClient: null, roas: null });
  });

  it("même devise des deux côtés : rien à convertir, tout se soustrait", () => {
    const a = agregatsFenetre(
      { ...base, fx: { payCurrency: "eur", revenueCurrency: "EUR", fxRateToRevenue: null } },
      W,
    );
    expect(a.costAll).toMatchObject({ value: 79.72, converted: false, rate: 1 });
    expect(a.marge).toBe(-17.37);
  });

  it("un coût par vidéo inconnu : aucun total (jamais une somme autour du trou)", () => {
    const a = agregatsFenetre({ ...base, attributionRows: [...base.attributionRows, ligne("2026-09-20", null)] }, W);
    expect(a.costAll).toBeNull();
    expect(a.marge).toBeNull();
    expect(a.acquisition).toBeNull();
  });

  it("multi-devise non convertible : pas de revenu, donc ni marge ni revenu par client", () => {
    const a = agregatsFenetre({ ...base, revenu: { ...base.revenu!, mixedCurrency: true } }, W);
    expect([a.net, a.marge, a.revenuePer]).toEqual([null, null, null]);
  });

  it("aucun client sur la fenêtre : rien n'est divisé", () => {
    const a = agregatsFenetre(base, { from: "2026-09-04", to: "2026-09-16" });
    expect(a.clients).toBe(0);
    expect(a.canDivide).toBe(false);
  });
});

describe("computeDelta", () => {
  it("écart absolu et relatif ; base nulle → pas de pourcentage", () => {
    expect(computeDelta(43.98, 7.24)).toEqual({ abs: 36.74, pct: 507.5, direction: "up" });
    expect(computeDelta(-85.02, 7.24)).toEqual({ abs: -92.26, pct: -1274.3, direction: "down" });
    expect(computeDelta(12.5, 0)).toEqual({ abs: 12.5, pct: null, direction: "up" });
  });
});

describe("ecartDashboardWhop — la décision qui suspend les chiffres par client", () => {
  const steps = (n: number) => [{ key: "subscription_completed", count: n }];

  it("petits écarts : jamais de suspension (il faut franchir 5 % ET 5 clients)", () => {
    expect(ecartDashboardWhop({ reachSteps: steps(147), dashboardClients: 140, whopClients: 144 })?.masks).toBe(false);
    // 6 clients mais 4 % : pas de suspension non plus.
    expect(ecartDashboardWhop({ reachSteps: steps(150), dashboardClients: null, whopClients: 144 })?.masks).toBe(false);
  });

  it("au-delà des deux seuils : suspendu", () => {
    const e = ecartDashboardWhop({ reachSteps: steps(160), dashboardClients: null, whopClients: 144 })!;
    expect(e).toMatchObject({ posthogClients: 160, signed: 16, diff: 16, pct: 11.1, masks: true });
  });

  it("l'écart EXPLIQUÉ (fantômes, paiements sans event, bande) ne suspend pas", () => {
    const e = ecartDashboardWhop({
      reachSteps: steps(160),
      dashboardClients: null,
      whopClients: 144,
      windowReconciliation: { ghostClients: 14, missingEvents: 0, unlinkedBeforeBreak: 3, unlinkedAfterBreak: 0 },
    })!;
    expect(e).toMatchObject({ predicted: 14, unexplained: 2, diff: 0, masks: false });
  });

  it("régression d'instrumentation : suspendu quel que soit l'écart", () => {
    const e = ecartDashboardWhop({
      reachSteps: steps(144),
      dashboardClients: null,
      whopClients: 144,
      windowReconciliation: { ghostClients: 0, missingEvents: 0, unlinkedBeforeBreak: 0, unlinkedAfterBreak: 1 },
    })!;
    expect(e.masks).toBe(true);
  });

  it("repli sur le tunnel séquentiel ; rien à comparer sans PostHog ou sans Whop", () => {
    expect(ecartDashboardWhop({ reachSteps: [], dashboardClients: 150, whopClients: 144 })).toMatchObject({
      posthogReach: null,
      posthogClients: 150,
    });
    expect(ecartDashboardWhop({ reachSteps: [], dashboardClients: null, whopClients: 144 })).toBeNull();
    expect(ecartDashboardWhop({ reachSteps: steps(150), dashboardClients: null, whopClients: null })).toBeNull();
  });
});

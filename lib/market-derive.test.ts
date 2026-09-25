import { describe, expect, it } from "vitest";
import {
  deriverMarches,
  lignesEtTotaux,
  ORDRE_VERDICT,
  partitionMarches,
  serieMensuelle,
  stepsOf,
  type MarketPnlLike,
} from "../convex/marketDerive";
import type { MarketRow } from "../convex/marketPnl";

// Forme de la prod Snytch : paie en dollars, revenu en euros, taux 0,86.
function ligne(country: string | null, o: Partial<MarketRow> = {}): MarketRow {
  return {
    country,
    creators: 1,
    videos: 3,
    cost: 120,
    promoCost: 90,
    promoViews: 41_237,
    creatorsDetail: [],
    creatorIds: ["c1"],
    clients: 0,
    renewals: 0,
    failures: 0,
    attempts: 0,
    paid: 0,
    revenueNet: 0,
    previousClients: 0,
    previousRevenueNet: 0,
    cohortClients: 0,
    curve: [],
    survival: [],
    ...o,
  };
}

const pnl: MarketPnlLike = {
  whopConfigured: true,
  payCurrency: "usd",
  revenueCurrency: "eur",
  fxRateToRevenue: 0.86,
  rows: [
    ligne("FR", { clients: 23, paid: 31, revenueNet: 412.37, cost: 210.5, promoCost: 180.25 }),
    ligne("RS", { clients: 2, paid: 2, revenueNet: 36.74, cost: 95, promoCost: 95 }),
    ligne("HR", { clients: 1, paid: 1, revenueNet: 18.37, cost: 40, promoCost: 40 }),
    ligne(null, { clients: 0, cost: 77.3, promoCost: 0, videos: 2 }),
  ],
  planCells: [],
  trend: [
    { month: "2026-09", country: "FR", cost: 210.5, revenueNet: 412.37 },
    { month: "2026-08", country: "FR", cost: 150, revenueNet: 120.12 },
    { month: "2026-09", country: "RS", cost: 95, revenueNet: 36.74 },
  ],
};
const traffic = {
  segments: [
    {
      key: "RS",
      steps: [
        { key: "visit", count: 812 },
        { key: "paywall_viewed", count: 640 },
        { key: "checkout_started", count: 491 },
        { key: "subscription_completed", count: 7 },
      ],
    },
  ],
};
const balkans = [{ id: "g1", nom: "Balkans", pays: ["RS", "HR", "SI"] }];

describe("partitionMarches", () => {
  it("les marchés composés d'abord (pays connus seulement), puis chaque pays seul", () => {
    expect(partitionMarches(["FR", "RS", "HR"], balkans)).toEqual([
      { key: "g:g1", label: "Balkans", pays: ["RS", "HR"], composed: true },
      { key: "FR", label: "FR", pays: ["FR"], composed: false },
    ]);
  });
});

describe("deriverMarches — l'onglet Pays", () => {
  const base = {
    pnl,
    traffic,
    groups: balkans,
    libellePays: (c: string) => `pays:${c}`,
    libelleHorsMarche: "Aucun pays défini",
  };

  it("par marché : Balkans agrège RS + HR, la ligne sans pays ferme la liste", () => {
    const m = deriverMarches({ ...base, maille: "marche" });
    expect(new Set(m.map((x) => x.label))).toEqual(new Set(["Balkans", "pays:FR", "Aucun pays défini"]));
    // Trié par ce qu'il faut faire d'abord (hors marché exclu, qui ferme la liste).
    const rangs = m.slice(0, -1).map((x) => ORDRE_VERDICT.indexOf(x.decision.verdict));
    expect(rangs).toEqual([...rangs].sort((p, q) => p - q));
    const bk = m.find((x) => x.label === "Balkans")!;
    expect(bk).toMatchObject({ composed: true, clients: 3, revenueNet: 55.11, videos: 6 });
    expect(bk.countries).toEqual(["RS", "HR"]);
    // Trafic PostHog des pays du marché : RS seul en a.
    expect(bk).toMatchObject({ visitors: 812, checkouts: 491, trafficClients: 7 });
    expect(m.at(-1)!.key).toBe("");
  });

  it("491 checkouts pour 7 clients : RÉPARER passe avant COUPER", () => {
    const m = deriverMarches({ ...base, maille: "marche" });
    const bk = m.find((x) => x.label === "Balkans")!;
    expect(bk.decision.verdict).toBe("reparer");
    expect(bk.decision.checkoutToClient).toBeCloseTo(7 / 491, 10);
  });

  it("par pays : aucune partition, libellés d'écran, même ordre de décision", () => {
    const m = deriverMarches({ ...base, maille: "pays" });
    expect(m.map((x) => x.key)).toEqual(expect.arrayContaining(["FR", "RS", "HR", ""]));
    expect(m.find((x) => x.key === "RS")!.label).toBe("pays:RS");
    expect(m.at(-1)!.key).toBe("");
  });

  it("sans taux de change : verdict inconnu, aucun coût comparable", () => {
    const m = deriverMarches({ ...base, pnl: { ...pnl, fxRateToRevenue: null }, maille: "pays" });
    const fr = m.find((x) => x.key === "FR")!;
    expect(fr.decision.verdict).toBe("inconnu");
    expect(fr.costComparable).toBeNull();
  });
});

describe("lignesEtTotaux et serieMensuelle", () => {
  it("la marge totale porte le coût hors marché ; la ligne sans pays n'a pas de marge", () => {
    const t = lignesEtTotaux(pnl);
    expect(t.totalCost).toBeCloseTo(422.8, 10);
    expect(t.totalRevenue).toBeCloseTo(467.48, 10);
    // 467,48 − 422,80 × 0,86 = 467,48 − 363,61 = 103,87
    expect(t.totalMarge).toBe(103.87);
    expect(t.lignes.find((l) => l.country === null)!.marge).toBeNull();
    // FR : 412,37 − 210,50 × 0,86 = 231,34
    expect(t.lignes[0]).toMatchObject({ country: "FR", marge: 231.34 });
  });

  it("sans taux : aucune marge (jamais des euros moins des dollars)", () => {
    const t = lignesEtTotaux({ ...pnl, fxRateToRevenue: null });
    expect(t.totalMarge).toBeNull();
    expect(t.lignes.every((l) => l.marge === null)).toBe(true);
  });

  it("série par mois, tous marchés, écart converti", () => {
    expect(serieMensuelle(pnl)).toEqual([
      { month: "2026-08", cost: 150, revenueNet: 120.12, ecart: -8.88 },
      { month: "2026-09", cost: 305.5, revenueNet: 449.11, ecart: 186.38 },
    ]);
  });

  it("étapes PostHog d'un pays", () => {
    expect(stepsOf(traffic)).toEqual([
      { country: "RS", visitors: 812, paywall: 640, checkouts: 491, clients: 7 },
    ]);
  });
});

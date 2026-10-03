import { describe, expect, it } from "vitest";
import {
  isPayCurrencyConvertible,
  normalizeCurrency,
  payCurrencyFactor,
  resolvePayCurrency,
  sumByCurrency,
} from "../convex/payCurrency";
import { computeMonthlyPayout, type PayoutItem, type PricingSnapshot } from "./pricing-engine";
import * as convexPricing from "../convex/pricing";
import { cycleCurrencyOf } from "../convex/payments";
import { regrouperPaiements, type LignePaiement } from "../convex/paymentsView";
import { leaderboardWindow, type RankedEntry } from "./leaderboard-window";
import { emailAmount } from "../convex/emailMessages";
import { formatMoneyByCurrency } from "./money-by-currency";

/**
 * DEVISE DE PAIE PAR BARÈME — cf convex/payCurrency.
 *
 * Les taux sont ceux de Snytch en prod (1 $ = 0,86 €, 1 RSD = 0,00852 €), les
 * montants ceux de ses barèmes français : « 400 €/mois » saisi 465 $ jusqu'ici.
 */
const SNYTCH = {
  payCurrency: "usd",
  fxRateToRevenue: 0.86,
  fxRatesToRevenue: [{ currency: "rsd", rate: 0.00852 }],
};

describe("payCurrencyFactor — 1 unité de la devise = ? unités de la paie du projet", () => {
  it("même devise, ou devise absente (donnée d'avant) : 1, rien ne bouge", () => {
    expect(payCurrencyFactor("usd", SNYTCH)).toBe(1);
    expect(payCurrencyFactor(" USD ", SNYTCH)).toBe(1);
    expect(payCurrencyFactor(null, SNYTCH)).toBe(1);
    expect(payCurrencyFactor(undefined, SNYTCH)).toBe(1);
  });

  it("la devise du revenu (sans taux propre) : 1 / taux de la paie", () => {
    // 1 € = 1 / 0,86 $ = 1,1628 $ : 400 € coûtent 465,12 $ — le 465 saisi à la main.
    expect(payCurrencyFactor("eur", SNYTCH)).toBeCloseTo(1 / 0.86, 12);
    expect(400 * payCurrencyFactor("eur", SNYTCH)!).toBeCloseTo(465.12, 2);
  });

  it("une devise avec son propre taux : taux / taux de la paie", () => {
    expect(payCurrencyFactor("rsd", SNYTCH)).toBeCloseTo(0.00852 / 0.86, 12);
  });

  it("sans taux de paie réglé : null — on ne devine pas", () => {
    expect(payCurrencyFactor("eur", { payCurrency: "usd" })).toBeNull();
    expect(payCurrencyFactor("eur", { payCurrency: "usd", fxRateToRevenue: 0 })).toBeNull();
    // … mais la devise du projet reste à 1, taux ou pas.
    expect(payCurrencyFactor("usd", { payCurrency: "usd" })).toBe(1);
  });
});

describe("isPayCurrencyConvertible — la garde d'écriture du barème", () => {
  it("accepte la devise du projet, une devise à taux propre, et la devise du revenu", () => {
    expect(isPayCurrencyConvertible("usd", SNYTCH, "eur")).toBe(true);
    expect(isPayCurrencyConvertible("rsd", SNYTCH, "eur")).toBe(true);
    expect(isPayCurrencyConvertible("EUR", SNYTCH, "eur")).toBe(true);
  });

  it("refuse une devise qui n'est ni l'une ni l'autre — sinon le facteur la prendrait pour le revenu", () => {
    expect(isPayCurrencyConvertible("gbp", SNYTCH, "eur")).toBe(false);
    // Revenu inconnu : l'euro n'est plus vérifiable.
    expect(isPayCurrencyConvertible("eur", SNYTCH, null)).toBe(false);
    // Aucun taux de paie : rien d'autre que la devise du projet.
    expect(isPayCurrencyConvertible("eur", { payCurrency: "usd" }, "eur")).toBe(false);
  });
});

describe("resolvePayCurrency / normalizeCurrency", () => {
  it("la sienne si posée, sinon celle du projet, normalisée", () => {
    expect(resolvePayCurrency(" EUR", "usd")).toBe("eur");
    expect(resolvePayCurrency(undefined, "USD")).toBe("usd");
    expect(resolvePayCurrency("", "usd")).toBe("usd");
    expect(resolvePayCurrency(null, null)).toBeNull();
    expect(normalizeCurrency("   ")).toBeNull();
  });
});

// ─── Le moteur : deux devises ne partagent JAMAIS un budget fixe ─────────────

const FR_AVANT: PricingSnapshot = {
  pricingId: "k97bq3rd5tmxjc0ss8g1vzp4n17h8a2e",
  montantFixe: 400,
  nbVideosCible: 60,
  tauxCPM: 0,
  seuilBonusVues: 0,
  montantBonus: 0,
};
const FR_EUR: PricingSnapshot = { ...FR_AVANT, currency: "eur" };

function videos(n: number, views: number, snapshot: PricingSnapshot, prefix: string): PayoutItem[] {
  return Array.from({ length: n }, (_, i) => ({
    assignmentId: `${prefix}${i}`,
    snapshot,
    totalViews: views,
  }));
}

describe("computeMonthlyPayout — la devise fait partie de la clé de groupe", () => {
  const mixte = [...videos(40, 12_345, FR_AVANT, "usd-"), ...videos(40, 9_876, FR_EUR, "eur-")];

  it("mêmes termes, devises différentes : deux groupes, deux budgets", () => {
    const r = computeMonthlyPayout(mixte);
    expect(r.perPricing).toHaveLength(2);
    // 40 vidéos à 400/60 = 266,67 dans CHAQUE devise — jamais 400 pour 80 vidéos.
    expect(r.perPricing.map((g) => g.fixed)).toEqual([266.67, 266.67]);
  });

  it("sans devise (données d'avant) : un seul groupe, comme toujours", () => {
    const r = computeMonthlyPayout(videos(80, 12_345, FR_AVANT, "x-"));
    expect(r.perPricing).toHaveLength(1);
    expect(r.fixedTotal).toBe(400);
  });

  it("parité lib/ ↔ convex/ (règle A6) sur le cycle à deux devises", () => {
    const a = computeMonthlyPayout(mixte);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = convexPricing.computeMonthlyPayout(mixte as any);
    expect(b.perPricing).toEqual(a.perPricing);
    expect(b.perAssignment).toEqual(a.perAssignment);
    expect(b.total).toBe(a.total);
  });
});

// ─── assembleBreakdown — devise d'un breakdown, et conversion d'analyse ──────

function breakdown(
  items: PayoutItem[],
  extra: {
    unlocks?: { montant: number; currency?: string; seuilVues?: number }[];
    toReference?: typeof SNYTCH;
  } = {},
) {
  return convexPricing.assembleBreakdown({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: items as any,
    videoBonuses: [],
    cashUnlocks: (extra.unlocks ?? []).map((u, i) => ({
      montant: u.montant,
      currency: u.currency,
      seuilVues: u.seuilVues ?? 1_000_000 * (i + 1),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any,
    challengeWins: [],
    unmeasuredPayablePosts: 0,
    projectPayCurrency: "usd",
    toReference: extra.toReference,
  });
}

const FR_CPM: PricingSnapshot = {
  pricingId: "k1x9w2c7vmb3rt5qzd8ny4hpe60a7fsj",
  currency: "eur",
  montantFixe: 0,
  nbVideosCible: 60,
  tauxCPM: 1,
  seuilBonusVues: 0,
  montantBonus: 0,
};

describe("assembleBreakdown — la devise d'une période", () => {
  it("tout en euros : la période dit « eur », aucun mélange", () => {
    const b = breakdown(videos(3, 87_654, FR_CPM, "a"));
    expect(b.currency).toBe("eur");
    expect(b.mixedCurrency).toBe(false);
    // 87 654 vues à 1 €/1000 = 87,65 € par vidéo (arrondi au centime).
    expect(b.total).toBe(262.95);
  });

  it("données d'avant (sans devise) : la devise du projet", () => {
    const b = breakdown(videos(3, 87_654, { ...FR_CPM, currency: undefined }, "a"));
    expect(b.currency).toBe("usd");
    expect(b.mixedCurrency).toBe(false);
  });

  it("une vidéo en euros et un palier en dollars : MÉLANGE signalé, devise nulle", () => {
    const b = breakdown(videos(2, 50_000, FR_CPM, "a"), { unlocks: [{ montant: 200 }] });
    expect(b.mixedCurrency).toBe(true);
    expect(b.currency).toBeNull();
  });

  it("période vide : aucune devise, aucun mélange (l'appelant prend celle de la créatrice)", () => {
    const b = breakdown([]);
    expect(b.currency).toBeNull();
    expect(b.mixedCurrency).toBe(false);
  });
});

describe("assembleBreakdown — conversion des écrans d'analyse (toReference)", () => {
  it("euros ramenés en dollars au taux du projet", () => {
    const brut = breakdown(videos(3, 87_654, FR_CPM, "a"));
    const conv = breakdown(videos(3, 87_654, FR_CPM, "a"), { toReference: SNYTCH });
    expect(conv.currency).toBe("usd");
    expect(conv.mixedCurrency).toBe(false);
    // 87,65 € par vidéo → 101,92 $ ; jamais le brut en euros sous un symbole $.
    expect(conv.perAssignment.map((a) => a.cpm)).toEqual([101.92, 101.92, 101.92]);
    expect(conv.total).toBe(305.76);
    expect(conv.total).not.toBe(brut.total);
  });

  it("le PLAFOND s'applique dans la devise du barème : 150 €, donc 174,42 $", () => {
    // 1 000 000 vues à 1 €/1000 = 1 000 € → plafonné à 150 € → 174,42 $ convertis.
    // Plafonner APRÈS conversion aurait rendu 150 $.
    const conv = breakdown(videos(1, 1_000_000, FR_CPM, "a"), { toReference: SNYTCH });
    expect(conv.total).toBe(174.42);
  });

  it("tout dans la devise du projet : résultat IDENTIQUE au chemin de paie", () => {
    const usd = { ...FR_CPM, currency: "usd" };
    const brut = breakdown(videos(5, 43_210, usd, "a"), { unlocks: [{ montant: 200, currency: "usd" }] });
    const conv = breakdown(videos(5, 43_210, usd, "a"), {
      unlocks: [{ montant: 200, currency: "usd" }],
      toReference: SNYTCH,
    });
    expect(conv).toEqual(brut);
  });

  it("paliers et vidéos en euros, convertis chacun", () => {
    const conv = breakdown(videos(2, 50_000, FR_CPM, "a"), {
      unlocks: [{ montant: 200, currency: "eur" }],
      toReference: SNYTCH,
    });
    expect(conv.bonusTierCashTotal).toBe(232.56);
    expect(conv.total).toBe(round2(232.56 + 2 * 58.14));
  });
});

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Devise d'un CYCLE — partagée par l'écran et le paiement ────────────────

describe("cycleCurrencyOf", () => {
  const base = { projectPay: "usd", creatorCurrency: "eur", rowCurrency: undefined, hasLegacyItems: false };

  it("la devise des barèmes du cycle", () => {
    expect(
      cycleCurrencyOf({ ...base, breakdown: { currency: "eur", mixedCurrency: false } }),
    ).toEqual({ currency: "eur", mixedCurrency: false });
  });

  it("cycle vide : la devise de la créatrice", () => {
    expect(
      cycleCurrencyOf({ ...base, breakdown: { currency: null, mixedCurrency: false } }),
    ).toEqual({ currency: "eur", mixedCurrency: false });
  });

  it("lignes legacy (devise du projet) dans un cycle en euros : mélange", () => {
    expect(
      cycleCurrencyOf({
        ...base,
        hasLegacyItems: true,
        breakdown: { currency: "eur", mixedCurrency: false },
      }),
    ).toEqual({ currency: null, mixedCurrency: true });
  });

  it("un acompte versé en dollars sur un cycle en euros : mélange", () => {
    expect(
      cycleCurrencyOf({ ...base, rowCurrency: "usd", breakdown: { currency: "eur", mixedCurrency: false } }),
    ).toEqual({ currency: null, mixedCurrency: true });
  });

  it("créatrice en dollars, tout en dollars : rien ne change", () => {
    expect(
      cycleCurrencyOf({
        projectPay: "usd",
        creatorCurrency: "usd",
        rowCurrency: undefined,
        hasLegacyItems: true,
        breakdown: { currency: "usd", mixedCurrency: false },
      }),
    ).toEqual({ currency: "usd", mixedCurrency: false });
  });
});

// ─── Les totaux du projet ne fondent jamais deux devises ─────────────────────

describe("sumByCurrency / formatMoneyByCurrency", () => {
  it("une entrée par devise, la plus grosse d'abord, au centime", () => {
    expect(
      sumByCurrency([
        { amount: 465.12, currency: "usd" },
        { amount: 400, currency: "EUR" },
        { amount: 87.65, currency: "eur" },
        { amount: 23.4, currency: "usd" },
      ]),
    ).toEqual([
      { currency: "usd", amount: 488.52 },
      { currency: "eur", amount: 487.65 },
    ]);
  });

  it("rendu « 487,65 € · 488,52 $ », jamais une somme", () => {
    const s = formatMoneyByCurrency(
      [
        { currency: "eur", amount: 487.65 },
        { currency: "usd", amount: 488.52 },
      ],
      "fr-FR",
    );
    expect(s).toContain("487,65");
    expect(s).toContain("€");
    expect(s).toContain("488,52");
    expect(s).toContain("$");
    expect(s).not.toContain("976");
  });
});

describe("regrouperPaiements — un virement par créatrice ET par devise", () => {
  const ligne = (o: Partial<LignePaiement> & Pick<LignePaiement, "key" | "creatorId" | "creatorName">): LignePaiement => ({
    creatorPaymentMethod: "sepa",
    creatorPaymentDetails: null,
    status: "accruing",
    cycleStart: Date.UTC(2026, 8, 20),
    paidAt: null,
    remainingDue: 0,
    totalDue: 0,
    currency: "usd",
    ...o,
  });
  const rows = [
    ligne({ key: "m-1", creatorId: "m", creatorName: "Marie Lefèvre", currency: "eur", rate: 1 / 0.86, remainingDue: 350, totalDue: 350 }),
    ligne({ key: "s-1", creatorId: "s", creatorName: "Shane O'Connor", currency: "usd", rate: 1, remainingDue: 380.5, totalDue: 380.5 }),
  ];

  it("« à verser » par devise", () => {
    const v = regrouperPaiements(rows, Date.UTC(2026, 9, 3));
    expect(v.aVerser).toEqual([
      { currency: "usd", amount: 380.5 },
      { currency: "eur", amount: 350 },
    ]);
  });

  it("l'ordre compare des valeurs CONVERTIES : 350 € (407 $) passent devant 380,50 $", () => {
    const v = regrouperPaiements(rows, Date.UTC(2026, 9, 3));
    expect(v.avecDu.map((g) => [g.creatorName, g.currency])).toEqual([
      ["Marie Lefèvre", "eur"],
      ["Shane O'Connor", "usd"],
    ]);
  });
});

// ─── Classement : l'écart se lit dans TA devise ─────────────────────────────

describe("leaderboardWindow — écart entre deux devises", () => {
  const entries: RankedEntry[] = [
    { creatorId: "k57a", name: "Sofia Benali", rank: 1, totalDue: 251.25, isMe: false, rate: 1 },
    { creatorId: "k57b", name: "Marie Lefèvre", rank: 2, totalDue: 165.9, isMe: true, rate: 1 / 0.86 },
  ];

  it("251,25 $ devant 165,90 € : l'écart est de 50,17 €, pas de 85,35", () => {
    const w = leaderboardWindow(entries)!;
    // 251,25 $ = 216,075 € ; 216,075 − 165,90 = 50,175 → 50,17 €.
    expect(w.gapToAhead).toBe(50.17);
  });

  it("sans taux (tout le monde dans la même devise) : la soustraction d'avant", () => {
    const w = leaderboardWindow(entries.map((e) => ({ ...e, rate: undefined })))!;
    expect(w.gapToAhead).toBe(85.35);
  });
});

// ─── E-mail « paiement effectué » : le symbole vient de la row ───────────────

describe("emailAmount — devise de la row payée", () => {
  it("dollar par défaut, à l'identique d'avant", () => {
    expect(emailAmount(1103.8, "fr")).toBe("1 103,80 $");
    expect(emailAmount(1103.8, "en")).toBe("$1,103.80");
  });

  it("euro : « 1 103,80 € » en français, « €1,103.80 » en anglais", () => {
    expect(emailAmount(1103.8, "fr", "eur")).toBe("1 103,80 €");
    expect(emailAmount(1103.8, "en", "EUR")).toBe("€1,103.80");
    expect(emailAmount(400, "es", "eur")).toBe("400 €");
    expect(emailAmount(1234.5, "pt", "eur")).toBe("1.234,50 €");
  });
});

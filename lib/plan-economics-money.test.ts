import { describe, expect, it } from "vitest";
import {
  membershipEconomicsOf,
  type PlanEconomicsPaymentLike,
} from "../convex/planEconomics";
import {
  projectFx,
  summarizeWhopRevenue,
  whopNetInSummaryCurrency,
} from "../convex/whopRevenue";

/**
 * Économie par offre, LTV réalisée et revenu mensuel par client (onglet Offres
 * « Économie par offre » ; MCP `revenus` : `historique.ltvRealiseeParClient`,
 * `revenuMensuelParClient`, `offres[]`).
 *
 * Bug du 08/10/2026 sur Snytch (EUR + USD + RSD) : le net de chaque paiement
 * s'accumulait par abonnement DANS SA DEVISE. L'offre « Snytch Pro 3 cilja —
 * Nedeljno » (599 RSD) affichait 2 141,05 de net et 237,89 de LTV — des dinars
 * lus comme des euros —, et la LTV du projet montait avec. Les taux sont ceux
 * du projet à cette date.
 */
const SNYTCH_FX = projectFx({
  payCurrency: "usd",
  fxRateToRevenue: 0.86,
  fxRatesToRevenue: [{ currency: "rsd", rate: 0.00852 }],
});

// 10:00 UTC = midi à Paris : le mois métier ne dépend pas du fuseau du runner.
const SEPT = Date.UTC(2026, 8, 15, 10);
const OCT = Date.UTC(2026, 9, 6, 10);

function paiement(
  membershipId: string | undefined,
  planId: string,
  paidAt: number,
  currency: string,
  net: number,
  extra: Partial<PlanEconomicsPaymentLike> = {},
): PlanEconomicsPaymentLike {
  return {
    membershipId,
    planId,
    paidAt,
    currency,
    status: "paid",
    grossAmount: net,
    feeAmount: 0,
    netAmount: net,
    refundedAmount: 0,
    ...extra,
  };
}

//  plan_eur : 9,31 € en sept + 9,31 € en oct (un abonnement), plus un
//             abonnement dont le seul paiement a échoué (compté, net nul).
//  plan_rsd : 535,26 RSD en sept + 535,26 RSD en oct (= 2 × 4,56 €), plus un
//             paiement de 0,50 RSD (0,004 € → 0,00 € une fois converti) : le
//             mois est ACTIF quand même, il a encaissé.
//  plan_usd : 11,12 $ (= 9,56 €).
const PAIEMENTS: PlanEconomicsPaymentLike[] = [
  paiement("mem_fr", "plan_eur", SEPT, "eur", 9.31),
  paiement("mem_fr", "plan_eur", OCT, "eur", 9.31),
  paiement("mem_echec", "plan_eur", OCT, "eur", 0, { status: "failed" }),
  paiement("mem_rs", "plan_rsd", SEPT, "rsd", 535.26),
  paiement("mem_rs", "plan_rsd", OCT, "rsd", 535.26),
  paiement("mem_rs_mini", "plan_rsd", OCT, "rsd", 0.5),
  paiement("mem_us", "plan_usd", OCT, "usd", 11.12),
];

const eco = (payments = PAIEMENTS, fx = SNYTCH_FX) =>
  membershipEconomicsOf(payments, summarizeWhopRevenue(payments, fx));

describe("membershipEconomicsOf — devises", () => {
  it("le résumé du lot ramène bien RSD et USD en euros (référentiel du test)", () => {
    const s = summarizeWhopRevenue(PAIEMENTS, SNYTCH_FX);
    expect(s.currency).toBe("eur");
    expect(s.mixedCurrency).toBe(false);
    expect(s.conversions.map((c) => c.from)).toEqual(["rsd", "usd"]);
  });

  it("net cumulé, LTV et net par mois-abonné de chaque offre sont en euros", () => {
    const { plans } = eco();
    // 2 × 535,26 RSD × 0,00852 = 2 × 4,56 € (+ 0,00 €) — et non 1 071,02.
    expect(plans.get("plan_rsd")).toEqual({
      members: 2,
      netTotal: 9.12,
      ltv: 4.56,
      netPerMemberMonth: 3.04, // 9,12 € ÷ 3 mois actifs (sept, oct, + oct du 0,50 RSD)
      netPerPayment: 3.04, // 9,12 € ÷ 3 paiements encaissés
    });
    // 11,12 $ × 0,86 — et non 11,12.
    expect(plans.get("plan_usd")).toEqual({
      members: 1,
      netTotal: 9.56,
      ltv: 9.56,
      netPerMemberMonth: 9.56,
      netPerPayment: 9.56,
    });
    // Déjà en euros : inchangé. L'abonnement en échec compte (2 abonnés), sans mois actif.
    expect(plans.get("plan_eur")).toEqual({
      members: 2,
      netTotal: 18.62,
      ltv: 9.31,
      netPerMemberMonth: 9.31,
      netPerPayment: 9.31,
    });
  });

  it("LTV et revenu mensuel du projet : des euros, pas une somme de devises", () => {
    const e = eco();
    // 18,62 + 9,12 + 9,56 = 37,30 € sur 5 abonnements — et non 1 100,76 ÷ 5.
    expect(e.ltv).toBe(7.46);
    // 37,30 € sur 6 mois-abonnés (2 + 2 + 1 + 1).
    expect(e.monthlyArpu).toBe(6.22);
  });

  it("les offres se somment sur le net du lot, conversion faite paiement par paiement", () => {
    const { plans } = eco();
    const s = summarizeWhopRevenue(PAIEMENTS, SNYTCH_FX);
    const somme = [...plans.values()].reduce((t, p) => t + (p.netTotal ?? 0), 0);
    const parPaiement = PAIEMENTS.reduce((t, p) => t + whopNetInSummaryCurrency(p, s), 0);
    expect(Math.round(somme * 100) / 100).toBe(Math.round(parPaiement * 100) / 100);
    // Le résumé convertit par devise, nous par paiement : l'écart est l'arrondi.
    expect(Math.abs(somme - s.net)).toBeLessThan(0.02);
  });
});

describe("membershipEconomicsOf — devise sans taux (A5)", () => {
  // Le dinar sans taux : deux devises encaissées non convertibles.
  const SANS_RSD = projectFx({ payCurrency: "usd", fxRateToRevenue: 0.86 });

  it("montants null, jamais une somme d'euros et de dinars", () => {
    const e = eco(PAIEMENTS, SANS_RSD);
    expect(e.ltv).toBeNull();
    expect(e.monthlyArpu).toBeNull();
    for (const p of e.plans.values()) {
      expect(p.netTotal).toBeNull();
      expect(p.ltv).toBeNull();
      expect(p.netPerMemberMonth).toBeNull();
      expect(p.netPerPayment).toBeNull();
    }
  });

  it("les compteurs restent justes", () => {
    const { plans } = eco(PAIEMENTS, SANS_RSD);
    expect([...plans.entries()].map(([id, p]) => [id, p.members])).toEqual([
      ["plan_eur", 2],
      ["plan_rsd", 2],
      ["plan_usd", 1],
    ]);
  });
});

describe("membershipEconomicsOf — une seule devise (non-régression)", () => {
  // Forme de e2e/mcp-revenus.spec.ts : un payé, un remboursé, un litige.
  const MOIS: PlanEconomicsPaymentLike[] = [
    paiement("mem_b", "plan_mois", OCT, "eur", 18.37),
    paiement("mem_c", "plan_mois", OCT, "eur", 18.37, {
      status: "refunded",
      refundedAmount: 18.37,
    }),
    paiement("mem_d", "plan_mois", SEPT, "eur", 18.37, { status: "disputed" }),
    paiement(undefined, "plan_mois", OCT, "eur", 18.37),
  ];

  it("3 abonnés, 18,37 € de net → LTV 6,12 ; le paiement sans abonnement compte au net/paiement", () => {
    const e = membershipEconomicsOf(MOIS, summarizeWhopRevenue(MOIS, SNYTCH_FX));
    expect(e.plans.get("plan_mois")).toEqual({
      members: 3,
      netTotal: 18.37,
      ltv: 6.12,
      netPerMemberMonth: 18.37,
      netPerPayment: 18.37,
    });
    expect(e.ltv).toBe(6.12);
    expect(e.monthlyArpu).toBe(18.37);
  });
});

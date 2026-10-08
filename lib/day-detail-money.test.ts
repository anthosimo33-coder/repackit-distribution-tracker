import { describe, expect, it } from "vitest";
import { dayDetailOf, type DayDetailPaymentLike } from "../convex/dayDetail";
import {
  projectFx,
  summarizeWhopRevenue,
  whopNetInSummaryCurrency,
} from "../convex/whopRevenue";

/**
 * Détail par jour (Vue d'ensemble) — l'argent par ref, par pays de facturation
 * et la décomposition du revenu.
 *
 * Bug du 08/10/2026 sur Snytch (EUR + USD + RSD) : chaque paiement entrait dans
 * les sommes avec son net DANS SA DEVISE. Une échéance serbe de 1 049 RSD
 * (≈ 8,94 €) s'ajoutait telle quelle aux euros de la même ref. Les taux sont
 * ceux du projet à cette date.
 */
const SNYTCH_FX = projectFx({
  payCurrency: "usd",
  fxRateToRevenue: 0.86,
  fxRatesToRevenue: [{ currency: "rsd", rate: 0.00852 }],
});

const DAY = 86_400_000;
// 10:00 UTC = midi à Paris : le jour métier ne dépend pas du fuseau du runner.
const J = Date.UTC(2026, 9, 7, 10);
const JOUR = "2026-10-07";

function paiement(
  membershipId: string,
  paidAt: number,
  currency: string,
  net: number,
  billingCountry: string | undefined,
  extra: Partial<DayDetailPaymentLike> = {},
): DayDetailPaymentLike {
  return {
    membershipId,
    paidAt,
    currency,
    status: "paid",
    grossAmount: net,
    feeAmount: 0,
    netAmount: net,
    refundedAmount: 0,
    billingCountry,
    ...extra,
  };
}

const REF_OF = new Map<string, string | null>([
  ["mem_fr1", "kelly"],
  ["mem_rs1", "kelly"],
  ["mem_rs2", "kelly"],
  ["mem_us1", null],
  ["mem_us2", "paredes"],
  ["mem_us3", "paredes"],
]);

// Le jour J :
//  - kelly   : 1 nouveau client FR à 9,99 €, 1 échéance RS de 1 049 RSD, 1 échec RS ;
//  - (aucune): 1 nouveau client US à 20 $ ;
//  - paredes : 1 échéance US de 20 $ remboursée de 5 $, 1 paiement de 20 $
//              intégralement remboursé.
const LOT: DayDetailPaymentLike[] = [
  paiement("mem_rs1", J - 30 * DAY, "rsd", 1049, "RS"),
  paiement("mem_us2", J - 30 * DAY, "usd", 20, "US"),
  paiement("mem_fr1", J, "eur", 9.99, "FR"),
  paiement("mem_rs1", J, "rsd", 1049, "RS"),
  paiement("mem_rs2", J, "rsd", 0, "RS", { status: "failed" }),
  paiement("mem_us1", J, "usd", 20, undefined),
  paiement("mem_us2", J, "usd", 20, "US", { refundedAmount: 5 }),
  paiement("mem_us3", J, "usd", 20, "US", { status: "refunded", refundedAmount: 20 }),
];

const detail = (payments = LOT, fx = SNYTCH_FX) =>
  dayDetailOf({ traffic: [], payments, refOf: REF_OF, sansSource: "sans source", fx });

describe("dayDetailOf — devises", () => {
  it("ramène l'argent des refs en euros au taux du projet", () => {
    const refs = detail().refs.filter((r) => r.day === JOUR);
    const net = (ref: string) => refs.find((r) => r.ref === ref)?.net;
    // 9,99 € + 1 049 × 0,00852 (= 8,94 €) — et non 1 058,99.
    expect(net("kelly")).toBe(18.93);
    // 20 $ × 0,86.
    expect(net("sans source")).toBe(17.2);
    // (20 − 5) $ × 0,86.
    expect(net("paredes")).toBe(12.9);
  });

  it("décompose le revenu du jour en euros, remboursements compris", () => {
    const rev = detail().revenue.find((r) => r.day === JOUR);
    expect(rev).toMatchObject({
      // 9,99 € + 17,20 €
      newNet: 27.19,
      // 8,94 € + 12,90 €
      renewalNet: 21.84,
      // (5 + 20) $ × 0,86 — et non 25.
      refunded: 21.5,
    });
  });

  it("ramène l'argent des pays de facturation en euros", () => {
    const pays = detail().billingCountries.filter((b) => b.day === JOUR);
    const de = (c: string | null) => pays.find((b) => b.country === c);
    expect(de("FR")).toMatchObject({ clients: 1, renewals: 0, net: 9.99 });
    expect(de("RS")).toMatchObject({ clients: 0, renewals: 1, failures: 1, net: 8.94 });
    expect(de("US")).toMatchObject({ clients: 0, renewals: 1, net: 12.9 });
    expect(de(null)).toMatchObject({ clients: 1, net: 17.2 });
  });

  it("la somme des refs du jour = le net du jour de la colonne principale (même référentiel)", () => {
    // Ce que calcule getRevenue pour la colonne « Revenu net » du tableau.
    const ref = summarizeWhopRevenue(LOT, SNYTCH_FX);
    const netDuJour = LOT.filter((p) => p.paidAt === J).reduce(
      (t, p) => t + whopNetInSummaryCurrency(p, ref),
      0,
    );
    const d = detail();
    const refs = d.refs.filter((r) => r.day === JOUR);
    const sommeRefs = refs.reduce((t, r) => t + (r.net ?? 0), 0);
    expect(Math.round(sommeRefs * 100) / 100).toBe(Math.round(netDuJour * 100) / 100);
    const rev = d.revenue.find((r) => r.day === JOUR);
    expect(Math.round(((rev?.newNet ?? 0) + (rev?.renewalNet ?? 0)) * 100) / 100).toBe(
      Math.round(netDuJour * 100) / 100,
    );
  });

  it("expose la devise et les conversions pour que l'écran les annonce", () => {
    const d = detail();
    expect(d.currency).toBe("eur");
    expect(d.mixedCurrency).toBe(false);
    expect(d.conversions).toEqual([
      { from: "rsd", rate: 0.00852 },
      { from: "usd", rate: 0.86 },
    ]);
    // Devises du jour : celles des paiements qui y portent de l'argent.
    expect(d.revenue.find((r) => r.day === JOUR)?.currencies).toEqual(["eur", "rsd", "usd"]);
    expect(d.revenue.find((r) => r.day === "2026-09-07")?.currencies).toEqual(["rsd", "usd"]);
  });

  it("devise encaissée sans taux : aucun montant additionné (null), compteurs intacts", () => {
    // Le dinar sans taux : euros et dinars ne se ramènent plus à une seule devise.
    const sansDinar = projectFx({ payCurrency: "usd", fxRateToRevenue: 0.86 });
    const d = detail(LOT, sansDinar);

    expect(d.mixedCurrency).toBe(true);
    expect(d.currency).toBeNull();
    const kelly = d.refs.find((r) => r.day === JOUR && r.ref === "kelly");
    expect(kelly).toMatchObject({ clients: 1, renewals: 1, failures: 1, net: null });
    expect(d.revenue.find((r) => r.day === JOUR)).toMatchObject({
      newNet: null,
      renewalNet: null,
      refunded: null,
    });
    expect(d.billingCountries.filter((b) => b.day === JOUR).every((b) => b.net === null)).toBe(
      true,
    );
  });

  it("devise sans taux : un vrai zéro reste un zéro (rien encaissé ≠ non additionnable)", () => {
    const sansDinar = projectFx({ payCurrency: "usd", fxRateToRevenue: 0.86 });
    const d = dayDetailOf({
      traffic: [{ date: JOUR, ref: "lea", visitors: 12, signups: 1 }],
      payments: LOT,
      refOf: REF_OF,
      sansSource: "sans source",
      fx: sansDinar,
    });
    expect(d.refs.find((r) => r.ref === "lea")).toMatchObject({ visitors: 12, net: 0 });
    // Le jour J−30 n'a aucun remboursement : 0, pas null.
    expect(d.revenue.find((r) => r.day === "2026-09-07")?.refunded).toBe(0);
  });

  it("remboursement dans une devise hors référentiel : exclu du total, jamais additionné, signalé", () => {
    // Une livre sterling remboursée : présente, jamais encaissée, sans taux.
    const lot = [
      ...LOT,
      paiement("mem_gb1", J, "gbp", 15, "GB", { status: "refunded", refundedAmount: 15 }),
    ];
    const rev = detail(lot).revenue.find((r) => r.day === JOUR);
    expect(rev?.refunded).toBe(21.5);
    expect(rev?.excludedCurrencies).toEqual(["gbp"]);
  });

  it("un paiement converti arrondi à 0,00 compte quand même son client", () => {
    // 0,50 RSD × 0,00852 = 0,004 € → 0,00 € : le client existe, son montant non.
    const lot = [...LOT, paiement("mem_rs9", J, "rsd", 0.5, "RS")];
    const rs = detail(lot).billingCountries.find((b) => b.day === JOUR && b.country === "RS");
    expect(rs).toMatchObject({ clients: 1, renewals: 1, net: 8.94 });
  });

  it("une seule devise : montants inchangés, aucune conversion", () => {
    const euros = LOT.filter((p) => p.currency === "eur");
    const d = detail(euros);
    expect(d.currency).toBe("eur");
    expect(d.conversions).toEqual([]);
    expect(d.refs).toEqual([
      {
        day: JOUR,
        ref: "kelly",
        visitors: null,
        signups: null,
        clients: 1,
        renewals: 0,
        failures: 0,
        net: 9.99,
      },
    ]);
  });
});

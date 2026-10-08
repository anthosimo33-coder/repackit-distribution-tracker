import { describe, expect, it } from "vitest";
import { billingCountriesOf, type BillingPaymentLike } from "../convex/billingCountries";
import { projectFx } from "../convex/whopRevenue";

/**
 * Ventes par pays de facturation (Parcours + outil MCP `parcours`).
 *
 * Cas réel du 08/10/2026 sur Snytch : la Serbie, payée en dinars, sortait 2ᵉ
 * pays avec « 3 238,76 » de revenu — des RSD bruts, ≈ 28 € — devant des pays
 * payés en euros bien plus gros. Les taux sont ceux du projet à cette date.
 */
const SNYTCH_FX = projectFx({
  payCurrency: "usd",
  fxRateToRevenue: 0.86,
  fxRatesToRevenue: [{ currency: "rsd", rate: 0.00852 }],
});

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);

function paiement(
  membershipId: string,
  jour: number,
  currency: string,
  net: number,
  billingCountry: string | undefined,
  status: BillingPaymentLike["status"] = "paid",
): BillingPaymentLike {
  return {
    membershipId,
    paidAt: T0 + jour * DAY,
    currency,
    status,
    grossAmount: status === "failed" ? 0 : net,
    feeAmount: 0,
    netAmount: status === "failed" ? 0 : net,
    refundedAmount: 0,
    billingCountry,
  };
}

// FR : 5 clients en euros (49,95 €). RS : 1 client, 3 échéances de 1 049 RSD
// (3 147 RSD ≈ 26,82 €) et un échec. US : 2 clients à 20 $ (40 $ = 34,40 €).
const LOT: BillingPaymentLike[] = [
  ...[1, 2, 3, 4, 5].map((i) => paiement(`mem_fr${i}`, i, "eur", 9.99, "FR")),
  paiement("mem_rs1", 0, "rsd", 1049, "RS"),
  paiement("mem_rs1", 30, "rsd", 1049, "RS"),
  paiement("mem_rs1", 60, "rsd", 1049, "RS"),
  paiement("mem_rs2", 10, "rsd", 1049, "RS", "failed"),
  paiement("mem_us1", 3, "usd", 20, "US"),
  paiement("mem_us2", 4, "usd", 20, "US"),
];

describe("billingCountriesOf — devises", () => {
  it("ramène chaque paiement en euros au taux du projet : RS ne passe plus devant FR", () => {
    const r = billingCountriesOf(LOT, new Map(), SNYTCH_FX);

    expect(r.rows.map((x) => x.country)).toEqual(["FR", "US", "RS"]);
    // 1 049 × 0,00852 = 8,94 € par échéance, converti paiement par paiement.
    expect(r.rows.find((x) => x.country === "RS")?.net).toBe(26.82);
    expect(r.rows.find((x) => x.country === "US")?.net).toBe(34.4);
    expect(r.rows.find((x) => x.country === "FR")?.net).toBe(49.95);
    // Aucune ligne ne porte un montant en devise d'origine.
    expect(r.rows.some((x) => x.net === 3147 || x.net === 40)).toBe(false);

    expect(r.currency).toBe("eur");
    expect(r.mixedCurrency).toBe(false);
    expect(r.conversions).toEqual([
      { from: "rsd", rate: 0.00852 },
      { from: "usd", rate: 0.86 },
    ]);
    expect(r.currencies.sort()).toEqual(["eur", "rsd", "usd"]);
  });

  it("garde les compteurs intacts : clients, renouvellements, échecs", () => {
    const r = billingCountriesOf(LOT, new Map(), SNYTCH_FX);
    const rs = r.rows.find((x) => x.country === "RS");
    expect(rs).toMatchObject({ clients: 1, renewals: 2, failures: 1 });
    expect(r.rows.find((x) => x.country === "FR")).toMatchObject({ clients: 5, renewals: 0 });
    expect(r.clients).toBe(8);
    expect(r.payments).toBe(LOT.length);
  });

  it("devise sans taux du projet : le revenu n'est PAS additionné (null), classement par clients", () => {
    // Le dinar sans taux : euros et dinars ne peuvent plus être ramenés à une seule devise.
    const sansDinar = projectFx({ payCurrency: "usd", fxRateToRevenue: 0.86 });
    const r = billingCountriesOf(LOT, new Map(), sansDinar);

    expect(r.mixedCurrency).toBe(true);
    expect(r.currency).toBeNull();
    expect(r.rows.every((x) => x.net === null)).toBe(true);
    expect(r.rows.map((x) => x.country)).toEqual(["FR", "US", "RS"]);
  });

  it("une seule devise : montants inchangés, aucune conversion annoncée", () => {
    const euros = LOT.filter((p) => p.currency === "eur");
    const r = billingCountriesOf(euros, new Map(), SNYTCH_FX);
    expect(r.currency).toBe("eur");
    expect(r.conversions).toEqual([]);
    expect(r.rows).toEqual([
      { country: "FR", clients: 5, renewals: 0, failures: 0, net: 49.95 },
    ]);
  });

  it("aucun paiement : vide, sans devise", () => {
    expect(billingCountriesOf([], new Map(), null)).toEqual({
      rows: [],
      payments: 0,
      withCountry: 0,
      clients: 0,
      clientsWithCountry: 0,
      currency: null,
      currencies: [],
      mixedCurrency: false,
      conversions: [],
    });
  });
});

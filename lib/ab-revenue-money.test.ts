import { describe, expect, it } from "vitest";
import {
  abRevenueOf,
  type AbRevenueMembershipLike,
  type AbRevenuePaymentLike,
} from "../convex/abRevenue";
import {
  projectFx,
  summarizeWhopRevenue,
  whopNetInSummaryCurrency,
} from "../convex/whopRevenue";

/**
 * Revenu par bras du test A/B (onglet Offres, « Net / assigné » ; MCP `offres`
 * et `revenus`).
 *
 * Bug du 08/10/2026 sur Snytch (EUR + USD + RSD) : le net de chaque paiement
 * entrait, par abonnement puis par bras, DANS SA DEVISE. Une échéance de
 * 1 049 RSD (≈ 8,94 €) pesait comme 1 049 € dans le bras. Les taux sont ceux
 * du projet à cette date.
 */
const SNYTCH_FX = projectFx({
  payCurrency: "usd",
  fxRateToRevenue: 0.86,
  fxRatesToRevenue: [{ currency: "rsd", rate: 0.00852 }],
});

const DAY = 86_400_000;
const DEBUT_TEST = Date.UTC(2026, 8, 1, 10);
const J = Date.UTC(2026, 9, 7, 10);

function paiement(
  membershipId: string,
  currency: string,
  net: number,
  extra: Partial<AbRevenuePaymentLike> = {},
): AbRevenuePaymentLike {
  return {
    membershipId,
    currency,
    status: "paid",
    grossAmount: net,
    feeAmount: 0,
    netAmount: net,
    refundedAmount: 0,
    paidAt: J,
    ...extra,
  };
}

const abonnement = (
  whopMembershipId: string,
  createdAt: number,
  extra: Partial<AbRevenueMembershipLike> = {},
): AbRevenueMembershipLike => ({ whopMembershipId, createdAt, ...extra });

//  soft  : 9,99 € + 2 × 1 049 RSD + 20 $                 = 9,99 + 17,88 + 17,20
//  hard  : 30 $ remboursés de 10 $, un litige de 20 $,
//          un litige de 0,50 RSD (0,004 € → 0,00 €)
//  trial : un abonnement dont le seul paiement a échoué  (vrai zéro)
//  écarté (flipper) : 1 049 RSD ; non rattaché : 5 € ; QA forcé : 9,99 € ;
//  antérieur au test : 9,99 €.
const PAIEMENTS: AbRevenuePaymentLike[] = [
  paiement("mem_s_eur", "eur", 9.99),
  paiement("mem_s_rsd", "rsd", 1049),
  paiement("mem_s_rsd", "rsd", 1049),
  paiement("mem_s_usd", "usd", 20),
  paiement("mem_h_usd", "usd", 30, { refundedAmount: 10 }),
  paiement("mem_h_litige", "usd", 20, { status: "disputed" }),
  paiement("mem_h_mini", "rsd", 0.5, { status: "disputed" }),
  paiement("mem_t_echec", "eur", 0, { status: "failed" }),
  paiement("mem_flip", "rsd", 1049),
  paiement("mem_seul", "eur", 5),
  paiement("mem_qa", "eur", 9.99),
  paiement("mem_ancien", "eur", 9.99),
];

const ABONNEMENTS: AbRevenueMembershipLike[] = [
  abonnement("mem_s_eur", J, { abVariant: "soft" }),
  abonnement("mem_s_rsd", J - 30 * DAY, { abVariant: "soft" }),
  abonnement("mem_s_usd", J, { distinctId: "ph_soft" }),
  abonnement("mem_h_usd", J, { abVariant: "hard" }),
  abonnement("mem_h_litige", J, { abVariant: "hard" }),
  abonnement("mem_h_mini", J, { abVariant: "hard" }),
  abonnement("mem_t_echec", J, { abVariant: "trial" }),
  abonnement("mem_flip", J, { abVariant: "soft", distinctId: "ph_flip" }),
  abonnement("mem_seul", J),
  abonnement("mem_qa", J, { abVariant: "hard", abForced: true }),
  abonnement("mem_ancien", DEBUT_TEST - DAY, { abVariant: "soft" }),
];

const LOOKUP = {
  personArms: new Map([["ph_soft", "soft"]]),
  flipperDistinctIds: new Set(["ph_flip"]),
};

const revenu = (
  opts: {
    payments?: AbRevenuePaymentLike[];
    fx?: ReturnType<typeof projectFx>;
    acquisition?: { from: number; to: number } | null;
  } = {},
) =>
  abRevenueOf({
    payments: opts.payments ?? PAIEMENTS,
    memberships: ABONNEMENTS,
    lookup: LOOKUP,
    startMs: DEBUT_TEST,
    acquisition: opts.acquisition ?? null,
    internalCfg: { handles: [], whopMembershipIds: [] },
    fx: opts.fx === undefined ? SNYTCH_FX : opts.fx,
    nowMs: J + DAY,
  });

const bras = (r: ReturnType<typeof revenu>, v: string) => r.rows.find((x) => x.variant === v);

describe("abRevenueOf — devises", () => {
  it("ramène le net de chaque bras en euros au taux du projet", () => {
    const r = revenu();
    // 9,99 € + 2 × 1 049 × 0,00852 (= 17,88 €) + 20 × 0,86 (= 17,20 €) — et non 2 127,99.
    expect(bras(r, "soft")).toMatchObject({ net: 45.07, memberships: 3, viaFallback: 1 });
    // (30 − 10) $ × 0,86 ; les litiges sont exclus du net.
    expect(bras(r, "hard")).toMatchObject({ net: 17.2, memberships: 3 });
  });

  it("convertit le montant en litige, et compte un litige que la conversion arrondit à 0,00", () => {
    // 20 $ × 0,86 + 0,50 RSD × 0,00852 (0,004 € → 0,00 €) — et non 20,5.
    expect(bras(revenu(), "hard")).toMatchObject({ atRiskMemberships: 2, atRiskAmount: 17.2 });
  });

  it("convertit le net des abonnements écartés pour changement de bras", () => {
    const r = revenu();
    expect(r.excludedFlippers).toBe(1);
    // 1 049 RSD × 0,00852 — et non 1 049.
    expect(r.excludedFlippersNet).toBe(8.94);
    expect(r.unattached).toBe(1);
  });

  it("même référentiel que le résumé de Revenus (devise, taux, net par paiement)", () => {
    const ref = summarizeWhopRevenue(PAIEMENTS, SNYTCH_FX);
    const r = revenu();
    expect(r.currency).toBe(ref.currency);
    expect(r.currency).toBe("eur");
    expect(r.mixedCurrency).toBe(false);
    expect(r.currencies).toEqual(["eur", "rsd", "usd"]);
    expect(r.conversions).toEqual([
      { from: "rsd", rate: 0.00852 },
      { from: "usd", rate: 0.86 },
    ]);
    const soft = new Set(["mem_s_eur", "mem_s_rsd", "mem_s_usd"]);
    const attendu = PAIEMENTS.filter((p) => soft.has(p.membershipId ?? "")).reduce(
      (t, p) => t + whopNetInSummaryCurrency(p, ref),
      0,
    );
    expect(bras(r, "soft")?.net).toBe(Math.round(attendu * 100) / 100);
  });

  it("période choisie : seuls les abonnements acquis dedans, toujours convertis", () => {
    const r = revenu({ acquisition: { from: J - 31 * DAY, to: J - 29 * DAY } });
    expect(r.rows).toEqual([
      {
        variant: "soft",
        net: 17.88,
        memberships: 1,
        viaFallback: 0,
        viaFlipperRule: 0,
        atRiskMemberships: 0,
        atRiskAmount: 0,
      },
    ]);
  });

  it("devise encaissée sans taux : aucun montant additionné (null), compteurs intacts", () => {
    // Le dinar sans taux : euros et dinars ne se ramènent plus à une seule devise.
    const sansDinar = projectFx({ payCurrency: "usd", fxRateToRevenue: 0.86 });
    const r = revenu({ fx: sansDinar });
    expect(r.mixedCurrency).toBe(true);
    expect(r.currency).toBeNull();
    expect(r.conversions).toEqual([]);
    expect(bras(r, "soft")).toMatchObject({ net: null, memberships: 3, viaFallback: 1 });
    expect(bras(r, "hard")).toMatchObject({
      net: null,
      memberships: 3,
      atRiskMemberships: 2,
      atRiskAmount: null,
    });
    expect(r.excludedFlippers).toBe(1);
    expect(r.excludedFlippersNet).toBeNull();
    expect(r.unattached).toBe(1);
  });

  it("devise sans taux : un bras sans aucun encaissement reste un vrai zéro", () => {
    const sansDinar = projectFx({ payCurrency: "usd", fxRateToRevenue: 0.86 });
    expect(bras(revenu({ fx: sansDinar }), "trial")).toMatchObject({
      net: 0,
      memberships: 1,
      atRiskAmount: 0,
    });
  });

  it("une seule devise : montants inchangés, aucune conversion", () => {
    const euros = PAIEMENTS.filter((p) => p.currency === "eur");
    const r = revenu({ payments: euros });
    expect(r.currency).toBe("eur");
    expect(r.conversions).toEqual([]);
    expect(bras(r, "soft")).toMatchObject({ net: 9.99, memberships: 3 });
    expect(bras(r, "hard")).toMatchObject({ net: 0, atRiskMemberships: 0, atRiskAmount: 0 });
  });
});

describe("abRevenueOf — personnes ayant changé de bras (règle du 24/10/2026)", () => {
  // Personne ph_flip : étiquetée soft sur son abonnement Whop, mais la règle
  // (offre ouverte au checkout) la rattache à hard. Personne ph_indecis : deux
  // offres ouvertes, reste écartée.
  const paiements = [
    ...PAIEMENTS,
    paiement("mem_indecis", "eur", 9.99),
  ];
  const abonnements = [
    ...ABONNEMENTS,
    abonnement("mem_indecis", J, { abVariant: "hard", distinctId: "ph_indecis" }),
  ];
  const avecRegle = (flipperArms: Map<string, string> | undefined) =>
    abRevenueOf({
      payments: paiements,
      memberships: abonnements,
      lookup: {
        personArms: new Map([["ph_soft", "soft"]]),
        flipperDistinctIds: new Set(["ph_flip", "ph_indecis"]),
        flipperArms,
      },
      startMs: DEBUT_TEST,
      acquisition: null,
      internalCfg: { handles: [], whopMembershipIds: [] },
      fx: SNYTCH_FX,
      nowMs: J + DAY,
    });

  it("rattache l'argent du flipper au bras de la RÈGLE, pas à celui de sa metadata", () => {
    const r = avecRegle(new Map([["ph_flip", "hard"]]));
    // 1 049 RSD × 0,00852 = 8,94 € passent dans hard ; soft garde ses 45,07 €.
    expect(bras(r, "soft")).toMatchObject({ net: 45.07, memberships: 3, viaFlipperRule: 0 });
    expect(bras(r, "hard")).toMatchObject({ net: 26.14, memberships: 4, viaFlipperRule: 1 });
    expect(r.reattributedFlippers).toBe(1);
    expect(r.reattributedFlippersNet).toBe(8.94);
    expect(r.reattributedAgainstMetadata).toBe(1);
    // L'indécidable reste écarté, et compté.
    expect(r.excludedFlippers).toBe(1);
    expect(r.excludedFlippersNet).toBe(9.99);
  });

  it("cache d'avant la règle (sans flipperArms) : les deux flippers restent écartés", () => {
    const r = avecRegle(undefined);
    expect(r.reattributedFlippers).toBe(0);
    expect(r.excludedFlippers).toBe(2);
    expect(bras(r, "hard")).toMatchObject({ net: 17.2, memberships: 3 });
  });

  it("rend la courbe de net cumulé de chaque plan, sur TOUS les abonnements (hors fenêtre du test)", () => {
    const pay = [
      { ...paiement("mem_ancien", "eur", 9.27), paidAt: DEBUT_TEST - DAY },
      { ...paiement("mem_ancien", "eur", 9.27), paidAt: DEBUT_TEST + 6 * DAY + 60_000 },
    ];
    const r = abRevenueOf({
      payments: pay,
      memberships: [abonnement("mem_ancien", DEBUT_TEST - DAY, { planId: "plan_8Eo6l4YYhkeI5" })],
      lookup: LOOKUP,
      startMs: DEBUT_TEST,
      acquisition: { from: J - DAY, to: J },
      internalCfg: { handles: [], whopMembershipIds: [] },
      fx: SNYTCH_FX,
      nowMs: J,
    });
    // L'abonnement précède le test ET la période : hors des lignes de bras…
    expect(r.rows).toEqual([]);
    // …mais dans la courbe de son offre.
    expect(r.netCurves).toEqual([
      {
        planId: "plan_8Eo6l4YYhkeI5",
        points: [
          { day: 7, n: 1, net: 18.54 },
          { day: 14, n: 1, net: 18.54 },
          { day: 28, n: 1, net: 18.54 },
          { day: 42, n: 0, net: 0 },
        ],
      },
    ]);
  });
});

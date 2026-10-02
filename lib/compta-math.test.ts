import { describe, it, expect } from "vitest";
import {
  aggregateLedgerDays,
  balanceByCurrency,
  bucketOf,
  buildComptaFx,
  builtinBucketOf,
  creatorCashOuts,
  creatorsControl,
  grossByDay,
  isFailedWithdrawal,
  isScanPaidLow,
  ledgerAmount,
  ledgerTotals,
  plannedOccurrences,
  referenceCurrency,
  scanCostUsd,
  scansSwap,
  thresholdView,
  transfersSinceReading,
  treasuryView,
  transferPartsError,
  transferPartsOf,
  type LedgerDayCell,
} from "../convex/comptaMath";
import { fetchWhopLedger, normalizeLedgerLine } from "../convex/whopLedgerApi";

/**
 * COMPTA — le classement des lignes du grand livre Whop, les conversions, la
 * trésorerie créatrices, les récurrences et le compteur de seuils.
 *
 * Les entrées ont la forme de la PROD : montants Whop en chaînes à la précision
 * 1e8 (pas des centimes), encaissements à 22 h 30 UTC un 31 du mois (le 1er à
 * Paris), trois devises dont une sans taux, prénom + nom des créatrices.
 */

const FX = buildComptaFx("eur", [
  { from: "usd", rate: 0.86 },
  { from: "rsd", rate: 0.00852 },
]);

describe("montant d'une ligne Whop", () => {
  it("lit une chaîne en unités de précision, pas des centimes", () => {
    expect(ledgerAmount("999000000", "100000000")).toBeCloseTo(9.99, 10);
    expect(ledgerAmount("-54940000", "100000000")).toBeCloseTo(-0.5494, 10);
    expect(ledgerAmount("999", "100")).toBeCloseTo(9.99, 10);
  });
  it("refuse de deviner un ordre de grandeur", () => {
    expect(ledgerAmount("999000000", "0")).toBeNull();
    expect(ledgerAmount("999000000", undefined)).toBeNull();
    expect(ledgerAmount("abc", "100")).toBeNull();
  });
});

describe("normalisation d'une ligne du grand livre", () => {
  const brut = {
    object: "ledger_activity",
    id: "line_3Qx81",
    line_type: "payment_gross",
    amount: "999000000",
    currency: { code: "EUR", precision: "100000000" },
    posted_at: "2026-08-31T22:30:00.000Z",
    payment_id: "pay_mJJosdR2XyYjLl",
    product_name: "Snytch Pro 3 cibles — Hebdo",
    user_email: "lorenzo.gallo@example.com",
    user_name: "Lorenzo Gallo",
  };
  it("garde ce que la compta lit, en devise minuscule", () => {
    expect(normalizeLedgerLine(brut)).toEqual({
      whopId: "line_3Qx81",
      lineType: "payment_gross",
      amount: 9.99,
      currency: "eur",
      postedAt: Date.parse("2026-08-31T22:30:00.000Z"),
      paymentId: "pay_mJJosdR2XyYjLl",
      label: "Snytch Pro 3 cibles — Hebdo",
    });
  });
  it("ne conserve aucune donnée personnelle du client", () => {
    const n = normalizeLedgerLine(brut)!;
    expect(JSON.stringify(n)).not.toContain("lorenzo");
    expect(JSON.stringify(n)).not.toContain("Gallo");
  });
  it("lit la destination d'un retrait", () => {
    const n = normalizeLedgerLine({
      id: "line_9",
      line_type: "withdrawal",
      amount: "-200000000000",
      currency: { code: "eur", precision: "100000000" },
      posted_at: "2026-09-05T08:12:00Z",
      source: { id: "wdrl_2Lk9Xq7Tz", status: "completed", payout_token_nickname: "SEPA ••4821" },
    })!;
    expect(n.amount).toBe(-2000);
    expect(n.sourceId).toBe("wdrl_2Lk9Xq7Tz");
    expect(n.destination).toBe("SEPA ••4821");
    expect(n.sourceStatus).toBe("completed");
  });
  it("écarte une ligne sans devise ou à date illisible", () => {
    expect(normalizeLedgerLine({ ...brut, currency: null })).toBeNull();
    expect(normalizeLedgerLine({ ...brut, posted_at: "hier" })).toBeNull();
  });
});

describe("lecture paginée du grand livre", () => {
  it("suit le curseur, borne posted_after en ISO, garde la clé hors de l'URL", async () => {
    const urls: string[] = [];
    const auth: string[] = [];
    const page = (ids: string[], next: string | null) => ({
      data: ids.map((id) => ({
        id,
        line_type: "payment_gross",
        amount: "499000000",
        currency: { code: "eur", precision: "100000000" },
        posted_at: "2026-09-12T10:00:00Z",
      })),
      page_info: { has_next_page: next !== null, end_cursor: next },
    });
    const pages = [page(["line_1", "line_2"], "cur_2"), page(["line_3"], null)];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      urls.push(url);
      auth.push((init.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify(pages[urls.length - 1]), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await fetchWhopLedger("sk_secret_cle", "biz_e1zcXWKzcgHgt9", {
      postedAfter: Date.parse("2026-09-01T00:00:00Z"),
      fetchImpl,
    });
    expect(res.error).toBeNull();
    expect(res.lines.map((l) => l.whopId)).toEqual(["line_1", "line_2", "line_3"]);
    expect(urls[0]).toContain("/api/v1/financial_activity?");
    expect(urls[0]).toContain("account_id=biz_e1zcXWKzcgHgt9");
    expect(urls[0]).toContain("posted_after=2026-09-01T00%3A00%3A00.000Z");
    expect(urls[1]).toContain("cursor=cur_2");
    expect(urls.join(" ")).not.toContain("sk_secret_cle");
    expect(auth).toEqual(["Bearer sk_secret_cle", "Bearer sk_secret_cle"]);
  });
  it("nomme le droit manquant sur un 403", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { status: 403 })) as unknown as typeof fetch;
    const res = await fetchWhopLedger("k", "biz_1", { fetchImpl });
    expect(res.error).toContain("company:balance:read");
  });
});

describe("classement d'un type de ligne", () => {
  it("range les types connus", () => {
    expect(builtinBucketOf("payment_gross")).toBe("gross");
    expect(builtinBucketOf("payment_refund")).toBe("refunds");
    expect(builtinBucketOf("payment_dispute_reversal")).toBe("disputes");
    expect(builtinBucketOf("withdrawal")).toBe("transfers");
    expect(builtinBucketOf("balance_reservation")).toBe("internal");
  });
  it("un frais de virement est un FRAIS, pas un virement", () => {
    expect(builtinBucketOf("withdrawal_fee")).toBe("fees");
    expect(builtinBucketOf("withdrawal_fee_reversal")).toBe("fees");
    expect(builtinBucketOf("payment_processing_percentage_fee")).toBe("fees");
  });
  it("laisse inconnu ce qui n'est pas certain", () => {
    expect(builtinBucketOf("referral_bonus")).toBeNull();
    // `…_fee_payout` ne se termine pas par `_fee` : ce n'est pas un frais payé.
    expect(builtinBucketOf("platform_markup_fee_payout")).toBeNull();
  });
  it("une règle range un type inconnu, jamais un type connu", () => {
    const rules = { referral_bonus: "gross", payment_gross: "internal" } as const;
    expect(bucketOf("referral_bonus", rules)).toBe("gross");
    expect(bucketOf("payment_gross", rules)).toBe("gross");
    expect(bucketOf("promo_reversal", rules)).toBe("unclassified");
  });
});

describe("agrégat d'un mois", () => {
  it("range un encaissement du 31/08 à 22 h 30 UTC au 1er septembre (Paris)", () => {
    const cells = aggregateLedgerDays([
      { postedAt: Date.parse("2026-08-31T22:30:00Z"), lineType: "payment_gross", currency: "eur", amount: 9.99 },
      { postedAt: Date.parse("2026-08-31T21:30:00Z"), lineType: "payment_gross", currency: "eur", amount: 4.99 },
    ]);
    expect(cells.map((c) => c.day)).toEqual(["2026-08-31", "2026-09-01"]);
  });

  const cells: LedgerDayCell[] = [
    { day: "2026-09-01", lineType: "payment_gross", currency: "eur", amount: 9439.57, count: 846 },
    { day: "2026-09-02", lineType: "payment_gross", currency: "usd", amount: 508.72, count: 31 },
    { day: "2026-09-03", lineType: "payment_gross", currency: "rsd", amount: 2846, count: 8 },
    { day: "2026-09-04", lineType: "payment_refund", currency: "eur", amount: -54.94, count: 9 },
    { day: "2026-09-04", lineType: "payment_processing_percentage_fee", currency: "eur", amount: -489.12, count: 885 },
    { day: "2026-09-05", lineType: "withdrawal", currency: "eur", amount: -2000, count: 1 },
    { day: "2026-09-05", lineType: "withdrawal_fee", currency: "eur", amount: -2.5, count: 1 },
    { day: "2026-09-06", lineType: "referral_bonus", currency: "eur", amount: 25, count: 1 },
  ];

  it("convertit au taux du projet et compose le net", () => {
    const t = ledgerTotals(cells, {}, FX);
    // 9 439,57 + 508,72 × 0,86 + 2 846 × 0,00852
    expect(t.gross).toBe(9901.32);
    expect(t.refunds).toBe(-54.94);
    expect(t.fees).toBe(-491.62);
    expect(t.net).toBe(9354.76);
    expect(t.transfersReceived).toBe(2000);
  });
  it("une ligne non classée n'entre pas au net, mais elle est comptée", () => {
    const t = ledgerTotals(cells, {}, FX);
    expect(t.unclassified).toEqual({ count: 1, amount: 25, lineTypes: ["referral_bonus"] });
    const classee = ledgerTotals(cells, { referral_bonus: "gross" }, FX);
    expect(classee.gross).toBe(9926.32);
    expect(classee.net).toBe(9379.76);
    expect(classee.unclassified.count).toBe(0);
  });
  it("une devise sans taux est mise de côté, jamais additionnée à 1:1", () => {
    const sansRsd = buildComptaFx("eur", [{ from: "usd", rate: 0.86 }]);
    const t = ledgerTotals(cells, {}, sansRsd);
    expect(t.gross).toBe(9877.07);
    expect(t.unconverted).toEqual([{ currency: "rsd", amount: 2846, count: 8 }]);
  });
  it("le solde par devise compte TOUTES les lignes, classées ou non", () => {
    expect(balanceByCurrency(cells)).toEqual([
      { currency: "eur", amount: 6918.01 },
      { currency: "rsd", amount: 2846 },
      { currency: "usd", amount: 508.72 },
    ]);
  });
  it("le CA brut par jour suit les règles", () => {
    const sans = grossByDay(cells, {}, FX);
    const avec = grossByDay(cells, { referral_bonus: "gross" }, FX);
    expect(sans.has("2026-09-06")).toBe(false);
    expect(avec.get("2026-09-06")).toBe(25);
  });
});

describe("devise de référence", () => {
  it("est la seule devise rencontrée sans taux", () => {
    const conv = [
      { from: "usd", rate: 0.86 },
      { from: "rsd", rate: 0.00852 },
    ];
    expect(referenceCurrency(["eur", "usd", "rsd"], conv)).toBe("eur");
    expect(referenceCurrency(["USD"], conv)).toBeNull();
    expect(referenceCurrency(["eur", "gbp"], conv)).toBeNull();
  });
});

describe("décaissements créatrices", () => {
  it("un cycle payé sort au jour du paiement, acomptes déduits", () => {
    const paidAt = Date.parse("2026-09-16T14:02:00Z");
    expect(
      creatorCashOuts({
        status: "paid",
        paidAt,
        totalDue: 1074.57,
        advances: [{ amount: 300, at: Date.parse("2026-09-01T09:00:00Z") }],
      }),
    ).toEqual([
      { at: Date.parse("2026-09-01T09:00:00Z"), amount: 300, kind: "advance" },
      { at: paidAt, amount: 774.57, kind: "settlement" },
    ]);
  });
  it("un cycle ouvert ne sort que ses acomptes", () => {
    expect(
      creatorCashOuts({ status: "accruing", totalDue: 1080.05, advances: [{ amount: 100, at: 1 }] }),
    ).toEqual([{ at: 1, amount: 100, kind: "advance" }]);
    expect(creatorCashOuts({ status: "accruing", totalDue: 1080.05 })).toEqual([]);
  });
  it("des acomptes au-delà de la valeur ne créent pas de solde négatif", () => {
    expect(
      creatorCashOuts({ status: "paid", paidAt: 5, totalDue: 80, advances: [{ amount: 100, at: 1 }] }),
    ).toEqual([{ at: 1, amount: 100, kind: "advance" }]);
  });
});

describe("charges « chaque mois »", () => {
  const vercel = { id: "c1", seriesId: "c1", day: "2026-08-05", recurring: true };
  it("prévoit chaque mois écoulé jusqu'au mois courant, au même jour", () => {
    expect(plannedOccurrences([vercel], "2026-10").map((p) => p.day)).toEqual([
      "2026-09-05",
      "2026-10-05",
    ]);
  });
  it("une série dont la dernière charge n'est plus récurrente s'arrête", () => {
    const stop = { id: "c2", seriesId: "c1", day: "2026-09-05", recurring: false };
    expect(plannedOccurrences([vercel, stop], "2026-10")).toEqual([]);
  });
  it("repart de la DERNIÈRE charge saisie de la série", () => {
    const confirmee = { id: "c2", seriesId: "c1", day: "2026-09-05", recurring: true };
    expect(plannedOccurrences([vercel, confirmee], "2026-10").map((p) => p.day)).toEqual([
      "2026-10-05",
    ]);
  });
  it("un 31 devient le dernier jour d'un mois court", () => {
    const fin = { id: "c3", seriesId: "c3", day: "2027-01-31", recurring: true };
    expect(plannedOccurrences([fin], "2027-02").map((p) => p.day)).toEqual(["2027-02-28"]);
  });
});

describe("compteur des seuils de CA", () => {
  // 12 557,57 € encaissés, dont septembre à ≈ 330 €/jour.
  const days = new Map<string, number>([
    ["2026-07-26", 213.66],
    ["2026-08-15", 2311.43],
    ...Array.from({ length: 30 }, (_, i): [string, number] => [
      `2026-09-${String(i + 1).padStart(2, "0")}`,
      330.044,
    ]),
    ["2026-10-01", 131.16],
  ]);
  it("projette chaque seuil au rythme des 30 derniers jours complets", () => {
    const v = thresholdView({ year: 2026, today: "2026-10-01", grossByDay: days });
    expect(v.cumul).toBe(12557.57);
    expect(v.dailyRate).toBe(330.04);
    expect(v.status).toBe("below");
    expect(v.base).toEqual({ remaining: 24942.43, reachedOn: "2026-12-16", reached: false });
    expect(v.majored.reachedOn).toBe("2026-12-27");
    expect(v.endOfYear).toBe(42591.21);
  });
  it("un seuil franchi donne le jour réel du franchissement", () => {
    const big = new Map(days);
    big.set("2026-10-20", 26000);
    const v = thresholdView({ year: 2026, today: "2026-10-25", grossByDay: big });
    expect(v.base).toEqual({ remaining: 0, reachedOn: "2026-10-20", reached: true });
    expect(v.status).toBe("between");
  });
  it("une année close n'a pas de projection", () => {
    const v = thresholdView({ year: 2026, today: "2027-02-01", grossByDay: days });
    expect(v.dailyRate).toBeNull();
    expect(v.base.reachedOn).toBeNull();
    expect(v.cumul).toBe(12557.57);
  });
});

describe("coût des scans", () => {
  it("des scans sans cost_usd = inconnu, zéro scan = zéro", () => {
    expect(scanCostUsd({ lightUsd: 0, fullUsd: 0, otherUsd: 0, runs: 4122, withCost: 0 })).toBeNull();
    expect(scanCostUsd({ lightUsd: 0, fullUsd: 0, otherUsd: 0, runs: 0, withCost: 0 })).toBe(0);
    expect(
      scanCostUsd({ lightUsd: 540.63, fullUsd: 562.39, otherUsd: 0, runs: 179177, withCost: 179177 }),
    ).toBe(1103.02);
  });
});

describe("ventilation d'un virement", () => {
  const parts = [
    { id: "p1", amount: 1500, usage: "pay", note: "Ma paie de septembre" },
    { id: "p2", amount: 200, usage: "business", note: "TikTok Ads", countedAs: "ads" },
    { id: "p3", amount: 625.49, usage: "provision", note: "Provision URSSAF T3" },
  ];
  it("accepte des parts qui couvrent le virement, ou en laissent un reste", () => {
    expect(transferPartsError(parts, 2325.49)).toBeNull();
    expect(transferPartsError(parts.slice(0, 2), 2325.49)).toBeNull();
  });
  it("refuse des parts qui dépassent le virement", () => {
    expect(transferPartsError(parts, 2325.48)).toBe("sum");
  });
  it("ne compte en charge qu'une dépense de l'activité, et exige son motif", () => {
    expect(transferPartsError([{ id: "a", amount: 10, usage: "pay", countedAs: "ads" }], 10)).toBe("counted");
    expect(transferPartsError([{ id: "a", amount: 10, usage: "business", countedAs: "ads" }], 10)).toBe("note");
    expect(transferPartsError([{ id: "a", amount: 10, usage: "business", note: "x", countedAs: "pub" }], 10)).toBe("counted");
  });
  it("refuse un montant nul et deux parts au même identifiant", () => {
    expect(transferPartsError([{ id: "a", amount: 0, usage: "pay" }], 10)).toBe("amount");
    expect(
      transferPartsError(
        [
          { id: "a", amount: 1, usage: "pay" },
          { id: "a", amount: 1, usage: "pay" },
        ],
        10,
      ),
    ).toBe("id");
  });
  it("une annotation d'avant la ventilation se lit comme une part du montant entier", () => {
    expect(transferPartsOf({ usage: "business", note: "API HIKER" }, 607.31)).toEqual([
      { id: "legacy", amount: 607.31, usage: "business", note: "API HIKER" },
    ]);
    expect(transferPartsOf({}, 607.31)).toEqual([]);
    expect(transferPartsOf({ usage: "pay", parts }, 2325.49)).toHaveLength(3);
  });
});

describe("retrait échoué", () => {
  it("un retour sur Whop fait foi, sinon le statut", () => {
    expect(isFailedWithdrawal("completed", true)).toBe(true);
    expect(isFailedWithdrawal("canceled", false)).toBe(true);
    expect(isFailedWithdrawal("completed", false)).toBe(false);
    expect(isFailedWithdrawal(null, false)).toBe(false);
  });
});

describe("scans : paiements réels face à l'estimation", () => {
  // Septembre de Snytch : 1 103,02 $ de cost_usd × 0,86 = 948,60 € estimés.
  const estimate = 948.6;

  it("un seul petit paiement efface toute l'estimation — et se voit", () => {
    // Le top-up Hiker de 100 € compté seul : les scans « baissent » de 848,60 €.
    expect(scansSwap({ estimate, paid: [], added: [100] })).toEqual({
      before: { kind: "estimate", value: 948.6 },
      after: { kind: "paid", value: 100 },
      delta: -848.6,
    });
    expect(isScanPaidLow(100, estimate)).toBe(true);
  });

  it("tous les paiements du mois : le réel remplace l'estimation, sans alerte", () => {
    // 8,64 + 96,23 + 46,55 + 607,31 déjà comptés, puis 100 + 200.
    const r = scansSwap({ estimate, paid: [8.64, 96.23, 46.55, 607.31], added: [100, 200] });
    expect(r.before).toEqual({ kind: "paid", value: 758.73 });
    expect(r.after).toEqual({ kind: "paid", value: 1058.73 });
    expect(r.delta).toBe(300);
    expect(isScanPaidLow(1058.73, estimate)).toBe(false);
    // Le seuil : la moitié de l'estimation, exclue.
    expect(isScanPaidLow(474.3, estimate)).toBe(false);
    expect(isScanPaidLow(474.29, estimate)).toBe(true);
  });

  it("sans estimation, ou un paiement sans taux : pas d'écart inventé", () => {
    expect(scansSwap({ estimate: null, paid: [], added: [31.24] })).toEqual({
      before: { kind: "none", value: null },
      after: { kind: "paid", value: 31.24 },
      delta: 31.24,
    });
    expect(scansSwap({ estimate, paid: [null], added: [100] }).delta).toBeNull();
    expect(scansSwap({ estimate, paid: [], added: [null] }).after).toEqual({ kind: "paid", value: null });
    expect(isScanPaidLow(null, estimate)).toBe(false);
    expect(isScanPaidLow(10, null)).toBe(false);
    expect(isScanPaidLow(0, 0)).toBe(false);
  });
});

describe("contrôle créatrices : versé selon Paiements face à l'argent sorti", () => {
  it("rien à comparer tant qu'aucune part « Paiement créatrices » n'existe", () => {
    expect(creatorsControl(1031.82, 0, 0)).toBeNull();
  });

  it("septembre de Snytch : 1 126 € sortis pour 1 031,82 € marqués versés", () => {
    // 870 € via Kevin + 150 Kelly + 43 Marine + 33 Orlane + 30 Sarah.
    expect(creatorsControl(1031.82, 1126, 5)).toEqual({ paid: 1031.82, sent: 1126, gap: 94.18, significant: true });
    // Dans l'autre sens : moins sorti que versé.
    expect(creatorsControl(1031.82, 870, 1)).toMatchObject({ gap: -161.82, significant: true });
  });

  it("un écart de quelques euros n'alerte pas : 5 % ou 10 € au moins", () => {
    expect(creatorsControl(1031.82, 1080, 2)).toMatchObject({ gap: 48.18, significant: false });
    expect(creatorsControl(1031.82, 1086.5, 2)).toMatchObject({ gap: 54.68, significant: true });
    expect(creatorsControl(40, 49.5, 1)).toMatchObject({ gap: 9.5, significant: false });
    expect(creatorsControl(40, 50.5, 1)).toMatchObject({ gap: 10.5, significant: true });
  });

  it("une paie sans taux : pas d'écart chiffré, pas d'alerte", () => {
    expect(creatorsControl(null, 870, 1)).toEqual({ paid: null, sent: 870, gap: null, significant: false });
  });
});

describe("argent à récupérer", () => {
  it("« À récupérer » est un usage, jamais compté en charge", () => {
    expect(transferPartsError([{ id: "a", amount: 493.23, usage: "recover", note: "USDC bloqué chez Revolut" }], 493.23)).toBeNull();
    expect(
      transferPartsError([{ id: "a", amount: 493.23, usage: "recover", note: "USDC", countedAs: "other" }], 493.23),
    ).toBe("counted");
  });
});

describe("trésorerie : Whop + comptes relevés − mis de côté", () => {
  // Les virements de Snytch, à la forme de la prod (destinations Whop réelles).
  const virements = [
    { day: "2026-09-15", destination: "Antho Banque", failed: false, converted: 2325.49, recoverConverted: 0 },
    { day: "2026-09-02", destination: "usdc jeremie", failed: false, converted: 493.23, recoverConverted: 493.23 },
    { day: "2026-09-30", destination: "Antho Banque", failed: false, converted: 412.6, recoverConverted: 0 },
    { day: "2026-10-01", destination: "Antho Banque", failed: true, converted: 304.47, recoverConverted: 0 },
    { day: "2026-10-01", destination: "SOL compte 7 Antho", failed: false, converted: 329.49, recoverConverted: 0 },
  ];

  it("un compte reçoit les virements arrivés APRÈS son relevé, ni échoués ni d'ailleurs", () => {
    // Relevé le 15/09 : le virement du 15/09 est déjà dedans, celui du 30/09 non.
    expect(transfersSinceReading(virements, ["Antho Banque"], "2026-09-15")).toBe(412.6);
    expect(transfersSinceReading(virements, ["Antho Banque"], "2026-09-30")).toBe(0);
    expect(transfersSinceReading(virements, ["Antho Banque"], "2026-09-14")).toBe(2738.09);
  });

  it("une part « à récupérer » n'est jamais arrivée : elle ne s'ajoute pas", () => {
    expect(transfersSinceReading(virements, ["usdc jeremie"], "2026-09-01")).toBe(0);
  });

  it("un virement sans taux rend la somme non chiffrée", () => {
    expect(
      transfersSinceReading(
        [{ day: "2026-09-20", destination: "Antho Wallet", failed: false, converted: null, recoverConverted: 0 }],
        ["Antho Wallet"],
        "2026-09-01",
      ),
    ).toBeNull();
  });

  it("disponible = Whop + comptes relevés − mis de côté ; un compte jamais relevé n'est pas compté", () => {
    const v = treasuryView({
      today: "2026-10-02",
      whop: 4744.44,
      accounts: [
        { id: "antho", reading: { day: "2026-09-15", converted: 1337.49 }, since: 412.6 },
        { id: "sol", reading: null, since: null },
      ],
      provisioned: 581.37,
      used: 0,
    });
    expect(v.accounts).toEqual([
      { id: "antho", counted: true, estimated: 1750.09, ageDays: 17, stale: true },
      { id: "sol", counted: false, estimated: null, ageDays: null, stale: false },
    ]);
    expect(v).toMatchObject({ inCash: 6494.53, setAside: 581.37, available: 5913.16, staleCount: 1, unreadCount: 1 });
  });

  it("à 14 jours un relevé est encore frais, à 15 il est à relever", () => {
    const age = (day: string) =>
      treasuryView({ today: "2026-10-02", whop: 0, accounts: [{ id: "a", reading: { day, converted: 1 }, since: 0 }], provisioned: 0, used: 0 }).accounts[0];
    expect(age("2026-09-18")).toMatchObject({ ageDays: 14, stale: false });
    expect(age("2026-09-17")).toMatchObject({ ageDays: 15, stale: true });
  });

  it("le mis de côté baisse de ce qui est payé, sans jamais devenir négatif", () => {
    const base = { today: "2026-10-02", whop: 1000, accounts: [] };
    expect(treasuryView({ ...base, provisioned: 581.37, used: 400 })).toMatchObject({ setAside: 181.37, available: 818.63 });
    expect(treasuryView({ ...base, provisioned: 581.37, used: 700 })).toMatchObject({ setAside: 0, available: 1000 });
  });

  it("un terme non chiffré ne s'additionne pas 1:1", () => {
    const v = treasuryView({
      today: "2026-10-02",
      whop: 4744.44,
      accounts: [{ id: "wallet", reading: { day: "2026-10-01", converted: null }, since: 0 }],
      provisioned: 0,
      used: 0,
    });
    expect(v).toMatchObject({ inCash: null, available: null });
    expect(treasuryView({ today: "2026-10-02", whop: null, accounts: [], provisioned: 0, used: 0 }).available).toBeNull();
  });
});

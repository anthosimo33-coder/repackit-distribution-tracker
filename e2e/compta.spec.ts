import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);
const DAY = 86_400_000;

/**
 * Choisit l'usage d'une part. Le menu s'ouvre DANS la modale, qui se re-rend au
 * fil des requêtes : en suite complète, le clic sur l'option tombait parfois
 * pendant l'ouverture et se perdait — l'usage restait vide, l'interrupteur
 * « Compter en charge » n'apparaissait jamais, et le test expirait à 180 s
 * (deux fois : 2e tour de mutations, suite complète). Même remède que
 * hook-variants-view (TD-018) : on retente le GESTE ENTIER jusqu'à ce que
 * l'usage soit affiché dans le champ, au lieu de supposer que le clic a pris.
 */
async function chooseUsage(page: Page, part: Locator, label: string) {
  const combo = part.getByRole("combobox", { name: "Usage" });
  await expect(async () => {
    if ((await combo.getAttribute("aria-expanded")) !== "true") await combo.click({ timeout: 2_000 });
    await page.getByRole("option", { name: label, exact: true }).click({ timeout: 2_000 });
    await expect(combo).toContainText(label, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * ONGLET COMPTA — grand livre Whop, règles de classement, charges, export.
 *
 * Données à la forme de la PROD : un encaissement du 31/08 à 22 h 30 UTC (le
 * 1er septembre à Paris), trois devises dont des dinars, un frais de litige, un
 * frais de virement, un type que Jarvia ne connaît pas (`referral_bonus`), des
 * montants à décimales. L'exercice 2025 est celui du test : aucune autre spec n'y
 * écrit, et la compta du projet e2e est remise à zéro avant et après.
 */

type Line = {
  whopId: string;
  lineType: string;
  amount: number;
  currency: string;
  postedAt: number;
  paymentId?: string;
  label?: string;
  sourceId?: string;
  destination?: string;
  sourceStatus?: string;
};

const at = (iso: string) => Date.parse(iso);

function ledger(ts: number): Line[] {
  const id = (s: string) => `line_e2e_${ts}_${s}`;
  return [
    // 31/08 21:30 UTC = 31/08 23:30 à Paris → AOÛT.
    { whopId: id("a0"), lineType: "payment_gross", amount: 4.99, currency: "eur", postedAt: at("2025-08-31T21:30:00Z"), paymentId: `pay_aout_${ts}`, label: "Snytch Pro — Hebdo" },
    // 31/08 22:30 UTC = 1er septembre 00:30 à Paris → SEPTEMBRE.
    { whopId: id("a1"), lineType: "payment_gross", amount: 9.99, currency: "eur", postedAt: at("2025-08-31T22:30:00Z"), paymentId: `pay_a_${ts}`, label: "Snytch Pro 3 cibles — Hebdo" },
    { whopId: id("a2"), lineType: "payment_processing_percentage_fee", amount: -0.55, currency: "eur", postedAt: at("2025-08-31T22:30:00Z"), paymentId: `pay_a_${ts}` },
    { whopId: id("a3"), lineType: "payment_processing_fixed_fee", amount: -0.2, currency: "eur", postedAt: at("2025-08-31T22:30:00Z"), paymentId: `pay_a_${ts}` },
    { whopId: id("b1"), lineType: "payment_gross", amount: 11.99, currency: "usd", postedAt: at("2025-09-16T10:00:00Z"), paymentId: `pay_b_${ts}`, label: "Snytch Pro 3 Targets - Weekly" },
    { whopId: id("b2"), lineType: "payment_processing_percentage_fee", amount: -0.84, currency: "usd", postedAt: at("2025-09-16T10:00:00Z"), paymentId: `pay_b_${ts}` },
    { whopId: id("c1"), lineType: "payment_gross", amount: 599, currency: "rsd", postedAt: at("2025-09-11T13:56:00Z"), paymentId: `pay_c_${ts}`, label: "Snytch Pro 3 cilja — Nedeljno" },
    { whopId: id("r1"), lineType: "payment_refund", amount: -9.99, currency: "eur", postedAt: at("2025-09-20T09:12:00Z"), paymentId: `pay_a_${ts}` },
    { whopId: id("d1"), lineType: "payment_dispute", amount: -16.9, currency: "eur", postedAt: at("2025-09-22T15:40:00Z"), paymentId: `pay_d_${ts}` },
    { whopId: id("d2"), lineType: "payment_dispute_fee", amount: -15, currency: "eur", postedAt: at("2025-09-22T15:40:00Z"), paymentId: `pay_d_${ts}` },
    { whopId: id("w1"), lineType: "withdrawal", amount: -2000, currency: "eur", postedAt: at("2025-09-25T08:00:00Z"), sourceId: `wdrl_e2e_${ts}`, destination: "SEPA ••4821", sourceStatus: "completed" },
    { whopId: id("w2"), lineType: "withdrawal_fee", amount: -2.5, currency: "eur", postedAt: at("2025-09-25T08:00:00Z"), sourceId: `wdrl_e2e_${ts}` },
    { whopId: id("x1"), lineType: "referral_bonus", amount: 25, currency: "eur", postedAt: at("2025-09-26T14:02:00Z") },
    // Un retrait en DOLLARS (converti à 0,86) et un retrait ÉCHOUÉ, revenu sur
    // Whop par une ligne `withdrawal_reversal` au même identifiant.
    { whopId: id("u1"), lineType: "withdrawal", amount: -31.24, currency: "usd", postedAt: at("2025-09-10T12:05:00Z"), sourceId: `wdrl_usd_${ts}`, destination: "Antho Wallet", sourceStatus: "completed" },
    { whopId: id("f1"), lineType: "withdrawal", amount: -304.47, currency: "eur", postedAt: at("2025-09-01T00:52:00Z"), sourceId: `wdrl_fail_${ts}`, destination: "LTVT CAPITAL", sourceStatus: "canceled" },
    { whopId: id("f2"), lineType: "withdrawal_reversal", amount: 304.47, currency: "eur", postedAt: at("2025-09-01T01:14:00Z"), sourceId: `wdrl_fail_${ts}`, destination: "LTVT CAPITAL", sourceStatus: "canceled" },
  ];
}

async function setup(ts: number) {
  const projectId = await admin.getProjectId();
  await admin.mutation(api.compta.e2eResetCompta, { secret: E2E_SECRET, projectId });
  const whop = await admin.mutation(api.whopSync.e2eSetProjectWhop, {
    secret: E2E_SECRET,
    projectId,
    whop: { companyId: `biz_e2e_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
  });
  const fx = await admin.mutation(api.compta.e2eSetProjectFx, {
    secret: E2E_SECRET,
    projectId,
    payCurrency: "usd",
    fxRateToRevenue: 0.86,
    fxRatesToRevenue: [{ currency: "rsd", rate: 0.00852 }],
  });
  await admin.mutation(api.compta.e2eSetComptaState, {
    secret: E2E_SECRET,
    projectId,
    referenceCurrency: "eur",
    lastSyncAt: Date.now() - 12 * 60_000,
  });
  await admin.mutation(api.compta.e2eSeedLedgerLines, { secret: E2E_SECRET, projectId, lines: ledger(ts) });
  await admin.mutation(api.compta.e2eSetScanMonth, {
    secret: E2E_SECRET,
    projectId,
    month: "2025-09",
    lightUsd: 540.63,
    fullUsd: 562.39,
    runs: 179_177,
    withCost: 179_177,
  });
  const restore = async () => {
    await admin.mutation(api.compta.e2eResetCompta, { secret: E2E_SECRET, projectId });
    await admin.mutation(api.whopSync.e2eSetProjectWhop, {
      secret: E2E_SECRET,
      projectId,
      whop: whop ?? undefined,
    });
    await admin.mutation(api.compta.e2eSetProjectFx, { secret: E2E_SECRET, projectId, ...fx });
  };
  return { projectId, restore };
}

const row = async (year: number, month: string) => {
  const o = await admin.query(api.compta.getComptaOverview, { year });
  return { o, r: o.rows.find((x) => x.month === month)! };
};

test.describe("Compta", () => {
  test("le grand livre se range par mois de Paris, et une règle range un type inconnu", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { restore } = await setup(ts);
    try {
      // ── Frontière de mois : la ligne de 22 h 30 UTC est en SEPTEMBRE ──────
      const aout = (await row(2025, "2025-08")).r;
      expect(aout.ledger.gross).toBe(4.99);
      const { o, r } = await row(2025, "2025-09");
      // 9,99 € + 11,99 $ × 0,86 + 599 RSD × 0,00852
      expect(r.ledger.gross).toBe(25.4);
      expect(r.ledger.refunds).toBe(-9.99);
      expect(r.ledger.disputes).toBe(-16.9);
      // Frais de litige ET frais de virement sont des frais, pas un litige ni un virement.
      expect(r.ledger.fees).toBe(-18.97);
      expect(r.ledger.net).toBe(-20.46);
      // 2 000 € + 31,24 $ × 0,86 ; le retrait échoué s'annule avec son retour.
      expect(r.ledger.transfersReceived).toBe(2026.87);

      // ── Le type inconnu est COMPTÉ, signalé, et hors du net ───────────────
      expect(r.ledger.unclassified).toEqual({ count: 1, amount: 25, lineTypes: ["referral_bonus"] });
      expect(r.incomplete).toContain("unclassified");
      const pending = o.unclassified.find((u) => u.lineType === "referral_bonus");
      expect(pending?.months).toEqual(["2025-09"]);
      expect(pending?.example?.amount).toBe(25);

      // ── Charges du mois : scans en dollars convertis ─────────────────────
      expect(r.scans).toBe(948.6);
      expect(r.creators).toBe(0);
      expect(r.result).toBe(-969.06);

      // ── Une règle ne touche JAMAIS un type connu ──────────────────────────
      await expect(
        admin.mutation(api.compta.setLineRule, { lineType: "payment_gross", bucket: "internal" }),
      ).rejects.toThrow(/ERR_COMPTA_RULE_BUILTIN/);

      // ── Ranger referral_bonus en CA brut ──────────────────────────────────
      await admin.mutation(api.compta.setLineRule, { lineType: "referral_bonus", bucket: "gross" });
      const apres = await row(2025, "2025-09");
      expect(apres.r.ledger.gross).toBe(50.4);
      expect(apres.r.ledger.net).toBe(4.54);
      expect(apres.r.ledger.unclassified.count).toBe(0);
      expect(apres.r.incomplete).not.toContain("unclassified");
      expect(apres.o.unclassified).toEqual([]);
      expect(apres.o.rules.map((x) => [x.lineType, x.bucket, x.months])).toEqual([
        ["referral_bonus", "gross", ["2025-09"]],
      ]);
      // Exercice clos : le cumul compte la règle, aucune projection.
      expect(apres.o.thresholds?.cumul).toBe(55.39);
      expect(apres.o.thresholds?.dailyRate).toBeNull();

      // ── Solde calculé : ouverture + net − virements = clôture ────────────
      const d = await admin.query(api.compta.getComptaMonth, { month: "2025-09" });
      expect(d.reconciliation.opening).toBe(4.99);
      expect(d.reconciliation.otherMovements).toBe(0);
      expect(d.reconciliation.closing).toBe(-2017.34);
      expect(
        Math.round((d.reconciliation.opening! + d.reconciliation.net - d.reconciliation.transfersReceived) * 100) / 100,
      ).toBe(d.reconciliation.closing);

      // ── Retirer la règle remet la ligne en « non classé » ────────────────
      await admin.mutation(api.compta.removeLineRule, { lineType: "referral_bonus" });
      expect((await row(2025, "2025-09")).r.ledger.unclassified.count).toBe(1);

      // ── Journal du mois : toutes les lignes, sans donnée personnelle ─────
      const j = await admin.query(api.compta.getComptaJournal, { month: "2025-09" });
      expect(j.ledger).toHaveLength(15);
      expect(
        j.ledger
          .filter((l) => l.lineType === "withdrawal")
          .map((l) => l.reference)
          .sort(),
      ).toEqual([`wdrl_e2e_${ts}`, `wdrl_fail_${ts}`, `wdrl_usd_${ts}`].sort());
    } finally {
      await restore();
    }
  });

  test("autres charges : conversion, récurrence prévue, confirmation, arrêt", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { restore } = await setup(ts);
    try {
      await expect(
        admin.mutation(api.compta.addComptaCharge, {
          day: "2025-09-01",
          label: "Vercel Pro",
          category: "hosting",
          amount: 20,
          currency: "gbp",
          recurring: true,
        }),
      ).rejects.toThrow(/ERR_COMPTA_CHARGE_INVALID/);
      await admin.mutation(api.compta.addComptaCharge, {
        day: "2025-09-01",
        label: "Vercel Pro",
        category: "hosting",
        amount: 20,
        currency: "usd",
        recurring: true,
      });
      await admin.mutation(api.compta.addComptaCharge, {
        day: "2025-09-05",
        label: "Google Workspace",
        category: "subscriptions",
        amount: 8.1,
        currency: "eur",
        recurring: false,
      });
      const sept = await admin.query(api.compta.listComptaCharges, { month: "2025-09" });
      expect(sept.charges.map((c) => [c.label, c.converted, c.planned])).toEqual([
        ["Vercel Pro", 17.2, false],
        ["Google Workspace", 8.1, false],
      ]);
      expect((await row(2025, "2025-09")).r.other).toBe(25.3);

      // Octobre : Vercel est PRÉVU (calculé), au même jour ; Workspace non.
      const oct = await admin.query(api.compta.listComptaCharges, { month: "2025-10" });
      expect(oct.charges.map((c) => [c.label, c.day, c.planned])).toEqual([["Vercel Pro", "2025-10-01", true]]);

      // Confirmer → une vraie charge, et novembre repart d'elle.
      await admin.mutation(api.compta.confirmPlannedCharge, {
        sourceId: oct.charges[0].sourceId,
        day: "2025-10-01",
      });
      const octOk = await admin.query(api.compta.listComptaCharges, { month: "2025-10" });
      expect(octOk.charges.map((c) => [c.label, c.planned])).toEqual([["Vercel Pro", false]]);
      const nov = await admin.query(api.compta.listComptaCharges, { month: "2025-11" });
      expect(nov.charges.map((c) => [c.label, c.planned])).toEqual([["Vercel Pro", true]]);

      // Arrêter la série sur sa DERNIÈRE charge → plus rien de prévu.
      await admin.mutation(api.compta.stopChargeSeries, { chargeId: octOk.charges[0].chargeId! });
      expect((await admin.query(api.compta.listComptaCharges, { month: "2025-11" })).charges).toEqual([]);
      // Présence : la charge d'octobre, elle, est toujours là.
      expect((await admin.query(api.compta.listComptaCharges, { month: "2025-10" })).charges).toHaveLength(1);
    } finally {
      await restore();
    }
  });

  test("ventilation : parts, charge comptée, scans réels, retrait échoué", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { restore } = await setup(ts);
    try {
      const list = await admin.query(api.compta.listComptaTransfers, { month: "2025-09" });
      const w = list.transfers.find((x) => x.sourceId === `wdrl_e2e_${ts}`)!;
      const usd = list.transfers.find((x) => x.sourceId === `wdrl_usd_${ts}`)!;
      const echec = list.transfers.find((x) => x.sourceId === `wdrl_fail_${ts}`)!;
      // Le retrait échoué est rendu, marqué, daté de son retour ; le dollar est converti.
      expect(echec).toMatchObject({ failed: true, returnedDay: "2025-09-01" });
      expect(w.failed).toBe(false);
      expect(usd).toMatchObject({ amount: 31.24, currency: "usd", converted: 26.87, failed: false });
      await expect(
        admin.mutation(api.compta.ventilateTransfer, { lineId: echec._id, parts: [] }),
      ).rejects.toThrow(/ERR_COMPTA_TRANSFER_FAILED/);

      // Refus : des parts au-delà du virement, une part comptée sans motif.
      await expect(
        admin.mutation(api.compta.ventilateTransfer, {
          lineId: w._id,
          parts: [{ id: "a", amount: 2000.01, usage: "pay" }],
        }),
      ).rejects.toThrow(/ERR_COMPTA_PARTS_INVALID/);
      await expect(
        admin.mutation(api.compta.ventilateTransfer, {
          lineId: w._id,
          parts: [{ id: "a", amount: 300, usage: "business", countedAs: "ads" }],
        }),
      ).rejects.toThrow(/ERR_COMPTA_PARTS_INVALID/);

      const avant = (await row(2025, "2025-09")).r;
      expect(avant).toMatchObject({ other: 0, scans: 948.6, scanSource: "estimate", scanPaidLow: false });
      // Aucune part « Paiement créatrices » : rien à contrôler.
      expect(avant.creatorsControl).toBeNull();
      expect((await row(2025, "2025-09")).o.toRecover).toEqual([]);
      // La fenêtre de ventilation lit l'estimation que remplacera un paiement de scans.
      expect((await admin.query(api.compta.listComptaCharges, { month: "2025-09" })).scanEstimate).toBe(948.6);

      await admin.mutation(api.compta.ventilateTransfer, {
        lineId: w._id,
        parts: [
          { id: "p1", amount: 1500, usage: "pay", note: "Ma paie de septembre" },
          { id: "p2", amount: 300, usage: "business", note: "TikTok Ads", countedAs: "ads" },
          { id: "p3", amount: 200, usage: "business", note: "API HIKER", countedAs: "scans" },
        ],
      });
      const apres = (await row(2025, "2025-09")).r;
      // TikTok en Autres ; Hiker REMPLACE l'estimation des scans ; le reste ne touche rien.
      expect(apres).toMatchObject({ other: 300, scans: 200, scanSource: "paid", scanEstimate: 948.6 });
      // 200 € réels pour 948,60 € estimés : un paiement manque peut-être.
      expect(apres.scanPaidLow).toBe(true);
      expect(apres.result).toBe(Math.round((avant.result + 948.6 - 200 - 300) * 100) / 100);
      expect(apres.ledger.transfersReceived).toBe(avant.ledger.transfersReceived);

      const charges = await admin.query(api.compta.listComptaCharges, { month: "2025-09" });
      const tiktok = charges.charges.find((c) => c.label === "TikTok Ads")!;
      expect(tiktok).toMatchObject({ category: "ads", amount: 300, day: "2025-09-25", transferLineId: w._id });
      expect(charges.charges.find((c) => c.label === "API HIKER")).toMatchObject({ category: "scans" });
      // Une charge liée ne se modifie qu'en passant par le virement.
      await expect(
        admin.mutation(api.compta.updateComptaCharge, {
          chargeId: tiktok.chargeId!,
          day: "2025-09-25",
          label: "TikTok",
          category: "ads",
          amount: 1,
          currency: "eur",
          recurring: false,
        }),
      ).rejects.toThrow(/ERR_COMPTA_CHARGE_LINKED/);
      await expect(
        admin.mutation(api.compta.deleteComptaCharge, { chargeId: tiktok.chargeId! }),
      ).rejects.toThrow(/ERR_COMPTA_CHARGE_LINKED/);

      // Décompter TikTok supprime SA charge, garde celle de Hiker.
      await admin.mutation(api.compta.ventilateTransfer, {
        lineId: w._id,
        parts: [
          { id: "p1", amount: 1500, usage: "pay", note: "Ma paie de septembre" },
          { id: "p2", amount: 300, usage: "business", note: "TikTok Ads" },
          { id: "p3", amount: 200, usage: "business", note: "API HIKER", countedAs: "scans" },
        ],
      });
      const restes = (await admin.query(api.compta.listComptaCharges, { month: "2025-09" })).charges;
      expect(restes.map((c) => c.label)).toEqual(["API HIKER"]);

      // Argent sorti pour les créatrices, et argent jamais arrivé.
      await admin.mutation(api.compta.ventilateTransfer, {
        lineId: w._id,
        parts: [
          { id: "p1", amount: 1500, usage: "pay", note: "Ma paie de septembre" },
          { id: "p5", amount: 250, usage: "creators", note: "Reversé à Kevin pour les créatrices" },
        ],
      });
      await admin.mutation(api.compta.ventilateTransfer, {
        lineId: usd._id,
        parts: [{ id: "r1", amount: 31.24, usage: "recover", note: "USDC bloqué chez Revolut, non reçu" }],
      });
      const controle = await row(2025, "2025-09");
      // Aucune paie marquée versée en septembre 2025 : tout l'argent sorti est un écart.
      expect(controle.r.creatorsControl).toEqual({ paid: 0, sent: 250, gap: 250, significant: true });
      expect((await admin.query(api.compta.getComptaMonth, { month: "2025-09" })).creatorsControl).toEqual({
        paid: 0,
        sent: 250,
        gap: 250,
        significant: true,
      });
      expect(controle.o.toRecover).toEqual([
        expect.objectContaining({
          lineId: usd._id,
          partId: "r1",
          day: "2025-09-10",
          destination: "Antho Wallet",
          amount: 31.24,
          currency: "usd",
          converted: 26.87,
          note: "USDC bloqué chez Revolut, non reçu",
        }),
      ]);
      // Signalé jusqu'à ce que l'usage change : récupéré → « Autre ».
      await admin.mutation(api.compta.ventilateTransfer, {
        lineId: usd._id,
        parts: [{ id: "r1", amount: 31.24, usage: "other", note: "USDC récupéré le 30/09" }],
      });
      expect((await row(2025, "2025-09")).o.toRecover).toEqual([]);
      // « À récupérer » ne se compte jamais en charge.
      await expect(
        admin.mutation(api.compta.ventilateTransfer, {
          lineId: usd._id,
          parts: [{ id: "r1", amount: 31.24, usage: "recover", note: "USDC", countedAs: "other" }],
        }),
      ).rejects.toThrow(/ERR_COMPTA_PARTS_INVALID/);

      // Effacer la ventilation : plus de charge liée, l'estimation revient.
      await admin.mutation(api.compta.ventilateTransfer, { lineId: w._id, parts: [] });
      expect((await admin.query(api.compta.listComptaCharges, { month: "2025-09" })).charges).toEqual([]);
      expect((await row(2025, "2025-09")).r).toMatchObject({
        scans: 948.6,
        scanSource: "estimate",
        scanPaidLow: false,
        creatorsControl: null,
      });
    } finally {
      await restore();
    }
  });

  test("une créatrice payée sort en charge au jour du paiement, convertie", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const { projectId, restore } = await setup(ts);
    try {
      const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date()).slice(0, 4));
      const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date()).slice(0, 7);
      const before = (await admin.query(api.compta.getComptaOverview, { year })).rows.find((r) => r.month === month);
      const c = await createCreatorSession(url!, {
        name: `[E2E_TEST] Kelly Moreau ${ts}`,
        email: `e2e-compta-${ts}@repackit.test`,
        password: `compta-${ts}-12345`,
      });
      const formatId = (await createFormatWithRate(admin, {
        name: `[E2E_TEST] Compta ${ts}`,
        type: "short",
        rateModel: { basePerPost: 1074.57 },
      })) as Id<"formats">;
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: c.creatorId,
        platform: "TikTok",
        handle: `@kelly.moreau_${ts}`,
      });
      await admin.mutation(api.assignments.assignFormat, {
        formatId,
        creatorId: c.creatorId,
        targets: [target],
        dueDate: ts + 7 * DAY,
        postsPerCreator: 1,
      });
      const a = (await admin.query(api.assignments.listAssignments, {})).find(
        (x) => x.creatorId === c.creatorId,
      )!;
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, { secret: E2E_SECRET, id: a._id, status: "to_publish" });
      await c.client.mutation(api.assignments.confirmPublication, {
        projectId: c.projectId,
        id: a._id,
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@kelly.moreau_${ts}/video/72${ts}` }],
      });
      // Engagé mais pas versé : la compta n'en sait rien.
      const engage = (await admin.query(api.compta.getComptaOverview, { year })).rows.find((r) => r.month === month);
      expect(engage?.creators ?? 0).toBe(before?.creators ?? 0);

      await admin.mutation(api.payments.markCyclePaid, { creatorId: c.creatorId, cycleIndex: 0 });
      const apres = (await admin.query(api.compta.getComptaOverview, { year })).rows.find((r) => r.month === month)!;
      // 1 074,57 $ × 0,86 = 924,13 €
      expect(Math.round(((apres.creators ?? 0) - (before?.creators ?? 0)) * 100) / 100).toBe(924.13);
      const detail = await admin.query(api.compta.getComptaMonth, { month });
      const ligne = detail.creators.find((x) => x.name === `[E2E_TEST] Kelly Moreau ${ts}`);
      expect(ligne).toMatchObject({ kind: "settlement", amount: 1074.57, converted: 924.13 });

      // Contrôle : un virement du mois dont 870 € sont partis pour les créatrices
      // face à la paie que Paiements dit versée (celle de Kelly comprise).
      await admin.mutation(api.compta.e2eSeedLedgerLines, {
        secret: E2E_SECRET,
        projectId,
        lines: [
          { whopId: `line_e2e_${ts}_wk`, lineType: "withdrawal", amount: -1806, currency: "eur", postedAt: Date.now() - 60_000, sourceId: `wdrl_kevin_${ts}`, destination: "OCBC LTVT", sourceStatus: "completed" },
        ],
      });
      const virement = (await admin.query(api.compta.listComptaTransfers, { month })).transfers.find(
        (x) => x.sourceId === `wdrl_kevin_${ts}`,
      )!;
      await admin.mutation(api.compta.ventilateTransfer, {
        lineId: virement._id,
        parts: [
          { id: "j", amount: 832, usage: "business", note: "Remboursement des frais avancés par Jérem" },
          { id: "k", amount: 870, usage: "creators", note: "Reversé à Kevin pour les créatrices (cycles d'août)" },
        ],
      });
      const ctl = (await admin.query(api.compta.getComptaMonth, { month })).creatorsControl!;
      const paid = (await admin.query(api.compta.getComptaOverview, { year })).rows.find((r) => r.month === month)!.creators!;
      expect(ctl.paid).toBe(paid);
      expect(ctl.sent).toBe(870);
      expect(ctl.gap).toBe(Math.round((870 - paid) * 100) / 100);
    } finally {
      await restore();
    }
  });

  test("écran : classer un type inconnu, annoter un virement, exporter le mois", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const { restore } = await setup(ts);
    try {
      await page.goto(adminPath("/compta"));
      // Le menu propose Compta : le projet est relié à Whop.
      await expect(page.getByRole("link", { name: "Compta" })).toBeVisible({ timeout: 20_000 });

      await page.getByRole("combobox", { name: /Exercice/ }).click();
      await page.getByRole("option", { name: "Exercice 2025" }).click();
      const sept = page.getByTestId("compta-row-2025-09");
      await expect(sept).toContainText(/25,40\s*€/);
      await expect(sept).toContainText("1 à classer");
      const banner = page.getByTestId("compta-unclassified-banner");
      await expect(banner).toContainText("referral_bonus");

      // ── Classer depuis la page ─────────────────────────────────────────────
      await banner.getByRole("button", { name: "Choisir leur colonne" }).click();
      await page.getByTestId("compta-classify-select-referral_bonus").click();
      await page.getByRole("option", { name: "CA brut" }).click();
      await expect(page.getByTestId("compta-classify-referral_bonus")).toContainText("Compte aussi dans le CA brut cumulé");
      await page.getByTestId("compta-classify-save").click();
      await expect(sept).toContainText(/50,40\s*€/);
      await expect(banner).toHaveCount(0);

      // ── Le bloc virements : échoué grisé et non compté, dollar converti ─────
      const transfers = page.getByTestId("compta-transfers");
      await transfers.getByRole("combobox").click();
      await page.getByRole("option", { name: "septembre 2025" }).click();
      const echec = page.getByTestId(`compta-transfer-wdrl_fail_${ts}`);
      await expect(echec).toContainText("Échoué");
      await expect(echec).toContainText("Revenu sur Whop le 01/09, non compté");
      await expect(page.getByTestId(`compta-transfer-wdrl_usd_${ts}`)).toContainText(/≈\s*26,87\s*€/);
      // 2 000 € + 26,87 € ; jamais les 304,47 € échoués, jamais 31,24 « € ».
      await expect(page.getByTestId("compta-transfers-total")).toHaveText(/2\s?026,87\s*€/);

      // ── Ventiler le virement de 2 000 € ────────────────────────────────────
      const virement = page.getByTestId(`compta-transfer-wdrl_e2e_${ts}`);
      await virement.getByRole("button", { name: "Dire à quoi il a servi" }).click();
      const part0 = page.getByTestId("compta-part-0");
      await part0.getByLabel("Montant").fill("1500,00");
      await chooseUsage(page, part0, "Rémunération");
      await part0.getByLabel("Motif").fill("Ma paie de septembre");
      await page.getByRole("button", { name: "Ajouter une part" }).click();
      const part1 = page.getByTestId("compta-part-1");
      // La nouvelle part reprend le reste.
      await expect(part1.getByLabel("Montant")).toHaveValue("500,00");
      await chooseUsage(page, part1, "Charges de l'activité");
      await part1.getByLabel("Motif").fill("TikTok Ads");
      await part1.getByRole("switch", { name: "Compter en charge" }).click();
      const effet = page.getByTestId("compta-ventilation-effect");
      await expect(effet).toContainText(/Autres charges : \+ 500,00\s*€ \(TikTok Ads, Publicité\)/);
      await expect(effet).toContainText(/Résultat : −500,00\s*€/);
      await page.getByTestId("compta-ventilation-save").click();
      await expect(virement).toContainText("Ventilé · 2 parts");
      await expect(transfers).toContainText("compté en charge · Publicité");
      // Seule la part comptée touche le résultat : −944,06 € − 500 €.
      await expect(sept).toContainText(/−1\s?444,06\s*€/);
      // La charge liée apparaît dans Autres charges, non modifiable ici.
      const charges = page.getByTestId("compta-charges");
      await charges.getByRole("combobox").click();
      await page.getByRole("option", { name: "septembre 2025" }).click();
      const tiktok = page.getByTestId("compta-charge-TikTok Ads");
      await expect(tiktok).toContainText("virement du 25/09");
      await expect(tiktok).toContainText("se modifie dans la ventilation");
      await expect(tiktok.getByRole("button", { name: "Supprimer" })).toHaveCount(0);

      // ── Exporter le récapitulatif de septembre ────────────────────────────
      await sept.getByRole("button", { name: /Exporter septembre 2025 en CSV/ }).click();
      await page.getByTestId("compta-export-kind-summary").click();
      await expect(page.getByTestId("compta-export-preview")).toContainText("CA brut encaissé");
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId("compta-export-download").click(),
      ]);
      expect(download.suggestedFilename()).toBe("e2e-test-compta-2025-09-recap.csv");
      const csv = readFileSync((await download.path())!, "utf8");
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain('"2025-09";"CA brut encaissé";"50,40"');
      expect(csv).toContain('"2025-09";"Net Whop";"4,54"');
      expect(csv).toContain('"2025-09";"Virements reçus";"2026,87"');
      expect(csv).toContain('"2025-09";"Autres charges — Publicité";"-500,00"');
      expect(csv).not.toContain("Non classé");

      // ── Sans Whop, plus d'entrée Compta dans le menu ─────────────────────
      const projectId = await admin.getProjectId();
      await admin.mutation(api.whopSync.e2eSetProjectWhop, { secret: E2E_SECRET, projectId, whop: undefined });
      await expect(page.getByRole("link", { name: "Compta" })).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await restore();
    }
  });

  test("écran : la devise attend le premier import, l'alerte ne vient qu'après", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { projectId, restore } = await setup(ts);
    try {
      // Projet relié à Whop, taux posés, grand livre JAMAIS lu — l'état de Snytch
      // le jour où l'onglet est apparu : « indéterminée » accusait des devises
      // « encaissées sans taux » alors que rien n'avait encore été lu.
      await admin.mutation(api.compta.e2eResetCompta, { secret: E2E_SECRET, projectId });
      await page.goto(adminPath("/compta"));
      const status = page.getByTestId("compta-sync-status");
      await expect(status).toContainText("Grand livre Whop jamais lu", { timeout: 20_000 });
      await expect(status).not.toContainText("Devise de référence indéterminée");
      const charges = page.getByTestId("compta-charges");
      await expect(charges.getByTestId("compta-charges-no-currency")).toContainText("après le premier import");
      await expect(charges.getByRole("button", { name: "Ajouter une charge" })).toBeDisabled();

      // Un import qui voit deux devises sans taux (euro ET franc suisse) : là,
      // l'alerte est vraie, et elle apparaît.
      await admin.mutation(api.compta.e2eSeedLedgerLines, {
        secret: E2E_SECRET,
        projectId,
        lines: [
          { whopId: `line_e2e_${ts}_eur`, lineType: "payment_gross", amount: 9.99, currency: "eur", postedAt: at("2025-09-12T09:30:00Z"), paymentId: `pay_eur_${ts}`, label: "Snytch Pro — Hebdo" },
          { whopId: `line_e2e_${ts}_chf`, lineType: "payment_gross", amount: 10.9, currency: "chf", postedAt: at("2025-09-13T18:05:00Z"), paymentId: `pay_chf_${ts}`, label: "Snytch Pro — Wöchentlich" },
        ],
      });
      await admin.mutation(api.compta.e2eSetComptaState, { secret: E2E_SECRET, projectId, lastSyncAt: Date.now() - 7 * 60_000 });
      await expect(status).toContainText("Devise de référence indéterminée");
      await expect(status).not.toContainText("jamais lu");
      await expect(charges.getByTestId("compta-charges-no-currency")).toContainText("Pose d'abord les taux du projet");
    } finally {
      await restore();
    }
  });

  test("écran : argent à récupérer, bascule des scans, contrôle créatrices", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const { restore } = await setup(ts);
    try {
      const list = await admin.query(api.compta.listComptaTransfers, { month: "2025-09" });
      const w = list.transfers.find((x) => x.sourceId === `wdrl_e2e_${ts}`)!;
      const usd = list.transfers.find((x) => x.sourceId === `wdrl_usd_${ts}`)!;

      await page.goto(adminPath("/compta"));
      await expect(page.getByTestId("compta-sync-status")).toBeVisible({ timeout: 20_000 });
      // Rien à récupérer : pas de bandeau…
      const banner = page.getByTestId("compta-recover-banner");
      await expect(banner).toHaveCount(0);

      // … puis un retrait en USDC bloqué : le bandeau apparaît, toutes années.
      await admin.mutation(api.compta.ventilateTransfer, {
        lineId: usd._id,
        parts: [{ id: "r1", amount: 31.24, usage: "recover", note: "USDC (36,30) bloqué chez Revolut, non reçu" }],
      });
      await expect(banner).toContainText(/Argent à récupérer : 26,87\s*€/);
      await expect(banner).toContainText("USDC (36,30) bloqué chez Revolut, non reçu");
      await expect(banner).toContainText("vers Antho Wallet");
      // « Voir le virement » rouvre le bloc Virements sur septembre 2025.
      await banner.getByRole("button", { name: "Voir le virement" }).click();
      const transfers = page.getByTestId("compta-transfers");
      await expect(transfers.getByTestId(`compta-transfer-wdrl_usd_${ts}`)).toContainText("À récupérer");

      // Kevin a reçu 250 € pour les créatrices ; Hiker compté seul, 200 €.
      await admin.mutation(api.compta.ventilateTransfer, {
        lineId: w._id,
        parts: [
          { id: "k", amount: 250, usage: "creators", note: "Reversé à Kevin pour les créatrices" },
          { id: "h", amount: 200, usage: "business", note: "API HIKER", countedAs: "scans" },
        ],
      });
      await page.getByRole("combobox", { name: /Exercice/ }).click();
      await page.getByRole("option", { name: "Exercice 2025" }).click();
      const scans = page.getByTestId("compta-scans-2025-09");
      await expect(scans).toHaveText(/−200,00\s*€/);
      await expect(scans).toHaveAttribute("title", /Réel 200,00\s*€ contre 948,60\s*€ estimés/);
      const createurs = page.getByTestId("compta-creators-2025-09");
      await expect(createurs).toHaveAttribute("title", /Sorti de Whop pour les créatrices : 250,00\s*€/);

      // Le détail du mois : contrôle créatrices et alerte scans.
      await page.getByTestId("compta-row-2025-09").click();
      const controle = page.getByTestId("compta-creators-control");
      await expect(controle).toContainText(/Sorti de Whop pour elles \(ventilation\)\s*250,00\s*€/);
      await expect(controle).toContainText(/Écart\s*\+\s?250,00\s*€/);
      await expect(controle).toContainText("Plus d'argent sorti que de paie marquée versée");
      await expect(page.getByTestId("compta-detail-scans-low")).toContainText("948,60");

      // La fenêtre de ventilation montre ce que le paiement de scans remplace
      // (le bloc Virements est resté sur septembre 2025, ouvert par le bandeau).
      await transfers.getByTestId(`compta-transfer-wdrl_e2e_${ts}`).getByRole("button", { name: "Ventiler ou annoter" }).click();
      await expect(page.getByTestId("compta-ventilation-scans")).toHaveText(
        /Scans : 948,60\s*€ estimés → 200,00\s*€ réels/,
      );
      await expect(page.getByTestId("compta-ventilation-scans-low")).toContainText(/baissent de 748,60\s*€/);
      // Résultat : la bascule des scans compte (+748,60 €), la part créatrices non.
      await expect(page.getByTestId("compta-ventilation-effect")).toContainText(/Résultat : \+\s?748,60\s*€/);
      await page.getByRole("button", { name: "Annuler" }).click();

      // L'export prévient avant l'envoi.
      await page.getByRole("button", { name: /Exporter septembre 2025/ }).click();
      await expect(page.getByTestId("compta-export-scans-low")).toContainText("948,60");
      await expect(page.getByTestId("compta-export-creators-gap")).toContainText(/250,00\s*€ sortis/);
    } finally {
      await restore();
    }
  });
});

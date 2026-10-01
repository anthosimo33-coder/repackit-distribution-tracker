import { readFileSync } from "node:fs";
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
      expect(r.ledger.transfersReceived).toBe(2000);

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
      expect(d.reconciliation.closing).toBe(-1990.47);
      expect(
        Math.round((d.reconciliation.opening! + d.reconciliation.net - d.reconciliation.transfersReceived) * 100) / 100,
      ).toBe(d.reconciliation.closing);

      // ── Retirer la règle remet la ligne en « non classé » ────────────────
      await admin.mutation(api.compta.removeLineRule, { lineType: "referral_bonus" });
      expect((await row(2025, "2025-09")).r.ledger.unclassified.count).toBe(1);

      // ── Journal du mois : toutes les lignes, sans donnée personnelle ─────
      const j = await admin.query(api.compta.getComptaJournal, { month: "2025-09" });
      expect(j.ledger).toHaveLength(12);
      expect(j.ledger.find((l) => l.lineType === "withdrawal")?.reference).toBe(`wdrl_e2e_${ts}`);
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

  test("une créatrice payée sort en charge au jour du paiement, convertie", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const { restore } = await setup(ts);
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

      // ── Annoter le virement ────────────────────────────────────────────────
      const transfers = page.getByTestId("compta-transfers");
      await transfers.getByRole("combobox").click();
      await page.getByRole("option", { name: "septembre 2025" }).click();
      const virement = page.getByTestId(`compta-transfer-wdrl_e2e_${ts}`);
      await expect(virement).toContainText(/2\s?000,00\s*€/);
      await virement.getByRole("button", { name: "Dire à quoi il a servi" }).click();
      await page.getByTestId("compta-transfer-usage").click();
      await page.getByRole("option", { name: "Rémunération" }).click();
      await page.getByLabel("Motif (libre)").fill("Ma paie de septembre");
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(virement).toContainText("Ma paie de septembre");
      await expect(virement).toContainText("Rémunération");
      // Le résultat ne bouge pas d'un centime avec l'annotation.
      await expect(sept).toContainText(/−944,06\s*€/);

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
      expect(csv).toContain('"2025-09";"Virements reçus";"2000,00"');
      expect(csv).not.toContain("Non classé");

      // ── Sans Whop, plus d'entrée Compta dans le menu ─────────────────────
      const projectId = await admin.getProjectId();
      await admin.mutation(api.whopSync.e2eSetProjectWhop, { secret: E2E_SECRET, projectId, whop: undefined });
      await expect(page.getByRole("link", { name: "Compta" })).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await restore();
    }
  });
});

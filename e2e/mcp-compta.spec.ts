import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const at = (iso: string) => Date.parse(iso);

type Mois = {
  mois: string;
  caBrut: number;
  netWhop: number;
  createatrices: number | null;
  scans: number | null;
  scansSource: string | null;
  scansEstimation?: number | null;
  autresCharges: number;
  resultat: number;
  virementsRecus: number;
  alerteScans?: string;
  controleCreatrices?: { verseSelonPaiements: number | null; sortiDeWhopPourElles: number | null; ecart: number | null; aEclaircir: boolean };
};
type Exercice = {
  exercice: number;
  devise: string;
  mois: Mois[];
  aRecuperer: { jour: string; montant: number; devise: string; contreValeur: number | null; motif: string | null; vers: string | null }[];
  nonClasses: { type: string; lignes: number }[];
  seuilsDeCA: { caBrutCumule: number; statut: string } | null;
};
type Detail = {
  mois: string;
  grandLivre: { caBrut: number; netWhop: number; virementsRecus: number };
  virements: {
    jour: string;
    montant: number;
    devise: string;
    vers: string | null;
    echoue?: boolean;
    parts?: { montant: number; usage: string; motif: string | null; compteeEnCharge: string | null }[];
    sansMotif?: number;
  }[];
  scans: { source: string | null; total: number | null; paiements: { libelle: string; depuisUnVirement: boolean }[] };
  createatrices: { controle: Mois["controleCreatrices"] | null };
};

async function appel(url: string, token: string, args: Record<string, unknown>) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "compta", arguments: args } }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { brut: result.content[0].text, erreur: result.isError ?? false };
}

/**
 * Outil MCP `compta` — l'onglet Compta, par les MÊMES cœurs
 * (`comptaOverviewCore`, `comptaMonthCore`) derrière le même bloc de droits.
 *
 * Projet DÉDIÉ (la spec compta.spec remet à zéro la compta du projet e2e) :
 * septembre 2025 à la forme de la PROD — un encaissement du 31/08 à 22 h 30 UTC
 * (septembre à Paris), un en dollars, un remboursement, un type inconnu, des
 * scans estimés à 948,60 €, un virement de 2 000 € VENTILÉ (paie, créatrices,
 * Hiker compté en Scans) et 31,24 $ d'USDC bloqués, marqués « à récupérer ».
 */
test.describe("Outil MCP compta", () => {
  test("l'exercice et le détail d'un mois, comme l'onglet, ventilation comprise", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-compta-${ts}`;
    const nom = `E2E MCP Compta ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.compta.e2eSetProjectFx, {
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
      const id = (s: string) => `line_mcp_${ts}_${s}`;
      await admin.mutation(api.compta.e2eSeedLedgerLines, {
        secret: E2E_SECRET,
        projectId,
        lines: [
          { whopId: id("a1"), lineType: "payment_gross", amount: 9.99, currency: "eur", postedAt: at("2025-08-31T22:30:00Z"), paymentId: `pay_a_${ts}`, label: "Snytch Pro 3 cibles — Hebdo" },
          { whopId: id("a2"), lineType: "payment_processing_percentage_fee", amount: -0.55, currency: "eur", postedAt: at("2025-08-31T22:30:00Z"), paymentId: `pay_a_${ts}` },
          { whopId: id("b1"), lineType: "payment_gross", amount: 11.99, currency: "usd", postedAt: at("2025-09-16T10:00:00Z"), paymentId: `pay_b_${ts}`, label: "Snytch Pro 3 Targets - Weekly" },
          { whopId: id("r1"), lineType: "payment_refund", amount: -9.99, currency: "eur", postedAt: at("2025-09-20T09:12:00Z"), paymentId: `pay_a_${ts}` },
          { whopId: id("x1"), lineType: "referral_bonus", amount: 25, currency: "eur", postedAt: at("2025-09-26T14:02:00Z") },
          { whopId: id("w1"), lineType: "withdrawal", amount: -2000, currency: "eur", postedAt: at("2025-09-25T08:00:00Z"), sourceId: `wdrl_mcp_${ts}`, destination: "SEPA ••4821", sourceStatus: "completed" },
          { whopId: id("u1"), lineType: "withdrawal", amount: -31.24, currency: "usd", postedAt: at("2025-09-10T12:05:00Z"), sourceId: `wdrl_usdc_${ts}`, destination: "usdc jeremie", sourceStatus: "completed" },
        ],
      });
      await admin.mutation(api.compta.e2eSetScanMonth, {
        secret: E2E_SECRET,
        projectId,
        month: "2025-09",
        lightUsd: 540.63,
        fullUsd: 562.39,
        runs: 179_177,
        withCost: 179_177,
      });
      const virements = (await admin.query(api.compta.listComptaTransfers, { projectId, month: "2025-09" })).transfers;
      const w = virements.find((x) => x.sourceId === `wdrl_mcp_${ts}`)!;
      const usdc = virements.find((x) => x.sourceId === `wdrl_usdc_${ts}`)!;
      await admin.mutation(api.compta.ventilateTransfer, {
        projectId,
        lineId: w._id,
        parts: [
          { id: "p", amount: 1500, usage: "pay", note: "Ma paie de septembre" },
          { id: "k", amount: 250, usage: "creators", note: "Reversé à Kevin pour les créatrices" },
          { id: "h", amount: 200, usage: "business", note: "API HIKER", countedAs: "scans" },
        ],
      });
      await admin.mutation(api.compta.ventilateTransfer, {
        projectId,
        lineId: usdc._id,
        parts: [{ id: "r", amount: 31.24, usage: "recover", note: "USDC (36,30) bloqué chez Revolut, non reçu" }],
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E compta ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];

      // ── L'exercice ──────────────────────────────────────────────────────────
      const exo = await appel(url, token, { projet: slug, annee: 2025 });
      expect(exo.erreur, exo.brut).toBe(false);
      const r = JSON.parse(exo.brut) as Exercice;
      expect(r).toMatchObject({ exercice: 2025, devise: "eur" });
      const sept = r.mois.find((m) => m.mois === "2025-09")!;
      // Hiker compté seul (200 €) remplace l'estimation de 948,60 € — et se signale.
      expect(sept).toMatchObject({ scans: 200, scansSource: "paiements réels", scansEstimation: 948.6 });
      expect(sept.alerteScans).toContain("sous l'estimation");
      // Aucune paie marquée versée en septembre 2025 : les 250 € sortis sont un écart.
      expect(sept.controleCreatrices).toEqual({
        verseSelonPaiements: 0,
        sortiDeWhopPourElles: 250,
        ecart: 250,
        aEclaircir: true,
      });
      expect(r.aRecuperer).toEqual([
        {
          jour: "2025-09-10",
          montant: 31.24,
          devise: "usd",
          contreValeur: 26.87,
          motif: "USDC (36,30) bloqué chez Revolut, non reçu",
          vers: "usdc jeremie",
          depuisJours: expect.any(Number),
        },
      ]);
      expect(r.nonClasses).toContainEqual(expect.objectContaining({ type: "referral_bonus", lignes: 1 }));

      // Le MÊME calcul que l'onglet, mois par mois.
      const ecran = await admin.query(api.compta.getComptaOverview, { projectId, year: 2025 });
      expect(r.mois.map((m) => [m.mois, m.caBrut, m.netWhop, m.createatrices, m.scans, m.autresCharges, m.resultat, m.virementsRecus])).toEqual(
        ecran.rows.map((x) => [x.month, x.ledger.gross, x.ledger.net, x.creators, x.scans, x.other, x.result, x.ledger.transfersReceived]),
      );

      // ── Le détail du mois, ventilation comprise ─────────────────────────────
      const mois = await appel(url, token, { projet: slug, mois: "2025-09" });
      expect(mois.erreur, mois.brut).toBe(false);
      const d = JSON.parse(mois.brut) as Detail;
      const v2000 = d.virements.find((x) => x.montant === 2000)!;
      expect(v2000).toMatchObject({ jour: "2025-09-25", devise: "eur", vers: "SEPA ••4821", sansMotif: 50 });
      expect(v2000.parts).toEqual([
        { montant: 1500, usage: "rémunération", motif: "Ma paie de septembre", compteeEnCharge: null },
        { montant: 250, usage: "paiement créatrices", motif: "Reversé à Kevin pour les créatrices", compteeEnCharge: null },
        { montant: 200, usage: "charges de l'activité", motif: "API HIKER", compteeEnCharge: "scans" },
      ]);
      expect(d.virements.find((x) => x.devise === "usd")!.parts).toEqual([
        { montant: 31.24, usage: "à récupérer (bloqué, en transit)", motif: "USDC (36,30) bloqué chez Revolut, non reçu", compteeEnCharge: null },
      ]);
      expect(d.scans).toMatchObject({ source: "paiements réels", total: 200 });
      expect(d.scans.paiements).toEqual([expect.objectContaining({ libelle: "API HIKER", depuisUnVirement: true })]);
      expect(d.createatrices.controle).toEqual(sept.controleCreatrices);
      const detailEcran = await admin.query(api.compta.getComptaMonth, { projectId, month: "2025-09" });
      expect([d.grandLivre.caBrut, d.grandLivre.netWhop, d.grandLivre.virementsRecus]).toEqual([
        detailEcran.ledger.gross,
        detailEcran.ledger.net,
        detailEcran.ledger.transfersReceived,
      ]);
      // Présence juste au-dessus (le virement, par sa destination) ; jamais ses
      // identifiants internes.
      for (const brut of [exo.brut, mois.brut]) {
        expect(brut).not.toContain(w._id);
        expect(brut).not.toContain(usdc._id);
      }

      // Un mois mal écrit est refusé, avec la forme attendue.
      const faux = await appel(url, token, { projet: slug, mois: "2025-13" });
      expect(faux.erreur).toBe(true);
      expect(faux.brut).toContain("AAAA-MM");
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

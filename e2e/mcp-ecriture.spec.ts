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

type Rpc = { result?: { tools?: { name: string; annotations: Record<string, unknown> }[]; content?: { text: string }[]; isError?: boolean }; error?: { message: string } };

async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}
async function appel(url: string, token: string, name: string, args: Record<string, unknown>) {
  const r = await rpc(url, token, "tools/call", { name, arguments: args });
  return {
    erreur: r.error !== undefined || r.result?.isError === true,
    texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "",
  };
}

const ECRITURE = ["ventiler_virement", "relever_solde", "marquer_mis_de_cote_paye", "ajouter_charge", "supprimer_charge", "classer_type_whop"];

/**
 * MCP EN ÉCRITURE (Compta) — une connexion ne MODIFIE que si la personne l'a
 * autorisée DANS L'APP ; chaque outil appelle le cœur de la mutation de l'écran
 * (mêmes règles, mêmes refus) et note l'écriture au journal.
 *
 * Projet DÉDIÉ, septembre 2025 à la forme de la prod : le retrait de 1 806 € vers
 * OCBC LTVT ventilé comme le vrai, un relevé d'Antho Banque, un type Whop inconnu.
 */
test.describe("MCP en écriture — Compta", () => {
  test("lecture seule par défaut, puis chaque outil comme l'écran, journal, et retour en lecture seule", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-ecrit-${ts}`;
    const nom = `E2E MCP Ecriture ${ts}`;
    const nomCle = `E2E écriture ${ts}`;
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
      await admin.mutation(api.compta.e2eSetProjectFx, { secret: E2E_SECRET, projectId, payCurrency: "usd", fxRateToRevenue: 0.86 });
      await admin.mutation(api.compta.e2eSetComptaState, { secret: E2E_SECRET, projectId, referenceCurrency: "eur", lastSyncAt: Date.now() - 60_000 });
      const id = (s: string) => `line_ecr_${ts}_${s}`;
      await admin.mutation(api.compta.e2eSeedLedgerLines, {
        secret: E2E_SECRET,
        projectId,
        lines: [
          { whopId: id("g"), lineType: "payment_gross", amount: 9838.4, currency: "eur", postedAt: at("2025-09-05T10:00:00Z"), paymentId: `pay_${ts}` },
          { whopId: id("w1"), lineType: "withdrawal", amount: -1806, currency: "eur", postedAt: at("2025-09-09T19:57:00Z"), sourceId: `wdrl_ocbc_${ts}`, destination: "OCBC LTVT", sourceStatus: "completed" },
          { whopId: id("w2"), lineType: "withdrawal", amount: -2325.49, currency: "eur", postedAt: at("2025-09-15T05:29:00Z"), sourceId: `wdrl_antho_${ts}`, destination: "Antho Banque", sourceStatus: "completed" },
          { whopId: id("x"), lineType: "referral_bonus", amount: 25, currency: "eur", postedAt: at("2025-09-26T14:02:00Z") },
        ],
      });

      // ── Une clé, depuis l'écran : lecture seule ─────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(nomCle);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
      await page.getByRole("button", { name: "J’ai copié la clé" }).click();

      const noms = async () => ((await rpc(url, token, "tools/list")).result?.tools ?? []).map((t) => t.name);
      expect(await noms()).toContain("compta");
      for (const n of ECRITURE) expect(await noms()).not.toContain(n);
      const refuse = await appel(url, token, "relever_solde", { projet: slug, compte: "Antho Banque", solde: 1 });
      expect(refuse.erreur).toBe(true);
      expect((await admin.query(api.compta.getComptaTreasury, { projectId })).accounts).toEqual([]);

      // ── L'écriture s'ouvre DANS L'APP ───────────────────────────────────────
      const interrupteur = page.getByRole("switch", { name: `Modifications de la Compta pour ${nomCle}` });
      await expect(interrupteur).not.toBeChecked();
      await interrupteur.click();
      await expect(interrupteur).toBeChecked();
      const outils = (await rpc(url, token, "tools/list")).result!.tools!;
      for (const n of ECRITURE) expect(outils.map((t) => t.name)).toContain(n);
      expect(outils.find((t) => t.name === "ventiler_virement")!.annotations).toMatchObject({ readOnlyHint: false });
      expect(outils.find((t) => t.name === "compta")!.annotations).toMatchObject({ readOnlyHint: true });

      // ── ventiler_virement : les libellés de l'écran, le cœur de l'écran ─────
      const v = await appel(url, token, "ventiler_virement", {
        projet: slug,
        jour: "2025-09-09",
        montant: 1806,
        parts: [
          { montant: 832, usage: "Charges de l'activité", motif: "Remboursement à Jérem des frais Hiker avancés" },
          { montant: 870, usage: "Paiement créatrices", motif: "Reversé à Kevin pour les créatrices" },
          { montant: 100, usage: "charges de l'activite", motif: "Top-up Hiker du 13/09", compter_en_charge: "Scans" },
          { montant: "3,50", usage: "business", motif: "Frais de réception LTVT Capital", compter_en_charge: "autre" },
        ],
      });
      expect(v.erreur, v.texte).toBe(false);
      expect(JSON.parse(v.texte).fait).toBe("1806,00 EUR vers OCBC LTVT du 09/09/2025, en 4 parts (103,50 EUR comptés en charge)");
      const virements = (await admin.query(api.compta.listComptaTransfers, { projectId, month: "2025-09" })).transfers;
      expect(virements.find((x) => x.destination === "OCBC LTVT")!.parts.map((p) => [p.amount, p.usage, p.countedAs])).toEqual([
        [832, "business", null],
        [870, "creators", null],
        [100, "business", "scans"],
        [3.5, "business", "other"],
      ]);

      // Mêmes refus que l'écran : des parts au-delà du virement, un usage inconnu.
      const trop = await appel(url, token, "ventiler_virement", {
        projet: slug,
        jour: "2025-09-09",
        montant: 1806,
        parts: [{ montant: 2000, usage: "rémunération" }],
      });
      expect(trop).toMatchObject({ erreur: true });
      expect(trop.texte).toContain("Refusé");
      const inconnu = await appel(url, token, "ventiler_virement", {
        projet: slug,
        jour: "2025-09-09",
        montant: 1806,
        parts: [{ montant: 10, usage: "cadeau" }],
      });
      expect(inconnu.texte).toContain("usage inconnu « cadeau »");
      const introuvable = await appel(url, token, "ventiler_virement", { projet: slug, jour: "2025-09-10", montant: 1806, parts: [] });
      expect(introuvable.texte).toContain("Aucun virement réussi de 1806 le 2025-09-10");

      // ── relever_solde, marquer_mis_de_cote_paye ──────────────────────────────
      const r = await appel(url, token, "relever_solde", {
        projet: slug,
        compte: "Antho Banque",
        solde: "1 337,49",
        jour: "2025-09-20",
        destinations: ["Antho Banque"],
      });
      expect(r.erreur, r.texte).toBe(false);
      const treso = await admin.query(api.compta.getComptaTreasury, { projectId });
      expect(treso.accounts).toEqual([
        expect.objectContaining({ name: "Antho Banque", currency: "eur", destinations: ["Antho Banque"], reading: expect.objectContaining({ day: "2025-09-20", amount: 1337.49 }) }),
      ]);
      const p = await appel(url, token, "marquer_mis_de_cote_paye", { projet: slug, montant: 200, jour: "2025-10-15", motif: "URSSAF 3e trimestre" });
      expect(p.erreur, p.texte).toBe(false);
      expect((await admin.query(api.compta.getComptaTreasury, { projectId })).setAside.used).toBe(200);

      // ── ajouter_charge puis supprimer_charge ─────────────────────────────────
      const c = await appel(url, token, "ajouter_charge", {
        projet: slug,
        jour: "2025-09-05",
        libelle: "Vercel Pro",
        categorie: "Hébergement",
        montant: 20,
      });
      expect(c.erreur, c.texte).toBe(false);
      const charges = async () => (await admin.query(api.compta.listComptaCharges, { projectId, month: "2025-09" })).charges.map((x) => [x.label, x.category]);
      expect(await charges()).toContainEqual(["Vercel Pro", "hosting"]);
      // Une charge née d'une ventilation ne se supprime pas ici.
      const liee = await appel(url, token, "supprimer_charge", { projet: slug, jour: "2025-09-09", libelle: "Top-up Hiker du 13/09" });
      expect(liee.texte).toContain("Refusé");
      const s = await appel(url, token, "supprimer_charge", { projet: slug, jour: "2025-09-05", libelle: "vercel pro" });
      expect(s.erreur, s.texte).toBe(false);
      expect(await charges()).not.toContainEqual(["Vercel Pro", "hosting"]);
      expect(await charges()).toContainEqual(["Top-up Hiker du 13/09", "scans"]);

      // ── classer_type_whop ───────────────────────────────────────────────────
      expect((await admin.query(api.compta.getComptaOverview, { projectId, year: 2025 })).unclassified.map((u) => u.lineType)).toEqual(["referral_bonus"]);
      const k = await appel(url, token, "classer_type_whop", { projet: slug, type: "referral_bonus", colonne: "CA brut" });
      expect(k.erreur, k.texte).toBe(false);
      expect((await admin.query(api.compta.getComptaOverview, { projectId, year: 2025 })).unclassified).toEqual([]);

      // ── Le journal, dans l'écran ─────────────────────────────────────────────
      const journal = page.getByTestId("mcp-journal");
      await expect(journal).toContainText("Ventiler un virement");
      await expect(journal).toContainText("1806,00 EUR vers OCBC LTVT du 09/09/2025, en 4 parts");
      await expect(journal).toContainText("Relever un solde");
      await expect(journal).toContainText("Ranger un type Whop");
      await expect(journal).toContainText(nomCle);
      await expect(journal.getByRole("link", { name: /Virements · septembre 2025/ })).toHaveAttribute("href", `/admin/${slug}/compta`);

      // ── Retour en lecture seule : plus aucun outil d'écriture ───────────────
      await interrupteur.click();
      await expect(interrupteur).not.toBeChecked();
      for (const n of ECRITURE) expect(await noms()).not.toContain(n);
      const coupe = await appel(url, token, "ajouter_charge", { projet: slug, jour: "2025-09-05", libelle: "Après coupure", categorie: "outils", montant: 1 });
      expect(coupe.erreur).toBe(true);
      expect(await charges()).not.toContainEqual(["Après coupure", "tools"]);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

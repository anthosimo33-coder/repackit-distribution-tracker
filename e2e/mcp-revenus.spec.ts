import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";
import { formatMoney } from "../convex/moneyFormat";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;
const HEURE = 3_600_000;

type Sortie = { text: string; isError: boolean };

async function outil(url: string, token: string, args: Record<string, unknown>): Promise<Sortie> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "revenus", arguments: args },
    }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { text: result.content[0].text, isError: result.isError === true };
}

type Revenus = {
  devise: string;
  periode: { du: string; au: string; jours: number };
  revenuNet: number | null;
  periodePrecedente?: { du?: string; au?: string; revenuNet?: number | null; evolutionPct?: number | null; indisponible?: string };
  parJour: { jour: string; net: number }[];
  historique: {
    premierJourDeRevenu: string | null;
    ltvRealiseeParClient: number | null;
    revenuMensuelParClient: number | null;
    parMois: { mois: string; net: number; premierPaiement: number; renouvellement: number; nonRattache: number; clients: number }[];
  };
  offres: {
    offre: string | null;
    prix: number | null;
    devisePrix: string | null;
    clients: number;
    netTotal: number | null;
    ltvRealisee: number | null;
    netParPaiement: number | null;
    netParMoisClient: number | null;
  }[];
  remboursements: { montant: number; nombre: number };
  litigesEnCours: {
    montantARisque: number;
    litiges: { montant: number; echeanceReponse: string | null; joursPourRepondre: number | null; motif: string | null; client: string | null }[];
  };
  avertissements?: string[];
};

/** Jour de Paris d'un instant — la clé de jour du serveur. */
const jourParis = (ts: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));
const moisParis = (ts: number) => jourParis(ts).slice(0, 7);
const arrondi = (n: number) => Math.round(n * 100) / 100;

/**
 * Outil MCP `revenus` — Claude lit ce que montre l'onglet Analytics (revenu de
 * la période, offres, litiges), par le MÊME calcul (`getRevenueBreakdownCore`,
 * fenêtres de `convex/analyticsDates`).
 *
 * Projet DÉDIÉ : la base e2e partagée porte les paiements Whop d'autres specs
 * (autres devises), qui changeraient les totaux selon l'ordre des fichiers.
 * Forme de la prod : euros à décimales, un abonnement hebdo qui renouvelle, un
 * remboursement, un litige en cours avec son échéance, un paiement d'AUJOURD'HUI
 * (hors de la période par défaut, qui s'arrête à hier).
 */
test.describe("Outil MCP revenus", () => {
  test("revenu de la période, comparaison, offres et litiges : les chiffres de l'écran", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-revenus-${ts}`;
    const nom = `E2E MCP Revenus ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_revenus_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      const maintenant = Date.now();
      const echeance = maintenant + 3 * DAY + 5 * HEURE;
      const paiement = (
        n: string,
        o: { jours: number; plan: string; membre: string; brut: number; net: number },
        extra: Record<string, unknown> = {},
      ) => ({
        whopId: `pay_e2e_rev_${ts}_${n}`,
        status: "paid" as const,
        rawStatus: "paid",
        currency: "eur",
        grossAmount: o.brut,
        feeAmount: Math.round((o.brut - o.net) * 100) / 100,
        netAmount: o.net,
        refundedAmount: 0,
        paidAt: maintenant - o.jours * DAY,
        planId: o.plan,
        membershipId: `mem_e2e_rev_${ts}_${o.membre}`,
        ...extra,
      });
      await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
        secret: E2E_SECRET,
        projectId,
        payments: [
          // Avant la période précédente : fixe le 1er jour de données (la
          // comparaison n'est possible que si les données la couvrent).
          paiement("f0", { jours: 70, plan: "plan_hebdo", membre: "F", brut: 7.99, net: 7.24 }),
          // Période précédente (les 30 jours avant la période).
          paiement("a1", { jours: 40, plan: "plan_hebdo", membre: "A", brut: 7.99, net: 7.24 }),
          // Période : un renouvellement hebdo et un nouveau client mensuel.
          paiement("a2", { jours: 12, plan: "plan_hebdo", membre: "A", brut: 7.99, net: 7.24 }),
          paiement("b1", { jours: 5, plan: "plan_mois", membre: "B", brut: 19.99, net: 18.37 }),
          // Remboursé en entier : 0 au net, compté en remboursement.
          paiement(
            "c1",
            { jours: 8, plan: "plan_mois", membre: "C", brut: 19.99, net: 18.37 },
            { status: "refunded", rawStatus: "refunded", refundedAmount: 18.37 },
          ),
          // Litige en cours : exclu du net, à risque, échéance dans 3 j 5 h.
          paiement(
            "d1",
            { jours: 20, plan: "plan_mois", membre: "D", brut: 19.99, net: 18.37 },
            {
              status: "disputed",
              rawStatus: "disputed",
              memberName: `lea.moreau_${ts}`,
              disputeDueAt: echeance,
              disputeReason: "fraudulent",
            },
          ),
          // Aujourd'hui : hors de la période par défaut (qui s'arrête à hier).
          paiement("e1", { jours: 0, plan: "plan_hebdo", membre: "E", brut: 7.99, net: 7.24 }),
        ],
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E revenus ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];

      // ── Période par défaut : les 30 jours complets jusqu'à hier ─────────────
      const sortie = await outil(url, token, { projet: slug, comparer: true });
      expect(sortie.isError, sortie.text).toBe(false);
      const r = JSON.parse(sortie.text) as Revenus;
      const hier = jourParis(maintenant - DAY);
      expect(r.periode).toEqual({ du: jourParis(maintenant - 30 * DAY), au: hier, jours: 30 });
      // 7,24 (renouvellement A) + 18,37 (nouveau B). Ni le remboursé, ni le
      // litige, ni le paiement d'aujourd'hui.
      expect(r.revenuNet).toBe(25.61);
      expect(r.parJour.map((d) => d.jour)).not.toContain(jourParis(maintenant));
      // Même durée (30 j), juste avant : du J−60 au J−31.
      expect(r.periodePrecedente).toMatchObject({
        du: jourParis(maintenant - 60 * DAY),
        au: jourParis(maintenant - 31 * DAY),
        revenuNet: 7.24,
        evolutionPct: 253.7, // (25,61 − 7,24) ÷ 7,24
      });

      // ── Le calcul de l'écran, champ par champ ──────────────────────────────
      const ecran = await admin.query(api.analyticsHub.getRevenueBreakdown, { projectId });
      expect(r.parJour).toEqual(
        ecran.dailyNet
          .filter((d) => d.day >= r.periode.du && d.day <= r.periode.au)
          .map((d) => ({ jour: d.day, net: d.net })),
      );
      expect(r.historique.parMois).toEqual(
        ecran.periods.map((p) => ({
          mois: p.period,
          net: p.net,
          premierPaiement: p.newNet,
          renouvellement: p.returningNet,
          nonRattache: p.unattributedNet,
          clients: p.members,
        })),
      );
      expect(r.offres.map((o) => [o.clients, o.netTotal, o.ltvRealisee])).toEqual(
        ecran.plans.map((p) => [p.members, p.netTotal, p.ltv]),
      );
      // Mensuel : 3 clients (B, C remboursé, D en litige), 18,37 de net → 6,12.
      expect(r.offres).toContainEqual(
        expect.objectContaining({ prix: 19.99, clients: 3, netTotal: 18.37, ltvRealisee: 6.12 }),
      );
      expect(r.remboursements).toEqual({ montant: 18.37, nombre: 1 });
      expect(r.litigesEnCours.montantARisque).toBe(18.37);
      expect(r.litigesEnCours.litiges).toEqual([
        {
          montant: 18.37,
          devise: "eur",
          payeLe: jourParis(maintenant - 20 * DAY),
          echeanceReponse: jourParis(echeance),
          joursPourRepondre: 4, // 3 j 5 h, arrondi au jour entier supérieur (comme l'écran)
          motif: "fraudulent",
          client: `lea.moreau_${ts}`,
        },
      ]);
      expect(r.avertissements?.join(" ")).toMatch(/1 litige\(s\) EN COURS/);

      // ── Comparaison impossible : dite, jamais tronquée ──────────────────────
      // Présence juste au-dessus ; ici la période démarre au 1er jour de données.
      const tout = JSON.parse(
        (await outil(url, token, { projet: slug, du: jourParis(maintenant - 70 * DAY), comparer: true })).text,
      ) as Revenus;
      expect(tout.revenuNet).toBe(40.09); // 7,24 × 3 (F, A, A) + 18,37 (B) : tout sauf aujourd’hui
      expect(tout.periodePrecedente?.indisponible).toMatch(/ne couvrent pas entièrement/);
      expect(tout.periodePrecedente).not.toHaveProperty("revenuNet");

      // ── Période explicite incluant aujourd'hui ──────────────────────────────
      const aujourdhui = JSON.parse(
        (await outil(url, token, { projet: slug, du: jourParis(maintenant), au: jourParis(maintenant) })).text,
      ) as Revenus;
      expect(aujourdhui.revenuNet).toBe(7.24);

      // ── Dates fausses : refus lisible ──────────────────────────────────────
      const faux = await outil(url, token, { projet: slug, du: "2026-13-01" });
      expect(faux.isError).toBe(true);
      expect(faux.text).toMatch(/AAAA-MM-JJ/);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });

  // Snytch encaisse en euros, en dollars et en dinars. L'économie par offre, la
  // LTV et le revenu mensuel par client additionnaient le net de chaque paiement
  // DANS SA DEVISE : l'offre serbe à 599 RSD affichait 2 141,05 de net, des
  // dinars lus comme des euros. L'écran formatait en plus ces nets dans la
  // devise du PRIX de l'offre.
  test("offres, LTV et revenu mensuel en EUR + RSD + USD : ramenés en euros au taux du projet", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-revenus-fx-${ts}`;
    const nom = `E2E MCP Revenus FX ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_revfx_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.compta.e2eSetProjectFx, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: 0.86,
        fxRatesToRevenue: [{ currency: "rsd", rate: 0.00852 }],
      });
      const plan = (k: string) => `plan_e2e_revfx_${ts}_${k}`;
      await admin.mutation(api.whopSync.e2eUpsertWhopPlans, {
        secret: E2E_SECRET,
        projectId,
        plans: [
          { planId: plan("rsd"), name: `Nedeljno ${ts}`, price: 599, currency: "rsd", interval: "semaine" },
          { planId: plan("eur"), name: `Hebdo ${ts}`, price: 9.99, currency: "eur", interval: "semaine" },
          { planId: plan("usd"), name: `Monthly ${ts}`, price: 19.99, currency: "usd", interval: "mois" },
        ],
      });
      const maintenant = Date.now();
      // Forme de la prod : 599 RSD bruts → 535,26 RSD nets (= 4,56 €).
      const lignes = [
        { n: "r1a", plan: "rsd", membre: "R1", jours: 12, currency: "rsd", brut: 599, net: 535.26 },
        { n: "r1b", plan: "rsd", membre: "R1", jours: 8, currency: "rsd", brut: 599, net: 535.26 },
        { n: "r1c", plan: "rsd", membre: "R1", jours: 5, currency: "rsd", brut: 599, net: 535.26 },
        { n: "r2", plan: "rsd", membre: "R2", jours: 3, currency: "rsd", brut: 599, net: 535.26 },
        { n: "e1", plan: "eur", membre: "E1", jours: 4, currency: "eur", brut: 9.99, net: 9.31 },
        { n: "u1", plan: "usd", membre: "U1", jours: 6, currency: "usd", brut: 21.5, net: 20 },
      ];
      await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
        secret: E2E_SECRET,
        projectId,
        payments: lignes.map((l) => ({
          whopId: `pay_e2e_revfx_${ts}_${l.n}`,
          status: "paid" as const,
          rawStatus: "paid",
          currency: l.currency,
          grossAmount: l.brut,
          feeAmount: Math.round((l.brut - l.net) * 100) / 100,
          netAmount: l.net,
          refundedAmount: 0,
          paidAt: maintenant - l.jours * DAY,
          planId: plan(l.plan),
          membershipId: `mem_e2e_revfx_${ts}_${l.membre}`,
        })),
      });
      // Mois actifs de R1 : un ou deux selon le jour du mois où tourne le test.
      // Trois paiements sur au plus deux mois : le net par mois-abonné ne vaut
      // jamais le net par paiement, les deux colonnes de l'écran se distinguent.
      const moisR1 = new Set([12, 8, 5].map((j) => moisParis(maintenant - j * DAY))).size;
      const netParMoisRsd = arrondi(18.24 / (moisR1 + 1));

      // ── Le calcul de l'écran ───────────────────────────────────────────────
      const ecran = await admin.query(api.analyticsHub.getRevenueBreakdown, { projectId });
      expect(ecran.currency).toBe("eur");
      const offre = (k: string) => ecran.plans.find((p) => p.planId === plan(k));
      // 4 × 535,26 RSD × 0,00852 = 4 × 4,56 € — et non 2 141,04.
      expect(offre("rsd")).toMatchObject({
        currency: "rsd", // devise du PRIX, inchangée
        price: 599,
        members: 2,
        netTotal: 18.24,
        ltv: 9.12,
        netPerPayment: 4.56,
        netPerMemberMonth: netParMoisRsd,
      });
      // 20 $ × 0,86 — et non 20.
      expect(offre("usd")).toMatchObject({ currency: "usd", members: 1, netTotal: 17.2, ltv: 17.2, netPerPayment: 17.2 });
      expect(offre("eur")).toMatchObject({ members: 1, netTotal: 9.31, ltv: 9.31, netPerPayment: 9.31 });
      // 18,24 + 9,31 + 17,20 = 44,75 € sur 4 abonnements — et non 2 170,35 ÷ 4.
      expect(ecran.ltv).toBe(11.19);
      expect(ecran.monthlyArpu).toBe(arrondi(44.75 / (moisR1 + 3)));

      // ── L'outil : les mêmes chiffres, devise du prix séparée de celle du net ─
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E revenus fx ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];
      const sortie = await outil(url, token, { projet: slug });
      expect(sortie.isError, sortie.text).toBe(false);
      const r = JSON.parse(sortie.text) as Revenus;
      expect(r.devise).toBe("eur");
      expect(r.historique.ltvRealiseeParClient).toBe(ecran.ltv);
      expect(r.historique.revenuMensuelParClient).toBe(ecran.monthlyArpu);
      expect(
        r.offres.map((o) => [o.clients, o.netTotal, o.ltvRealisee, o.netParPaiement, o.netParMoisClient]),
      ).toEqual(ecran.plans.map((p) => [p.members, p.netTotal, p.ltv, p.netPerPayment, p.netPerMemberMonth]));
      expect(r.offres).toContainEqual(
        expect.objectContaining({ offre: `Nedeljno ${ts}`, prix: 599, devisePrix: "rsd", netTotal: 18.24, ltvRealisee: 9.12 }),
      );

      // ── L'écran : nets en euros, pied hebdo/mensuel additionnable ───────────
      await page.goto(`/admin/${slug}/analytics`);
      await page.getByRole("tab", { name: "Offres & tests" }).click();
      const carte = page.locator('[data-slot="card"]').filter({ hasText: "Économie par offre" });
      const ligneRsd = carte.getByRole("row").filter({ hasText: `Nedeljno ${ts}` });
      const cellule = (i: number) => ligneRsd.locator("td").nth(i);
      // Le prix reste en dinars (l'ICU de Chromium l'écrit sans décimales,
      // celui de Node avec) ; les nets sont en euros — et non « 535,26 RSD ».
      await expect(cellule(0)).toContainText(/599(,00)?\sRSD/);
      await expect(cellule(1)).toHaveText("2");
      await expect(cellule(2)).toHaveText(formatMoney(4.56, "eur"));
      await expect(cellule(4)).toHaveText(formatMoney(netParMoisRsd, "eur"));
      // Pied hebdo/mensuel : 18,24 € (RSD) + 9,31 € — et non 2 150,35 ; 20 $ × 0,86.
      const pied = (cadence: string) =>
        carte.locator("span").filter({ has: page.locator("strong", { hasText: cadence }) });
      await expect(pied("Hebdomadaire")).toContainText(formatMoney(27.55, "eur"));
      await expect(pied("Mensuel")).toContainText(formatMoney(17.2, "eur"));
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

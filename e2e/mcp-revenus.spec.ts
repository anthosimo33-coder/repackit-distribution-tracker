import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

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
    parMois: { mois: string; net: number; premierPaiement: number; renouvellement: number; nonRattache: number; clients: number }[];
  };
  offres: { offre: string | null; prix: number | null; clients: number; netTotal: number; ltvRealisee: number | null }[];
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
      expect(r.periodePrecedente).toMatchObject({
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
});

import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  ANALYSIS_WINDOW_DAYS,
  computeChurn,
  HORIZON_DAYS,
  SAMPLE_THRESHOLD,
  WHOP_WEBHOOK_FIX_MS,
} from "../convex/churn";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;
const MINUTE = 60_000;

type Retention = {
  devise: string;
  cohorte: string | { du: string; au: string; clientsAcquis: number };
  clientsPayants: number;
  sur90Jours: {
    resiliations: number;
    expirations: number;
    tauxResiliationPct: number | null;
    delaiAvantResiliationHeures: { mediane: number | null; neufSurDix: number | null };
    resiliations_detail: { offre: string; delaiHeures: number | null }[];
  };
  perteAVenir: { dansLesJours: number; clients: number; clientsPayantsApres: number; liste: { finAcces: string }[] };
  revenu?: { nouveau: number; renouvellement: number; partRenouvellementPct: number | null };
  parClient?: { coutAcquisition: { valeur: number; devise: string } | null };
};

async function outil(url: string, token: string, args: Record<string, unknown>): Promise<Retention> {
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
      params: { name: "retention", arguments: args },
    }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError ?? false, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text) as Retention;
}

const jourParis = (ts: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));

/**
 * Outil MCP `retention` — l'onglet Rétention de l'Analytics, par le MÊME calcul
 * (`convex/churn.computeChurn` sur `getChurn`).
 *
 * Projet DÉDIÉ, quatre abonnements à la forme de la prod :
 *  - A (mensuel) paie, résilie 17 jours après, garde l'accès encore 5 jours ;
 *  - B (hebdo) paie trois fois (deux renouvellements), puis EXPIRE ;
 *  - C (mensuel) paie, toujours actif ;
 *  - D (mensuel) paie et résilie 6 MINUTES après — le cas « quasi immédiat ».
 */
test.describe("Outil MCP retention", () => {
  test("résiliations, expirations, perte à venir, renouvellement : les chiffres de l'onglet", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-retention-${ts}`;
    const nom = `E2E MCP Retention ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_ret_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      const maintenant = Date.now();
      const mem = (m: string) => `mem_e2e_ret_${ts}_${m}`;
      const paiement = (n: string, m: string, jours: number, plan: string, net: number, raison: string) => ({
        whopId: `pay_e2e_ret_${ts}_${n}`,
        status: "paid" as const,
        rawStatus: "paid",
        currency: "eur",
        grossAmount: net > 10 ? 19.99 : 7.99,
        feeAmount: Math.round(((net > 10 ? 19.99 : 7.99) - net) * 100) / 100,
        netAmount: net,
        refundedAmount: 0,
        paidAt: maintenant - jours,
        planId: plan,
        membershipId: mem(m),
        billingReason: raison,
      });
      await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
        secret: E2E_SECRET,
        projectId,
        payments: [
          paiement("a1", "A", 20 * DAY, "plan_mois", 18.37, "subscription_create"),
          paiement("b1", "B", 30 * DAY, "plan_hebdo", 7.24, "subscription_create"),
          paiement("b2", "B", 23 * DAY, "plan_hebdo", 7.24, "subscription_cycle"),
          paiement("b3", "B", 16 * DAY, "plan_hebdo", 7.24, "subscription_cycle"),
          paiement("c1", "C", 10 * DAY, "plan_mois", 18.37, "subscription_create"),
          paiement("d1", "D", 2 * DAY, "plan_mois", 18.37, "subscription_create"),
        ],
      });
      const abonnement = (m: string, extra: Record<string, unknown>) =>
        admin.mutation(api.whopSync.e2eSeedWhopMembership, {
          secret: E2E_SECRET,
          projectId,
          whopMembershipId: mem(m),
          ...extra,
        });
      // A : résilié 3 j avant aujourd'hui (17 j après son paiement), accès jusqu'à J+5.
      await abonnement("A", {
        planId: "plan_mois",
        status: "canceled",
        canceledAt: maintenant - 3 * DAY,
        accessEndsAt: maintenant + 5 * DAY,
        valid: true,
      });
      // B : expiré il y a 9 jours.
      await abonnement("B", { planId: "plan_hebdo", status: "expired", accessEndsAt: maintenant - 9 * DAY, valid: false });
      await abonnement("C", { planId: "plan_mois" });
      // D : résilié 6 minutes après son paiement, accès jusqu'à J+28.
      await abonnement("D", {
        planId: "plan_mois",
        status: "canceled",
        canceledAt: maintenant - 2 * DAY + 6 * MINUTE,
        accessEndsAt: maintenant + 28 * DAY,
        valid: true,
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E retention ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];

      // ── Toute la profondeur ────────────────────────────────────────────────
      const r = await outil(url, token, { projet: slug });
      expect(r.cohorte).toBe("toute la profondeur");
      expect(r.clientsPayants).toBe(4);
      expect(r.sur90Jours).toMatchObject({
        resiliations: 2, // A et D
        expirations: 1, // B
        tauxResiliationPct: 50,
        // Médiane (rang le plus proche) = la plus rapide des deux : 6 min = 0,1 h ;
        // 9 sur 10 = la plus lente : 17 jours = 408 h.
        delaiAvantResiliationHeures: { mediane: 0.1, neufSurDix: 408 },
      });
      // Les quasi-immédiates d'abord.
      expect(r.sur90Jours.resiliations_detail.map((d) => d.delaiHeures)).toEqual([0.1, 408]);
      expect(r.perteAVenir).toMatchObject({
        dansLesJours: 7,
        clients: 1, // A (J+5) ; D finit à J+28, hors horizon
        clientsPayantsApres: 3,
        liste: [{ finAcces: jourParis(maintenant + 5 * DAY) }],
      });
      // 4 premiers paiements (62,35) contre 2 renouvellements de B (14,48). La part
      // vaut 0,18847 ; le serveur l'arrondit à 4 décimales (0,1885) et l'écran à
      // une décimale de % : 18,9 % À L'ÉCRAN — et donc ici.
      expect(r.revenu).toMatchObject({ nouveau: 62.35, renouvellement: 14.48, partRenouvellementPct: 18.9 });
      // Aucune vidéo : coût d'acquisition nul, affiché, sans ratio inventé.
      expect(r.parClient?.coutAcquisition).toMatchObject({ valeur: 0 });

      // ── Le calcul de l'écran, sur l'agrégat de l'écran ─────────────────────
      const ecran = await admin.query(api.analyticsHub.getChurn, { projectId });
      const attendu = computeChurn(ecran.memberships, {
        now: Date.now(),
        periodStartMs: Date.now() - ANALYSIS_WINDOW_DAYS * DAY,
        webhookFixMs: WHOP_WEBHOOK_FIX_MS,
        horizonMs: HORIZON_DAYS * DAY,
        sampleThreshold: SAMPLE_THRESHOLD,
        libelleSansOffre: "(sans offre)",
      });
      expect([
        r.clientsPayants,
        r.sur90Jours.resiliations,
        r.sur90Jours.expirations,
        r.sur90Jours.tauxResiliationPct,
        r.perteAVenir.clients,
        r.perteAVenir.clientsPayantsApres,
      ]).toEqual([
        attendu.clients,
        attendu.resiliations,
        attendu.expirations,
        attendu.cancelRate,
        attendu.upcomingExpirations.length,
        attendu.projectedClients,
      ]);

      // ── Une cohorte : les clients ACQUIS sur les 12 derniers jours ──────────
      const du = jourParis(maintenant - 11 * DAY);
      const au = jourParis(maintenant);
      const cohorte = await outil(url, token, { projet: slug, du, au });
      expect(cohorte.cohorte).toEqual({ du, au, clientsAcquis: 2 }); // C et D
      expect(cohorte.clientsPayants).toBe(2);
      expect(cohorte.sur90Jours).toMatchObject({ resiliations: 1, expirations: 0, tauxResiliationPct: 50 });
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

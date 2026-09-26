import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { parisDayKey } from "../convex/viewsDaily";
import { shiftDay } from "../convex/analyticsDates";
import { checkoutLoss, posthogOutageDays, whopWithoutAppAccess } from "../convex/analyticsHubMath";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const MIN = 60_000;
const DAY = 86_400_000;

/** La panne PostHog du 07-08/09 tombe-t-elle dans la période ? (sort des fenêtres avec le temps) */
const traversePanne = (du: string, au: string) => [...posthogOutageDays()].some((j) => j >= du && j <= au);
const avert = (sortie: { avertissements?: string[] }) => (sortie.avertissements ?? []).join(" ");

async function outil(url: string, token: string, name: string, args: Record<string, unknown>) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError === true, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text);
}

const tunnel = (visit: number, signup: number, paywall: number, checkout: number, subs: number) => ({
  segments: [
    {
      key: "all",
      steps: [
        { key: "visit", count: visit },
        { key: "signup_completed", count: signup },
        { key: "paywall_viewed", count: paywall },
        { key: "checkout_started", count: checkout },
        { key: "subscription_completed", count: subs },
      ],
    },
  ],
});
const parPays = (lignes: [string, number, number, number, number][]) => ({
  segments: lignes.map(([key, visit, signup, checkout, subs]) => ({
    key,
    steps: [
      { key: "visit", count: visit },
      { key: "signup_completed", count: signup },
      { key: "checkout_started", count: checkout },
      { key: "subscription_completed", count: subs },
    ],
  })),
});
const appareil = (device: string, checkouts: number, paid: number, divertedFree: number, failedPayment: number, disappeared: number, medPayMs: number, p90PayMs: number) => ({
  device,
  checkouts,
  paid,
  divertedFree,
  failedPayment,
  disappeared,
  medPayMs,
  p90PayMs,
});

/**
 * Outil MCP `parcours` — l'onglet Parcours, par les MÊMES calculs, et le
 * trafic de `marches` qui suit enfin la période (point 8).
 *
 * Deux jeux de chiffres PostHog, pour qu'on voie lequel est lu :
 *  - le cache du cron (90 jours) : 4 812 visiteurs au tunnel, 2 050 visiteurs FR ;
 *  - la plage que l'ÉCRAN recalcule par défaut (ses 30 derniers jours de
 *    données), rangée dans le cache partagé : 1 734 visiteurs, 811 FR.
 * Aucune clé PostHog : une plage absente du cache ne peut PAS être recalculée —
 * l'outil doit retomber sur les 90 jours ET le dire.
 */
test.describe("Outil MCP parcours (+ trafic de marches sur la période)", () => {
  test("recalculé sur la période comme l'écran ; repli annoncé ; cache si la période couvre tout", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const slug = `e2e-mcp-parcours-${ts}`;
    const nom = `E2E MCP Parcours ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    // Les jours de données : 60, jusqu'à aujourd'hui (Paris).
    const aujourdHui = parisDayKey(ts);
    const premier = parisDayKey(ts - 59 * DAY);
    // La fenêtre par défaut de l'ÉCRAN : ses 30 derniers jours de données.
    const ecran = { from: shiftDay(aujourdHui, -29), to: aujourdHui };

    try {
      const cache = (key: string, valeur: unknown) => ({ key, json: JSON.stringify(valeur), computedAt: ts - 30 * MIN });
      await admin.mutation(api.posthogSync.e2eSeedPosthogCache, {
        secret: E2E_SECRET,
        projectId,
        entries: [
          cache("overview", {
            daily: Array.from({ length: 60 }, (_, i) => ({
              ts: ts - (59 - i) * DAY,
              visitors: 81 + (i % 7) * 3,
              signups: 20 + (i % 5),
              checkouts: 6,
              subs: 2,
            })),
          }),
          cache("funnel:sequential", tunnel(4_812, 1_206, 1_118, 342, 97)),
          cache("funnel:global", tunnel(5_330, 1_291, 1_202, 377, 118)),
          cache("funnel:country", parPays([["FR", 2_117, 604, 171, 0], ["BE", 431, 102, 38, 0], ["(inconnu)", 388, 41, 9, 0]])),
          cache("funnel:language", parPays([["fr", 702, 611, 180, 61], ["(inconnu)", 4_020, 540, 150, 30]])),
          cache("countryPersons", parPays([["FR", 2_050, 598, 160, 60]])),
          cache("checkoutReliability", {
            rows: [
              appareil("natif", 211, 71, 41, 12, 87, 38_400, 151_000),
              appareil("webview", 131, 26, 19, 9, 77, 52_000, 190_000),
            ],
          }),
          cache("activation", { rows: [] }),
          cache("serverSideSplit", { rows: [] }),
        ],
      });

      // La plage de l'écran, telle qu'une volée PostHog l'aurait rangée.
      const recalcule = {
        funnels: {
          global: tunnel(1_902, 431, 399, 127, 44),
          sequential: tunnel(1_734, 402, 377, 118, 37),
          source: { segments: [] },
          language: parPays([["fr", 309, 270, 71, 22], ["en", 64, 51, 12, 5], ["(inconnu)", 1_361, 81, 35, 10]]),
          country: parPays([["FR", 802, 233, 64, 0], ["BE", 157, 41, 13, 0], ["(inconnu)", 118, 12, 4, 0]]),
          countryPersons: parPays([["FR", 811, 236, 63, 24]]),
        },
        activation: {
          rows: [
            { segment: "payant", recent: 1, persons: 23, targetAdded: 21, firstAlert: 18, usernameEntered: 23 },
            { segment: "payant", recent: 0, persons: 14, targetAdded: 11, firstAlert: 7, usernameEntered: 12 },
            { segment: "gratuit", recent: 1, persons: 151, targetAdded: 83, firstAlert: 36, usernameEntered: 142 },
            { segment: "sans_acces", recent: 0, persons: 187, targetAdded: 4, firstAlert: 1, usernameEntered: 52 },
            { segment: "hors_inscription", recent: 0, persons: 1_322, targetAdded: 0, firstAlert: 0, usernameEntered: 0 },
          ],
        },
        checkoutReliability: {
          rows: [
            appareil("natif", 71, 26, 13, 4, 28, 41_300, 166_000),
            appareil("webview", 47, 11, 7, 3, 26, 58_900, 204_000),
          ],
        },
        serverSideSplit: {
          rows: [
            { event: "signup_completed", personsTotal: 402, personsClient: 402, eventsTotal: 402, eventsServer: 0 },
            { event: "subscription_completed", personsTotal: 37, personsClient: 3, eventsTotal: 71, eventsServer: 65 },
          ],
        },
        offres: {
          abVariants: { rows: [] },
          abArms: { rows: [], startMs: null },
          abOffers: { rows: [] },
          abPurchases: { rows: [] },
          paywallById: { rows: [], startMs: null },
          freePlan: { signups: 0, used: 0, convertedPaid: 0 },
          scanCost: { rows: [] },
        },
        sante: {
          firstSearchAfterPay: {
            paid: 0, paidExcluded: 0, instrStartMs: null, searched: 0, results: [],
            medDelaySec: null, p90DelaySec: null, cancelJoinable: 0,
          },
          searchResults: { rows: [] },
          scanReliability: { rows: [] },
          scanLatency: { rows: [] },
          friction: { rows: [] },
          frictionByStep: { rows: [] },
          instrumentation: { events: [], props: [] },
        },
        from: ecran.from,
        to: ecran.to,
        elapsedMs: 2_870,
        cachedAt: null,
        stale: false,
      };
      await admin.mutation(api.analyticsWindowed.e2eSeedWindowCache, {
        secret: E2E_SECRET,
        projectId,
        from: ecran.from,
        to: ecran.to,
        json: JSON.stringify(recalcule),
        computedAt: ts - 10 * MIN,
      });

      // Whop : trois ventes facturées en France dans la plage, pour que le
      // marché FR existe côté argent (le trafic ne crée pas de marché).
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_parc_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
        secret: E2E_SECRET,
        projectId,
        payments: [9, 6, 3].map((jours, i) => ({
          whopId: `pay_e2e_parc_${ts}_${i}`,
          status: "paid" as const,
          rawStatus: "paid",
          currency: "eur",
          grossAmount: 19.99,
          feeAmount: 1.62,
          netAmount: 18.37,
          refundedAmount: 0,
          paidAt: ts - jours * DAY,
          planId: "plan_mois",
          membershipId: `mem_e2e_parc_${ts}_${i}`,
          billingCountry: "FR",
          billingReason: "subscription_create",
        })),
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E parcours ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];

      // ── 1. La période de l'écran : recalculée (le cache partagé) ────────────
      const p = await outil(url, token, "parcours", { projet: slug, du: ecran.from, au: ecran.to });
      expect(p.periode).toEqual({ du: ecran.from, au: ecran.to, source: "recalculé sur la période (bornée aux jours de données)" });
      expect(avert(p)).not.toContain("Recalcul sur la période impossible");
      expect(avert(p).includes("Ingestion PostHog coupée")).toBe(traversePanne(ecran.from, ecran.to));
      expect(p.tunnel.map((t: { personnes: number }) => t.personnes)).toEqual([1_734, 402, 377, 118, 37]);
      expect(p.tunnel.map((t: { partDesVisiteursPct: number }) => t.partDesVisiteursPct)).toEqual([100, 23.2, 21.7, 6.8, 2.1]);
      expect(p.tunnel.map((t: { perteDepuisEtapePrecedentePct: number | null }) => t.perteDepuisEtapePrecedentePct)).toEqual([null, 76.8, 6.2, 68.7, 68.6]);
      expect(p.tunnel[4].atteinteBrute).toEqual({ libelle: "Paiements déclenchés", personnes: 44 });
      // Les non-payeurs : 118 checkouts − 37 payés = 81, chacun sur une seule ligne.
      expect(p.checkoutsSansPaiement).toEqual({
        detournesVersLeGratuit: 20,
        echecDePaiementSansSuite: 7,
        disparusSansTentative: 54,
        total: 81,
      });
      const l = checkoutLoss(recalcule.checkoutReliability.rows);
      expect(p.checkoutsSansPaiement.total).toBe(l.total);
      expect(p.parAppareil.appareils.map((d: { contexte: string; conversionPct: number }) => [d.contexte, d.conversionPct])).toEqual([
        ["Navigateur natif", 36.6],
        ["Webview in-app", 23.4],
      ]);
      expect(p.parAppareil.checkoutsAvecAppareilConnuPct).toBe(100);
      expect(p.delaiJusquAuPaiement).toEqual({ medianeSec: 41.3, neufSurDixSousSec: 166, ancienSeuilTimeoutSec: 60 });
      expect(p.traficParPaysDeConnexion.inconnuPct).toBe(11); // 118 ÷ 1 077
      expect(p.traficParPaysDeConnexion.lignes.map((r: { segment: string; visiteurs: number }) => [r.segment, r.visiteurs])).toEqual([
        ["FR", 802],
        ["BE", 157],
      ]);
      expect(p.traficParPaysDeConnexion.lignes[0].clients).toBeUndefined();
      expect(p.traficParPaysDeConnexion.mesureCoteNavigateur).toContainEqual({
        etape: "subscription_completed",
        partPct: 8.1,
        nonMesurable: false,
      });
      expect(p.traficParLangue.lignes[0]).toEqual({ segment: "fr", visiteurs: 309, inscrits: 270, checkouts: 71, clients: 22, visiteVersClientPct: 7.1 });
      expect(p.activation.tousLesInscrits.map((r: { type: string; inscrits: number }) => [r.type, r.inscrits])).toEqual([
        ["Payant", 37],
        ["Gratuit", 151],
        ["Inscrits sans accès", 187],
      ]);
      expect(p.activation.depuisLe28Juillet.map((r: { type: string; inscrits: number }) => [r.type, r.inscrits])).toEqual([
        ["Payant", 23],
        ["Gratuit", 151],
      ]);
      const fiab = await admin.query(api.analyticsHub.getReliability, { projectId });
      const gap = whopWithoutAppAccess(fiab.coherence);
      expect(p.paiementsWhopSansAccesApp).toEqual(
        gap === null ? null : { ecart: Math.max(0, gap.gap), clientsWhop: gap.whop, abonnesApp: gap.app, sur: "toute la profondeur (pas la période)" },
      );
      expect(p.ventesParPaysDeFacturation.pays.map((r: { pays: string; clients: number }) => [r.pays, r.clients])).toEqual([["FR", 3]]);

      // Le trafic du marché FR suit la même période (point 8).
      const m = await outil(url, token, "marches", { projet: slug, du: ecran.from, au: ecran.to, pays: "FR" });
      expect(m.traficSur).toEqual({ du: ecran.from, au: ecran.to, source: "recalculé sur la période (bornée aux jours de données)" });
      expect(m.marches[0].trafic.visiteurs).toBe(811);
      expect(m.marches[0].trafic.checkouts).toBe(63);

      // ── 2. Une période absente du cache, sans clé : repli ANNONCÉ ───────────
      const defaut = await outil(url, token, "parcours", { projet: slug });
      expect(defaut.periode.source).toBe("cache des 90 derniers jours (recalcul impossible)");
      expect(defaut.tunnel[0].personnes).toBe(4_812);
      expect(avert(defaut)).toContain("Recalcul sur la période impossible");
      expect(avert(defaut)).toContain("POSTHOG_API_KEY_E2E_ABSENTE");
      const mDefaut = await outil(url, token, "marches", { projet: slug, pays: "FR" });
      expect(mDefaut.traficSur).toEqual({ source: "cache des 90 derniers jours (recalcul impossible)" });
      expect(mDefaut.marches[0].trafic.visiteurs).toBe(2_050);
      expect(avert(mDefaut)).toContain("Trafic : recalcul sur la période impossible");
      expect(avert(m)).not.toContain("Trafic : recalcul");

      // ── 3. Une période qui couvre toutes les données : le cache, sans alerte ─
      const tout = await outil(url, token, "parcours", { projet: slug, du: premier, au: aujourdHui });
      expect(tout.periode).toEqual({
        du: premier,
        au: aujourdHui,
        source: "cache des 90 derniers jours (la période couvre toutes les données)",
      });
      expect(tout.tunnel[0].personnes).toBe(4_812);
      expect(tout.checkoutsSansPaiement.total).toBe(60 + 21 + 164);
      expect(avert(tout)).not.toContain("Recalcul sur la période impossible");
      expect(avert(tout).includes("Ingestion PostHog coupée")).toBe(traversePanne(premier, aujourdHui));

      // ── L'écran, sur sa période par défaut, montre les MÊMES pertes ─────────
      await page.goto(`/admin/${slug}/analytics`);
      await page.getByRole("tab", { name: "Parcours" }).click();
      const ligne = page.getByRole("row").filter({ hasText: "Détournés vers le gratuit" });
      await expect(ligne.getByRole("cell").nth(1)).toHaveText("20");
      await expect(
        page.getByRole("row").filter({ hasText: "Disparition sans aucune tentative" }).getByRole("cell").nth(1),
      ).toHaveText("54");
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

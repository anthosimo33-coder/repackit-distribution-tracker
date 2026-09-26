import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { parisDayKey } from "../convex/viewsDaily";
import { shiftDay } from "../convex/analyticsDates";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const MIN = 60_000;
const DAY = 86_400_000;

async function outil(url: string, token: string, args: Record<string, unknown>) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "sante_produit", arguments: args } }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError === true, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text);
}

const premiereRecherche = (paid: number, searched: number, found: number, prive: number, introuvable: number, erreur: number, ts: number) => ({
  paid,
  paidExcluded: 6,
  instrStartMs: ts - 50 * DAY,
  searched,
  results: [
    { result: "found", persons: found },
    { result: "private", persons: prive },
    { result: "not_found", persons: introuvable },
    { result: "error", persons: erreur },
  ],
  medDelaySec: 312.4,
  p90DelaySec: 2_841,
  cancelJoinable: 0,
});

/**
 * Outil MCP `sante_produit` — l'onglet Santé produit, par les MÊMES calculs
 * (convex/analyticsHubMath : scansByReason, searchOutcome, firstSearchVerdict).
 *
 * Deux jeux PostHog : le cache du cron (88 payants ont cherché, 61 trouvés —
 * 69,3 %) et la période que l'ÉCRAN recalcule par défaut (29 ont cherché, 17
 * trouvés — 58,6 %, sous le seuil d'échantillon de 30).
 */
test.describe("Outil MCP sante_produit", () => {
  test("première recherche, scans, recherche, latence, frictions : l'onglet, sur la même période", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-sante-${ts}`;
    const nom = `E2E MCP Santé ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };
    const aujourdHui = parisDayKey(ts);
    const premier = parisDayKey(ts - 59 * DAY);
    const ecran = { from: shiftDay(aujourdHui, -29), to: aujourdHui };

    try {
      const cache = (key: string, valeur: unknown) => ({ key, json: JSON.stringify(valeur), computedAt: ts - 30 * MIN });
      await admin.mutation(api.posthogSync.e2eSeedPosthogCache, {
        secret: E2E_SECRET,
        projectId,
        entries: [
          cache("overview", {
            daily: Array.from({ length: 60 }, (_, i) => ({ ts: ts - (59 - i) * DAY, visitors: 80, signups: 20, checkouts: 6, subs: 2 })),
          }),
          cache("firstSearchAfterPay", premiereRecherche(97, 88, 61, 14, 9, 4, ts)),
          cache("scanReliability", {
            rows: [
              { reason: "scheduled_full", mode: "full", result: "success", runs: 3_402 },
              { reason: "scheduled_full", mode: "full", result: "error", runs: 88 },
            ],
          }),
          cache("searchResults", { rows: [{ result: "found", persons: 640 }] }),
          cache("instrumentation", {
            events: [
              { name: "handle_submitted", category: "produit", persons: 1_107, firstSeenMs: ts - 50 * DAY, notYetEmitted: false },
              { name: "handle_search_result", category: "produit", persons: 702, firstSeenMs: ts - 50 * DAY, notYetEmitted: false },
            ],
            props: [],
          }),
          cache("scanLatency", { rows: [] }),
          cache("friction", { rows: [] }),
          cache("frictionByStep", { rows: [] }),
        ],
      });

      // La plage de l'écran, telle qu'une volée PostHog l'aurait rangée.
      await admin.mutation(api.analyticsWindowed.e2eSeedWindowCache, {
        secret: E2E_SECRET,
        projectId,
        from: ecran.from,
        to: ecran.to,
        computedAt: ts - 10 * MIN,
        json: JSON.stringify({
          funnels: {
            global: { segments: [] },
            sequential: { segments: [] },
            source: { segments: [] },
            language: { segments: [] },
            country: { segments: [] },
            countryPersons: { segments: [] },
          },
          activation: { rows: [] },
          checkoutReliability: { rows: [] },
          serverSideSplit: { rows: [] },
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
            firstSearchAfterPay: premiereRecherche(41, 29, 17, 6, 4, 2, ts),
            searchResults: {
              rows: [
                { result: "found", persons: 212 },
                { result: "private", persons: 31 },
                { result: "not_found", persons: 18 },
              ],
            },
            scanReliability: {
              rows: [
                { reason: "scheduled_full", mode: "full", result: "success", runs: 1_204 },
                { reason: "scheduled_full", mode: "full", result: "error", runs: 97 },
                { reason: "scheduled_full", mode: "full", result: "timeout", runs: 31 },
                { reason: "scheduled_light", mode: "light", result: "success", runs: 3_310 },
                { reason: "scheduled_light", mode: "light", result: "error", runs: 12 },
                { reason: "manual_refresh", mode: "full", result: "success", runs: 88 },
              ],
            },
            scanLatency: {
              rows: [
                { bucket: "< 1k", medianMs: 8_400, p90Ms: 21_300, n: 311 },
                { bucket: "1k-10k", medianMs: 14_100, p90Ms: 64_200, n: 187 },
              ],
            },
            friction: { rows: [{ page: "/onboarding", persons: 23 }, { page: "/app/cibles", persons: 9 }] },
            frictionByStep: { rows: [{ step: "(absent)", persons: 23 }] },
            instrumentation: {
              events: [
                { name: "handle_submitted", category: "produit", persons: 402, firstSeenMs: ts - 50 * DAY, notYetEmitted: false },
                { name: "handle_search_result", category: "produit", persons: 261, firstSeenMs: ts - 50 * DAY, notYetEmitted: false },
              ],
              props: [],
            },
          },
          from: ecran.from,
          to: ecran.to,
          elapsedMs: 2_910,
          cachedAt: null,
          stale: false,
        }),
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E santé ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];

      // ── La période de l'écran : recalculée ──────────────────────────────────
      const p = await outil(url, token, { projet: slug, du: ecran.from, au: ecran.to });
      expect(p.periode).toEqual({ du: ecran.from, au: ecran.to, source: "recalculé sur la période (bornée aux jours de données)" });
      expect(p.premiereRechercheApresPaiement).toMatchObject({
        payantsMesurables: 41,
        exclusCarPayesAvantInstrumentation: 6,
        ontCherche: 29,
        trouves: 17,
        exploitablePct: 58.6,
        echantillonSuffisant: false,
        seuilEchantillon: 30,
        delaiPaiementVersRechercheSec: { mediane: 312.4, neufSurDix: 2_841 },
      });
      expect(p.premiereRechercheApresPaiement.resultats[0]).toEqual({ resultat: "Trouvé", exploitable: true, personnes: 17 });
      // Scans par déclenchement : le planifié complet d'abord, 128 échecs sur 1 332.
      expect(p.fiabiliteDesScans.map((s: { declenchement: string; executes: number; echecs: number; tauxEchecPct: number }) => [s.declenchement, s.executes, s.echecs, s.tauxEchecPct])).toEqual([
        ["Planifié complet", 1_332, 128, 9.6],
        ["Planifié léger", 3_322, 12, 0.4],
        ["Rafraîchissement manuel", 88, 0, 0],
      ]);
      expect(p.fiabiliteDesScans[0].detecteLesDesabonnements).toBe(true);
      expect(p.fiabiliteDesScans[0].resultats).toContainEqual({ resultat: "Délai dépassé", echec: true, executes: 31, partPct: 2.3 });
      // Bloqués par le paywall : DÉDUITS (402 ont saisi un compte, 261 ont eu un résultat).
      expect(p.resultatsDeRecherche.bloquesParLePaywall).toEqual({ personnes: 141, source: "déduit (handle_submitted − handle_search_result)" });
      expect(p.latenceDesScans).toEqual([
        { scan: "< 1k", medianeSec: 8.4, neufSurDixSec: 21.3, scans: 311 },
        { scan: "1k-10k", medianeSec: 14.1, neufSurDixSec: 64.2, scans: 187 },
      ]);
      expect(p.frictions.pages).toEqual([{ page: "/onboarding", personnes: 23 }, { page: "/app/cibles", personnes: 9 }]);
      expect(p.frictions.parEtapeDOnboarding).toBe("non ventilé : l'app n'émet pas encore onboarding_step sur le rageclick");
      expect((p.avertissements ?? []).join(" ")).not.toContain("Recalcul sur la période impossible");

      // ── Toute la profondeur : le cache du cron ─────────────────────────────
      const tout = await outil(url, token, { projet: slug, du: premier, au: aujourdHui });
      expect(tout.periode.source).toBe("cache des 90 derniers jours (la période couvre toutes les données)");
      expect(tout.premiereRechercheApresPaiement).toMatchObject({ ontCherche: 88, trouves: 61, exploitablePct: 69.3, echantillonSuffisant: true });
      expect(tout.resultatsDeRecherche.bloquesParLePaywall.personnes).toBe(405);

      // ── L'écran, sur sa période par défaut, dit la même chose ──────────────
      await page.goto(`/admin/${slug}/analytics`);
      await page.getByRole("tab", { name: "Santé produit" }).click();
      await expect(page.getByText(/17 sur 29 trouvés/)).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: "Planifié complet" }).first()).toContainText("9,6");
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

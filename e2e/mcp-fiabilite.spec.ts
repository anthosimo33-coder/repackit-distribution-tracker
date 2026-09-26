import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { buildCoherenceChecks } from "../convex/analyticsHubMath";
import { coherenceInputsFrom } from "../convex/coherenceInputs";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Sortie = { text: string; isError: boolean };
async function outil(url: string, token: string, args: Record<string, unknown>): Promise<Sortie> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fiabilite", arguments: args } }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { text: result.content[0].text, isError: result.isError === true };
}

type Fiabilite = {
  posthogConfigure: boolean;
  controles: { controle: string; etat: string; detail: string | null }[];
  ecarts: number;
  instrumentation: {
    evenements: { evenement: string; personnes: number | null; premiereEmission: string | null; etat: string; note?: string }[];
    proprietes: { propriete: string; emise: boolean; evenementsLaPortant: number }[];
  };
  comptesInternesExclus: { personnesPostHog: number; surPersonnesPostHog: number; abonnementsWhop: number };
  abonnementsParPersonne: {
    abonnements: number;
    personnes: number;
    personnesAvecPlusieurs: number;
    repartition: { abonnements: number; personnes: number }[];
  } | null;
  nonMesurable: { quoi: string; pourquoi: string }[];
  rupturesDeSerie: { depuis: string }[];
  fraicheur: { source: string; derniereSynchro: string | null; etat: string }[];
};

/**
 * Outil MCP `fiabilite` — l'onglet Fiabilité, par les MÊMES contrôles
 * (`buildCoherenceChecks` sur `coherenceInputsFrom`, le module de l'écran).
 *
 * Projet DÉDIÉ, cache PostHog semé comme le cron l'aurait rangé il y a 13 h
 * (donc périmé) : un tunnel séquentiel NON monotone (431 paywalls vus pour 402
 * inscrits), quatre événements dans quatre états, trois comptes internes exclus.
 * Côté Whop, six abonnements payés pour trois personnes (1, 2 et 3), synchro il
 * y a une heure (fraîche).
 */
test.describe("Outil MCP fiabilite", () => {
  test("contrôles, instrumentation, doublons, fraîcheur : l'onglet Fiabilité", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-fiab-${ts}`;
    const nom = `E2E MCP Fiabilité ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      const il13h = ts - 13 * HOUR;
      const cache = (key: string, valeur: unknown) => ({ key, json: JSON.stringify(valeur), computedAt: il13h });
      await admin.mutation(api.posthogSync.e2eSeedPosthogCache, {
        secret: E2E_SECRET,
        projectId,
        entries: [
          cache("funnel:sequential", {
            segments: [
              {
                key: "all",
                steps: [
                  { key: "$pageview", count: 1_834 },
                  { key: "signup_completed", count: 402 },
                  { key: "paywall_shown", count: 431 },
                  { key: "subscription_completed", count: 37 },
                ],
              },
            ],
          }),
          cache("instrumentation", {
            events: [
              { name: "$pageview", category: "acquisition", persons: 1_834, firstSeenMs: ts - 41 * DAY, notYetEmitted: false },
              {
                name: "paywall_shown",
                category: "conversion",
                persons: 612,
                firstSeenMs: ts - 38 * DAY,
                notYetEmitted: false,
                note: "émis deux fois (client + serveur)",
              },
              { name: "payment_failed", category: "conversion", persons: 0, firstSeenMs: null, notYetEmitted: true },
              { name: "handle_submitted", category: "produit", persons: 0, firstSeenMs: null, notYetEmitted: false },
            ],
            props: [
              { key: "creator_ref", onEvent: "$pageview", present: 1_207, notYetEmitted: false },
              { key: "paywall_id", onEvent: "paywall_shown", present: 0, notYetEmitted: false },
            ],
          }),
          cache("internalExcluded", { persons: 3, totalPersons: 1_837 }),
        ],
      });

      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_fiab_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      // Six abonnements payés : Lou 1, Sam 2, Noa 3.
      const abonnements = [
        ["lou", 1],
        ["sam", 2],
        ["noa", 3],
      ].flatMap(([qui, n]) => Array.from({ length: n as number }, (_, i) => ({ qui: qui as string, id: `mem_e2e_fiab_${ts}_${qui}${i}` })));
      for (const [i, a] of abonnements.entries()) {
        await admin.mutation(api.whopSync.e2eSeedWhopMembership, {
          secret: E2E_SECRET,
          projectId,
          whopMembershipId: a.id,
          whopUserId: `user_e2e_fiab_${ts}_${a.qui}`,
          createdAt: ts - (20 - i) * DAY,
        });
      }
      await admin.mutation(api.whopSync.e2eUpsertWhopPayments, {
        secret: E2E_SECRET,
        projectId,
        payments: abonnements.map((a, i) => ({
          whopId: `pay_e2e_fiab_${ts}_${i}`,
          status: "paid" as const,
          rawStatus: "paid",
          currency: "eur",
          grossAmount: 19.99,
          feeAmount: 1.62,
          netAmount: 18.37,
          refundedAmount: 0,
          paidAt: ts - (20 - i) * DAY,
          planId: "plan_mois",
          membershipId: a.id,
          billingReason: "subscription_create",
        })),
      });
      await admin.mutation(api.whopSync.e2eMarkWhopSynced, { secret: E2E_SECRET, projectId, at: ts - HOUR });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E fiabilité ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];

      const sortie = await outil(url, token, { projet: slug });
      expect(sortie.isError, sortie.text).toBe(false);
      const f = JSON.parse(sortie.text) as Fiabilite;

      // ── Les contrôles : ceux de l'écran, un par un ──────────────────────────
      const ecran = buildCoherenceChecks(
        coherenceInputsFrom((await admin.query(api.analyticsHub.getReliability, { projectId })).coherence),
      );
      const etat = { ok: "ok", info: "info", violation: "écart" } as const;
      expect(f.controles).toEqual(ecran.map((c) => ({ controle: c.label, etat: etat[c.status], detail: c.detail || null })));
      expect(f.controles).toContainEqual({
        controle: "Tunnel séquentiel monotone",
        etat: "écart",
        detail: "paywall_shown dépasse signup_completed de 29",
      });
      expect(f.ecarts).toBe(ecran.filter((c) => c.status === "violation").length);
      expect(f.ecarts).toBeGreaterThanOrEqual(1);

      // ── Instrumentation : quatre états ──────────────────────────────────────
      expect(f.instrumentation.evenements.map((e) => [e.evenement, e.personnes, e.etat])).toEqual([
        ["$pageview", 1_834, "sain"],
        ["paywall_shown", 612, "à surveiller"],
        ["payment_failed", null, "attendu, absent"],
        ["handle_submitted", null, "absent"],
      ]);
      expect(f.instrumentation.evenements[1].note).toBe("émis deux fois (client + serveur)");
      expect(f.instrumentation.proprietes.map((p) => [p.propriete, p.emise, p.evenementsLaPortant])).toEqual([
        ["creator_ref", true, 1_207],
        ["paywall_id", false, 0],
      ]);
      expect(f.comptesInternesExclus).toEqual({ personnesPostHog: 3, surPersonnesPostHog: 1_837, abonnementsWhop: 0 });

      // ── Six abonnements pour trois personnes : deux en ont plusieurs ────────
      expect(f.abonnementsParPersonne).toEqual({
        abonnements: 6,
        personnes: 3,
        personnesAvecPlusieurs: 2,
        repartition: [
          { abonnements: 2, personnes: 1 },
          { abonnements: 3, personnes: 1 },
        ],
      });
      // Aucun identifiant Whop ne sort.
      expect(sortie.text).not.toContain("user_e2e_fiab");
      expect(sortie.text).not.toContain("mem_e2e_fiab");

      // ── Fraîcheur : PostHog il y a 13 h (périmé), Whop il y a 1 h (frais) ───
      expect(f.fraicheur.map((x) => [x.source, x.etat])).toEqual([
        ["PostHog", "périmé"],
        ["Whop", "frais"],
        ["Vues (scraping)", "périmé"],
      ]);
      expect(f.fraicheur[2].derniereSynchro).toBeNull();
      expect(f.nonMesurable[0]).toEqual({ quoi: "Assignations sans date de post", pourquoi: "aucune assignation" });
      expect(f.nonMesurable.map((x) => x.quoi)).toContain("Latence de recherche");
      expect(f.rupturesDeSerie.map((r) => r.depuis)).toContain("17/08/2026");

      // ── L'écran dit la même chose ───────────────────────────────────────────
      await page.goto(`/admin/${slug}/analytics`);
      await page.getByRole("tab", { name: "Fiabilité" }).click();
      await expect(page.getByRole("row").filter({ hasText: "Tunnel séquentiel monotone" })).toContainText("écart");
      await expect(page.getByRole("row").filter({ hasText: "paywall_shown dépasse" })).toContainText("29");
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

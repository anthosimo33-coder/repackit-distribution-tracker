import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const MIN = 60_000;
const DAY = 86_400_000;

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

/**
 * RECALCUL PAR PÉRIODE — un appel par geste, jamais une boucle.
 *
 * Incident du 25/11/2026 en prod : l'onglet Parcours relançait le recalcul
 * toutes les ~0,62 s (145 appels en 2 min, jusqu'à 28 en vol), chacun de 23
 * requêtes PostHog. PostHog en accepte trois par projet : tout sortait en 429,
 * ce qui relançait la boucle, et le bandeau rouge clignotait. Cause : la
 * fonction d'appel changeait d'identité à chaque rendu et figurait dans les
 * dépendances de l'effet — chaque rendu reprogrammait une volée.
 *
 * Le projet a une config PostHog SANS clé : toute plage absente du cache échoue
 * côté serveur, comme un 429 en prod. On compte les messages `Action` que le
 * navigateur envoie réellement sur le websocket Convex — le câblage, pas un
 * calcul isolé.
 */
test.describe("Analytics — recalcul sur la période", () => {
  test("un échec ne relance rien seul ; Réessayer et un changement de dates relancent UNE fois", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const slug = `e2e-recalcul-${ts}`;
    const nom = `E2E Recalcul ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      // 60 jours de données : la période par défaut (30 derniers jours) ne
      // couvre PAS tout, donc l'écran demande un recalcul dès l'ouverture.
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
          cache("checkoutReliability", { rows: [] }),
          cache("activation", { rows: [] }),
          cache("serverSideSplit", { rows: [] }),
        ],
      });

      const appels: number[] = [];
      page.on("websocket", (ws) => {
        ws.on("framesent", ({ payload }) => {
          const texte = typeof payload === "string" ? payload : payload.toString("utf8");
          if (
            texte.includes('"type":"Action"') &&
            texte.includes('"udfPath":"analyticsWindowed:getWindowedAnalytics"')
          ) {
            appels.push(Date.now());
          }
        });
      });

      await page.goto(`/admin/${slug}/analytics`);
      await page.getByRole("tab", { name: "Parcours" }).click();
      // Le tunnel du cron (90 jours) reste affiché : l'échec ne vide pas l'écran.
      // (Espace fine insécable dans « 4 812 » : `\s` la couvre.)
      await expect(page.getByText(/4\s812/).first()).toBeVisible({ timeout: 15_000 });

      const bandeau = page.getByText("Recalcul sur la période impossible.");
      await expect(bandeau).toBeVisible({ timeout: 15_000 });
      expect(appels).toHaveLength(1);

      // Cinq secondes sans geste : AUCUN nouvel appel, et le bandeau ne
      // clignote pas (il disparaissait à chaque relance). Avant le correctif :
      // un appel toutes les ~0,6 s.
      await page.waitForTimeout(5_000);
      expect(appels).toHaveLength(1);
      await expect(bandeau).toBeVisible();

      // PRÉSENCE — Réessayer relance, une seule fois.
      await page.getByRole("button", { name: "Réessayer" }).click();
      await expect.poll(() => appels.length, { timeout: 10_000 }).toBe(2);
      await expect(bandeau).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(3_000);
      expect(appels).toHaveLength(2);

      // PRÉSENCE — une autre période relance, une seule fois.
      await page.getByRole("button", { name: "7 j", exact: true }).click();
      await expect.poll(() => appels.length, { timeout: 10_000 }).toBe(3);
      await page.waitForTimeout(3_000);
      expect(appels).toHaveLength(3);

      // « Tout » se sert du cache du cron : aucun appel, et plus de bandeau.
      await page.getByRole("button", { name: "Tout", exact: true }).click();
      await expect(bandeau).toBeHidden();
      await page.waitForTimeout(2_000);
      expect(appels).toHaveLength(3);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

const client = new ConvexHttpClient(url);

/**
 * Remédiation sécurité — cleanup 100 % server-side via les e2eMutation
 * gated E2E_SECRET (cf convex/functions.ts). L'ancienne version listait et
 * supprimait row par row avec un client ANONYME : impossible désormais
 * (listPublications / deletePublication exigent une identité), et le
 * global-setup tourne avant toute session (fenêtre bootstrap pas forcément
 * franchie) → le secret est le seul canal d'accès possible ici.
 *
 * Ordre : snapshots → publications → comptes (un compte référencé par une
 * publication n'est pas supprimable, cf cleanupTestComptes qui archive en
 * fallback) → presets → veille (inspirations, folders) → personnes → icps.
 */
export async function cleanupTestData() {
  const secret = process.env.E2E_SECRET;
  if (!secret) {
    console.warn(
      "⚠️ E2E_SECRET non défini côté Node — cleanup e2e sauté. " +
        "(Requis aussi comme env var du deployment Convex de test.)",
    );
    return;
  }

  const steps: Array<[string, () => Promise<unknown>]> = [
    [
      "metricSnapshots",
      () =>
        client.mutation(api.metricSnapshots.cleanupTestSnapshots, { secret }),
    ],
    [
      "publications",
      () =>
        client.mutation(api.publications.cleanupTestPublications, { secret }),
    ],
    ["comptes", () => client.mutation(api.comptes.cleanupTestComptes, { secret })],
    [
      "filterPresets",
      () => client.mutation(api.filterPresets.cleanupTestPresets, { secret }),
    ],
    [
      "inspirations",
      () =>
        client.mutation(api.inspirations.cleanupTestInspirations, { secret }),
    ],
    ["folders", () => client.mutation(api.folders.cleanupTestFolders, { secret })],
    // Assets (dossiers d'images [E2E_TEST] + blobs storage).
    ["assets", () => client.mutation(api.assets.cleanupTestAssets, { secret })],
    [
      "personnes",
      () => client.mutation(api.personnes.cleanupTestPersonnes, { secret }),
    ],
    ["icps", () => client.mutation(api.icps.cleanupTestIcps, { secret })],
    // Paiements (P8) — liés aux créateurs de test, supprimés avant eux.
    [
      "payments",
      () => client.mutation(api.payments.cleanupTestPayments, { secret }),
    ],
    // Assignments AVANT formats/creators (les référencent). Cascade aussi la
    // publication matérialisée + ses snapshots (notes="" → hors cleanupTestPublications).
    [
      "assignments",
      () => client.mutation(api.assignments.cleanupTestAssignments, { secret }),
    ],
    [
      "creators",
      () => client.mutation(api.creators.cleanupTestCreators, { secret }),
    ],
    [
      "formats",
      () => client.mutation(api.formats.cleanupTestFormats, { secret }),
    ],
    // S1 — campagnes de scripts + leurs bricks (cascade).
    [
      "scripts",
      () => client.mutation(api.scripts.cleanupTestScripts, { secret }),
    ],
  ];

  for (const [label, run] of steps) {
    try {
      await run();
    } catch (e) {
      console.warn(`Cleanup ${label} failed:`, (e as Error).message);
    }
  }
}

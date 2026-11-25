import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { HogQLResult } from "../convex/posthogApi";

/**
 * CÂBLAGE de l'expérience A/B courante : le cron et la volée par période
 * doivent choisir l'expérience UNE fois, puis l'écrire dans chacune de leurs
 * requêtes `ab*`. Un appelant qui oublierait de la passer à `buildQueries`
 * rendrait des cartes vides sans erreur — seul le SQL envoyé à PostHog le dit.
 */
const h = vi.hoisted(() => ({
  sent: [] as string[],
  candidates: { rows: [], columns: [], error: null } as HogQLResult,
}));

vi.mock("../convex/posthogApi", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../convex/posthogApi")>();
  return {
    ...orig,
    runHogQL: vi.fn(async (_key: string, _target: unknown, sql: string): Promise<HogQLResult> => {
      h.sent.push(sql);
      if (sql.includes("AS first_seen") && sql.includes("WHERE event = 'paywall_viewed'")) {
        return h.candidates;
      }
      return { rows: [], columns: [], error: null };
    }),
  };
});

const { collectProjectEntries, POSTHOG_CACHE_KEYS } = await import("../convex/posthogSync");
const { computeWindowedAnalytics } = await import("../convex/analyticsWindowed");
const { hogWindowClause } = await import("./hog-window");

// Lignes de la prod du 25/11/2026 à 12:54 UTC : le dernier paywall vient d'un
// ancien assigné du test pass, mais le dernier test LANCÉ est le test hebdo.
const PROD_12H54: unknown[][] = [
  ["paywall_hebdo_2026_10", "2026-10-28T11:50:07.318000Z", "2026-11-25T12:53:02.415000Z", 41899],
  ["paywall_pass_2026_10", "2026-10-07T03:29:41.552000Z", "2026-11-25T12:53:49.120000Z", 10401],
  ["paywall_ab_2026_08_v2", "2026-08-08T10:18:56.211000Z", "2026-11-25T12:47:15.006000Z", 3129],
];

const TARGET = { posthogProjectId: "231200", host: "eu" as const };
const AB_KEYS = ["abArms", "abPurchases", "abOffers", "abPersonArms", "abFlippers"] as const;
const abSent = () => h.sent.filter((sql) => sql.includes("AS ab_exp"));

beforeEach(() => {
  h.sent.length = 0;
  h.candidates = { rows: PROD_12H54, columns: [], error: null };
});

describe("cron horaire — collectProjectEntries", () => {
  it("les cinq requêtes ab* partent avec le test hebdo, choisi avant elles", async () => {
    await collectProjectEntries("snytch", "phx_test", TARGET);
    const ab = abSent();
    expect(ab).toHaveLength(5);
    for (const sql of ab) expect(sql).toContain("'paywall_hebdo_2026_10' AS ab_exp");
    // Les candidats sont lus AVANT la première requête A/B.
    const iCandidats = h.sent.findIndex((sql) => sql.includes("AS first_seen"));
    expect(iCandidats).toBeGreaterThan(-1);
    expect(iCandidats).toBeLessThan(h.sent.indexOf(ab[0]));
  });

  it("candidats illisibles : AUCUNE requête ab* lancée, leurs agrégats marqués en erreur", async () => {
    h.candidates = { rows: [], columns: [], error: "rate_limited (429)" };
    const entries = await collectProjectEntries("snytch", "phx_test", TARGET);
    expect(abSent()).toHaveLength(0);
    for (const k of AB_KEYS) {
      const e = entries.find((x) => x.key === POSTHOG_CACHE_KEYS[k]);
      expect(e?.error, k).toBe("abExperiment: rate_limited (429)");
      // Pas de json : `upsertPosthogCache` garde la dernière valeur connue.
      expect(e?.json, k).toBeUndefined();
    }
    // Les autres agrégats, eux, sont calculés.
    expect(entries.find((x) => x.key === POSTHOG_CACHE_KEYS.overview)?.error).toBeUndefined();
  });
});

describe("volée par période — computeWindowedAnalytics", () => {
  it("les trois requêtes ab* de la volée portent le test hebdo", async () => {
    process.env.POSTHOG_API_KEY_TEST = "phx_test";
    const ctx = {
      runQuery: async (ref: unknown): Promise<unknown> => {
        const nom = getFunctionName(ref as never);
        if (nom === "posthogSync:listPosthogProjects") {
          return [{ _id: "p1", slug: "snytch", posthogProjectId: "231200", host: "eu", apiKeyEnvVar: "POSTHOG_API_KEY_TEST" }];
        }
        if (nom === "analyticsWindowed:readWindowCache") return null;
        throw new Error(`query inattendue : ${nom}`);
      },
      runMutation: async (): Promise<null> => null,
    };
    await computeWindowedAnalytics(ctx as never, {
      projectId: "p1" as never,
      window: hogWindowClause("2026-11-18", "2026-11-24")!,
      windowOnFirstSub: hogWindowClause("2026-11-18", "2026-11-24", "t_first_sub")!,
      from: "2026-11-18",
      to: "2026-11-24",
    });
    const ab = abSent();
    expect(ab).toHaveLength(3);
    for (const sql of ab) expect(sql).toContain("'paywall_hebdo_2026_10' AS ab_exp");
  });
});

import { describe, expect, it } from "vitest";
import {
  ASYNC_BUDGET_MS,
  POLL_DELAYS_MS,
  runHogQL,
} from "../convex/posthogApi";

/**
 * MODE ASYNCHRONE de l'API query PostHog. Les réponses simulées reprennent les
 * FORMES relevées sur la vraie API le 25/11/2026 (projet Snytch) :
 *  - requête neuve : POST → 202, `query_status` incomplet (id ULID) ;
 *  - interrogation : GET …/query/<id>/ → 200 tant que ça tourne, puis 200 avec
 *    `query_status.complete` et le corps complet dans `query_status.results` ;
 *  - échec : GET → 400, `query_status.error` + `error_code` + `error_message` ;
 *  - résultat en cache : POST → 200 directement, `query_status: null`.
 */
const target = { posthogProjectId: "231200", host: "eu" as const };
const ID = "01a21331b90173768ffeb39cbfc037dd";

type Appel = { method: string; url: string; body: unknown };

function statut(extra: Record<string, unknown>) {
  return {
    query_status: {
      id: ID,
      team_id: 231200,
      query_async: true,
      complete: false,
      error: false,
      error_code: null,
      error_message: null,
      results: null,
      ...extra,
    },
  };
}

/** POST → `post` ; chaque GET → la réponse suivante de `gets` (la dernière se répète). */
function fauxPostHog(
  post: { status: number; json: unknown },
  gets: { status: number; json: unknown }[],
) {
  const appels: Appel[] = [];
  let g = 0;
  const impl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    appels.push({
      method,
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (method === "POST") return Response.json(post.json, { status: post.status });
    if (method === "DELETE") return new Response(null, { status: 204 });
    const r = gets[Math.min(g, gets.length - 1)];
    g += 1;
    return Response.json(r.json, { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, appels };
}

const corpsComplet = {
  results: [
    ["hebdo12", true, [], [], 812, 37],
    ["hard", true, [], [], 797, 52],
  ],
  columns: ["variant", "stable", "ck_key", "pv_key", "exposed", "paid"],
  is_cached: false,
};

describe("runHogQL — mode asynchrone (la limite bloquante de 10 s)", () => {
  it("soumet en async puis interroge l'état jusqu'au résultat", async () => {
    const f = fauxPostHog({ status: 202, json: statut({}) }, [
      { status: 200, json: statut({}) },
      { status: 200, json: statut({}) },
      { status: 200, json: statut({ complete: true, results: corpsComplet }) },
    ]);
    const attentes: number[] = [];
    const res = await runHogQL("k", target, "SELECT …", {
      fetchImpl: f.impl,
      sleep: async (ms) => void attentes.push(ms),
    });

    expect(res.error).toBeNull();
    expect(res.rows).toEqual(corpsComplet.results);
    expect(res.columns).toEqual(corpsComplet.columns);
    // Soumise UNE fois, en async (le cache de PostHog reste utilisable).
    const posts = f.appels.filter((a) => a.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ refresh: "async" });
    // Trois interrogations, sur l'id rendu, aux délais prévus.
    const gets = f.appels.filter((a) => a.method === "GET");
    expect(gets.map((a) => a.url)).toEqual(
      Array(3).fill(`https://eu.posthog.com/api/projects/231200/query/${ID}/`),
    );
    expect(attentes).toEqual(POLL_DELAYS_MS.slice(0, 3));
  });

  it("rend le message de PostHog quand la requête échoue en cours de route", async () => {
    const f = fauxPostHog({ status: 202, json: statut({}) }, [
      {
        status: 400,
        json: statut({
          complete: true,
          error: true,
          error_code: "hogql_query_error",
          error_message: "Unable to resolve field: colonne_inconnue_55324.",
        }),
      },
    ]);
    const res = await runHogQL("k", target, "SELECT …", {
      fetchImpl: f.impl,
      sleep: async () => {},
    });
    expect(res.rows).toEqual([]);
    expect(res.error).toBe("HTTP 400: Unable to resolve field: colonne_inconnue_55324.");
    // Une erreur de requête ne guérit pas : ni resoumission, ni nouvel essai.
    expect(f.appels.filter((a) => a.method === "POST")).toHaveLength(1);
  });

  it("un 429 pendant l'interrogation fait attendre, sans resoumettre la requête", async () => {
    const f = fauxPostHog({ status: 202, json: statut({}) }, [
      { status: 429, json: { detail: "Request was throttled." } },
      { status: 200, json: statut({ complete: true, results: corpsComplet }) },
    ]);
    const res = await runHogQL("k", target, "SELECT …", {
      fetchImpl: f.impl,
      sleep: async () => {},
    });
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(2);
    expect(f.appels.filter((a) => a.method === "POST")).toHaveLength(1);
  });

  it("au-delà du budget, annule la requête chez PostHog et le dit", async () => {
    const f = fauxPostHog({ status: 202, json: statut({}) }, [
      { status: 200, json: statut({}) },
    ]);
    const attentes: number[] = [];
    const res = await runHogQL("k", target, "SELECT …", {
      fetchImpl: f.impl,
      sleep: async (ms) => void attentes.push(ms),
    });
    expect(res.rows).toEqual([]);
    expect(res.error).toMatch(/délai dépassé/);
    // Jamais plus d'attente que le budget, et la requête est libérée : elle
    // occuperait sinon une des TROIS places simultanées du projet.
    expect(attentes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(ASYNC_BUDGET_MS);
    const deletes = f.appels.filter((a) => a.method === "DELETE");
    expect(deletes.map((a) => a.url)).toEqual([
      `https://eu.posthog.com/api/projects/231200/query/${ID}/`,
    ]);
  });

  it("un résultat déjà en cache chez PostHog revient sans interrogation", async () => {
    const f = fauxPostHog(
      { status: 200, json: { ...corpsComplet, is_cached: true, query_status: null } },
      [],
    );
    const res = await runHogQL("k", target, "SELECT …", {
      fetchImpl: f.impl,
      sleep: async () => {},
    });
    expect(res.error).toBeNull();
    expect(res.rows).toEqual(corpsComplet.results);
    expect(f.appels.map((a) => a.method)).toEqual(["POST"]);
  });
});

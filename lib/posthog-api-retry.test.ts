import { describe, expect, it } from "vitest";
import { RETRY_429_DELAYS_MS, runHogQL } from "../convex/posthogApi";

const target = { posthogProjectId: "1", host: "eu" as const };

/** Réponses servies dans l'ordre ; compte les appels. */
function fauxFetch(statuts: number[]) {
  let appels = 0;
  const impl = (async () => {
    const status = statuts[Math.min(appels, statuts.length - 1)];
    appels += 1;
    return new Response(
      status === 200 ? JSON.stringify({ results: [[42]], columns: ["n"] }) : "{}",
      { status },
    );
  }) as unknown as typeof fetch;
  return { impl, appels: () => appels };
}

describe("runHogQL — refus 429 de PostHog", () => {
  it("retente un 429 et rend le résultat dès que PostHog accepte", async () => {
    const f = fauxFetch([429, 429, 200]);
    const attentes: number[] = [];
    const res = await runHogQL("k", target, "SELECT 1", {
      fetchImpl: f.impl,
      sleep: async (ms) => void attentes.push(ms),
    });
    expect(res.error).toBeNull();
    expect(res.rows).toEqual([[42]]);
    expect(f.appels()).toBe(3);
    expect(attentes).toEqual([...RETRY_429_DELAYS_MS]);
  });

  it("abandonne après le dernier essai et nomme le refus", async () => {
    const f = fauxFetch([429]);
    const res = await runHogQL("k", target, "SELECT 1", {
      fetchImpl: f.impl,
      sleep: async () => {},
    });
    expect(res.error).toBe("rate_limited (429)");
    expect(f.appels()).toBe(RETRY_429_DELAYS_MS.length + 1);
  });

  it("ne retente PAS une autre erreur (une clé invalide ne guérit pas)", async () => {
    const f = fauxFetch([401]);
    const res = await runHogQL("k", target, "SELECT 1", {
      fetchImpl: f.impl,
      sleep: async () => {},
    });
    expect(res.error).toMatch(/401/);
    expect(f.appels()).toBe(1);
  });
});

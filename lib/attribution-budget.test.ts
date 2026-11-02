import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { ProjectQueryCtx } from "../convex/functions";
import { getAttributionCore } from "../convex/analyticsHub";
import { POSTHOG_CACHE_KEYS } from "../convex/posthogSync";

/**
 * L'attribution (Vue d'ensemble, Acquisition, Rétention ; outils MCP
 * `economie_unitaire`, `retention`, `acquisition`) est UNE query Convex : une
 * seconde de calcul au plus. Le 2026-11-02 elle en prenait 1,00 à 1,04 s en
 * production et tombait une fois sur deux. Une bonne part du temps partait à
 * construire un `Intl.DateTimeFormat` par jour lu (cf lib/date-fr.test.ts). Ce
 * test passe par le VRAI cœur : chaque jour de la série PostHog y traverse le
 * jour Paris du hub, et aucun formateur ne doit naître pendant l'appel.
 */

const PROJET = "p_snytch" as Id<"projects">;

/** Une base réduite à la série quotidienne PostHog : tout le reste est vide. */
function ctxAvecSerie(jours: number): ProjectQueryCtx {
  const debut = Date.parse("2025-10-01T22:00:00Z");
  const overview = {
    projectId: PROJET,
    key: POSTHOG_CACHE_KEYS.overview,
    json: JSON.stringify({
      daily: Array.from({ length: jours }, (_, i) => ({
        ts: debut + i * 86_400_000,
        visitors: 100,
        signups: 10,
        checkouts: 3,
        subs: 1,
      })),
    }),
    computedAt: Date.parse("2026-11-02T10:00:00Z"),
  };
  const lignes = (table: string) => (table === "posthogCache" ? [overview] : []);
  const requete = (table: string) => {
    const q = {
      withIndex: () => q,
      order: () => q,
      collect: async () => lignes(table),
      first: async () => lignes(table)[0] ?? null,
      unique: async () => lignes(table)[0] ?? null,
      take: async (n: number) => lignes(table).slice(0, n),
    };
    return q;
  };
  const db = {
    get: async () => ({ _id: PROJET, slug: "snytch", payCurrency: "usd", fxRateToRevenue: 0.86 }),
    query: requete,
  };
  return { db, projectId: PROJET, userId: "u" } as unknown as ProjectQueryCtx;
}

describe("attribution — budget CPU d'une query", () => {
  it("lit 400 jours de série sans construire un seul formateur de date", async () => {
    const ctx = ctxAvecSerie(400);
    let r: Awaited<ReturnType<typeof getAttributionCore>> | null = null;
    const n = await formateursConstruits(async () => {
      r = await getAttributionCore(ctx);
    });
    // Présence : la série a bien été lue, jour par jour.
    expect(r!.attributionAvailable).toBe(true);
    expect(n).toBe(0);
  });
});

/**
 * Compte les `Intl.DateTimeFormat` construits pendant `f` — sans rien changer à
 * ce qu'ils rendent (un `Proxy` transparent, retiré ensuite).
 */
async function formateursConstruits(f: () => unknown): Promise<number> {
  const original = Intl.DateTimeFormat;
  let n = 0;
  Intl.DateTimeFormat = new Proxy(original, {
    construct(cible, args) {
      n += 1;
      return Reflect.construct(cible, args);
    },
    apply(cible, ceci, args) {
      n += 1;
      return Reflect.apply(cible, ceci, args);
    },
  });
  try {
    await f();
  } finally {
    Intl.DateTimeFormat = original;
  }
  return n;
}

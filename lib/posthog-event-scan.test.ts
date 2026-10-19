import { describe, it, expect } from "vitest";
import { buildQueries } from "../convex/posthogSync";

/**
 * GARDE-FOU — les requêtes du funnel ne balaient QUE les events qu'elles
 * comptent. Sans ce filtre, PostHog les coupait en HTTP 504 (« max execution
 * time ») sur les 90 jours de Snytch, au cron comme au recalcul sur période
 * (2026-10-19). Le filtre ne doit jamais CACHER un event compté : chaque
 * `event = '…'` de la requête doit figurer dans sa liste `event IN (…)`.
 */

const FILTREES = ["overview", "funnelGlobal", "funnelSequential"] as const;

const jeux: [string, Record<string, string>][] = [
  ["cron (90 jours)", buildQueries("", "") as Record<string, string>],
  [
    "période libre",
    buildQueries(
      "",
      "",
      "timestamp >= toDateTime('2026-10-11 22:00:00') AND timestamp < toDateTime('2026-10-18 22:00:00')",
      "t_first_sub >= toDateTime('2026-10-11 22:00:00') AND t_first_sub < toDateTime('2026-10-18 22:00:00')",
    ) as Record<string, string>,
  ],
];

describe.each(jeux)("balayage borné aux events comptés — %s", (_nom, queries) => {
  it.each(FILTREES)("%s filtre sur ses events, sans en cacher un", (cle) => {
    const sql = queries[cle];
    const liste = /event IN \(([^)]*)\)/.exec(sql);
    expect(liste, `${cle} : pas de filtre event IN (…)`).not.toBeNull();
    const filtres = new Set(
      [...liste![1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
    );
    const comptes = new Set([...sql.matchAll(/event = '([^']+)'/g)].map((m) => m[1]));
    expect(comptes.size).toBeGreaterThan(0);
    for (const e of comptes) {
      expect(filtres.has(e), `${cle} compte « ${e} » mais le filtre l'écarte`).toBe(true);
    }
  });
});

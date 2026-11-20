import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 20/11/2026 : le Radar déménage dans Kopycat, qui le fait tourner lui-même (convex/radar/ du dépôt swarm-site). Jarvia
 * ne planifie plus aucune de ses tâches : deux Radars relèveraient les mêmes comptes, en double (pages TikTok, crédits
 * ScrapeCreators, base Convex).
 */
describe("tâches planifiées de Jarvia : plus de Radar", () => {
  const crons = fs.readFileSync(path.join(__dirname, "../convex/crons.ts"), "utf8");

  it("aucune tâche n'appelle un module du Radar", () => {
    const radar = [...crons.matchAll(/internal\.(radar\w*|swarmExport\w*)\.\w+/g)].map((m) => m[0]);
    expect(radar).toEqual([]);
  });

  it("les autres tâches restent (relevés de vues, Whop…)", () => {
    expect(crons).toMatch(/internal\.earlyReadings\.runEarlyReadings/);
    expect((crons.match(/crons\.(interval|hourly|daily|weekly|monthly|cron)\(/g) ?? []).length).toBeGreaterThan(5);
  });
});

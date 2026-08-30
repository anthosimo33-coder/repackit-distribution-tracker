import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { coherenceInputsFrom } from "./coherence-inputs";
import { buildCoherenceChecks } from "./analytics-hub";

/**
 * LE DÉFAUT QUE CE MODULE FERME.
 *
 * La Vue d'ensemble et Fiabilité recopiaient chacune le même mapping du payload
 * vers les entrées des contrôles. Elles ont divergé : la Vue d'ensemble ne
 * passait ni `subsByMembership` ni `whopFirstPaidDay`, donc le contrôle croisé
 * y retombait sur l'écart BRUT et affichait « 2 jour(s) divergent(s) — pire :
 * 2026-07-28 … (écart 3) » en VIOLATION, bandeau rouge compris, pendant que
 * Fiabilité disait « 2 jour(s) réconcilié(s), aucun divergent » pour la même
 * journée. Un contrôle qui rend deux verdicts opposés selon l'onglet est pire
 * que le défaut qu'il surveille.
 *
 * Relevé de prod du 2026-08-30 13:45, reproduit à l'identique ci-dessous.
 */
const PROD = {
  sequentialSteps: [{ key: "subscription_completed", count: 154 }],
  reachSteps: [{ key: "subscription_completed", count: 159 }],
  currencyCount: 1,
  dashboardClients: 154,
  whopMembers: 163,
  whopClients: 153,
  whopClientsTotal: 154,
  whopMembersTotal: 164,
  whopExcludedPre: 0,
  whopExcludedAfter: 1,
  dailyClientsSum: 184,
  dailySignupsSum: 4909,
  dailySubs: [{ day: "2026-07-28", subs: 11 }],
  dailyPaidClients: [{ day: "2026-07-28", clients: 8 }],
  // Le 28/07 : 6 appariés, 3 rejeux de la veille, 3 remboursés, 1 sans id.
  subsByMembership: [
    ...["m1", "m2", "m3", "m4", "m5", "m6"].map((membershipId) => ({ day: "2026-07-28", membershipId, persons: 1 })),
    ...["r1", "r2", "r3"].map((membershipId) => ({ day: "2026-07-28", membershipId, persons: 1 })),
    ...["u1", "u2", "u3"].map((membershipId) => ({ day: "2026-07-28", membershipId, persons: 1 })),
    { day: "2026-07-28", membershipId: "", persons: 1 },
  ],
  whopFirstPaidDay: [
    ...["m1", "m2", "m3", "m4", "m5", "m6"].map((membershipId) => ({ membershipId, day: "2026-07-28" })),
    ...["r1", "r2", "r3"].map((membershipId) => ({ membershipId, day: "2026-07-27" })),
    ...["x1", "x2"].map((membershipId) => ({ membershipId, day: "2026-07-28" })),
  ],
  windowReconciliation: {
    ghostClients: 3,
    missingEvents: 9,
    unlinkedBeforeBreak: 18,
    unlinkedAfterBreak: 0,
    breakLabel: "28/07/2026 01:09 UTC",
  },
  todayParis: "2026-08-30",
  payDue: undefined,
};

const daily = (i: Parameters<typeof buildCoherenceChecks>[0]) =>
  buildCoherenceChecks(i).find((c) => c.key === "daily_clients_posthog_vs_whop")!;

describe("coherenceInputsFrom — un seul câblage pour tous les écrans", () => {
  it("la réconciliation est transmise : le 28/07 n'est PAS une violation", () => {
    const c = daily(coherenceInputsFrom(PROD));
    expect(c.status).not.toBe("violation");
    expect(c.detail).toContain("réconcilié");
    expect(c.detail).toContain("rejoué");
  });

  it("sans elle, le même jour serait une violation — le défaut, reproduit", () => {
    // Contrôle OPPOSÉ : c'est bien CES deux entrées qui font la différence.
    // C'est exactement ce que la Vue d'ensemble produisait.
    const ampute = { ...coherenceInputsFrom(PROD) };
    delete (ampute as { subsByMembership?: unknown }).subsByMembership;
    delete (ampute as { whopFirstPaidDay?: unknown }).whopFirstPaidDay;
    const c = daily(ampute);
    expect(c.status).toBe("violation");
    // « écart 3 » = la branche SANS décomposition. C'est la signature exacte du
    // défaut relevé en prod ; le nombre de jours, lui, dépend du jeu de test
    // (un seul jour ici, deux en prod).
    expect(c.detail).toContain("jour(s) divergent(s)");
    expect(c.detail).toContain("écart 3");
    expect(c.detail).not.toContain("rejoué");
  });

  it("les deux écrans obtiennent le MÊME verdict, au diviseur près", () => {
    const vueEnsemble = daily(coherenceInputsFrom(PROD, { unitCostDenominator: 154 }));
    const fiabilite = daily(coherenceInputsFrom(PROD));
    expect(vueEnsemble.status).toBe(fiabilite.status);
    expect(vueEnsemble.detail).toBe(fiabilite.detail);
  });

  it("le diviseur reste le SEUL réglage par écran", () => {
    const avec = buildCoherenceChecks(coherenceInputsFrom(PROD, { unitCostDenominator: 154 }));
    const sans = buildCoherenceChecks(coherenceInputsFrom(PROD));
    const k = "unit_cost_denominator";
    expect(avec.find((c) => c.key === k)?.status).toBe("ok");
    expect(sans.find((c) => c.key === k)?.status).toBe("info");
    // …et rien d'autre ne bouge entre les deux écrans.
    const autres = (cs: typeof avec) => cs.filter((c) => c.key !== k).map((c) => `${c.key}:${c.status}:${c.detail}`);
    expect(autres(avec)).toEqual(autres(sans));
  });
});

/**
 * GARDE — un composant ne construit JAMAIS ces entrées à la main.
 *
 * Le défaut ci-dessus a survécu à trois contre-épreuves sur données de prod
 * parce qu'elles nourrissaient le MODULE du jeu d'entrées complet : elles
 * testaient le calcul, jamais le câblage. La seule protection durable est
 * qu'il n'y ait qu'un câblage.
 */
describe("garde-fou : un seul chemin vers les contrôles de cohérence", () => {
  const ROOT = process.cwd();
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
    }
    return out;
  }

  it("tout appel à buildCoherenceChecks passe par coherenceInputsFrom", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "components"))) {
      const src = readFileSync(file, "utf8");
      let i = src.indexOf("buildCoherenceChecks(");
      while (i !== -1) {
        const suite = src.slice(i + "buildCoherenceChecks(".length).trimStart();
        if (!suite.startsWith("coherenceInputsFrom(")) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${src.slice(0, i).split("\n").length}`);
        }
        i = src.indexOf("buildCoherenceChecks(", i + 1);
      }
    }
    expect(
      offenders,
      `Entrées de cohérence construites à la main : ${offenders.join(", ")}. ` +
        `Passe par coherenceInputsFrom(coherence, { … }) — deux écrans qui recopient ` +
        `le mapping finissent par diverger, et le contrôle rend alors deux verdicts opposés.`,
    ).toEqual([]);
  });
});

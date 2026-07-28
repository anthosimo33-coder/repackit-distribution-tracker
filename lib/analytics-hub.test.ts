import { describe, it, expect } from "vitest";
import {
  MIN_SAMPLE_SIZE,
  isConclusive,
  buildFunnel,
  computeDelta,
  computeConversion,
  conversionLift,
  overallRate,
  delayStatus,
  hasLongTail,
  buildRetentionGrid,
  retentionIntensity,
  costPerAcquisition,
  per1kViews,
  computeUnitEconomics,
  checkMonotonicity,
  funnelCoherenceChecks,
  buildCoherenceChecks,
} from "./analytics-hub";

const HOUR = 60 * 60 * 1000;

describe("isConclusive", () => {
  it("refuse un effectif sous le seuil", () => {
    expect(isConclusive(MIN_SAMPLE_SIZE - 1)).toBe(false);
    expect(isConclusive(0)).toBe(false);
  });

  it("accepte à partir du seuil exact", () => {
    expect(isConclusive(MIN_SAMPLE_SIZE)).toBe(true);
    expect(isConclusive(1000)).toBe(true);
  });
});

describe("buildFunnel", () => {
  const steps = [
    { key: "visit", label: "Visite", count: 1000 },
    { key: "signup", label: "Inscription", count: 250 },
    { key: "sub", label: "Abonnement", count: 25 },
  ];

  it("calcule part des entrants, perte et effectif perdu", () => {
    const f = buildFunnel(steps);
    expect(f[0].shareOfStart).toBe(100);
    expect(f[0].dropPct).toBeNull();
    expect(f[0].droppedCount).toBeNull();
    expect(f[1].shareOfStart).toBe(25);
    expect(f[1].dropPct).toBe(75);
    expect(f[1].droppedCount).toBe(750);
    expect(f[2].shareOfStart).toBe(2.5);
    expect(f[2].dropPct).toBe(90);
  });

  it("marque non concluante une étape sous le seuil", () => {
    const f = buildFunnel(steps);
    expect(f[1].conclusive).toBe(true);
    expect(f[2].conclusive).toBe(false);
  });

  it("rend des ratios null quand le funnel est vide (aucun event)", () => {
    const f = buildFunnel([
      { key: "visit", label: "Visite", count: 0 },
      { key: "signup", label: "Inscription", count: 0 },
    ]);
    expect(f[0].shareOfStart).toBeNull();
    expect(f[1].dropPct).toBeNull();
    expect(f[1].droppedCount).toBe(0);
  });

  it("ne maquille pas un funnel non monotone", () => {
    const f = buildFunnel([
      { key: "a", label: "A", count: 10 },
      { key: "b", label: "B", count: 40 },
    ]);
    expect(f[1].count).toBe(40);
    expect(f[1].droppedCount).toBe(0);
    expect(f[1].dropPct).toBe(0);
  });

  it("rend un tableau vide sans étape", () => {
    expect(buildFunnel([])).toEqual([]);
  });
});

describe("computeDelta", () => {
  it("calcule hausse et baisse en absolu et relatif", () => {
    expect(computeDelta(120, 100)).toEqual({
      abs: 20,
      pct: 20,
      direction: "up",
    });
    expect(computeDelta(80, 100)).toEqual({
      abs: -20,
      pct: -20,
      direction: "down",
    });
  });

  it("rend un pct null depuis une base nulle (pas de +100 % inventé)", () => {
    const d = computeDelta(50, 0);
    expect(d.abs).toBe(50);
    expect(d.pct).toBeNull();
    expect(d.direction).toBe("up");
  });

  it("détecte l'absence d'évolution", () => {
    expect(computeDelta(100, 100).direction).toBe("flat");
  });
});

describe("computeConversion", () => {
  const rows = [
    { key: "trial_end", label: "Fin d'essai", n: 200, converted: 40 },
    { key: "second_target", label: "2e cible", n: 10, converted: 5 },
  ];

  it("calcule le taux et conserve l'ordre", () => {
    const c = computeConversion(rows);
    expect(c[0].rate).toBe(20);
    expect(c[1].rate).toBe(50);
    expect(c.map((r) => r.key)).toEqual(["trial_end", "second_target"]);
  });

  it("signale non concluant un segment sous le seuil", () => {
    const c = computeConversion(rows);
    expect(c[0].conclusive).toBe(true);
    expect(c[1].conclusive).toBe(false);
  });

  it("rend un taux null sur un effectif nul", () => {
    expect(computeConversion([{ key: "x", label: "X", n: 0, converted: 0 }])[0].rate).toBeNull();
  });
});

describe("overallRate", () => {
  it("agrège numérateurs et dénominateurs", () => {
    expect(
      overallRate([
        { key: "a", label: "A", n: 100, converted: 10 },
        { key: "b", label: "B", n: 100, converted: 30 },
      ]),
    ).toBe(20);
  });

  it("rend null sans aucun effectif", () => {
    expect(overallRate([])).toBeNull();
    expect(overallRate([{ key: "a", label: "A", n: 0, converted: 0 }])).toBeNull();
  });
});

describe("conversionLift", () => {
  it("exprime le facteur vs la moyenne", () => {
    expect(conversionLift(40, 20)).toBe(2);
    expect(conversionLift(10, 20)).toBe(0.5);
    expect(conversionLift(20, 20)).toBe(1);
  });

  it("rend null si un taux manque ou si la référence est nulle", () => {
    expect(conversionLift(null, 20)).toBeNull();
    expect(conversionLift(40, null)).toBeNull();
    expect(conversionLift(40, 0)).toBeNull();
  });
});

describe("delayStatus", () => {
  it("classe le délai face au budget", () => {
    expect(delayStatus(1 * HOUR, 2 * HOUR)).toBe("ok");
    expect(delayStatus(3 * HOUR, 2 * HOUR)).toBe("warn");
    expect(delayStatus(5 * HOUR, 2 * HOUR)).toBe("alert");
  });

  it("traite le budget exact comme ok", () => {
    expect(delayStatus(2 * HOUR, 2 * HOUR)).toBe("ok");
  });

  it("rend unknown (et non ok) sans mesure", () => {
    expect(delayStatus(null, 2 * HOUR)).toBe("unknown");
    expect(delayStatus(1 * HOUR, 0)).toBe("unknown");
  });
});

describe("hasLongTail", () => {
  it("détecte un p90 qui décroche de la médiane", () => {
    expect(hasLongTail(1 * HOUR, 5 * HOUR)).toBe(true);
    expect(hasLongTail(1 * HOUR, 3 * HOUR)).toBe(false);
  });

  it("reste faux sans mesure exploitable", () => {
    expect(hasLongTail(null, 5 * HOUR)).toBe(false);
    expect(hasLongTail(1 * HOUR, null)).toBe(false);
    expect(hasLongTail(0, 5 * HOUR)).toBe(false);
  });
});

describe("buildRetentionGrid", () => {
  const cohorts = [
    { cohort: "2026-W20", size: 200, retainedByWeek: [200, 120, 80, 60] },
    { cohort: "2026-W21", size: 10, retainedByWeek: [10, 5] },
  ];

  it("calcule les pourcentages par semaine", () => {
    const g = buildRetentionGrid(cohorts, 4);
    expect(g[0].cells.map((c) => c.pct)).toEqual([100, 60, 40, 30]);
  });

  it("marque non concluante une cohorte sous le seuil", () => {
    const g = buildRetentionGrid(cohorts, 4);
    expect(g[0].conclusive).toBe(true);
    expect(g[1].conclusive).toBe(false);
  });

  it("laisse les semaines non atteintes ABSENTES (jamais 0)", () => {
    const g = buildRetentionGrid(cohorts, 4);
    expect(g[1].cells).toHaveLength(2);
  });

  it("borne la largeur au nombre de semaines demandé", () => {
    const g = buildRetentionGrid(cohorts, 2);
    expect(g[0].cells).toHaveLength(2);
  });

  it("rend des pct null sur une cohorte vide", () => {
    const g = buildRetentionGrid(
      [{ cohort: "vide", size: 0, retainedByWeek: [0] }],
      4,
    );
    expect(g[0].cells[0].pct).toBeNull();
  });
});

describe("retentionIntensity", () => {
  it("mappe un pourcentage sur 0→1", () => {
    expect(retentionIntensity(0)).toBe(0);
    expect(retentionIntensity(50)).toBe(0.5);
    expect(retentionIntensity(100)).toBe(1);
  });

  it("borne les valeurs hors plage et neutralise null", () => {
    expect(retentionIntensity(150)).toBe(1);
    expect(retentionIntensity(-10)).toBe(0);
    expect(retentionIntensity(null)).toBe(0);
  });
});

describe("costPerAcquisition", () => {
  it("divise le coût par les acquis", () => {
    expect(costPerAcquisition(300, 12)).toBe(25);
  });

  it("rend null sans acquisition (ni 0 ni infini)", () => {
    expect(costPerAcquisition(300, 0)).toBeNull();
    expect(costPerAcquisition(0, 0)).toBeNull();
  });
});

describe("per1kViews", () => {
  it("ramène l'effectif à 1 000 vues", () => {
    expect(per1kViews(50, 100_000)).toBe(0.5);
  });

  it("rend null sans vue", () => {
    expect(per1kViews(50, 0)).toBeNull();
  });
});

describe("computeUnitEconomics", () => {
  const base = {
    creatorCost: 1000,
    attributedSubs: 40,
    ltv: 75,
    monthlyArpu: 25,
  };

  it("calcule CAC, ratio LTV/CAC et délai de récupération", () => {
    expect(computeUnitEconomics(base)).toEqual({
      cac: 25,
      ltv: 75,
      ltvCacRatio: 3,
      paybackMonths: 1,
    });
  });

  it("sert le CAC seul quand la LTV attend encore les events", () => {
    const u = computeUnitEconomics({ ...base, ltv: null, monthlyArpu: null });
    expect(u.cac).toBe(25);
    expect(u.ltv).toBeNull();
    expect(u.ltvCacRatio).toBeNull();
    expect(u.paybackMonths).toBeNull();
  });

  it("rend tout null sans abonné attribué", () => {
    const u = computeUnitEconomics({ ...base, attributedSubs: 0 });
    expect(u.cac).toBeNull();
    expect(u.ltvCacRatio).toBeNull();
    expect(u.paybackMonths).toBeNull();
  });

  it("ne divise pas par un ARPU nul", () => {
    expect(computeUnitEconomics({ ...base, monthlyArpu: 0 }).paybackMonths).toBeNull();
  });
});

describe("checkMonotonicity", () => {
  const seq = [
    { key: "visit", label: "", count: 745 },
    { key: "signup", label: "", count: 499 },
    { key: "paywall", label: "", count: 499 },
    { key: "checkout", label: "", count: 100 },
    { key: "sub", label: "", count: 14 },
  ];
  const reach = [
    { key: "visit", label: "", count: 741 },
    { key: "signup", label: "", count: 499 },
    { key: "paywall", label: "", count: 513 },
    { key: "checkout", label: "", count: 100 },
    { key: "sub", label: "", count: 19 },
  ];

  it("valide un tunnel séquentiel strictement décroissant", () => {
    const r = checkMonotonicity(seq);
    expect(r.monotone).toBe(true);
    expect(r.breaks).toHaveLength(0);
  });

  it("tolère l'égalité entre étapes (499 = 499)", () => {
    expect(checkMonotonicity(seq).monotone).toBe(true);
  });

  it("repère la rupture paywall > inscription de l'atteinte brute", () => {
    const r = checkMonotonicity(reach);
    expect(r.monotone).toBe(false);
    expect(r.breaks).toEqual([
      { key: "paywall", count: 513, prevKey: "signup", prevCount: 499, excess: 14 },
    ]);
  });
});

describe("funnelCoherenceChecks", () => {
  const seq = [
    { key: "visit", label: "", count: 745 },
    { key: "signup", label: "", count: 499 },
    { key: "paywall", label: "", count: 499 },
  ];
  const reachOk = [
    { key: "visit", label: "", count: 745 },
    { key: "signup", label: "", count: 499 },
    { key: "paywall", label: "", count: 499 },
  ];
  const reachBreak = [
    { key: "visit", label: "", count: 741 },
    { key: "signup", label: "", count: 499 },
    { key: "paywall", label: "", count: 513 },
  ];

  it("marque le séquentiel monotone OK et n'ajoute rien pour une atteinte propre", () => {
    const checks = funnelCoherenceChecks(seq, reachOk);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ key: "funnel_sequential_monotone", status: "ok" });
  });

  it("signale l'atteinte non monotone en INFO (pas violation)", () => {
    const checks = funnelCoherenceChecks(seq, reachBreak);
    expect(checks).toHaveLength(2);
    const reach = checks.find((c) => c.key === "funnel_reach_nonmonotone");
    expect(reach?.status).toBe("info");
    expect(reach?.detail).toContain("paywall dépasse signup de 14");
  });

  it("passe le séquentiel NON monotone en violation (bug de calcul)", () => {
    const broken = [
      { key: "signup", label: "", count: 100 },
      { key: "paywall", label: "", count: 120 },
    ];
    const checks = funnelCoherenceChecks(broken, broken);
    const seqCheck = checks.find((c) => c.key === "funnel_sequential_monotone");
    expect(seqCheck?.status).toBe("violation");
  });
});

describe("buildCoherenceChecks", () => {
  const seq = [
    { key: "visit", label: "", count: 745 },
    { key: "signup", label: "", count: 499 },
    { key: "paywall", label: "", count: 499 },
  ];
  const cleanReach = [
    { key: "visit", label: "", count: 745 },
    { key: "signup", label: "", count: 499 },
    { key: "paywall", label: "", count: 499 },
  ];
  const base = {
    sequentialSteps: seq,
    reachSteps: cleanReach,
    currencyCount: 1,
    dashboardClients: 21,
    whopMembers: 21,
  };
  const byKey = (checks: { key: string; status: string }[]) =>
    new Map(checks.map((c) => [c.key, c.status]));

  it("tout cohérent → aucun statut « violation », garanties présentes", () => {
    const m = byKey(buildCoherenceChecks(base));
    expect(m.get("funnel_sequential_monotone")).toBe("ok");
    expect(m.get("attributed_le_total")).toBe("ok");
    expect(m.get("no_cross_currency")).toBe("ok");
    expect(m.get("dashboard_vs_whop")).toBe("ok");
    expect([...m.values()]).not.toContain("violation");
  });

  it("multi-devise → contrôle inter-devises en info (jamais sommé)", () => {
    const m = byKey(buildCoherenceChecks({ ...base, currencyCount: 2 }));
    expect(m.get("no_cross_currency")).toBe("info");
  });

  it("petit écart (>5 % mais ≤5 clients) NE masque PAS → info", () => {
    // 19 vs 21 = 9,5 % mais seulement 2 clients : les deux seuils ne sont pas franchis.
    const m = byKey(
      buildCoherenceChecks({ ...base, dashboardClients: 19, whopMembers: 21 }),
    );
    expect(m.get("dashboard_vs_whop")).toBe("info");
  });

  it("gros écart (>5 % ET >5 clients) → violation (masque)", () => {
    const m = byKey(
      buildCoherenceChecks({ ...base, dashboardClients: 10, whopMembers: 21 }),
    );
    expect(m.get("dashboard_vs_whop")).toBe("violation");
  });

  it("affiche la cause (memberships antérieurs à l'instrumentation)", () => {
    const checks = buildCoherenceChecks({
      ...base,
      dashboardClients: 19,
      whopMembers: 20,
      whopExcludedPre: 2,
    });
    const c = checks.find((x) => x.key === "dashboard_vs_whop");
    expect(c?.status).toBe("info");
    expect(c?.detail).toContain("antérieur");
  });

  it("source manquante → dashboard/Whop en attente (info, pas 0)", () => {
    const m = byKey(buildCoherenceChecks({ ...base, whopMembers: null }));
    expect(m.get("dashboard_vs_whop")).toBe("info");
  });

  it("atteinte brute non monotone → info à côté du séquentiel OK", () => {
    const reachBreak = [
      { key: "signup", label: "", count: 499 },
      { key: "paywall", label: "", count: 513 },
    ];
    const m = byKey(buildCoherenceChecks({ ...base, reachSteps: reachBreak }));
    expect(m.get("funnel_sequential_monotone")).toBe("ok");
    expect(m.get("funnel_reach_nonmonotone")).toBe("info");
  });
});

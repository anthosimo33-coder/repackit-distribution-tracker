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
  computePromoRpm,
  checkMonotonicity,
  funnelCoherenceChecks,
  buildCoherenceChecks,
  reconcileDailyClients,
  abArmCoherenceChecks,
  parisDayKey,
  parisShortDate,
  daysUntil,
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

  it("Σ clients/jour > total → violation (le bug des 54 vs 25)", () => {
    const steps = [{ key: "subscription_completed", label: "", count: 25 }];
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        sequentialSteps: steps,
        reachSteps: steps,
        dailyClientsSum: 54,
      }),
    );
    expect(m.get("sum_daily_clients_le_total")).toBe("violation");
  });

  it("Σ clients/jour ≤ total → ok", () => {
    const steps = [{ key: "subscription_completed", label: "", count: 25 }];
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        sequentialSteps: steps,
        reachSteps: steps,
        dailyClientsSum: 24,
      }),
    );
    expect(m.get("sum_daily_clients_le_total")).toBe("ok");
  });

  it("subscription_completed brut > séquentiel → défaut exposé (info, pas masqué)", () => {
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        sequentialSteps: [{ key: "subscription_completed", label: "", count: 20 }],
        reachSteps: [{ key: "subscription_completed", label: "", count: 25 }],
      }),
    );
    expect(m.get("subscription_double_instrumentation")).toBe("info");
  });

  // Contrôle CROISÉ PAR JOUR (le cas que les totaux ne voyaient pas — 3e occurrence).
  it("croisé PostHog↔Whop : jours concordants → ok", () => {
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        dailySubs: [
          { day: "2026-07-28", subs: 5 },
          { day: "2026-07-29", subs: 5 },
        ],
        dailyPaidClients: [
          { day: "2026-07-28", clients: 5 },
          { day: "2026-07-29", clients: 5 },
        ],
        todayParis: "2026-07-30",
      }),
    );
    expect(m.get("daily_clients_posthog_vs_whop")).toBe("ok");
  });

  it("croisé : un jour 0 PostHog vs 5 Whop → violation (le cas du 29/07)", () => {
    const checks = buildCoherenceChecks({
      ...base,
      dailySubs: [{ day: "2026-07-29", subs: 0 }],
      dailyPaidClients: [{ day: "2026-07-29", clients: 5 }],
      todayParis: "2026-07-30",
    });
    const c = checks.find((x) => x.key === "daily_clients_posthog_vs_whop");
    expect(c?.status).toBe("violation");
    expect(c?.detail).toContain("2026-07-29");
  });

  it("croisé : le jour COURANT (partiel des deux côtés) est exclu", () => {
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        dailySubs: [{ day: "2026-07-30", subs: 0 }],
        dailyPaidClients: [{ day: "2026-07-30", clients: 5 }],
        todayParis: "2026-07-30",
      }),
    );
    expect(m.get("daily_clients_posthog_vs_whop")).toBe("ok");
  });

  it("croisé : ±1 toléré (paiement disputé / bord de journée)", () => {
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        dailySubs: [{ day: "2026-07-28", subs: 5 }],
        dailyPaidClients: [{ day: "2026-07-28", clients: 6 }],
        todayParis: "2026-07-30",
      }),
    );
    expect(m.get("daily_clients_posthog_vs_whop")).toBe("ok");
  });

  it("croisé : ±2 sur un gros jour (14 vs 12, bruit structurel) → PAS d'alerte", () => {
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        dailySubs: [{ day: "2026-07-27", subs: 14 }],
        dailyPaidClients: [{ day: "2026-07-27", clients: 12 }],
        todayParis: "2026-07-30",
      }),
    );
    expect(m.get("daily_clients_posthog_vs_whop")).toBe("ok");
  });


  // ─── RÉCONCILIATION par membership_id (diagnostic du 28/07/2026) ──────────
  // Le cas RÉEL, reconstruit sur les horodatages de prod : PostHog 11 vs Whop 8
  // = 7 appariés + 3 events rejoués du 27 (retries serveur de 15:03/16:12) + 1
  // sub sans paiement encaissé (remboursé), et 1 paiement Whop sans event.
  const jour28 = {
    subs: [
      // 7 appariés le 28
      { day: "2026-07-28", membershipId: "mem_EpAm", persons: 1 },
      { day: "2026-07-28", membershipId: "mem_iXFG", persons: 1 },
      { day: "2026-07-28", membershipId: "mem_uWZM", persons: 1 },
      { day: "2026-07-28", membershipId: "mem_peA2", persons: 1 },
      { day: "2026-07-28", membershipId: "mem_9Z1C", persons: 1 },
      { day: "2026-07-28", membershipId: "mem_RAnm", persons: 1 },
      { day: "2026-07-28", membershipId: "mem_EOvy", persons: 1 },
      // 3 rejoués : encaissés le 27, event ré-émis le 28
      { day: "2026-07-28", membershipId: "mem_S7F2", persons: 1 },
      { day: "2026-07-28", membershipId: "mem_lDjp", persons: 1 },
      { day: "2026-07-28", membershipId: "mem_joGn", persons: 1 },
      // 1 fantôme : paiement remboursé, jamais encaissé
      { day: "2026-07-28", membershipId: "mem_pZxK", persons: 1 },
    ],
    whop: [
      { membershipId: "mem_EpAm", day: "2026-07-28" },
      { membershipId: "mem_iXFG", day: "2026-07-28" },
      { membershipId: "mem_uWZM", day: "2026-07-28" },
      { membershipId: "mem_peA2", day: "2026-07-28" },
      { membershipId: "mem_9Z1C", day: "2026-07-28" },
      { membershipId: "mem_RAnm", day: "2026-07-28" },
      { membershipId: "mem_EOvy", day: "2026-07-28" },
      // le 8e Whop du 28 : payé 13:49:48, AUCUN event PostHog
      { membershipId: "mem_JAiV", day: "2026-07-28" },
      // les 3 rejoués sont des clients du 27
      { membershipId: "mem_S7F2", day: "2026-07-27" },
      { membershipId: "mem_lDjp", day: "2026-07-27" },
      { membershipId: "mem_joGn", day: "2026-07-27" },
    ],
  };

  it("réconciliation du 28/07 : 11 = 7 appariés + 3 rejoués + 1 sans paiement, 1 Whop sans event", () => {
    const r = reconcileDailyClients(jour28.subs, jour28.whop).find(
      (x) => x.day === "2026-07-28",
    )!;
    expect(r).toEqual({
      day: "2026-07-28",
      matched: 7,
      replayed: 3,
      unpaid: 1,
      unlinked: 0,
      missing: 1,
    });
  });

  it("croisé RÉCONCILIÉ : l'écart brut 11 vs 8 devient une INFO décomposée, pas une violation", () => {
    const checks = buildCoherenceChecks({
      ...base,
      dailySubs: [{ day: "2026-07-28", subs: 11 }],
      dailyPaidClients: [{ day: "2026-07-28", clients: 8 }],
      subsByMembership: jour28.subs,
      whopFirstPaidDay: jour28.whop,
      todayParis: "2026-07-30",
    });
    const c = checks.find((x) => x.key === "daily_clients_posthog_vs_whop")!;
    // Le contrôle a fait son travail (il SIGNALE), mais il ne sonne plus :
    // matched(7) vs Whop(8) = 1, sous le seuil.
    expect(c.status).toBe("info");
    expect(c.detail).toContain("7 apparié(s)");
    expect(c.detail).toContain("3 rejoué(s)");
    expect(c.detail).toContain("1 sans paiement abouti");
    expect(c.detail).toContain("1 paiement(s) Whop sans event");
    expect(c.detail).toContain("Whop fait foi");
  });

  it("croisé SANS réconciliation (cache vide) : le même écart reste une VIOLATION brute", () => {
    // Le contrôle ne se tait jamais faute de données : sans membership_id, tout
    // l'écart est inexpliqué. Contre-épreuve du test précédent.
    const checks = buildCoherenceChecks({
      ...base,
      dailySubs: [{ day: "2026-07-28", subs: 11 }],
      dailyPaidClients: [{ day: "2026-07-28", clients: 8 }],
      todayParis: "2026-07-30",
    });
    expect(
      checks.find((x) => x.key === "daily_clients_posthog_vs_whop")!.status,
    ).toBe("violation");
  });

  it("croisé réconcilié : un écart INEXPLIQUÉ (subs appariés ≠ Whop) sonne toujours", () => {
    // 5 subs, tous appariés au 29 ; mais Whop en compte 9 le 29 → 4 paiements
    // sans event. La réconciliation ne l'excuse pas : c'est un vrai trou.
    const subs = ["a", "b", "c", "d", "e"].map((m) => ({
      day: "2026-07-29",
      membershipId: `mem_${m}`,
      persons: 1,
    }));
    const whop = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((m) => ({
      membershipId: `mem_${m}`,
      day: "2026-07-29",
    }));
    const c = buildCoherenceChecks({
      ...base,
      dailySubs: [{ day: "2026-07-29", subs: 5 }],
      dailyPaidClients: [{ day: "2026-07-29", clients: 9 }],
      subsByMembership: subs,
      whopFirstPaidDay: whop,
      todayParis: "2026-07-30",
    }).find((x) => x.key === "daily_clients_posthog_vs_whop")!;
    expect(c.status).toBe("violation");
    expect(c.detail).toContain("4 paiement(s) Whop sans event");
  });

  it("conversion à 23h58 Paris : classée le BON jour des deux côtés (aucun décalage minuit)", () => {
    // Les deux séries sont déjà en jour Paris ; un event à 23:58 et son
    // paiement à 23:57 tombent le même jour → apparié, zéro alerte. C'était
    // l'hypothèse fuseau, écartée par le diagnostic — le test la verrouille.
    const subs = [{ day: "2026-07-28", membershipId: "mem_late", persons: 1 }];
    const whop = [{ membershipId: "mem_late", day: "2026-07-28" }];
    expect(reconcileDailyClients(subs, whop)).toEqual([
      { day: "2026-07-28", matched: 1, replayed: 0, unpaid: 0, unlinked: 0, missing: 0 },
    ]);
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        dailySubs: [{ day: "2026-07-28", subs: 1 }],
        dailyPaidClients: [{ day: "2026-07-28", clients: 1 }],
        subsByMembership: subs,
        whopFirstPaidDay: whop,
        todayParis: "2026-07-30",
      }),
    );
    expect(m.get("daily_clients_posthog_vs_whop")).toBe("ok");
  });

  it("doublon dédupliqué : deux events du MÊME membership le même jour comptent 1", () => {
    // uniq(person_id) par (jour, membership) côté HogQL rend déjà persons=1 ;
    // et si le même membership revenait sur DEUX lignes du même jour (deux
    // personnes ?), il n'est apparié qu'une fois : le 2e est un `replayed`
    // (jour Whop ≠) ou un doublon d'appariement, jamais un 2e client.
    const subs = [
      { day: "2026-07-28", membershipId: "mem_x", persons: 1 },
      { day: "2026-07-28", membershipId: "mem_x", persons: 1 },
    ];
    const whop = [{ membershipId: "mem_x", day: "2026-07-28" }];
    const r = reconcileDailyClients(subs, whop)[0];
    // Les deux lignes sont appariées au même jour Whop → matched=2 côté lignes,
    // mais `missing` reste 0 et Whop n'a qu'un client : l'écart (2 vs 1) est
    // sous le seuil et n'alerte pas.
    expect(r.missing).toBe(0);
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        dailySubs: [{ day: "2026-07-28", subs: 1 }],
        dailyPaidClients: [{ day: "2026-07-28", clients: 1 }],
        subsByMembership: subs,
        whopFirstPaidDay: whop,
        todayParis: "2026-07-30",
      }),
    );
    expect(m.get("daily_clients_posthog_vs_whop")).toBe("ok");
  });

  it("fantôme compté à part : sub sans paiement encaissé → `unpaid`, pas un client", () => {
    const subs = [
      { day: "2026-07-28", membershipId: "mem_ok", persons: 1 },
      { day: "2026-07-28", membershipId: "mem_refund", persons: 1 },
    ];
    const whop = [{ membershipId: "mem_ok", day: "2026-07-28" }];
    expect(reconcileDailyClients(subs, whop)[0]).toMatchObject({
      matched: 1,
      unpaid: 1,
      missing: 0,
    });
  });

  it("sub sans membership_id (pré-bascule) reste `unlinked` — inexpliqué, pas excusé", () => {
    const subs = [{ day: "2026-07-27", membershipId: "", persons: 3 }];
    expect(reconcileDailyClients(subs, [])[0]).toMatchObject({ unlinked: 3, matched: 0 });
    // Et il continue de peser dans l'écart : 3 unlinked vs 0 Whop → violation.
    const c = buildCoherenceChecks({
      ...base,
      dailySubs: [{ day: "2026-07-27", subs: 3 }],
      dailyPaidClients: [{ day: "2026-07-27", clients: 0 }],
      subsByMembership: subs,
      whopFirstPaidDay: [],
      todayParis: "2026-07-30",
    }).find((x) => x.key === "daily_clients_posthog_vs_whop")!;
    expect(c.status).toBe("violation");
  });
  it("croisé : ±2 proportionnellement fort (2 vs 4) → info", () => {
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        dailySubs: [{ day: "2026-07-27", subs: 2 }],
        dailyPaidClients: [{ day: "2026-07-27", clients: 4 }],
        todayParis: "2026-07-30",
      }),
    );
    expect(m.get("daily_clients_posthog_vs_whop")).toBe("info");
  });

  it("croisé : absent si les séries ne sont pas fournies", () => {
    const m = byKey(buildCoherenceChecks(base));
    expect(m.has("daily_clients_posthog_vs_whop")).toBe(false);
  });

  // TOLÉRANCE RETIRÉE : les deux séries comptent désormais des PREMIERS paiements
  // (`subs` filtre `is_renewal` dans QUERIES.overview), donc un excès PostHog n'est
  // plus « expliqué » par les renouvellements du jour — il redevient un écart.
  it("croisé : un excès PostHog n'est plus absorbé par les renouvellements du jour", () => {
    const checks = buildCoherenceChecks({
      ...base,
      dailySubs: [{ day: "2026-08-05", subs: 10 }],
      dailyPaidClients: [{ day: "2026-08-05", clients: 3 }],
      todayParis: "2026-08-07",
    });
    const c = checks.find((x) => x.key === "daily_clients_posthog_vs_whop");
    expect(c?.status).toBe("violation");
    expect(c?.detail).toContain("2026-08-05");
    expect(c?.detail).not.toContain("renouvellements");
  });

  // Le cas réel qui tenait le bandeau rouge (04/08 : 8 personnes PostHog, 2
  // nouveaux clients Whop, 2 renouvellements) : une fois les renouvellements
  // filtrés à la source, PostHog tombe à 2 et le jour concorde.
  it("croisé : le 04/08 filtré à la source (2 vs 2) ne diverge plus", () => {
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        dailySubs: [{ day: "2026-08-04", subs: 2 }],
        dailyPaidClients: [{ day: "2026-08-04", clients: 2 }],
        todayParis: "2026-08-07",
      }),
    );
    expect(m.get("daily_clients_posthog_vs_whop")).toBe("ok");
  });

  // Résidu ASSUMÉ : un renouvellement mal étiqueté `is_renewal=false` par le
  // chemin temps réel (1/jour, cas des 06 et 07/08) reste sous le seuil d'alerte.
  it("croisé : 1 faux « nouveau » par jour reste sous le seuil", () => {
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        dailySubs: [
          { day: "2026-08-06", subs: 1 },
          { day: "2026-08-07", subs: 1 },
        ],
        dailyPaidClients: [],
        todayParis: "2026-08-08",
      }),
    );
    expect(m.get("daily_clients_posthog_vs_whop")).toBe("ok");
  });

  it("croisé : PostHog SOUS Whop reste une violation", () => {
    const m = byKey(
      buildCoherenceChecks({
        ...base,
        dailySubs: [{ day: "2026-07-29", subs: 0 }],
        dailyPaidClients: [{ day: "2026-07-29", clients: 5 }],
        todayParis: "2026-07-30",
      }),
    );
    expect(m.get("daily_clients_posthog_vs_whop")).toBe("violation");
  });

  it("croisé : plusieurs jours divergents → le pire est nommé, tous sont comptés", () => {
    const checks = buildCoherenceChecks({
      ...base,
      dailySubs: [
        { day: "2026-08-04", subs: 9 },
        { day: "2026-08-05", subs: 0 },
      ],
      dailyPaidClients: [
        { day: "2026-08-04", clients: 2 },
        { day: "2026-08-05", clients: 4 },
      ],
      todayParis: "2026-08-07",
    });
    const c = checks.find((x) => x.key === "daily_clients_posthog_vs_whop");
    expect(c?.status).toBe("violation");
    expect(c?.detail).toContain("2 jour(s) divergent(s)");
    expect(c?.detail).toContain("2026-08-04"); // écart 7 = le pire
  });
});

/**
 * RPM PROMO — trois valeurs sur un dénominateur COMMUN (les vues promo, warmup
 * exclu) et DEUX devises : l'écart n'existe que si le taux du projet les relie.
 */
describe("computePromoRpm", () => {
  const base = {
    revenueNet: 1200, // €
    creatorCost: 800, // $
    promoViews: 400_000,
    fxRateToRevenue: 0.9,
  };

  it("ramène revenu et coût à mille vues promo, et l'écart à leur différence", () => {
    const r = computePromoRpm(base);
    expect(r.revenue).toBe(3); // 1200 / 400 milliers
    expect(r.cost).toBe(2); // 800 / 400 milliers ($)
    expect(r.costConverted).toBe(1.8); // 2 × 0,9 (€)
    expect(r.margin).toBe(1.2); // 3 − 1,8, exactement l'écart affiché
    expect(r.promoViews).toBe(400_000);
  });

  it("l'écart se lit sur les valeurs AFFICHÉES (revenu − coût converti)", () => {
    const r = computePromoRpm(base);
    expect(r.margin).toBe(
      Math.round(((r.revenue as number) - (r.costConverted as number)) * 100) / 100,
    );
  });

  it("sans taux de change : chaque RPM existe, l'écart non (jamais deux devises soustraites)", () => {
    const r = computePromoRpm({ ...base, fxRateToRevenue: null });
    expect(r.revenue).toBe(3);
    expect(r.cost).toBe(2);
    expect(r.costConverted).toBeNull();
    expect(r.margin).toBeNull();
  });

  it("même devise (taux 1) : le coût converti vaut le coût", () => {
    const r = computePromoRpm({ ...base, fxRateToRevenue: 1 });
    expect(r.costConverted).toBe(2);
    expect(r.margin).toBe(1);
  });

  it("aucune vue promo : tout est null, jamais un RPM infini ni un zéro inventé", () => {
    for (const promoViews of [0, null]) {
      const r = computePromoRpm({ ...base, promoViews });
      expect(r.revenue).toBeNull();
      expect(r.cost).toBeNull();
      expect(r.costConverted).toBeNull();
      expect(r.margin).toBeNull();
      expect(r.promoViews).toBe(0);
    }
  });

  it("Whop non configuré : le RPM coût reste lisible, le revenu et l'écart non", () => {
    const r = computePromoRpm({ ...base, revenueNet: null });
    expect(r.revenue).toBeNull();
    expect(r.cost).toBe(2);
    expect(r.margin).toBeNull();
  });

  it("coût au-dessus du revenu : écart NÉGATIF, jamais borné à zéro", () => {
    const r = computePromoRpm({ ...base, revenueNet: 400 });
    expect(r.revenue).toBe(1);
    expect(r.margin).toBe(-0.8);
  });
});

describe("jour Europe/Paris (courbe ⇄ tableau)", () => {
  // Minuit Europe/Paris (été = UTC+2) du 29 juil. = 28 juil. 22:00 UTC. Un bucket
  // PostHog porte cet instant : c'est LE cas qui décalait la courbe d'un jour.
  const parisMidnight29 = Date.UTC(2026, 6, 28, 22, 0, 0);

  it("ancre l'étiquette sur Paris, pas sur le fuseau du navigateur", () => {
    // La lecture NAÏVE (fuseau UTC) donnait la VEILLE — le bug signalé.
    const naiveUtc = new Date(parisMidnight29).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    expect(naiveUtc).toBe("28 juil.");
    // Ancré Paris : le bon jour, quel que soit le fuseau où tourne le test.
    expect(parisShortDate(parisMidnight29)).toBe("29 juil.");
    expect(parisShortDate(parisMidnight29)).not.toBe(naiveUtc);
    expect(parisDayKey(parisMidnight29)).toBe("2026-07-29");
  });

  it("première et dernière date de la courbe = celles du tableau", () => {
    // 8 buckets = jours Paris 23 → 30 juil. (mêmes instants côté courbe et tableau).
    const daily = Array.from({ length: 8 }, (_, i) => ({
      ts: Date.UTC(2026, 6, 22 + i, 22, 0, 0), // minuit Paris du 23+i juil.
    }));
    // La courbe (HubTrendChart) et le tableau (« Détail par jour ») dérivent tous
    // deux l'étiquette du MÊME ts via parisShortDate : ils ne peuvent plus diverger.
    const courbe = daily.map((d) => parisShortDate(d.ts));
    const tableau = daily.map((d) => parisShortDate(d.ts));
    expect(courbe[0]).toBe(tableau[0]);
    expect(courbe.at(-1)).toBe(tableau.at(-1));
    // Et l'axe correct : 23 → 30 juil. (la version buguée affichait 22 → 29).
    expect(courbe[0]).toBe("23 juil.");
    expect(courbe.at(-1)).toBe("30 juil.");
  });
});

describe("daysUntil — décompte de réponse à un litige", () => {
  const now = Date.UTC(2026, 6, 30, 12, 0, 0);
  const DAY = 24 * 60 * 60 * 1000;

  it("compte les jours entiers restants (arrondi au supérieur)", () => {
    expect(daysUntil(now + 6 * DAY, now)).toBe(6);
    expect(daysUntil(now + 5.2 * DAY, now)).toBe(6); // arrondi au jour supérieur
    expect(daysUntil(now + 0.5 * DAY, now)).toBe(1);
  });

  it("négatif si l'échéance est dépassée, null si inconnue", () => {
    expect(daysUntil(now - 2 * DAY, now)).toBe(-2);
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil(NaN, now)).toBeNull();
  });
});

describe("abArmCoherenceChecks — garde-fou de la carte Test A/B", () => {
  /** Un bras sain : 1 client sur 1 checkout, 6 cibles ajoutées après paiement. */
  const soft = {
    variant: "soft",
    exposed: 24,
    paywallViewers: 11,
    checkouts: 1,
    paid: 1,
    paidWithoutCheckout: 0,
    clientTargets: 6,
    armTargets: 14,
    shownCompletionPct: 100,
    shownTargetsPerClient: 6,
  };
  /** Bras sans aucun target_added : le ratio par client n'est pas mesurable. */
  const hard = {
    variant: "hard",
    exposed: 20,
    paywallViewers: 13,
    checkouts: 4,
    paid: 1,
    paidWithoutCheckout: 0,
    clientTargets: 0,
    armTargets: 0,
    shownCompletionPct: 25,
    shownTargetsPerClient: null,
  };
  const byKey = (checks: { key: string; status: string; detail: string }[]) =>
    new Map(checks.map((c) => [c.key, c]));

  it("carte conforme → tout au vert", () => {
    const m = byKey(abArmCoherenceChecks([soft, hard]));
    expect(m.get("ab_completion_subset")?.status).toBe("ok");
    expect(m.get("ab_completion_matches_columns")?.status).toBe("ok");
    expect(m.get("ab_columns_monotone")?.status).toBe("ok");
    expect(m.get("ab_targets_per_client")?.status).toBe("ok");
  });

  it("aucun contrôle sur une carte vide (aucun bras assigné)", () => {
    expect(abArmCoherenceChecks([])).toEqual([]);
  });

  it("attrape le bug d'unité : un ratio affiché à la place d'un pourcentage", () => {
    // Le bug réel : pct(paid / checkouts) rendait « 0,5 % » pour 50 %.
    const m = byKey(
      abArmCoherenceChecks([
        { ...hard, paid: 2, checkouts: 4, shownCompletionPct: 0.5 },
      ]),
    );
    const c = m.get("ab_completion_matches_columns");
    expect(c?.status).toBe("violation");
    expect(c?.detail).toContain("50 % réel");
    expect(c?.detail).toContain("×100 manquant");
  });

  it("complétion > 100 % → violation (numérateur hors dénominateur)", () => {
    const m = byKey(
      abArmCoherenceChecks([
        { ...hard, paid: 5, checkouts: 4, shownCompletionPct: 125 },
      ]),
    );
    expect(m.get("ab_completion_subset")?.status).toBe("violation");
    expect(m.get("ab_completion_subset")?.detail).toContain("taux > 100 %");
  });

  it("un payé sans checkout est signalé même si le total reste sous 100 %", () => {
    const m = byKey(
      abArmCoherenceChecks([{ ...hard, paidWithoutCheckout: 1 }]),
    );
    expect(m.get("ab_completion_subset")?.status).toBe("info");
    expect(m.get("ab_completion_subset")?.detail).toContain("sans checkout_started");
  });

  it("colonnes non emboîtées → violation", () => {
    const m = byKey(
      abArmCoherenceChecks([{ ...hard, paywallViewers: 25, checkouts: 26 }]),
    );
    expect(m.get("ab_columns_monotone")?.status).toBe("violation");
  });

  it("cibles : un ratio affiché sans aucun target_added est une violation", () => {
    const m = byKey(
      abArmCoherenceChecks([{ ...hard, shownTargetsPerClient: 0 }]),
    );
    expect(m.get("ab_targets_per_client")?.status).toBe("violation");
    expect(m.get("ab_targets_per_client")?.detail).toContain("aucun target_added");
  });

  it("cibles : attrape le bug de population (cibles du BRAS ÷ clients)", () => {
    // Le bug réel : le numérateur prenait les cibles de TOUT le bras (14, dont 8
    // de gens qui n'ont jamais payé) et le dénominateur les seuls clients (1).
    const m = byKey(
      abArmCoherenceChecks([{ ...soft, shownTargetsPerClient: 14 }]),
    );
    expect(m.get("ab_targets_per_client")?.status).toBe("violation");
    expect(m.get("ab_targets_per_client")?.detail).toContain("14 affiché pour 6");
  });

  it("cibles : le numérateur ne peut pas dépasser les cibles du bras", () => {
    const m = byKey(
      abArmCoherenceChecks([
        { ...soft, clientTargets: 20, shownTargetsPerClient: 20 },
      ]),
    );
    expect(m.get("ab_targets_per_client")?.status).toBe("violation");
    expect(m.get("ab_targets_per_client")?.detail).toContain("20 cibles clients");
  });
});

describe("contrôle de cohérence — montant dû = somme des cycles calculés", () => {
  const base = {
    sequentialSteps: [],
    reachSteps: [],
    currencyCount: 1,
    dashboardClients: null,
    whopMembers: null,
  };
  const find = (checks: ReturnType<typeof buildCoherenceChecks>) =>
    checks.find((c) => c.key === "pay_due_matches_parts");

  it("absent si le payload ne porte pas le dû (rétrocompatible)", () => {
    expect(find(buildCoherenceChecks(base))).toBeUndefined();
  });

  it("ok quand le total recoupe ses parts", () => {
    const c = find(
      buildCoherenceChecks({
        ...base,
        payDue: {
          displayedTotal: 978.6,
          recomputedTotal: 978.6,
          cycles: 6,
          creators: 5,
        },
      }),
    );
    expect(c?.status).toBe("ok");
    expect(c?.detail).toContain("978.60");
  });

  it("violation dès qu'un écart dépasse le centime, avec les deux montants", () => {
    // C'est le cas qui aurait cadré la dérive du barème édité en place : un
    // total qui ne se recompose plus depuis son propre détail.
    const c = find(
      buildCoherenceChecks({
        ...base,
        payDue: {
          displayedTotal: 1130.15,
          recomputedTotal: 998.6,
          cycles: 6,
          creators: 5,
        },
      }),
    );
    expect(c?.status).toBe("violation");
    expect(c?.detail).toContain("131.55");
    expect(c?.detail).toContain("1130.15");
    expect(c?.detail).toContain("998.60");
  });

  it("un centime d'arrondi ne déclenche rien", () => {
    const c = find(
      buildCoherenceChecks({
        ...base,
        payDue: {
          displayedTotal: 100.01,
          recomputedTotal: 100.0,
          cycles: 1,
          creators: 1,
        },
      }),
    );
    expect(c?.status).toBe("ok");
  });
});

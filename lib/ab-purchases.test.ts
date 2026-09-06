process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import {
  armPurchases,
  purchaseCoherenceIssues,
  type AbPurchaseInput,
  type PlanPriceLike,
} from "./ab-purchases";

/**
 * L'ÉTAT RÉEL DE LA PROD le 06/09/2026 : requête `abPurchases` exécutée sur
 * PostHog, prix relevés dans la table whopPlans. Deux pièges de la vraie donnée
 * sont conservés — un même slug (`snytch_target_weekly`) porté par DEUX plans
 * Whop, et une offre ponctuelle SANS prix.
 */
const PROD: AbPurchaseInput[] = [
  { variant: "hard", plan: "snytch_trio_weekly", whopPlanId: "plan_8Eo6l4YYhkeI5", clients: 147, armClients: 157, armMultiPlan: 1 },
  { variant: "hard", plan: "snytch_trio_monthly", whopPlanId: "plan_WOE4g8VkBjtgy", clients: 10, armClients: 157, armMultiPlan: 1 },
  { variant: "hard", plan: "snytch_oto_3m", whopPlanId: "plan_mv3B9ptYsCCb0", clients: 1, armClients: 157, armMultiPlan: 1 },
  { variant: "soft", plan: "snytch_target_weekly", whopPlanId: "plan_qK5UxXXkHmXtx", clients: 80, armClients: 115, armMultiPlan: 2 },
  { variant: "soft", plan: "snytch_target_weekly", whopPlanId: "plan_zlK5qDJzXDELm", clients: 20, armClients: 115, armMultiPlan: 2 },
  { variant: "soft", plan: "snytch_target_monthly", whopPlanId: "plan_UiKAw2VyEE6oe", clients: 17, armClients: 115, armMultiPlan: 2 },
];

const PLANS: PlanPriceLike[] = [
  { planId: "plan_8Eo6l4YYhkeI5", name: "Snytch Pro 3 cibles — Hebdo", price: 9.99, currency: "eur", interval: "semaine" },
  { planId: "plan_WOE4g8VkBjtgy", name: "Snytch Pro 3 Cibles— Mensuel", price: 29.99, currency: "eur", interval: "mois" },
  // Offre ponctuelle : Whop ne lui donne AUCUN prix.
  { planId: "plan_mv3B9ptYsCCb0", name: "Offre Unique Snytch", price: null, currency: "eur", interval: "one_time" },
  { planId: "plan_qK5UxXXkHmXtx", name: "Snytch Pro - Hebdo · 4,99 €/sem", price: 4.99, currency: "eur", interval: "semaine" },
  { planId: "plan_zlK5qDJzXDELm", name: "Snytch Pro — Hebdo · 4,99 €/sem", price: 4.99, currency: "eur", interval: "semaine" },
  { planId: "plan_UiKAw2VyEE6oe", name: "Snytch Pro — Mensuel · 16,99 €/mois", price: 16.99, currency: "eur", interval: "mois" },
  // Grille en DOLLARS apparue le 06/09 au catalogue, encore sans acheteur.
  { planId: "plan_HFtrxkHt9BQMn", name: "Snytch Pro 3 Targets - Weekly", price: 11.99, currency: "usd", interval: "semaine" },
];

describe("armPurchases", () => {
  it("joint le prix par plan_id, pas par slug", () => {
    const arms = armPurchases(PROD, PLANS);
    const hard = arms.find((a) => a.variant === "hard")!;
    const hebdo = hard.rows.find((r) => r.plan === "snytch_trio_weekly")!;
    const mensuel = hard.rows.find((r) => r.plan === "snytch_trio_monthly")!;
    // Le défaut vu sur la prod : deux tableaux dédupliqués non alignés donnaient
    // le plan_id de l'hebdo au mensuel, donc 9,99 € à la place de 29,99 €.
    expect(hebdo.price).toBe(9.99);
    expect(mensuel.price).toBe(29.99);
    expect(mensuel.firstCycleRevenue).toBe(299.9); // 10 × 29,99
    expect(hebdo.firstCycleRevenue).toBe(1468.53); // 147 × 9,99
  });

  it("un même slug sous DEUX plans Whop reste sur deux lignes", () => {
    const soft = armPurchases(PROD, PLANS).find((a) => a.variant === "soft")!;
    const hebdos = soft.rows.filter((r) => r.plan === "snytch_target_weekly");
    expect(hebdos).toHaveLength(2);
    // Les fusionner masquerait le jour où les deux plans n'ont plus le même prix.
    expect(hebdos.map((r) => r.clients).sort((a, b) => a - b)).toEqual([20, 80]);
    expect(new Set(hebdos.map((r) => r.whopPlanId)).size).toBe(2);
  });

  it("le total du bras EXCLUT les clients sans prix, et le dit", () => {
    const hard = armPurchases(PROD, PLANS).find((a) => a.variant === "hard")!;
    // 147 × 9,99 + 10 × 29,99 = 1 768,43. L'offre ponctuelle n'a pas de prix
    // chez Whop : son client est écarté du total, pas compté à zéro.
    expect(hard.firstCycleRevenue).toBe(1768.43);
    expect(hard.clientsWithoutPrice).toBe(1);
    expect(hard.rows.find((r) => r.plan === "snytch_oto_3m")!.firstCycleRevenue)
      .toBeNull();
  });

  it("refuse d'additionner deux devises", () => {
    // Le catalogue porte une grille en dollars depuis le 06/09 : le jour où un
    // bras vend dans les deux, une somme se lirait comme un montant.
    const mixte = [
      ...PROD.filter((r) => r.variant === "hard"),
      { variant: "hard", plan: "snytch_trio_weekly_usd", whopPlanId: "plan_HFtrxkHt9BQMn", clients: 5, armClients: 157, armMultiPlan: 1 },
    ];
    const hard = armPurchases(mixte, PLANS).find((a) => a.variant === "hard")!;
    expect(hard.firstCycleRevenue).toBeNull();
    expect(hard.currencies).toEqual(["eur", "usd"]);
    // Contre-test de présence : sans la ligne en dollars, le total revient.
    const pur = armPurchases(PROD, PLANS).find((a) => a.variant === "hard")!;
    expect(pur.firstCycleRevenue).toBe(1768.43);
    expect(pur.currency).toBe("eur");
  });

  it("le bras A vend moins cher ET moins : deux fois moins de revenu", () => {
    const arms = armPurchases(PROD, PLANS);
    const soft = arms.find((a) => a.variant === "soft")!;
    const hard = arms.find((a) => a.variant === "hard")!;
    // 80×4,99 + 20×4,99 + 17×16,99 = 787,83
    expect(soft.firstCycleRevenue).toBe(787.83);
    expect(hard.firstCycleRevenue! / soft.firstCycleRevenue!).toBeGreaterThan(2);
  });

  it("la part par plan se calcule sur les clients DISTINCTS du bras", () => {
    const hard = armPurchases(PROD, PLANS).find((a) => a.variant === "hard")!;
    // 147 / 157, pas 147 / 158 (la somme des lignes compte une personne deux fois).
    expect(hard.rows[0].sharePct).toBe(93.6);
    expect(hard.armClients).toBe(157);
  });

  it("un plan absent du catalogue Whop n'invente pas de prix", () => {
    const arms = armPurchases(PROD, []);
    const hard = arms.find((a) => a.variant === "hard")!;
    expect(hard.firstCycleRevenue).toBeNull();
    expect(hard.clientsWithoutPrice).toBe(158);
    // Le libellé retombe sur le slug émis par l'app plutôt que sur un vide.
    expect(hard.rows[0].label).toBe("snytch_trio_weekly");
    // Contre-test : avec le catalogue, c'est le nom Whop qui s'affiche.
    expect(armPurchases(PROD, PLANS)[0].rows[0].label).toContain("Snytch Pro");
  });
});

describe("purchaseCoherenceIssues", () => {
  it("ne dit rien quand les deux tableaux comptent la même population", () => {
    const arms = armPurchases(PROD, PLANS);
    const paid = new Map([
      ["hard", 157],
      ["soft", 115],
    ]);
    expect(purchaseCoherenceIssues(arms, paid)).toEqual([]);
  });

  it("signale un écart avec la carte des bras", () => {
    const arms = armPurchases(PROD, PLANS);
    // Le défaut vécu deux fois sur ce hub : un agrégat change de population
    // (personnes contre abonnements) et l'autre reste en arrière.
    const issues = purchaseCoherenceIssues(arms, new Map([["hard", 138]]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("157");
    expect(issues[0]).toContain("138");
  });

  it("signale des doubles comptes incohérents avec les multi-plans", () => {
    // 3 clients multi-plans ne peuvent pas produire 1 seule ligne en trop.
    const faux = PROD.filter((r) => r.variant === "hard").map((r) => ({
      ...r,
      armMultiPlan: 3,
    }));
    const issues = purchaseCoherenceIssues(armPurchases(faux, PLANS), new Map());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("multi-plans");
  });
});

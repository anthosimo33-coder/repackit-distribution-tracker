process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import {
  armPurchases,
  convertibleAmount,
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

/**
 * Le contexte devises de Snytch en prod : revenu en euros, l'autre grille en
 * dollars, taux posé à la main (1 $ = 0,86 €).
 */
const CTX = { revenueCurrency: "eur", payCurrency: "usd", fxRateToRevenue: 0.86 };

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

/** Le bras B vend aussi hors Europe : la grille en dollars a trouvé 5 clients. */
const MIXTE: AbPurchaseInput[] = [
  ...PROD.filter((r) => r.variant === "hard"),
  { variant: "hard", plan: "snytch_trio_weekly_usd", whopPlanId: "plan_HFtrxkHt9BQMn", clients: 5, armClients: 157, armMultiPlan: 1 },
];

describe("convertibleAmount", () => {
  it("convertit le dollar, laisse l'euro tel quel, refuse le reste", () => {
    expect(convertibleAmount(100, "eur", CTX)).toBe(100);
    expect(convertibleAmount(100, "usd", CTX)).toBe(86);
    expect(convertibleAmount(100, "gbp", CTX)).toBeNull();
    expect(convertibleAmount(100, null, CTX)).toBeNull();
    expect(convertibleAmount(100, "usd", { ...CTX, fxRateToRevenue: null })).toBeNull();
  });
});

describe("armPurchases", () => {
  it("joint le prix par plan_id, pas par slug", () => {
    const arms = armPurchases(PROD, PLANS, CTX);
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
    const soft = armPurchases(PROD, PLANS, CTX).find((a) => a.variant === "soft")!;
    const hebdos = soft.rows.filter((r) => r.plan === "snytch_target_weekly");
    expect(hebdos).toHaveLength(2);
    // Les fusionner masquerait le jour où les deux plans n'ont plus le même prix.
    expect(hebdos.map((r) => r.clients).sort((a, b) => a - b)).toEqual([20, 80]);
    expect(new Set(hebdos.map((r) => r.whopPlanId)).size).toBe(2);
  });

  it("le total du bras EXCLUT les clients sans prix, et le dit", () => {
    const hard = armPurchases(PROD, PLANS, CTX).find((a) => a.variant === "hard")!;
    // 147 × 9,99 + 10 × 29,99 = 1 768,43. L'offre ponctuelle n'a pas de prix
    // chez Whop : son client est écarté du total, pas compté à zéro.
    expect(hard.firstCycleRevenue).toBe(1768.43);
    expect(hard.clientsWithoutPrice).toBe(1);
    expect(hard.rows.find((r) => r.plan === "snytch_oto_3m")!.firstCycleRevenue)
      .toBeNull();
  });

  it("vendre dans DEUX devises est normal : sous-totaux exacts + total converti", () => {
    // Règle produit depuis le 06/09 : grille en euros pour l'Europe, en dollars
    // ailleurs. Un bras vendra dans les deux en régime normal — refuser le total
    // laisserait la colonne vide pour toujours.
    const hard = armPurchases(MIXTE, PLANS, CTX).find((a) => a.variant === "hard")!;
    expect(hard.currencies).toEqual(["eur", "usd"]);
    // Les sous-totaux ne dépendent d'AUCUN taux : ce sont eux la référence.
    expect(hard.revenueByCurrency).toEqual([
      { currency: "eur", amount: 1768.43 },
      { currency: "usd", amount: 59.95 }, // 5 × 11,99
    ]);
    // 59,95 $ × 0,86 = 51,56 €, plus 1 768,43 €.
    expect(hard.firstCycleRevenue).toBe(1819.99);
    expect(hard.currency).toBe("eur");
    expect(hard.converted).toBe(true);
    expect(hard.unconvertibleCurrencies).toEqual([]);
  });

  it("sans vente en dollars, rien n'est converti", () => {
    // Contre-test de la condition : `converted` ne doit pas être vrai par défaut,
    // sinon l'écran afficherait « converti » sur des euros qui n'ont pas bougé.
    const hard = armPurchases(PROD, PLANS, CTX).find((a) => a.variant === "hard")!;
    expect(hard.firstCycleRevenue).toBe(1768.43);
    expect(hard.converted).toBe(false);
    expect(hard.revenueByCurrency).toEqual([{ currency: "eur", amount: 1768.43 }]);
  });

  it("une TROISIÈME devise n'est pas convertie au taux du dollar", () => {
    // Le piège : `fxRateToRevenue` vaut pour UNE paire ($ → €). L'appliquer à une
    // livre sterling donnerait un montant faux d'apparence crédible.
    const avecLivre = [
      ...PROD.filter((r) => r.variant === "hard"),
      { variant: "hard", plan: "snytch_trio_weekly_gbp", whopPlanId: "plan_GBP", clients: 4, armClients: 157, armMultiPlan: 1 },
    ];
    const plans = [
      ...PLANS,
      { planId: "plan_GBP", name: "Pro 3 Targets - Weekly (UK)", price: 8.99, currency: "gbp", interval: "semaine" },
    ];
    const hard = armPurchases(avecLivre, plans, CTX).find((a) => a.variant === "hard")!;
    expect(hard.unconvertibleCurrencies).toEqual(["gbp"]);
    expect(hard.firstCycleRevenue).toBeNull();
    // Le sous-total en livres reste JUSTE : seul le total combiné disparaît.
    expect(hard.revenueByCurrency).toContainEqual({ currency: "gbp", amount: 35.96 });
  });

  it("sans taux réglé sur le projet, les dollars ne deviennent pas des euros", () => {
    const sansTaux = armPurchases(MIXTE, PLANS, {
      ...CTX,
      fxRateToRevenue: null,
    }).find((a) => a.variant === "hard")!;
    expect(sansTaux.firstCycleRevenue).toBeNull();
    expect(sansTaux.unconvertibleCurrencies).toEqual(["usd"]);
    // Contre-test : avec le taux, le total existe.
    expect(
      armPurchases(MIXTE, PLANS, CTX).find((a) => a.variant === "hard")!
        .firstCycleRevenue,
    ).toBe(1819.99);
  });

  it("le bras A vend moins cher ET moins : deux fois moins de revenu", () => {
    const arms = armPurchases(PROD, PLANS, CTX);
    const soft = arms.find((a) => a.variant === "soft")!;
    const hard = arms.find((a) => a.variant === "hard")!;
    // 80×4,99 + 20×4,99 + 17×16,99 = 787,83
    expect(soft.firstCycleRevenue).toBe(787.83);
    expect(hard.firstCycleRevenue! / soft.firstCycleRevenue!).toBeGreaterThan(2);
  });

  it("la part par plan se calcule sur les clients DISTINCTS du bras", () => {
    const hard = armPurchases(PROD, PLANS, CTX).find((a) => a.variant === "hard")!;
    // 147 / 157, pas 147 / 158 (la somme des lignes compte une personne deux fois).
    expect(hard.rows[0].sharePct).toBe(93.6);
    expect(hard.armClients).toBe(157);
  });

  it("un plan absent du catalogue Whop n'invente pas de prix", () => {
    const arms = armPurchases(PROD, [], CTX);
    const hard = arms.find((a) => a.variant === "hard")!;
    expect(hard.firstCycleRevenue).toBeNull();
    expect(hard.clientsWithoutPrice).toBe(158);
    // Le libellé retombe sur le slug émis par l'app plutôt que sur un vide.
    expect(hard.rows[0].label).toBe("snytch_trio_weekly");
    // Contre-test : avec le catalogue, c'est le nom Whop qui s'affiche.
    expect(armPurchases(PROD, PLANS, CTX)[0].rows[0].label).toContain("Snytch Pro");
  });
});

describe("purchaseCoherenceIssues", () => {
  it("ne dit rien quand les deux tableaux comptent la même population", () => {
    const arms = armPurchases(PROD, PLANS, CTX);
    const paid = new Map([
      ["hard", 157],
      ["soft", 115],
    ]);
    expect(purchaseCoherenceIssues(arms, paid)).toEqual([]);
  });

  it("signale un écart avec la carte des bras", () => {
    const arms = armPurchases(PROD, PLANS, CTX);
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
    const issues = purchaseCoherenceIssues(armPurchases(faux, PLANS, CTX), new Map());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("multi-plans");
  });
});

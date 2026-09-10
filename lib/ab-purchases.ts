/**
 * TEST A/B — ce que les clients ont RÉELLEMENT acheté. Logique PURE (testée
 * Vitest, aucune dép React ni Convex).
 *
 * ⚠️ POURQUOI CE MODULE EN PLUS DE `lib/ab-offers.ts`. `plan_preselected` est le
 * plan PRÉ-COCHÉ à l'ouverture du paywall, pas l'offre : chaque bras présente un
 * MENU. Le bras B vend 9,99 €/semaine ou 29,99 €/mois, le bras A 16,90 €/mois ou
 * 49,90 €/an. Tant qu'on lit la présélection, on croit qu'un bras a UN prix —
 * mesuré en prod le 06/09, le bras B a vendu trois plans à trois prix, dont une
 * offre ponctuelle qu'aucune constante du dépôt ne connaissait.
 *
 * Le prix vient de WHOP (`PlanEconomics`, joint par `plan_id`), jamais d'une
 * table écrite en dur : celle du dépôt (`EXPECTED_ARM_PRICING`) a dérivé deux
 * fois en un mois sans que rien ne le signale.
 *
 * ⚠️ LA MULTI-DEVISE EST ICI UNE RÈGLE PRODUIT, PAS UNE ANOMALIE. Depuis le
 * 06/09 le catalogue sert la grille en euros aux résidents européens et la
 * grille en dollars aux autres : un bras vendra donc DANS LES DEUX, en régime
 * normal et pour toujours. Refuser le total serait laisser la colonne revenu
 * vide en permanence. On rend donc les deux choses : les sous-totaux PAR DEVISE,
 * exacts et sans hypothèse, et un total converti au taux du projet, marqué comme
 * tel. Ce qui reste interdit, c'est d'ADDITIONNER deux devises sans le dire.
 */

/** Une ligne de `AbPurchasesPayload`. */
import { payAmountInRevenueCurrency, sameCurrency } from "./currency";

export interface AbPurchaseInput {
  variant: string;
  plan: string;
  whopPlanId: string;
  clients: number;
  armClients: number;
  armMultiPlan: number;
}

/** Ce dont ce module a besoin d'un plan Whop (sous-ensemble de PlanEconomics). */
export interface PlanPriceLike {
  planId: string;
  name: string | null;
  price: number | null;
  currency: string | null;
  interval: string | null;
}

/**
 * De quoi convertir un revenu vers la devise d'affichage du hub.
 *
 * `fxRateToRevenue` n'est PAS un taux universel : il est défini pour UNE paire
 * (payCurrency → revenueCurrency, chez Snytch 1 $ = 0,86 €). L'appliquer à une
 * troisième devise donnerait un montant faux d'apparence crédible, ce qui est
 * pire qu'un tiret. `convertibleAmount` refuse ce cas explicitement.
 */
export interface RevenueContext {
  /** Devise d'affichage du hub (celle du revenu Whop). */
  revenueCurrency: string | null | undefined;
  /** L'autre devise de la paire couverte par le taux. */
  payCurrency: string | null | undefined;
  /** 1 unité de `payCurrency` = ce nombre d'unités de `revenueCurrency`. */
  fxRateToRevenue: number | null | undefined;
}

/**
 * Un montant converti vers la devise d'affichage, ou `null` si le taux du projet
 * ne couvre pas cette devise. C'est la GARDE qui empêche d'appliquer le taux
 * dollar à une livre sterling.
 */
export function convertibleAmount(
  amount: number,
  currency: string | null | undefined,
  ctx: RevenueContext,
): number | null {
  if (sameCurrency(currency, ctx.revenueCurrency)) return amount;
  if (!sameCurrency(currency, ctx.payCurrency)) return null;
  const d = payAmountInRevenueCurrency(
    amount,
    currency,
    ctx.revenueCurrency,
    ctx.fxRateToRevenue,
  );
  return d.converted ? d.value : null;
}

export interface AbPurchaseRow extends AbPurchaseInput {
  /** Prix Whop du plan. `null` = plan sans prix (offre ponctuelle) ou inconnu. */
  price: number | null;
  currency: string | null;
  interval: string | null;
  /** Nom Whop si disponible, sinon le slug émis par l'app. */
  label: string;
  /** Part des clients du bras ayant pris ce plan. */
  sharePct: number | null;
  /** clients × prix. `null` si le prix est inconnu — jamais zéro. */
  firstCycleRevenue: number | null;
}

export interface AbArmPurchases {
  variant: string;
  rows: AbPurchaseRow[];
  /** Clients DISTINCTS du bras. Ce n'est PAS la somme de la colonne `clients`. */
  armClients: number;
  /** Combien d'entre eux ont acheté plusieurs plans. */
  armMultiPlan: number;
  /**
   * Somme des lignes moins les clients distincts : le nombre de fois qu'une
   * personne apparaît en double. Doit valoir AU MOINS `armMultiPlan` (chaque
   * personne à plusieurs plans pèse au moins une ligne de trop). En dessous, les
   * deux compteurs ne parlent pas de la même population.
   */
  doubleCounted: number;
  /**
   * Revenu du 1er cycle PAR DEVISE, exact et sans hypothèse. C'est le chiffre de
   * référence : il ne dépend d'aucun taux, donc il ne vieillit pas.
   */
  revenueByCurrency: { currency: string; amount: number }[];
  /**
   * Total converti dans la devise d'affichage. `null` dès qu'une devise vendue
   * n'est pas couverte par le taux du projet — un total partiel se lirait comme
   * un total.
   */
  firstCycleRevenue: number | null;
  /** Devise de `firstCycleRevenue`. */
  currency: string | null;
  /** Vrai si au moins un montant a été converti (l'écran doit le dire). */
  converted: boolean;
  /** Devises rencontrées, triées. */
  currencies: string[];
  /** Celles que le taux du projet ne couvre pas — la raison d'un total absent. */
  unconvertibleCurrencies: string[];
  /** Clients écartés du total faute de prix Whop sur leur plan. */
  clientsWithoutPrice: number;
}

/** `armClients` et `armMultiPlan` sont répétés sur chaque ligne : lus une fois. */
function armFieldOf(
  rows: readonly AbPurchaseInput[],
  pick: (r: AbPurchaseInput) => number,
): number {
  return rows.length > 0 ? pick(rows[0]) : 0;
}

/**
 * Achats par bras, prix joints depuis Whop.
 *
 * Le total du bras N'ADDITIONNE PAS deux devises : depuis le 06/09 le catalogue
 * Whop porte une grille en dollars à côté de la grille en euros, et une somme
 * mélangée se lirait comme un montant. Elle est refusée, la répartition en
 * clients reste juste.
 */
export function armPurchases(
  rows: readonly AbPurchaseInput[],
  plans: readonly PlanPriceLike[],
  ctx: RevenueContext,
): AbArmPurchases[] {
  const priceOf = new Map(plans.map((p) => [p.planId, p] as const));
  const byArm = new Map<string, AbPurchaseInput[]>();
  for (const r of rows) {
    const list = byArm.get(r.variant);
    if (list) list.push(r);
    else byArm.set(r.variant, [r]);
  }
  return [...byArm.entries()]
    .map(([variant, list]) => {
      const armClients = armFieldOf(list, (r) => r.armClients);
      const enriched: AbPurchaseRow[] = list
        .map((r) => {
          const p = priceOf.get(r.whopPlanId);
          const price = p?.price ?? null;
          return {
            ...r,
            price,
            currency: p?.currency ?? null,
            interval: p?.interval ?? null,
            label: p?.name ?? r.plan,
            sharePct:
              armClients > 0
                ? Math.round((r.clients / armClients) * 1000) / 10
                : null,
            firstCycleRevenue:
              price === null ? null : Math.round(r.clients * price * 100) / 100,
          };
        })
        .sort((a, b) => b.clients - a.clients);
      const priced = enriched.filter((r) => r.firstCycleRevenue !== null);
      const currencies = [
        ...new Set(priced.map((r) => r.currency).filter((c): c is string => !!c)),
      ].sort();
      const byCurrency = currencies.map((currency) => ({
        currency,
        amount:
          Math.round(
            priced
              .filter((r) => r.currency === currency)
              .reduce((t, r) => t + (r.firstCycleRevenue ?? 0), 0) * 100,
          ) / 100,
      }));
      const unconvertible = byCurrency
        .filter((b) => convertibleAmount(b.amount, b.currency, ctx) === null)
        .map((b) => b.currency);
      const rowSum = list.reduce((t, r) => t + r.clients, 0);
      return {
        variant,
        rows: enriched,
        armClients,
        armMultiPlan: armFieldOf(list, (r) => r.armMultiPlan),
        doubleCounted: rowSum - armClients,
        revenueByCurrency: byCurrency,
        firstCycleRevenue:
          byCurrency.length === 0 || unconvertible.length > 0
            ? null
            : Math.round(
                byCurrency.reduce(
                  (t, b) => t + (convertibleAmount(b.amount, b.currency, ctx) ?? 0),
                  0,
                ) * 100,
              ) / 100,
        currency:
          byCurrency.length === 0 || unconvertible.length > 0
            ? null
            : (ctx.revenueCurrency ?? null),
        converted: currencies.some((c) => !sameCurrency(c, ctx.revenueCurrency)),
        currencies,
        unconvertibleCurrencies: unconvertible,
        clientsWithoutPrice: enriched
          .filter((r) => r.firstCycleRevenue === null)
          .reduce((t, r) => t + r.clients, 0),
      };
    })
    .sort((a, b) => (a.variant < b.variant ? -1 : 1));
}

/**
 * Contrôle de cohérence des deux tableaux : les clients du bras ici doivent être
 * ceux de la carte des bras. Les deux agrégats appliquent le même filtre de bras
 * stable et la même définition du nouveau client ; un écart signalerait que l'un
 * des deux a changé de population sans l'autre, ce qui est déjà arrivé deux fois
 * sur ce hub (personnes contre abonnements).
 */
export function purchaseCoherenceIssues(
  arms: readonly AbArmPurchases[],
  paidByVariant: ReadonlyMap<string, number>,
): string[] {
  const issues: string[] = [];
  for (const a of arms) {
    const expected = paidByVariant.get(a.variant);
    if (expected !== undefined && expected !== a.armClients) {
      issues.push(
        `${a.variant} : ${a.armClients} client(s) dans les achats contre ${expected} dans la carte des bras`,
      );
    }
    if (a.doubleCounted < a.armMultiPlan) {
      issues.push(
        `${a.variant} : ${a.doubleCounted} ligne(s) en double pour ${a.armMultiPlan} client(s) multi-plans`,
      );
    }
  }
  return issues;
}

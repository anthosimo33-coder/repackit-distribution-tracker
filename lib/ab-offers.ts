/**
 * TEST A/B — lecture par OFFRE SERVIE. Logique PURE (testée Vitest, aucune dép
 * React ni Convex).
 *
 * ⚠️ CE MODULE EXISTE PARCE QU'UNE CARTE « BRAS A vs BRAS B » MENT DÈS QUE LE
 * CONTENU D'UN BRAS CHANGE. L'expérience courante de Snytch a servi CINQ offres
 * depuis le 08/08 : les deux bras sont passés du mensuel à l'hebdo le 18/08, puis
 * le bras `soft` est repassé au mensuel le 06/09. La carte agrégeait tout ça en
 * deux lignes — un taux du bras `soft` mélangeait donc 16,99 €/mois, 4,99 €/sem
 * et 16,90 €/mois.
 *
 * Deux règles tenues ici :
 *  1. On ne compare QUE des offres de même rythme de facturation. Un hebdo à
 *     9,99 € et un mensuel à 16,90 € n'ont pas le même « client » derrière le
 *     mot client ; les mettre côte à côte dans un revenu par mille produirait un
 *     classement faux, pas un classement incertain.
 *  2. Le revenu affiché est celui du PREMIER CYCLE, jamais annualisé. Annualiser
 *     supposerait une rétention qu'aucune des colonnes ne mesure.
 */

import { formatMoney } from "./format-rate";

export type BillingInterval = "semaine" | "mois";

/** Une ligne de `AbOffersPayload`, réduite à ce dont ce module a besoin. */
export interface AbOfferInput {
  variant: string;
  plan: string;
  price: string;
  attributed: boolean;
  paywallViewers: number;
  checkouts: number;
  paid: number;
  renewals: number;
  firstMs: number | null;
  lastMs: number | null;
}

/** Ce dont ce module a besoin d'un plan Whop (sous-ensemble de PlanEconomics). */
export interface OfferPlanLike {
  price: number | null;
  currency: string | null;
  interval: string | null;
}

export interface AbOffer extends AbOfferInput {
  /**
   * Devise de CETTE offre, retrouvée dans le catalogue Whop. `null` = aucun plan
   * ou plusieurs devises possibles : le montant sort alors sans symbole.
   */
  currency: string | null;
  /** `null` quand le plan n'est pas émis : le rythme est alors INCONNU, pas mensuel. */
  interval: BillingInterval | null;
  /** `null` quand `price` n'est pas émis ou n'est pas un nombre. */
  amount: number | null;
  label: string;
  /** Conversion en % des personnes ayant VU cette offre. `null` si personne. */
  conversionPct: number | null;
  /**
   * Revenu du PREMIER CYCLE pour mille vues de paywall. `null` si le prix n'est
   * pas connu. Ne se compare qu'entre offres de même `interval` (cf. `comparable`).
   */
  firstCycleRevenuePer1000: number | null;
}

/**
 * Rythme de facturation lu dans le nom du plan. Le suffixe est la SEULE source :
 * déduire le rythme du prix (« 16,99 € c'est sûrement du mensuel ») aurait
 * silencieusement rangé le 16,90 €/mois du 06/09 avec l'hebdo à 4,99 €.
 */
export function intervalOfPlan(plan: string): BillingInterval | null {
  if (plan.endsWith("_weekly")) return "semaine";
  if (plan.endsWith("_monthly")) return "mois";
  return null;
}

/** Prix émis → nombre. Chaîne vide, `NaN` ou négatif ⇒ prix INCONNU. */
export function amountOfPrice(price: string): number | null {
  if (price.trim() === "") return null;
  const n = Number(price);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Devise d'une offre servie, lue dans le CATALOGUE WHOP.
 *
 * ⚠️ `properties.price` EST UN NOMBRE NU. Il a longtemps pris la devise du
 * revenu (l'euro) : depuis que le paywall sert une grille par pays, « 599 » et
 * « 1049 » (dinars serbes) s'affichaient 599,00 €/semaine et 1 049,00 €/mois, et
 * les grilles en dollars (11,99, 19,99) passaient pour des euros.
 *
 * Le rapprochement se fait sur (prix, rythme) : une devise n'est retenue que si
 * TOUS les plans Whop à ce prix et ce rythme la partagent. Aucun plan, ou deux
 * devises possibles ⇒ `null`, jamais une devise supposée.
 */
export function offerCurrency(
  plan: string,
  price: string,
  plans: readonly OfferPlanLike[],
): string | null {
  const amount = amountOfPrice(price);
  if (amount === null) return null;
  const interval = intervalOfPlan(plan);
  const devises = new Set(
    plans
      .filter(
        (p) =>
          p.price !== null &&
          Math.abs(p.price - amount) < 0.005 &&
          !!p.currency &&
          (interval === null || p.interval === interval),
      )
      .map((p) => p.currency!.trim().toLowerCase()),
  );
  return devises.size === 1 ? [...devises][0] : null;
}

/**
 * Libellé lisible. Une offre dont le plan manque garde son prix : l'app a un trou
 * d'instrumentation (233 personnes en prod le 06/09 côté `soft`), et masquer la
 * ligne entière pour un champ absent perdrait des conversions bien réelles.
 *
 * `currency` vient du catalogue Whop (cf `offerCurrency`) : `properties.price`
 * est un nombre nu, PostHog n'en transporte pas la devise. Absente, `formatMoney`
 * rend le montant sans symbole — un « € » posé par défaut serait une devise
 * inventée.
 */
export function offerLabel(
  plan: string,
  price: string,
  currency: string | null | undefined,
): string {
  const amount = amountOfPrice(price);
  const interval = intervalOfPlan(plan);
  if (amount === null) return "Offre non identifiée";
  const money = formatMoney(amount, currency);
  return interval === null ? `${money} (rythme non émis)` : `${money}/${interval}`;
}

function enrich(r: AbOfferInput, plans: readonly OfferPlanLike[]): AbOffer {
  const amount = amountOfPrice(r.price);
  const currency = offerCurrency(r.plan, r.price, plans);
  return {
    ...r,
    currency,
    interval: intervalOfPlan(r.plan),
    amount,
    label: offerLabel(r.plan, r.price, currency),
    conversionPct:
      r.paywallViewers > 0
        ? Math.round((r.paid / r.paywallViewers) * 10000) / 100
        : null,
    firstCycleRevenuePer1000:
      amount !== null && r.paywallViewers > 0
        ? Math.round((r.paid / r.paywallViewers) * 1000 * amount * 100) / 100
        : null,
  };
}

/**
 * Offres attribuées, la plus récente d'abord au sein de chaque bras.
 * Les lignes `attributed = false` sont SORTIES d'ici : elles n'ont ni offre ni
 * prix, les afficher comme une offre inventerait un traitement.
 */
export function attributedOffers(
  rows: readonly AbOfferInput[],
  plans: readonly OfferPlanLike[],
): AbOffer[] {
  return rows
    .filter((r) => r.attributed)
    .map((r) => enrich(r, plans))
    .sort((a, b) =>
      a.variant !== b.variant
        ? a.variant < b.variant
          ? -1
          : 1
        : (b.lastMs ?? 0) - (a.lastMs ?? 0),
    );
}

/** Personnes écartées (bras ou offre instable), par bras. Compteur VISIBLE. */
export function excludedViewers(rows: readonly AbOfferInput[]): number {
  return rows
    .filter((r) => !r.attributed)
    .reduce((sum, r) => sum + r.paywallViewers, 0);
}

/**
 * L'offre EN COURS de chaque bras — celle dont la dernière vue de paywall est la
 * plus récente. C'est la réponse à « qu'est-ce qu'on sert en ce moment ? », et
 * elle se met à jour toute seule au prochain changement.
 */
export function currentOfferByArm(
  rows: readonly AbOfferInput[],
  plans: readonly OfferPlanLike[],
): Map<string, AbOffer> {
  const out = new Map<string, AbOffer>();
  for (const o of attributedOffers(rows, plans)) {
    if (o.lastMs === null) continue;
    const prev = out.get(o.variant);
    if (prev === undefined || (prev.lastMs ?? 0) < o.lastMs) out.set(o.variant, o);
  }
  return out;
}

export interface ArmComparability {
  /** L'offre servie en ce moment par chaque bras, triée par bras. */
  current: AbOffer[];
  /**
   * Faux dès que les bras servent des rythmes de facturation différents, ou que
   * l'un d'eux sert un rythme inconnu. Le test ne mesure alors plus un prix, il
   * mélange prix et rythme — deux effets qu'aucune colonne ne sépare.
   */
  comparable: boolean;
  /** Rythmes servis, dédupliqués et triés — de quoi écrire l'avertissement. */
  intervals: (BillingInterval | null)[];
}

export function armComparability(
  rows: readonly AbOfferInput[],
  plans: readonly OfferPlanLike[],
): ArmComparability {
  const current = [...currentOfferByArm(rows, plans).values()].sort((a, b) =>
    a.variant < b.variant ? -1 : 1,
  );
  const intervals = [...new Set(current.map((o) => o.interval))];
  return {
    current,
    // Un seul bras servi n'est pas une comparaison douteuse, c'est une
    // comparaison absente : on ne l'alerte pas ici (la carte des bras le dit).
    comparable:
      current.length < 2 || (intervals.length === 1 && intervals[0] !== null),
    intervals,
  };
}

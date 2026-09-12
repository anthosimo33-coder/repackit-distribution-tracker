// Import RELATIF, pas l'alias `@/` : vitest ne le résout pas pour un import
// de VALEUR (cf lib/creator-schedule, même idiome).
import { VALUE_DAYS, SURVIVAL_DAYS } from "../convex/marketValue";

/**
 * UN MARCHÉ, SEUL OU COMPOSÉ — la seule division de tout l'écran.
 *
 * Le serveur ne rend que des SOMMES et des EFFECTIFS (cf convex/marketValue).
 * Ici on additionne les pays d'un marché, puis on divise UNE FOIS. C'est ce qui
 * rend un marché composé exact : « Serbie + Croatie » n'est pas la moyenne de
 * deux moyennes — sinon la France (147 clients) pèserait autant que le
 * Luxembourg (1).
 *
 * La même fonction sert au pays seul (un marché d'un pays) et à l'aperçu du
 * composeur avant enregistrement : une seule dérivation, donc rien qui puisse
 * diverger entre ce qu'on prévisualise et ce qu'on obtient.
 *
 * ── DEUX HORLOGES, ET IL FAUT LE SAVOIR ─────────────────────────────────────
 * Le coût, le revenu et les clients acquis sont bornés par la PÉRIODE choisie.
 * Les valeurs de cohorte (à J+30, J+90) et la survie portent sur TOUT
 * l'historique : elles décrivent le marché, pas la fenêtre. Le coût par client
 * confronte donc une dépense de période à une valeur de cohorte — c'est voulu
 * (« ce qu'un client me coûte aujourd'hui contre ce qu'il vaut »), et l'écran
 * doit le dire.
 */

/** Effectif minimal pour qu'une valeur de cohorte soit affichée. */
export const MIN_MATURE = 5;
/** Effectif minimal pour qu'un taux de conversion se lise (cf country-traffic). */
export const MIN_VISITORS = 30;

/** Les faits d'UN pays, tels que le serveur les rend. Aucune moyenne. */
export type MarketFacts = {
  country: string | null;
  /** ── Ce qu'on y met, sur la PÉRIODE ── */
  /** Ids des créatrices qui visent ce marché — des ids pour pouvoir les UNIR
   *  sans double compte : une créatrice qui vise deux pays n'est qu'une. */
  creatorIds: string[];
  videos: number;
  /** Coût en devise de PAIE (dollars) — pour l'afficher tel quel. */
  cost: number;
  /** Le même coût converti en devise de REVENU, ou `null` si aucun taux n'est
   *  réglé : soustraire des dollars à des euros ne veut rien dire. */
  costComparable: number | null;
  /** ── Ce que ça rapporte, sur la PÉRIODE ── */
  clients: number;
  payments: number;
  revenueNet: number;
  previousClients: number;
  previousRevenueNet: number;
  /** ── Les cohortes, sur TOUT l'historique ── */
  cohortClients: number;
  curve: { day: number; sum: number; mature: number }[];
  survival: { day: number; alive: number; mature: number }[];
  /** ── Le trafic, population PostHog (pays de CONNEXION) ── */
  visitors: number;
  trafficClients: number;
  /** ── Ce qu'ils achètent ── */
  plans: { planId: string; label: string | null; price: number; clients: number }[];
};

export type ValeurCohorte = {
  day: number;
  /** Somme ÷ effectif mûr, ou `null` sous le seuil d'effectif. */
  value: number | null;
  mature: number;
};

export type Remboursement = {
  /** Jour où la valeur rattrape le coût d'acquisition. */
  day: number | null;
  /**
   * `gratuit`  — rien n'est investi sur ce marché, il n'y a rien à rembourser ;
   * `ok`       — la valeur a rattrapé le coût ;
   * `jamais`   — pas dans les jalons mesurés (≠ « jamais » au sens absolu) ;
   * `inconnu`  — aucun client, ou coût non convertible : pas de verdict.
   */
  state: "gratuit" | "ok" | "jamais" | "inconnu";
};

export type MarketDerived = {
  /** Clé stable : le code pays, ou `g:<id>` pour un marché composé. */
  key: string;
  label: string;
  countries: (string | null)[];
  composed: boolean;
  creators: number;
  videos: number;
  cost: number;
  costComparable: number | null;
  clients: number;
  payments: number;
  revenueNet: number;
  /** Coût d'acquisition d'un client. `null` sans client ou sans taux. */
  cac: number | null;
  /** Revenu net ÷ paiements encaissés. */
  basket: number | null;
  /** Paiements ÷ clients acquis. */
  cycles: number | null;
  /** Un point par jalon de `VALUE_DAYS`. */
  value: ValeurCohorte[];
  /** Un point par jalon de `SURVIVAL_DAYS`, taux `null` sous le seuil. */
  survival: { day: number; rate: number | null; mature: number }[];
  /** Revenu net ÷ coût. `null` si rien n'est investi ou sans taux. */
  retour: number | null;
  payback: Remboursement;
  /** Variation relative vs période précédente. `null` = rien avant (nouveau). */
  deltaClients: number | null;
  deltaRevenue: number | null;
  visitors: number;
  trafficClients: number;
  /** Clients ÷ visiteurs, `null` sous le seuil d'effectif. */
  conversion: number | null;
  /** Part de chaque plan dans les clients, du moins cher au plus cher. */
  plans: { planId: string; label: string | null; price: number; share: number }[];
};

const arrondi2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Additionne des pays, puis dérive. `label` et `key` sont donnés par l'appelant
 * — c'est lui qui sait s'il compose un marché ou rend un pays seul.
 */
export function aggregateMarket(
  faits: readonly MarketFacts[],
  opts: { key: string; label: string; composed: boolean },
): MarketDerived {
  const somme = (f: (m: MarketFacts) => number) =>
    faits.reduce((s, m) => s + f(m), 0);

  // UNION des créatrices, jamais une somme : celle qui vise deux pays d'un même
  // marché composé ne doit pas y compter double.
  const creatrices = new Set<string>();
  for (const m of faits) for (const id of m.creatorIds) creatrices.add(id);

  const cost = somme((m) => m.cost);
  // Le coût comparable n'existe que si TOUS les membres le sont : un total à
  // moitié converti serait un nombre sans unité.
  const tousComparables = faits.length > 0 && faits.every((m) => m.costComparable !== null);
  const costComparable = tousComparables ? somme((m) => m.costComparable ?? 0) : null;

  const clients = somme((m) => m.clients);
  const payments = somme((m) => m.payments);
  const revenueNet = arrondi2(somme((m) => m.revenueNet));
  const clientsAvant = somme((m) => m.previousClients);
  const revenuAvant = somme((m) => m.previousRevenueNet);

  // ── Valeurs de cohorte : on somme les sommes ET les effectifs, puis on divise.
  const value: ValeurCohorte[] = VALUE_DAYS.map((day, i) => {
    const sum = somme((m) => m.curve[i]?.sum ?? 0);
    const mature = somme((m) => m.curve[i]?.mature ?? 0);
    return { day, value: mature >= MIN_MATURE ? sum / mature : null, mature };
  });

  const survival = SURVIVAL_DAYS.map((day, i) => {
    const alive = somme((m) => m.survival[i]?.alive ?? 0);
    const mature = somme((m) => m.survival[i]?.mature ?? 0);
    return { day, rate: mature >= MIN_MATURE ? alive / mature : null, mature };
  });

  const cac =
    costComparable === null || clients === 0 ? null : costComparable / clients;

  const visitors = somme((m) => m.visitors);
  const trafficClients = somme((m) => m.trafficClients);

  return {
    key: opts.key,
    label: opts.label,
    countries: faits.map((m) => m.country),
    composed: opts.composed,
    creators: creatrices.size,
    videos: somme((m) => m.videos),
    cost: arrondi2(cost),
    costComparable: costComparable === null ? null : arrondi2(costComparable),
    clients,
    payments,
    revenueNet,
    cac,
    basket: payments > 0 ? revenueNet / payments : null,
    cycles: clients > 0 ? payments / clients : null,
    value,
    survival,
    retour:
      costComparable === null || costComparable <= 0 ? null : revenueNet / costComparable,
    payback: remboursement(value, cac, clients),
    deltaClients: clientsAvant > 0 ? (clients - clientsAvant) / clientsAvant : null,
    deltaRevenue: revenuAvant > 0 ? (revenueNet - revenuAvant) / revenuAvant : null,
    visitors,
    trafficClients,
    conversion: visitors >= MIN_VISITORS ? trafficClients / visitors : null,
    plans: fusionPlans(faits),
  };
}

/**
 * LE JOUR OÙ UN CLIENT A REMBOURSÉ CE QU'IL A COÛTÉ.
 *
 * Interpolé entre les deux jalons qui encadrent le franchissement : les jalons
 * sont espacés de quinze jours, et annoncer « J+30 » pour un seuil franchi le
 * 16 serait une fausse précision dans l'autre sens.
 *
 * ⚠️ `jamais` veut dire « pas dans les 90 jours mesurés », pas « jamais ». Un
 * jalon sans effectif suffisant est SAUTÉ, pas lu comme un échec : sous le
 * seuil, on ne sait pas, et ne pas savoir n'est pas une mauvaise nouvelle.
 */
export function remboursement(
  value: readonly ValeurCohorte[],
  cac: number | null,
  clients: number,
): Remboursement {
  if (clients === 0) return { day: null, state: "inconnu" };
  if (cac === null) return { day: null, state: "inconnu" };
  // Rien n'est investi : il n'y a rien à rembourser, et ce n'est pas « 0 jour
  // pour rembourser 0 € » — c'est une autre catégorie, que l'écran affiche
  // autrement (« aucun investissement ciblé »).
  if (cac <= 0) return { day: 0, state: "gratuit" };

  const connus = value.filter((v) => v.value !== null) as (ValeurCohorte & {
    value: number;
  })[];
  if (connus.length === 0) return { day: null, state: "inconnu" };

  for (let i = 0; i < connus.length; i++) {
    if (connus[i].value < cac) continue;
    if (i === 0) return { day: connus[0].day, state: "ok" };
    const av = connus[i - 1];
    const ap = connus[i];
    const part = ap.value === av.value ? 0 : (cac - av.value) / (ap.value - av.value);
    return {
      day: Math.round(av.day + part * (ap.day - av.day)),
      state: "ok",
    };
  }
  return { day: null, state: "jamais" };
}

/** Part de chaque plan dans les clients du marché, du moins cher au plus cher. */
function fusionPlans(faits: readonly MarketFacts[]) {
  const t = new Map<string, { planId: string; label: string | null; price: number; clients: number }>();
  for (const m of faits) {
    for (const p of m.plans) {
      const vu = t.get(p.planId);
      if (vu) vu.clients += p.clients;
      else t.set(p.planId, { ...p });
    }
  }
  const total = [...t.values()].reduce((s, p) => s + p.clients, 0);
  return [...t.values()]
    .sort((a, b) => a.price - b.price || b.clients - a.clients)
    .map((p) => ({
      planId: p.planId,
      label: p.label,
      price: p.price,
      share: total > 0 ? p.clients / total : 0,
    }));
}

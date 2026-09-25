/**
 * L'ONGLET PAYS, DES AGRÉGATS AUX MARCHÉS — logique PURE.
 *
 * Ce qui vivait dans le composant (PaysTab : `factsOf`, `stepsOf`, la dérivation
 * `marches`, les totaux, la série mensuelle) vit ici pour que l'outil MCP
 * `marches` rende les MÊMES marchés, dans le même ordre, avec le même verdict :
 * le runtime Convex n'importe rien de components/ ni de lib/ (règle A6).
 * L'écran appelle ces fonctions et n'en garde que l'affichage.
 *
 * Les LIBELLÉS (nom d'un pays, « Aucun pays défini ») sont du texte d'écran :
 * ils sont PASSÉS, jamais écrits ici.
 *
 * Deux populations, jamais divisées l'une par l'autre : l'ARGENT (pays de
 * facturation, Whop) et le TRAFIC (pays de connexion, PostHog). Elles sont
 * posées côte à côte parce que c'est la décision qu'on prend (« j'investis ici,
 * ça rapporte ça »).
 */

import { toDisplayAmount, type CurrencyContext } from "./currencyRate";
import { aggregateMarket, type MarketDerived, type MarketFacts } from "./marketAggregate";
import { decideMarket, type MarketDecision, type MarketVerdict } from "./marketDecision";
import type { MarketRow, MarketTrendPoint, PlanCountryCell } from "./marketPnl";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Un marché, avec son verdict — une ligne du tableau de décision. */
export type DecidedMarket = MarketDerived & { decision: MarketDecision };

/** Ce que l'écran et l'outil lisent de `getMarketPnl`. */
export type MarketPnlLike = {
  whopConfigured: boolean;
  payCurrency: string | null;
  revenueCurrency: string | null;
  fxRateToRevenue: number | null;
  rows: MarketRow[];
  planCells: PlanCountryCell[];
  trend: MarketTrendPoint[];
};

/** Étapes d'un pays, telles que `countryPersons` (PostHog) les rend. */
export type FunnelSegments = {
  segments: { key: string; steps: { key: string; count: number }[] }[];
};

/** Trafic d'un pays (pays de CONNEXION, PostHog). */
export type EtapesPays = {
  country: string;
  visitors: number;
  paywall: number;
  checkouts: number;
  clients: number;
};

export function stepsOf(segments: FunnelSegments | undefined): EtapesPays[] {
  return (segments?.segments ?? []).map((seg) => {
    const n = (k: string) => seg.steps.find((x) => x.key === k)?.count ?? 0;
    return {
      country: seg.key,
      visitors: n("visit"),
      paywall: n("paywall_viewed"),
      checkouts: n("checkout_started"),
      clients: n("subscription_completed"),
    };
  });
}

/** Contexte devises de l'onglet : la paie, le revenu, et le taux qui les relie. */
export function contexteDevises(pnl: MarketPnlLike | undefined | null): CurrencyContext {
  return {
    payCurrency: pnl?.payCurrency,
    revenueCurrency: pnl?.revenueCurrency,
    fxRateToRevenue: pnl?.fxRateToRevenue,
  };
}

/**
 * DU SERVEUR À L'AGRÉGATION — le pont, et les deux populations qu'il respecte.
 *
 * Le coût est converti ICI, une fois : `marketAggregate` reçoit un montant déjà
 * comparable au revenu, ou `null` quand aucun taux n'est réglé. Sans ce `null`,
 * un ratio euros/dollars sortirait un nombre sans unité.
 */
export function factsOf(
  r: MarketRow,
  ctx: CurrencyContext,
  trafic: Map<string, EtapesPays>,
  plans: PlanCountryCell[],
): MarketFacts {
  const converti = toDisplayAmount(r.cost, ctx);
  const promoConverti = toDisplayAmount(r.promoCost, ctx);
  const t = r.country === null ? undefined : trafic.get(r.country);
  return {
    country: r.country,
    creatorIds: r.creatorIds,
    videos: r.videos,
    cost: r.cost,
    costComparable: converti !== null && converti.rate !== null ? converti.value : null,
    clients: r.clients,
    payments: r.paid,
    revenueNet: r.revenueNet,
    previousClients: r.previousClients,
    previousRevenueNet: r.previousRevenueNet,
    cohortClients: r.cohortClients,
    curve: r.curve,
    survival: r.survival,
    visitors: t?.visitors ?? 0,
    trafficClients: t?.clients ?? 0,
    checkouts: t?.checkouts ?? 0,
    promoCost: r.promoCost,
    promoCostComparable:
      promoConverti !== null && promoConverti.rate !== null ? promoConverti.value : null,
    promoViews: r.promoViews,
    creatorsDetail: r.creatorsDetail,
    plans: plans
      .filter((c) => c.country === r.country)
      .map((c) => ({
        planId: c.planId,
        label: c.planLabel,
        price: c.price,
        clients: c.clients,
        localPrice: c.localPrice,
      })),
  };
}

/** Un marché composé, tel que l'équipe l'a défini (« Balkans » = RS + HR…). */
export type MarcheCompose = {
  /** Identifiant stable — `Id<"marketGroups">` côté serveur, une chaîne ici. */
  id: string;
  nom: string;
  /** Codes pays, tels que le revenu et le coût les portent. */
  pays: string[];
};

/**
 * LA PARTITION : les marchés composés, puis chaque pays restant seul.
 *
 * Rend des GROUPES de codes, pas des données — l'agrégation, elle, vit dans
 * `marketAggregate`. Séparer les deux permet de tester la partition sans
 * fabriquer de chiffres, et l'agrégation sans fabriquer de marchés.
 *
 * L'ORDRE est stable : les marchés composés d'abord, dans l'ordre où ils ont été
 * créés, puis les pays isolés dans l'ordre où ils arrivent. L'écran trie ensuite
 * sur ce qu'il montre ; ce qu'on garantit ici, c'est qu'un même état rend
 * toujours la même liste.
 */
export function partitionMarches(
  paysConnus: readonly string[],
  marches: readonly MarcheCompose[],
): { key: string; label: string; pays: string[]; composed: boolean }[] {
  const pris = new Set<string>();
  const out: { key: string; label: string; pays: string[]; composed: boolean }[] = [];

  for (const m of marches) {
    // ⚠️ On ne garde que les pays RÉELLEMENT connus des données. Un marché qui
    // référence un pays disparu (renommé chez Whop, plus aucun paiement) doit
    // rendre ce qu'il reste, pas une ligne fantôme ni une erreur.
    const membres = m.pays.filter((p) => paysConnus.includes(p));
    for (const p of membres) pris.add(p);
    out.push({ key: `g:${m.id}`, label: m.nom, pays: membres, composed: true });
  }
  for (const p of paysConnus) {
    if (pris.has(p)) continue;
    out.push({ key: p, label: p, pays: [p], composed: false });
  }
  return out;
}

/** Ordre des lignes : ce qu'il faut faire d'abord. */
export const ORDRE_VERDICT: MarketVerdict[] = [
  "accelerer",
  "reparer",
  "surveiller",
  "couper",
  "trop_tot",
  "sans_depense",
  "inconnu",
];

/**
 * LES MARCHÉS DÉRIVÉS — un par pays, ou un par marché composé, avec leur verdict,
 * triés par ce qu'il faut faire puis par retour d'acquisition. La ligne « hors
 * marché » (coût sans pays cible) ferme toujours la liste.
 *
 * Un pays seul et un marché de cinq pays passent par la MÊME dérivation, donc
 * par les mêmes seuils d'effectif.
 */
export function deriverMarches(e: {
  pnl: MarketPnlLike | undefined | null;
  traffic: FunnelSegments | undefined;
  groups: MarcheCompose[] | undefined;
  maille: "pays" | "marche";
  /** Libellé d'un pays à partir de son code (texte d'écran). */
  libellePays: (code: string) => string;
  /** Libellé de la ligne sans pays cible (texte d'écran). */
  libelleHorsMarche: string;
}): DecidedMarket[] {
  const ctx = contexteDevises(e.pnl);
  const trafic = new Map(stepsOf(e.traffic).map((t) => [t.country, t]));
  const cells = e.pnl?.planCells ?? [];
  const parPays = new Map(
    (e.pnl?.rows ?? []).map((r) => [r.country ?? "", factsOf(r, ctx, trafic, cells)]),
  );
  const codes = (e.pnl?.rows ?? [])
    .map((r) => r.country)
    .filter((c): c is string => c !== null);

  // Par pays : la partition n'est pas consultée du tout. Passer une liste vide
  // de marchés rendrait le même résultat, mais le dire explicitement évite de
  // se demander plus tard si la bascule a un effet de bord.
  const groupes =
    e.maille === "pays"
      ? codes.map((c) => ({ key: c, label: c, pays: [c], composed: false }))
      : partitionMarches(codes, e.groups ?? []);

  const derives = groupes
    // Un marché dont tous les pays ont disparu des données n'a rien à montrer
    // ici. Il reste modifiable dans le composeur, qui, lui, le garde visible.
    .filter((g) => g.pays.length > 0)
    .map((g) =>
      aggregateMarket(
        g.pays.map((c) => parPays.get(c)!).filter(Boolean),
        {
          key: g.key,
          label: g.composed ? g.label : e.libellePays(g.label),
          composed: g.composed,
        },
      ),
    );

  // La ligne « hors marché » (coût sans pays cible) n'est PAS un marché : elle
  // ne se compose avec rien et garde sa place, comme avant.
  const horsMarche = parPays.get("");
  if (horsMarche) {
    derives.push(
      aggregateMarket([horsMarche], {
        key: "",
        label: e.libelleHorsMarche,
        composed: false,
      }),
    );
  }

  return derives
    .map((m) => ({ ...m, decision: decideMarket(m) }))
    .sort((a, b) => {
      if (a.key === "") return 1;
      if (b.key === "") return -1;
      const va = ORDRE_VERDICT.indexOf(a.decision.verdict);
      const vb = ORDRE_VERDICT.indexOf(b.decision.verdict);
      if (va !== vb) return va - vb;
      return (b.acquisitionReturn ?? -1) - (a.acquisitionReturn ?? -1);
    });
}

/**
 * Lignes PAR PAYS avec leur marge, et les totaux. Marge = revenu − coût, en
 * devise d'AFFICHAGE, seulement si le coût a pu être converti. La ligne sans
 * pays n'a pas de marge (rien à quoi comparer), mais le TOTAL porte son coût :
 * c'est la marge réelle.
 */
export function lignesEtTotaux(pnl: MarketPnlLike | undefined | null) {
  const ctx = contexteDevises(pnl);
  const lignes = [...(pnl?.rows ?? [])]
    .map((r) => {
      const coutAffiche = toDisplayAmount(r.cost, ctx);
      const coutComparable =
        coutAffiche !== null && coutAffiche.rate !== null ? coutAffiche.value : null;
      const marge =
        r.country === null || coutComparable === null || !pnl?.whopConfigured
          ? null
          : round2(r.revenueNet - coutComparable);
      return { ...r, marge };
    })
    .sort((a, b) => (b.marge ?? -Infinity) - (a.marge ?? -Infinity));
  const totalCost = lignes.reduce((s, r) => s + r.cost, 0);
  const totalRevenue = lignes.reduce((s, r) => s + r.revenueNet, 0);
  const totalCoutAffiche = toDisplayAmount(totalCost, ctx);
  const totalMarge =
    pnl?.whopConfigured && totalCoutAffiche !== null && totalCoutAffiche.rate !== null
      ? round2(totalRevenue - totalCoutAffiche.value)
      : null;
  return { lignes, totalCost, totalRevenue, totalMarge };
}

/**
 * La série mensuelle, TOUS MARCHÉS : « est-ce que ça s'améliore », pas « où ».
 * L'écart n'est calculé que si le coût a pu être converti.
 */
export function serieMensuelle(pnl: MarketPnlLike) {
  const ctx = contexteDevises(pnl);
  const parMois = new Map<string, { cost: number; revenueNet: number }>();
  for (const p of pnl.trend) {
    const d = parMois.get(p.month) ?? { cost: 0, revenueNet: 0 };
    d.cost = round2(d.cost + p.cost);
    d.revenueNet = round2(d.revenueNet + p.revenueNet);
    parMois.set(p.month, d);
  }
  return [...parMois.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => {
      const converti = toDisplayAmount(d.cost, ctx);
      return {
        month,
        ...d,
        ecart:
          converti !== null && converti.rate !== null
            ? round2(d.revenueNet - converti.value)
            : null,
      };
    });
}

/**
 * DÉTAIL PAR JOUR — le calcul pur derrière `getDayDetail` (Vue d'ensemble,
 * lignes dépliables du tableau « Détail par jour ») : l'argent par (jour, ref),
 * par (jour, pays de facturation) et la décomposition du revenu du jour.
 *
 * Sorti de la query pour être testé sur des paiements réels (lib/
 * day-detail-money.test.ts) : la query ne fait plus que lire la base.
 *
 * ⚠️ DEVISES. Le net d'un paiement est exprimé dans la devise DU PAIEMENT. Ce
 * détail additionnait donc des dinars serbes, des dollars et des euros : le
 * 08/10/2026 sur Snytch, une échéance de 1 049 RSD (≈ 8,94 €) s'ajoutait telle
 * quelle aux euros de sa ref. Chaque montant est désormais ramené à la devise
 * du revenu par le MÊME référentiel que la colonne « Revenu net » du tableau
 * (`summarizeWhopRevenue` sur tous les paiements du projet, au taux du projet) :
 * la somme des refs d'un jour retombe sur le net affiché pour ce jour.
 *
 * Une devise encaissée SANS taux laisse le revenu non additionnable (garde A5) :
 * tout montant qui aurait porté de l'argent passe à `null`, jamais à une somme
 * de devises. Un vrai zéro (rien encaissé) reste 0.
 */
import {
  amountInReferenceCurrency,
  summarizeWhopRevenue,
  whopCollectedAmount,
  whopNetContribution,
  whopNetInSummaryCurrency,
  type WhopConversion,
  type WhopFx,
  type WhopPaymentLike,
} from "./whopRevenue";

export interface DayDetailPaymentLike extends WhopPaymentLike {
  paidAt: number;
  membershipId?: string;
  billingCountry?: string;
}

/** Une ligne de `creatorConversions` : le trafic d'un (jour, ref). */
export interface DayDetailTraffic {
  date: string;
  ref?: string;
  visitors?: number;
  signups?: number;
}

export interface DayDetailRefRow {
  day: string;
  ref: string;
  /** null = trafic PAS ENCORE COLLECTÉ ce jour-là (cf lib/day-detail). */
  visitors: number | null;
  signups: number | null;
  clients: number;
  renewals: number;
  failures: number;
  /** Net dans `currency` ; null = encaissé mais non additionnable (A5). */
  net: number | null;
}

export interface DayDetailBillingRow {
  day: string;
  country: string | null;
  clients: number;
  renewals: number;
  failures: number;
  /** Net dans `currency` ; null = encaissé mais non additionnable (A5). */
  net: number | null;
}

export interface DayDetailRevenueRow {
  day: string;
  /** Montants dans `currency` ; null = présents mais non additionnables (A5). */
  newNet: number | null;
  renewalNet: number | null;
  refunded: number | null;
  /** Devises des paiements qui portent de l'argent ce jour-là (minuscules). */
  currencies: string[];
  /**
   * Devises de remboursements que le référentiel ne sait pas exprimer (présentes,
   * jamais encaissées, sans conversion) : EXCLUES de `refunded`, comme dans
   * `summarizeWhopRevenue` — l'écran le signale.
   */
  excludedCurrencies: string[];
}

export interface DayDetailMoney {
  refs: DayDetailRefRow[];
  revenue: DayDetailRevenueRow[];
  billingCountries: DayDetailBillingRow[];
  /** Devise de tous les montants ; null si aucune encaissée ou non convertibles. */
  currency: string | null;
  /** Devises ENCAISSÉES, avant conversion. */
  currencies: string[];
  /** true = plusieurs devises encaissées sans taux pour les ramener à une seule. */
  mixedCurrency: boolean;
  /** Devises ramenées à `currency` au taux du projet — l'écran DOIT le dire. */
  conversions: WhopConversion[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Additionne dans la devise du référentiel ; `null` est absorbant (A5). */
const add = (acc: number | null, x: number | null): number | null =>
  acc === null || x === null ? null : round2(acc + x);

/** Jour « métier » Europe/Paris d'un timestamp (ms) → "YYYY-MM-DD". */
function parisDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
  }).format(new Date(ms));
}

const currencyKey = (p: { currency?: string }): string =>
  p.currency?.trim().toLowerCase() || "(inconnue)";

export function dayDetailOf(input: {
  traffic: readonly DayDetailTraffic[];
  payments: readonly DayDetailPaymentLike[];
  /** membership Whop → ref normalisée (null = aucune). */
  refOf: ReadonlyMap<string, string | null>;
  /** Étiquette du trafic et de l'argent qu'aucune ref ne revendique. */
  sansSource: string;
  /** Taux du projet (`projectFx`). */
  fx: WhopFx | null;
}): DayDetailMoney {
  const { payments, refOf, sansSource } = input;
  // Référentiel de change : celui de la colonne « Revenu net » (getRevenue), sur
  // le même lot — tous les paiements du projet.
  const ref = summarizeWhopRevenue([...payments], input.fx);
  const mixed = ref.mixedCurrency;

  const refs = new Map<string, DayDetailRefRow>();
  const touch = (day: string, r: string): DayDetailRefRow => {
    const k = `${day}|${r}`;
    const cur = refs.get(k) ?? {
      day,
      ref: r,
      // Le trafic démarre à NULL : une ref créée par un paiement Whop n'a pas
      // de trafic collecté tant que le cron de 23 h n'est pas passé. Un 0
      // initial aurait affiché « 0 visiteur » pour une journée non collectée.
      visitors: null,
      signups: null,
      clients: 0,
      renewals: 0,
      failures: 0,
      net: 0,
    };
    refs.set(k, cur);
    return cur;
  };
  for (const r of input.traffic) {
    const a = touch(r.date, r.ref ?? sansSource);
    // Une ligne collectée fait passer le trafic de « inconnu » à une MESURE —
    // y compris quand elle vaut zéro.
    if (r.visitors !== undefined) a.visitors = (a.visitors ?? 0) + r.visitors;
    if (r.signups !== undefined) a.signups = (a.signups ?? 0) + r.signups;
  }

  type RevenueAcc = Omit<DayDetailRevenueRow, "currencies" | "excludedCurrencies"> & {
    currencies: Set<string>;
    excludedCurrencies: Set<string>;
  };
  const revenue = new Map<string, RevenueAcc>();
  /**
   * Argent par (jour, PAYS DE FACTURATION). Groupe SÉPARÉ du trafic par pays
   * de connexion : deux notions, deux populations. Les réunir sur une même
   * ligne inviterait à diviser des clients par des visiteurs.
   */
  const billing = new Map<string, DayDetailBillingRow>();
  const touchBilling = (day: string, country: string | undefined) => {
    const k = `${day}|${country ?? ""}`;
    const cur = billing.get(k) ?? {
      day,
      country: country ?? null,
      clients: 0,
      renewals: 0,
      failures: 0,
      net: 0,
    };
    billing.set(k, cur);
    return cur;
  };

  // 1er paiement encaissé par abonnement : un NOUVEAU client compte le jour
  // de celui-là, jamais d'un renouvellement (cf getReliability).
  const firstPaid = new Map<string, number>();
  for (const p of payments) {
    if (!p.membershipId || whopCollectedAmount(p) <= 0) continue;
    const prev = firstPaid.get(p.membershipId);
    if (prev === undefined || p.paidAt < prev) firstPaid.set(p.membershipId, p.paidAt);
  }
  for (const p of payments) {
    const day = parisDay(p.paidAt);
    const r = p.membershipId ? (refOf.get(p.membershipId) ?? null) : null;
    const a = touch(day, r ?? sansSource);
    if (p.status === "failed") {
      a.failures += 1;
      touchBilling(day, p.billingCountry).failures += 1;
      continue;
    }
    const rev = revenue.get(day) ?? {
      day,
      newNet: 0,
      renewalNet: 0,
      refunded: 0,
      currencies: new Set<string>(),
      excludedCurrencies: new Set<string>(),
    };
    revenue.set(day, rev);
    const rembourse = Math.max(0, p.refundedAmount ?? 0);
    if (rembourse > 0) {
      rev.currencies.add(currencyKey(p));
      if (mixed) rev.refunded = null;
      else {
        const converti = amountInReferenceCurrency(rembourse, p, ref);
        if (converti === null) rev.excludedCurrencies.add(currencyKey(p));
        else rev.refunded = add(rev.refunded, converti);
      }
    }
    // Le CLASSEMENT (client, renouvellement) se décide sur le net brut : un
    // petit montant converti arrondi à 0 ne doit pas faire disparaître un client.
    if (whopNetContribution(p) <= 0) continue;
    rev.currencies.add(currencyKey(p));
    // Montant dans la devise du référentiel ; null si non additionnable.
    const net = mixed ? null : whopNetInSummaryCurrency(p, ref);
    a.net = add(a.net, net);
    const estNouveau =
      p.membershipId !== undefined && firstPaid.get(p.membershipId) === p.paidAt;
    const b = touchBilling(day, p.billingCountry);
    b.net = add(b.net, net);
    if (estNouveau) {
      a.clients += 1;
      b.clients += 1;
      rev.newNet = add(rev.newNet, net);
    } else {
      a.renewals += 1;
      b.renewals += 1;
      rev.renewalNet = add(rev.renewalNet, net);
    }
  }

  return {
    refs: [...refs.values()],
    revenue: [...revenue.values()].map((r) => ({
      ...r,
      currencies: [...r.currencies].sort(),
      excludedCurrencies: [...r.excludedCurrencies].sort(),
    })),
    billingCountries: [...billing.values()],
    currency: mixed ? null : ref.currency,
    currencies: ref.currencies,
    mixedCurrency: mixed,
    conversions: ref.conversions,
  };
}

/**
 * VENTES PAR PAYS DE FACTURATION — le calcul pur derrière le second tableau de
 * Parcours (`getBillingCountriesCore`) et l'outil MCP `parcours`.
 *
 * Sorti de la query pour être testé sur des paiements réels (lib/
 * billing-countries.test.ts) : la query ne fait plus que lire la base.
 *
 * ⚠️ DEVISES. Le net d'un paiement est exprimé dans la devise DU PAIEMENT. Ce
 * tableau additionnait donc des dinars serbes, des dollars et des euros, puis
 * TRIAIT sur ces sommes : le 08/10/2026, la Serbie (3 238,76 RSD ≈ 28 €) sortait
 * 2ᵉ pays de Snytch, devant des pays payés en euros dix fois plus gros. Chaque
 * paiement est désormais ramené à la devise du revenu au taux du projet — le
 * même référentiel que Revenus, Rentabilité et Économie unitaire. Une devise
 * encaissée SANS taux laisse le revenu non additionnable (garde A5) : le net
 * passe alors à `null`, jamais à une somme de devises.
 */
import {
  summarizeWhopRevenue,
  whopCollectedAmount,
  whopNetInSummaryCurrency,
  type WhopConversion,
  type WhopFx,
  type WhopPaymentLike,
} from "./whopRevenue";

export interface BillingPaymentLike extends WhopPaymentLike {
  paidAt: number;
  membershipId?: string;
  billingCountry?: string;
}

export interface BillingCountryRow {
  country: string | null;
  clients: number;
  renewals: number;
  failures: number;
  /**
   * Revenu net du pays dans `currency`, conversion faite. `null` = devises
   * encaissées non convertibles : une somme serait un mélange, pas un montant.
   */
  net: number | null;
}

export interface BillingCountries {
  /** Du plus gros revenu (converti) au plus petit, puis par clients. */
  rows: BillingCountryRow[];
  payments: number;
  withCountry: number;
  clients: number;
  clientsWithCountry: number;
  /** Devise de `net` ; null si aucune encaissée ou si non convertibles. */
  currency: string | null;
  /** Devises ENCAISSÉES, avant conversion — ce que l'écran nomme. */
  currencies: string[];
  /** true = plusieurs devises encaissées sans taux pour les ramener à une seule. */
  mixedCurrency: boolean;
  /** Devises ramenées à `currency` au taux du projet — l'écran DOIT le dire. */
  conversions: WhopConversion[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * `userOf` : membership Whop → personne Whop. Un client est rattaché au pays de
 * son PREMIER paiement encaissé (cf getBillingCountriesCore).
 */
export function billingCountriesOf(
  payments: BillingPaymentLike[],
  userOf: ReadonlyMap<string, string>,
  fx: WhopFx | null,
): BillingCountries {
  // Référentiel de change du lot : sa devise et les taux qui y ramènent les
  // autres — le même résumé que l'écran Revenus.
  const ref = summarizeWhopRevenue(payments, fx);
  const personOf = (membershipId: string): string =>
    userOf.get(membershipId) ?? `mem:${membershipId}`;

  // Pays d'un client = celui de son PREMIER paiement encaissé.
  const first = new Map<string, { at: number; country?: string }>();
  for (const p of payments) {
    if (!p.membershipId || whopCollectedAmount(p) <= 0) continue;
    const u = personOf(p.membershipId);
    const prev = first.get(u);
    if (prev === undefined || p.paidAt < prev.at) {
      first.set(u, { at: p.paidAt, country: p.billingCountry });
    }
  }

  const rows = new Map<string, BillingCountryRow & { net: number }>();
  const touch = (c: string | undefined) => {
    const k = c ?? "";
    const cur = rows.get(k) ?? {
      country: c ?? null,
      clients: 0,
      renewals: 0,
      failures: 0,
      net: 0,
    };
    rows.set(k, cur);
    return cur;
  };
  for (const [, f] of first) touch(f.country).clients += 1;
  for (const p of payments) {
    const r = touch(p.billingCountry);
    if (p.status === "failed") {
      r.failures += 1;
      continue;
    }
    const net = whopNetInSummaryCurrency(p, ref);
    if (net <= 0) continue;
    r.net = round2(r.net + net);
    const u = p.membershipId ? personOf(p.membershipId) : null;
    const estPremier = u !== null && first.get(u)?.at === p.paidAt;
    if (!estPremier) r.renewals += 1;
  }

  const mixedCurrency = ref.mixedCurrency;
  return {
    rows: [...rows.values()]
      .map((r) => ({ ...r, net: mixedCurrency ? null : r.net }))
      .sort((a, b) => (b.net ?? 0) - (a.net ?? 0) || b.clients - a.clients),
    payments: payments.length,
    withCountry: payments.filter((p) => p.billingCountry).length,
    clients: first.size,
    clientsWithCountry: [...first.values()].filter((f) => f.country).length,
    currency: mixedCurrency ? null : ref.currency,
    currencies: ref.currencies,
    mixedCurrency,
    conversions: ref.conversions,
  };
}

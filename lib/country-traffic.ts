/**
 * TRAFIC ET CONVERSION PAR PAYS — la comparaison, et ce qu'elle refuse.
 *
 * Deux façons de dire « ce pays convertit mal », et une seule est honnête ici :
 *
 *  - LE TAUX, clients ÷ visiteurs, calculé DANS une seule source. Il n'est
 *    permis que parce que `countryPersons` compte les deux bouts sur les MÊMES
 *    personnes (cf QUERIES.countryPersons) : le pays vient de leurs events
 *    client, l'achat est compté d'où qu'il soit émis.
 *  - LA PART, la place d'un pays dans les checkouts contre sa place dans les
 *    clients. Deux distributions posées côte à côte, jamais divisées l'une par
 *    l'autre — c'est ce qui permettrait de comparer un jour le trafic PostHog
 *    aux clients Whop sans inventer un ratio entre deux populations.
 *
 * Le seuil d'effectif est le même que partout dans le hub : sous 30 personnes,
 * un taux ne se lit pas, il s'invente.
 */

/** Effectif minimal pour qu'un taux soit affiché (cf lib/analytics-hub). */
export const MIN_COUNTRY_SAMPLE = 30;

export type CountrySteps = {
  country: string;
  visitors: number;
  paywall: number;
  checkouts: number;
  clients: number;
};

export type CountryTrafficRow = CountrySteps & {
  /** Clients ÷ visiteurs, `null` sous le seuil d'effectif. */
  conversion: number | null;
  /** Part de ce pays dans les checkouts (0..1), `null` si aucun checkout. */
  checkoutShare: number | null;
  /** Part de ce pays dans les clients (0..1), `null` si aucun client. */
  clientShare: number | null;
};

/**
 * Range les pays par volume de checkouts et calcule taux et parts.
 *
 * Le dénominateur du taux est le VISITEUR, pas le checkout : c'est la question
 * posée (« ce trafic vaut-il quelque chose ? »). Le checkout sert aux PARTS,
 * qui répondent à une autre question (« où se joue l'intention ? »).
 */
export function countryTrafficRows(
  segments: readonly CountrySteps[],
): CountryTrafficRow[] {
  const totalCheckouts = segments.reduce((s, c) => s + c.checkouts, 0);
  const totalClients = segments.reduce((s, c) => s + c.clients, 0);
  return segments
    .map((c) => ({
      ...c,
      conversion:
        c.visitors >= MIN_COUNTRY_SAMPLE ? c.clients / c.visitors : null,
      checkoutShare: totalCheckouts > 0 ? c.checkouts / totalCheckouts : null,
      clientShare: totalClients > 0 ? c.clients / totalClients : null,
    }))
    .sort((a, b) => b.checkouts - a.checkouts || b.visitors - a.visitors);
}

/**
 * L'ÉCART entre la place d'un pays dans l'intention et sa place dans les
 * clients, en points. Positif = il convertit mieux que sa part de checkouts ne
 * le laissait attendre.
 *
 * `null` dès qu'une des deux parts manque : un écart contre une part inconnue
 * se lirait comme un écart nul, c'est-à-dire comme une information.
 */
export function shareGap(row: CountryTrafficRow): number | null {
  if (row.checkoutShare === null || row.clientShare === null) return null;
  return row.clientShare - row.checkoutShare;
}

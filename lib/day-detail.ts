/**
 * DÉTAIL DÉPLIABLE D'UNE JOURNÉE — trois groupes, trois provenances.
 *
 * L'asymétrie du milieu est le point délicat de cet écran.
 *
 * PAR PAYS : trafic SEULEMENT. Le pays est lu sur l'event PostHog, et seules les
 * étapes émises côté navigateur portent l'IP du visiteur — relevé du 30/08 :
 * visiteurs, paywall et checkouts à 100 % de couverture client, inscriptions à
 * 32,5 %, clients à 8,5 %. Surtout, l'argent vient de Whop, qui ne stocke AUCUN
 * pays : ni sur les paiements, ni sur les adhésions. Les colonnes argent d'une
 * ligne pays valent donc `null` — un TIRET à l'écran, jamais un zéro. Un zéro se
 * lirait « ce pays ne convertit pas » là où il veut dire « on ne mesure pas »,
 * et l'œil retient le chiffre plutôt que la note.
 *
 * PAR REF : les sept colonnes. `creatorConversions` porte déjà (jour, ref) pour
 * le trafic, et les paiements Whop se groupent par jour × ref pour l'argent.
 *
 * REVENU : décomposition du net du jour. Les remboursements sortent de l'argent,
 * donc ils sont rendus NÉGATIFS — une ligne « 8,00 € » sous « Remboursements »
 * se lirait comme une recette.
 */

import { isoCountryLabel } from "./country-name";

export interface CountryDay {
  day: string;
  country: string;
  visitors: number;
  signups: number;
  checkouts: number;
}

export interface RefDay {
  day: string;
  ref: string;
  /**
   * Trafic du jour pour cette ref. `null` = PAS ENCORE COLLECTÉ, pas zéro : la
   * collecte de conversion tourne à 23 h et ramasse la veille, alors que les
   * ventes Whop sont synchronisées toutes les heures. Sur la journée d'hier une
   * ref a donc son argent sans son trafic — le 29/08 en prod, `paredes`
   * affichait 2 clients et 18,54 € pour « 0 visiteur ».
   */
  visitors: number | null;
  signups: number | null;
  clients: number;
  renewals: number;
  failures: number;
  net: number;
}

/** Argent d'un jour par pays de FACTURATION (Whop) — jamais de connexion. */
export interface BillingCountryDay {
  day: string;
  country: string | null;
  clients: number;
  renewals: number;
  failures: number;
  net: number;
}

export interface RevenueDay {
  day: string;
  newNet: number;
  renewalNet: number;
  refunded: number;
}

/** Une sous-ligne — mêmes colonnes que le tableau, `null` = non mesurable. */
export interface DetailRow {
  label: string;
  visitors: number | null;
  signups: number | null;
  checkouts: number | null;
  clients: number | null;
  renewals: number | null;
  failures: number | null;
  net: number | null;
}

export interface DayDetail {
  /** Pays de CONNEXION — trafic seul. */
  countries: DetailRow[];
  /** Pays de FACTURATION — argent seul. Groupe SÉPARÉ, pas des colonnes de plus :
   *  réunis, « France · 982 visiteurs · 18 clients » inviterait à lire 18/982
   *  comme un taux, or ce sont deux populations. */
  billingCountries: DetailRow[];
  refs: DetailRow[];
  revenue: { label: string; net: number }[];
  /** true = rien à déplier ce jour-là. */
  isEmpty: boolean;
}

export function buildDayDetail(input: {
  day: string;
  countries: readonly CountryDay[];
  refs: readonly RefDay[];
  revenue: readonly RevenueDay[];
  billingCountries?: readonly BillingCountryDay[];
}): DayDetail {
  const countries: DetailRow[] = input.countries
    .filter((c) => c.day === input.day)
    .sort((a, b) => b.visitors - a.visitors || (a.country < b.country ? -1 : 1))
    .map((c) => ({
      // HUMANISÉ ICI, pas à l'écran. Le rendu décidait de traduire en reniflant
      // un préfixe de clé React — écrit quand les pays de connexion étaient des
      // noms anglais, ce test est devenu faux dès que la requête est passée au
      // code ISO, et le groupe affichait « FR, RS, BE, BA, CH, MK ».
      label: isoCountryLabel(c.country),
      visitors: c.visitors,
      signups: c.signups,
      checkouts: c.checkouts,
      // NON MESURABLE par pays : Whop ne porte aucun pays, et la couverture
      // client de `subscription_completed` n'est que de 8,5 %.
      clients: null,
      renewals: null,
      failures: null,
      net: null,
    }));

  const refs: DetailRow[] = input.refs
    .filter((r) => r.day === input.day)
    // Tri par argent puis par trafic. Un trafic NON COLLECTÉ (null) ne doit pas
    // se comporter comme un zéro dans le tri : il passe après, à argent égal.
    .sort((a, b) => b.net - a.net || (b.visitors ?? -1) - (a.visitors ?? -1))
    .map((r) => ({
      label: r.ref,
      visitors: r.visitors,
      signups: r.signups,
      // JAMAIS MESURÉ : `creatorConversions` ne stocke que visitors, signups,
      // sales et revenue — aucun checkout. Un 0 ici se lirait « personne n'a
      // ouvert de checkout par cette ref ».
      checkouts: null,
      clients: r.clients,
      renewals: r.renewals,
      failures: r.failures,
      net: r.net,
    }));

  const billingCountries: DetailRow[] = (input.billingCountries ?? [])
    .filter((b) => b.day === input.day)
    .sort((a, b) => b.net - a.net || b.clients - a.clients)
    .map((b) => ({
      label: isoCountryLabel(b.country),
      // NON MESURABLE par pays de facturation : le trafic est compté par pays de
      // CONNEXION, sur l'IP. Un 0 ici se lirait « personne n'est venu de ce
      // pays », alors qu'on n'y mesure pas le trafic du tout.
      visitors: null,
      signups: null,
      checkouts: null,
      clients: b.clients,
      renewals: b.renewals,
      failures: b.failures,
      net: b.net,
    }));

  const rev = input.revenue.find((r) => r.day === input.day);
  const revenue: { label: string; net: number }[] = [];
  if (rev) {
    if (rev.newNet !== 0) revenue.push({ label: "Nouveaux", net: rev.newNet });
    if (rev.renewalNet !== 0)
      revenue.push({ label: "Renouvellements", net: rev.renewalNet });
    // NÉGATIF : un remboursement sort de l'argent. « 8,00 € » sous
    // « Remboursements » se lirait comme une recette.
    if (rev.refunded !== 0)
      revenue.push({ label: "Remboursements", net: -Math.abs(rev.refunded) });
  }

  return {
    countries,
    billingCountries,
    refs,
    revenue,
    isEmpty:
      countries.length === 0 &&
      billingCountries.length === 0 &&
      refs.length === 0 &&
      revenue.length === 0,
  };
}

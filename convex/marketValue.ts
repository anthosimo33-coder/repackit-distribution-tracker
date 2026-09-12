/**
 * CE QU'UN CLIENT RAPPORTE, PAR MARCHÉ ET DANS LE TEMPS — module PUR.
 *
 * Il ne rend que des SOMMES et des EFFECTIFS, jamais une moyenne. La division
 * vit en un seul endroit (`lib/market-aggregate`), et c'est ce qui rend un
 * marché composé correct par construction : additionner deux pays, c'est
 * additionner leurs sommes, puis diviser une fois. Rendre des moyennes ici
 * obligerait l'écran à moyenner des moyennes — la France (147 clients) pèserait
 * alors autant que le Luxembourg (1).
 *
 * ── LA COHORTE EST TOUT L'HISTORIQUE, PAS LA PÉRIODE ────────────────────────
 * « Ce qu'un client de ce marché vaut » décrit le MARCHÉ, pas la fenêtre qu'on
 * regarde. Restreindre la cohorte à la période viderait la colonne : sur 103
 * jours, seuls les clients des treize premiers jours auraient l'âge de dire
 * quelque chose à 90 jours. Le coût, le revenu et les clients acquis, eux,
 * restent bornés par la période — l'écran doit dire que ces deux horloges ne
 * sont pas la même.
 *
 * ── LA MATURITÉ EST UNE CONDITION, PAS UNE CORRECTION ───────────────────────
 * Un client acquis il y a dix jours ne peut rien dire de sa valeur à 90 jours.
 * Il n'est donc pas compté AU NUMÉRATEUR NI AU DÉNOMINATEUR de ce jalon — pas
 * « compté à zéro », ce qui tirerait la colonne vers le bas et se lirait comme
 * un marché qui ne renouvelle pas.
 */

/** Les jalons mesurés, en jours depuis le premier paiement du client. */
export const VALUE_DAYS = [0, 15, 30, 45, 60, 90] as const;

const JOUR_MS = 86_400_000;

/** Un paiement ENCAISSÉ, déjà rattaché à son client et à son marché. */
export type PaiementValeur = {
  /** Identifiant du CLIENT — `membershipId` à défaut `whopId`, comme partout. */
  client: string;
  /** Pays de facturation ANCRÉ du client (son premier paiement). */
  country: string | null;
  paidAt: number;
  /** Contribution NETTE de ce paiement, remboursements déduits. */
  net: number;
};

/** Un point de la courbe de valeur, pour un jalon. */
export type ValuePoint = {
  /** Jours depuis le premier paiement. */
  day: number;
  /** Somme du net cumulé à ce jalon, sur les clients assez mûrs. */
  sum: number;
  /** Combien de clients ont l'âge de ce jalon. */
  mature: number;
};

export type MarketValue = {
  country: string | null;
  /** Clients acquis sur TOUT l'historique (le dénominateur des cohortes). */
  cohortClients: number;
  /** Un point par jalon de `VALUE_DAYS`, dans le même ordre. */
  curve: ValuePoint[];
};

/**
 * La valeur cumulée d'un client à chaque jalon, sommée par marché.
 *
 * `now` est injecté : c'est lui qui décide de la maturité, et un test qui le
 * lirait dans l'horloge changerait de résultat chaque jour.
 */
export function marketValueByCountry(
  paiements: readonly PaiementValeur[],
  now: number,
): MarketValue[] {
  /** client → ses paiements, triés dans le temps. */
  const parClient = new Map<string, PaiementValeur[]>();
  for (const p of paiements) {
    const l = parClient.get(p.client);
    if (l) l.push(p);
    else parClient.set(p.client, [p]);
  }

  const parPays = new Map<string, MarketValue>();
  const marche = (country: string | null): MarketValue => {
    const k = country ?? "";
    let m = parPays.get(k);
    if (!m) {
      m = {
        country,
        cohortClients: 0,
        curve: VALUE_DAYS.map((day) => ({ day, sum: 0, mature: 0 })),
      };
      parPays.set(k, m);
    }
    return m;
  };

  for (const lignes of parClient.values()) {
    const tries = [...lignes].sort((a, b) => a.paidAt - b.paidAt);
    const premier = tries[0];
    // Le pays du client est celui de son PREMIER paiement : il ne change pas de
    // marché parce qu'il a payé une fois depuis ailleurs.
    const m = marche(premier.country);
    m.cohortClients += 1;
    const t0 = premier.paidAt;
    const age = now - t0;
    for (let i = 0; i < VALUE_DAYS.length; i++) {
      const jour = VALUE_DAYS[i];
      const fenetre = jour * JOUR_MS;
      // ⚠️ La maturité D'ABORD : un client trop jeune ne compte nulle part.
      if (age < fenetre) continue;
      let cumul = 0;
      for (const p of tries) {
        if (p.paidAt - t0 <= fenetre) cumul += p.net;
      }
      m.curve[i].sum += cumul;
      m.curve[i].mature += 1;
    }
  }

  return [...parPays.values()];
}

/** Un abonnement, réduit à ce que la survie demande. */
export type AbonnementSurvie = {
  /** Même identifiant de client que les paiements. */
  client: string;
  /** Fin d'accès (ms). `null` = l'accès court toujours. */
  accessEndsAt: number | null;
};

/** Les jalons de survie, en jours. */
export const SURVIVAL_DAYS = [30, 60, 90] as const;

export type SurvivalPoint = {
  day: number;
  /** Clients encore abonnés à ce jalon. */
  alive: number;
  /** Clients assez mûrs pour que le jalon ait un sens. */
  mature: number;
};

export type MarketSurvival = { country: string | null; steps: SurvivalPoint[] };

/**
 * COMBIEN RESTENT ABONNÉS — par marché, aux mêmes conditions de maturité.
 *
 * ⚠️ RÉSILIÉ N'EST PAS EXPIRÉ. Tant que l'accès court, la personne est abonnée :
 * c'est `accessEndsAt` qui tranche, jamais le statut. Une résiliation d'hier se
 * verra dans la survie quand la période payée finira, pas avant — et c'est la
 * bonne lecture, puisque le revenu du cycle est déjà encaissé.
 *
 * Un client sans abonnement connu (paiement isolé, import antérieur à la
 * synchro des memberships) est ÉCARTÉ du jalon plutôt que compté mort : une
 * donnée absente n'est pas une résiliation.
 */
export function marketSurvivalByCountry(
  clients: readonly { client: string; country: string | null; firstPaidAt: number }[],
  abonnements: readonly AbonnementSurvie[],
  now: number,
): MarketSurvival[] {
  /** client → la fin d'accès la PLUS TARDIVE (une personne peut cumuler). */
  const finDAcces = new Map<string, number | null>();
  for (const a of abonnements) {
    if (!finDAcces.has(a.client)) {
      finDAcces.set(a.client, a.accessEndsAt);
      continue;
    }
    const vu = finDAcces.get(a.client) ?? null;
    // `null` (accès en cours) gagne sur toute date : il n'est pas encore fini.
    if (vu === null || a.accessEndsAt === null) finDAcces.set(a.client, null);
    else if (a.accessEndsAt > vu) finDAcces.set(a.client, a.accessEndsAt);
  }

  const parPays = new Map<string, MarketSurvival>();
  const marche = (country: string | null): MarketSurvival => {
    const k = country ?? "";
    let m = parPays.get(k);
    if (!m) {
      m = { country, steps: SURVIVAL_DAYS.map((day) => ({ day, alive: 0, mature: 0 })) };
      parPays.set(k, m);
    }
    return m;
  };

  for (const c of clients) {
    if (!finDAcces.has(c.client)) continue; // abonnement inconnu ⇒ pas de verdict
    const fin = finDAcces.get(c.client) ?? null;
    const m = marche(c.country);
    const age = now - c.firstPaidAt;
    for (let i = 0; i < SURVIVAL_DAYS.length; i++) {
      const fenetre = SURVIVAL_DAYS[i] * JOUR_MS;
      if (age < fenetre) continue;
      m.steps[i].mature += 1;
      if (fin === null || fin > c.firstPaidAt + fenetre) m.steps[i].alive += 1;
    }
  }

  return [...parPays.values()];
}

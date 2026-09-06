/**
 * L'unité « CLIENT » du hub — logique PURE (aucun import Convex, testée Vitest
 * depuis lib/). SOURCE UNIQUE de la question « combien de personnes ? ».
 *
 * Whop compte des ABONNEMENTS, le hub affiche des PERSONNES. Confondre les deux a
 * déjà produit un faux écart en prod (153 abonnements lus comme 153 personnes face
 * à 144 côté PostHog) qui suspendait la carte « Clients payants » en permanence
 * pour un écart réel NUL : 8 personnes avaient 2 abonnements, une en avait 3.
 * Ce n'était pas une dérive à surveiller, c'était une unité.
 *
 * ⚠️ CE MODULE EXISTE POUR QUE LE TOTAL ET LA SÉRIE QUOTIDIENNE NE PUISSENT PAS
 * DIVERGER. Les deux se calculaient séparément ; le jour où l'un aurait changé de
 * règle, l'autre serait resté en arrière et l'écran aurait affiché un « ÷ 351 »
 * sous une courbe qui somme à 375. Ici, `countPersons` et `dailyNewPersons`
 * dérivent du MÊME repliement — l'invariant Σ(jours) = total est structurel, pas
 * une coïncidence à surveiller.
 */

/**
 * Clé de PERSONNE d'un abonnement.
 *
 * Un abonnement dont la personne n'est pas résolue (`whopUserId` pas encore
 * synchronisé) compte POUR LUI-MÊME : on ne fusionne JAMAIS deux inconnus en un
 * seul client. Le compte ne peut donc que SURESTIMER — jamais perdre un client
 * acquis. C'est le bon sens de l'erreur pour un chiffre qui sert de dénominateur
 * à des coûts : surestimer les clients sous-estime le coût unitaire, ce qui ne
 * flatte rien.
 */
export function personKeyOf(
  membershipId: string,
  userOf: ReadonlyMap<string, string>,
): string {
  return userOf.get(membershipId) ?? `mem:${membershipId}`;
}

/** Nombre de PERSONNES derrière un lot d'abonnements. */
export function countPersons(
  membershipIds: Iterable<string>,
  userOf: ReadonlyMap<string, string>,
): number {
  const keys = new Set<string>();
  for (const id of membershipIds) keys.add(personKeyOf(id, userOf));
  return keys.size;
}

/**
 * Instant du PREMIER paiement encaissé de chaque PERSONNE.
 *
 * Une personne à deux abonnements ouverts à des dates différentes est acquise le
 * jour du PREMIER : c'est ce qui fait que la somme des nouveaux clients par jour
 * vaut exactement le nombre de clients, et non le nombre d'abonnements.
 */
export function firstPaidByPerson(
  firstPaidByMembership: ReadonlyMap<string, number>,
  userOf: ReadonlyMap<string, string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [membershipId, at] of firstPaidByMembership) {
    const key = personKeyOf(membershipId, userOf);
    const prev = out.get(key);
    if (prev === undefined || at < prev) out.set(key, at);
  }
  return out;
}

/**
 * NOUVELLES personnes payantes par jour, triées. `dayOf` est injecté (le jour
 * Europe/Paris vit dans analyticsHub) pour que ce module reste pur et testable
 * sans Intl ni fuseau implicite.
 *
 * INVARIANT : Σ des `clients` = `countPersons(...)` sur le même lot. C'est ce qui
 * autorise l'écran à diviser par une somme fenêtrée sans changer d'unité.
 */
export function dailyNewPersons(
  firstPaidByMembership: ReadonlyMap<string, number>,
  userOf: ReadonlyMap<string, string>,
  dayOf: (ts: number) => string,
): { day: string; clients: number }[] {
  const byDay = new Map<string, number>();
  for (const at of firstPaidByPerson(firstPaidByMembership, userOf).values()) {
    const day = dayOf(at);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.entries()]
    .map(([day, clients]) => ({ day, clients }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

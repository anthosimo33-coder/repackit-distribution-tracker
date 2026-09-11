/**
 * COÛT D'UNE ASSIGNATION RÉPARTI ENTRE SES MARCHÉS.
 *
 * Le moteur de paie raisonne par CRÉATRICE : `computeLivePricingBreakdown` rend
 * ce qu'elle gagne, pas où l'argent a été dépensé. Or le pays vit un cran plus
 * bas — sur le COMPTE — et une assignation peut viser plusieurs comptes. Mesuré
 * en prod le 11/09/2026 : 20 assignations sur 523 (3,8 %) visent deux pays, tous
 * le même couple (GB + RS). Rare, donc, mais pas nul — et concentré sur un des
 * marchés qu'on demande justement à l'écran de trancher.
 *
 * ⚠️ CE MODULE NE CALCULE AUCUN MONTANT. Il reçoit le coût déjà calculé par le
 * moteur et se contente de le DÉCOUPER. C'est délibéré : deux calculs de paie
 * finiraient par diverger, et c'est celui de l'écran d'argent qui fait foi.
 *
 * CLÉ DE RÉPARTITION : les VUES de chaque compte. Le CPM y est proportionnel par
 * construction ; le fixe suit la même clé plutôt qu'une seconde (au prorata des
 * cibles), parce qu'un même coût découpé selon deux règles rend deux totaux par
 * pays qui ne se recollent pas. Sans aucune vue mesurée — le cas d'une vidéo
 * publiée hier, ou que le relevé n'a pas rattrapée — on retombe sur un partage
 * ÉGAL entre les cibles : le seul choix qui ne privilégie aucun marché.
 */

/** Une cible d'assignation, réduite à ce que la répartition regarde. */
export type MarketTarget = {
  /** Pays visé du compte. `null` = compte sans pays cible (ligne « non défini »). */
  country: string | null;
  /** Vues relevées sur la publication de cette cible. */
  views: number;
};

export type MarketShare = {
  country: string | null;
  cost: number;
  /** Part de la clé de répartition, pour que l'écran puisse la montrer. */
  weight: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Découpe `cost` entre les marchés de `targets`.
 *
 * Le total rendu est EXACTEMENT `cost` (aux centimes) : le reste d'arrondi va
 * sur la plus grosse part. Sans ce recollement, la somme des pays s'écarterait
 * du total de l'écran de paie — l'écart que personne ne sait expliquer six mois
 * plus tard.
 */
export function splitCostByMarket(
  cost: number,
  targets: readonly MarketTarget[],
): MarketShare[] {
  if (targets.length === 0) return [];

  // Un seul marché : rien à répartir, et surtout aucun arrondi à introduire.
  const pays = [...new Set(targets.map((t) => t.country))];
  if (pays.length === 1) {
    return [{ country: pays[0], cost: round2(cost), weight: 1 }];
  }

  const parPays = new Map<string | null, number>();
  for (const t of targets) {
    parPays.set(
      t.country,
      (parPays.get(t.country) ?? 0) + Math.max(0, t.views),
    );
  }
  const totalVues = [...parPays.values()].reduce((s, v) => s + v, 0);
  const clés = [...parPays.keys()];
  const poids = clés.map((c) =>
    totalVues > 0 ? (parPays.get(c) ?? 0) / totalVues : 1 / clés.length,
  );

  const parts = clés.map((country, i) => ({
    country,
    cost: round2(cost * poids[i]),
    weight: poids[i],
  }));

  // Recollement : le reste d'arrondi rejoint la plus grosse part.
  const écart = round2(cost - parts.reduce((s, p) => s + p.cost, 0));
  if (écart !== 0) {
    let max = 0;
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].cost > parts[max].cost) max = i;
    }
    parts[max].cost = round2(parts[max].cost + écart);
  }
  return parts;
}

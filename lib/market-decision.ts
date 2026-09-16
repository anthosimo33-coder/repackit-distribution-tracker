/**
 * LE VERDICT D'UN MARCHÉ — logique PURE, la seule qui décide de la couleur.
 *
 * L'onglet Pays ne sert qu'à une question : où mettre les créatrices la
 * semaine prochaine. Le verdict y répond avec des seuils ÉCRITS (et affichés à
 * côté des colonnes de décision) plutôt qu'avec une impression de couleurs.
 *
 * ⚠️ « RÉPARER » PASSE AVANT « COUPER ». Un marché dont l'audience ouvre le
 * checkout mais ne paie pas n'a pas un problème de marché, il a un problème de
 * paiement. Relevé du 16/09/2026 : les Balkans font 491 checkouts pour 7
 * clients (1,4 %) contre 18,2 % en Francophonie. Le couper sur son retour
 * jetterait une audience qui répond.
 */
import type { MarketDerived } from "./market-aggregate";

export type MarketVerdict =
  | "accelerer"
  | "reparer"
  | "surveiller"
  | "couper"
  | "trop_tot"
  | "sans_depense"
  | "inconnu";

/** Seuils, en devise du REVENU. Affichés tels quels à l'écran. */
export const DECISION = {
  /** Sous cette dépense promo, aucun verdict : trop tôt. */
  minSpend: 30,
  /** Retour minimal pour accélérer… */
  goReturn: 2,
  /** …avec au moins autant de nouveaux clients. */
  goClients: 20,
  /** Sous ce retour, couper (ou revoir). */
  cutReturn: 0.5,
  /** Checkouts minimum pour juger l'étape de paiement. */
  fixMinCheckouts: 30,
  /** Sous cette part de checkouts qui aboutissent, le paiement casse. */
  fixMaxCheckoutToClient: 0.05,
} as const;

export type MarketDecision = {
  verdict: MarketVerdict;
  /** Checkouts → clients, `null` sous le seuil d'effectif. */
  checkoutToClient: number | null;
  /** Visiteurs → checkouts, `null` sans visiteurs. */
  visitToCheckout: number | null;
};

export function decideMarket(
  m: Pick<
    MarketDerived,
    | "promoCostComparable"
    | "acquisitionReturn"
    | "clients"
    | "checkouts"
    | "trafficClients"
    | "visitors"
  >,
): MarketDecision {
  const checkoutToClient =
    m.checkouts >= DECISION.fixMinCheckouts ? m.trafficClients / m.checkouts : null;
  const visitToCheckout = m.visitors > 0 ? m.checkouts / m.visitors : null;
  const avec = (verdict: MarketVerdict): MarketDecision => ({
    verdict,
    checkoutToClient,
    visitToCheckout,
  });

  // Coût non convertible (aucun taux) : on ne sait pas comparer, on ne tranche pas.
  if (m.promoCostComparable === null) return avec("inconnu");
  // Aucune créatrice ne vise ce marché : rien à accélérer ni à couper, et ce
  // n'est pas « trop tôt » — des clients y arrivent sans qu'on y dépense.
  if (m.promoCostComparable === 0) return avec("sans_depense");
  if (m.promoCostComparable < DECISION.minSpend) return avec("trop_tot");
  const retour = m.acquisitionReturn;
  if (retour === null) return avec("inconnu");

  const paiementCasse =
    checkoutToClient !== null && checkoutToClient < DECISION.fixMaxCheckoutToClient;
  if (paiementCasse && retour < DECISION.goReturn) return avec("reparer");
  if (retour >= DECISION.goReturn && m.clients >= DECISION.goClients) {
    return avec("accelerer");
  }
  if (retour < DECISION.cutReturn) return avec("couper");
  return avec("surveiller");
}

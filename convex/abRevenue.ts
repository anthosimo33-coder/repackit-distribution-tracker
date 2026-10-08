/**
 * REVENU PAR BRAS du test A/B — le calcul pur derrière `abRevenueCore`
 * (convex/analyticsHub.ts), lu par l'onglet Offres (« Net / assigné ») et les
 * outils MCP `offres` et `revenus`.
 *
 * Sorti de la query pour être testé sur des paiements réels (lib/
 * ab-revenue-money.test.ts) : la query ne fait plus que lire la base.
 *
 * ⚠️ DEVISES. Le net d'un paiement est exprimé dans la devise DU PAIEMENT. Ce
 * revenu additionnait donc, par abonnement puis par bras, des dinars serbes, des
 * dollars et des euros : le 08/10/2026 sur Snytch (EUR + USD + RSD), une
 * échéance de 1 049 RSD (≈ 8,94 €) pesait dans « Net / assigné » comme 1 049 €.
 * Chaque paiement est désormais ramené à la devise du revenu par le MÊME
 * référentiel que le résumé de Revenus (`summarizeWhopRevenue` sur tous les
 * paiements du projet, au taux du projet).
 *
 * Une devise encaissée SANS taux laisse le revenu non additionnable (garde A5) :
 * tout montant passe à `null`, jamais à une somme de devises. Les compteurs
 * (abonnements, litiges, exclusions) restent justes.
 */
import { armDivergence, resolveArm, type ArmLookup } from "./abAttribution";
import {
  isInternalWhopMembership,
  type InternalAccountsConfig,
} from "./internalAccounts";
import {
  amountInReferenceCurrency,
  summarizeWhopRevenue,
  whopNetContribution,
  whopNetInSummaryCurrency,
  type WhopConversion,
  type WhopFx,
  type WhopPaymentLike,
} from "./whopRevenue";

export interface AbRevenuePaymentLike extends WhopPaymentLike {
  membershipId?: string;
}

/** Ce qu'un abonnement Whop apporte au rattachement (cf `whopMemberships`). */
export interface AbRevenueMembershipLike {
  whopMembershipId: string;
  createdAt: number;
  abVariant?: string;
  abForced?: boolean;
  distinctId?: string;
}

export interface AbRevenueArmRow {
  variant: string;
  /**
   * Net SÉCURISÉ rattaché à ce bras, dans `currency`. `null` = devises
   * encaissées non convertibles : une somme serait un mélange, pas un montant.
   */
  net: number | null;
  /** Abonnements rattachés à ce bras dans la fenêtre. */
  memberships: number;
  /** Dont rattachés par REPLI (distinctId), faute de metadata. */
  viaFallback: number;
  /**
   * Abonnements dont TOUT l'argent est en litige : ils expliquent un net à
   * 0,00 € qui, sans ça, se lirait comme une absence de conversion.
   */
  atRiskMemberships: number;
  /**
   * Montant à risque correspondant (exclu du net), dans `currency`. `null` =
   * non additionnable (A5, ou litige dans une devise que le référentiel ne sait
   * pas exprimer).
   */
  atRiskAmount: number | null;
}

/**
 * REVENU PAR BRAS du test A/B. Voie PRIMAIRE : `metadata.abVariant` du
 * membership Whop. Voie de REPLI : `distinctId` → personne PostHog. Restreint
 * à la FENÊTRE DU TEST — les abonnements antérieurs n'ont pas de bras parce
 * que le test n'existait pas, les ranger en « inconnu » serait faux.
 */
export interface AbRevenue {
  /** Début de la fenêtre = 1er abonnement portant un bras (ms). null = pas de test. */
  startMs: number | null;
  rows: AbRevenueArmRow[];
  /** Abonnements où metadata et PostHog ne disent PAS le même bras. */
  divergences: { membershipId: string; metadata: string; posthog: string }[];
  /** Abonnements de la fenêtre sans bras par aucune des deux voies. */
  unattached: number;
  /**
   * Abonnements ÉCARTÉS parce que leur personne a changé de bras. Le tableau
   * par bras les retire déjà de ses colonnes (`excludedFlippers`) : sans cette
   * exclusion côté revenu, leur argent entrait au numérateur d'un bras dont le
   * dénominateur les excluait. Compteur VISIBLE — une exclusion silencieuse se
   * lit comme un bras qui vend mal.
   */
  excludedFlippers: number;
  /** Net correspondant, retiré des colonnes de bras ; `null` si non additionnable. */
  excludedFlippersNet: number | null;
  /** Devise de tous les montants ; null si aucune encaissée ou non convertibles. */
  currency: string | null;
  /** Devises ENCAISSÉES, avant conversion — ce que l'écran nomme. */
  currencies: string[];
  /** true = plusieurs devises encaissées sans taux pour les ramener à une seule. */
  mixedCurrency: boolean;
  /** Devises ramenées à `currency` au taux du projet — l'écran DOIT le dire. */
  conversions: WhopConversion[];
}

/** Revenu A/B d'un projet sans Whop ou sans test : rien à rattacher. */
export const EMPTY_AB_REVENUE: AbRevenue = {
  startMs: null,
  rows: [],
  divergences: [],
  unattached: 0,
  excludedFlippers: 0,
  excludedFlippersNet: 0,
  currency: null,
  currencies: [],
  mixedCurrency: false,
  conversions: [],
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Additionne dans la devise du référentiel ; `null` est absorbant (A5). */
const add = (acc: number | null, x: number | null): number | null =>
  acc === null || x === null ? null : round2(acc + x);

/**
 * `acquisition` (ms, bornes INCLUSES, cf windowToMs) : ne garde que les
 * abonnements créés dans la période. Sans elle, tout le test.
 */
export function abRevenueOf(input: {
  /** Tous les paiements du projet — le lot du résumé de Revenus. */
  payments: readonly AbRevenuePaymentLike[];
  memberships: readonly AbRevenueMembershipLike[];
  lookup: ArmLookup;
  /** Début du test (ms) ; null = pas de test. */
  startMs: number | null;
  acquisition: { from: number; to: number } | null;
  internalCfg: InternalAccountsConfig;
  /** Taux du projet (`projectFx`). */
  fx: WhopFx | null;
}): AbRevenue {
  const { lookup, startMs, acquisition, internalCfg } = input;
  // Référentiel de change : celui du résumé de Revenus, sur le même lot — tous
  // les paiements du projet, pas seulement ceux des abonnements de la période.
  const ref = summarizeWhopRevenue([...input.payments], input.fx);
  const mixed = ref.mixedCurrency;

  const moneyByMembership = new Map<
    string,
    { net: number | null; atRisk: number | null; hasAtRisk: boolean }
  >();
  for (const p of input.payments) {
    if (!p.membershipId) continue;
    if (isInternalWhopMembership(p.membershipId, internalCfg)) continue;
    const a =
      moneyByMembership.get(p.membershipId) ?? { net: 0, atRisk: 0, hasAtRisk: false };
    // Seul un paiement qui porte de l'argent peut rendre la somme non
    // additionnable : un abonnement sans encaissement reste un vrai zéro.
    if (whopNetContribution(p) > 0) {
      a.net = add(a.net, mixed ? null : whopNetInSummaryCurrency(p, ref));
    }
    const enLitige = p.status === "disputed" ? Math.max(0, p.netAmount - p.refundedAmount) : 0;
    // Le COMPTE se décide sur le montant brut : un petit litige converti arrondi
    // à 0,00 ne doit pas faire disparaître l'abonnement en litige.
    if (enLitige > 0) {
      a.hasAtRisk = true;
      a.atRisk = add(a.atRisk, mixed ? null : amountInReferenceCurrency(enLitige, p, ref));
    }
    moneyByMembership.set(p.membershipId, a);
  }
  const NO_MONEY = { net: 0, atRisk: 0, hasAtRisk: false };

  const armAcc = new Map<string, AbRevenueArmRow>();
  const divergences: AbRevenue["divergences"] = [];
  let unattached = 0;
  let excludedFlippers = 0;
  let excludedFlippersNet: number | null = 0;
  for (const m of input.memberships) {
    if (isInternalWhopMembership(m.whopMembershipId, internalCfg)) continue;
    if (startMs === null || m.createdAt < startMs) continue; // hors fenêtre du test
    // Période choisie : seuls les abonnements ACQUIS dedans — la même population
    // que les « nouveaux clients » de la période côté PostHog (1er abonnement
    // dans la fenêtre). Leur argent est compté À CE JOUR, renouvellements compris.
    if (acquisition && (m.createdAt < acquisition.from || m.createdAt > acquisition.to)) continue;
    const money = moneyByMembership.get(m.whopMembershipId) ?? NO_MONEY;
    // Résolution UNIQUE, gardes AVANT les deux voies (cf convex/abAttribution).
    const resolved = resolveArm(
      { abVariant: m.abVariant, abForced: m.abForced, distinctId: m.distinctId },
      lookup,
    );
    if (resolved.variant === null) {
      // Une exclusion se COMPTE, sinon elle se lit comme un bras qui vend mal.
      if (resolved.rejected === "flipper") {
        excludedFlippers += 1;
        excludedFlippersNet = add(excludedFlippersNet, money.net);
      } else if (resolved.rejected === "unassigned") {
        unattached += 1;
      }
      continue; // "forced" : session de QA, hors revenu comme hors events
    }
    const variant = resolved.variant;
    const divergence = armDivergence(
      { abVariant: m.abVariant, distinctId: m.distinctId },
      lookup,
    );
    if (divergence) {
      divergences.push({
        membershipId: m.whopMembershipId,
        metadata: divergence.metadata,
        posthog: divergence.posthog,
      });
    }
    const a = armAcc.get(variant) ?? {
      variant,
      net: 0,
      memberships: 0,
      viaFallback: 0,
      atRiskMemberships: 0,
      atRiskAmount: 0,
    };
    a.net = add(a.net, money.net);
    a.memberships += 1;
    if (!m.abVariant) a.viaFallback += 1;
    if (money.hasAtRisk) {
      a.atRiskMemberships += 1;
      a.atRiskAmount = add(a.atRiskAmount, money.atRisk);
    }
    armAcc.set(variant, a);
  }
  return {
    startMs,
    rows: [...armAcc.values()].sort((x, y) => x.variant.localeCompare(y.variant)),
    divergences,
    unattached,
    excludedFlippers,
    excludedFlippersNet,
    currency: mixed ? null : ref.currency,
    currencies: ref.currencies,
    mixedCurrency: mixed,
    conversions: ref.conversions,
  };
}

/**
 * VENTES ET POSTS PAR JOUR — logique PURE (aucun import `_generated`), testée
 * depuis `lib/ventes-par-jour.test.ts`.
 *
 * Sert le détail « Par jour » de la carte Rentabilité (écran Paiements) : chaque
 * jour, les NOUVELLES ventes encaissées et, à côté, les posts qui faisaient les
 * vues ce jour-là. Une vente Whop ne porte pas sa source : on ne relie JAMAIS une
 * vente à un post, on met les deux séries côte à côte. Un pic de ventes porté par
 * un seul post est un indice, pas une attribution.
 */
import { whopCollectedAmount, type WhopPaymentLike } from "./whopRevenue";
import { netInReference } from "./marketMoney";
import {
  computeDailyViewDeltasBy,
  computeDailyViewDeltasWithEstimate,
  type SnapshotPoint,
} from "./viewsDaily";

/** Un paiement Whop tel que la table le porte — ce qu'il faut pour le dater et le classer. */
export type PaiementDuJour = WhopPaymentLike & {
  paidAt: number;
  membershipId?: string;
  /** Départage stable de deux paiements au même instant. */
  whopId: string;
  /**
   * Porté par la table, VOLONTAIREMENT ignoré : c'est l'ordre des paiements d'un
   * abonnement qui fait la nouvelle vente, pas ce libellé (un achat unique dit
   * `one_time`, et c'est une acquisition).
   */
  billingReason?: string;
};

export type VentesDuJour = {
  /** Jour de Paris « AAAA-MM-JJ ». */
  jour: string;
  /** Abonnements dont c'est le PREMIER paiement encaissé (achat unique compris). */
  nouvelles: number;
  /** Net de ces premiers paiements, devise du revenu ; null = devises non convertibles. */
  netNouvelles: number | null;
  /** Net de tous les autres paiements encaissés du jour (renouvellements surtout). */
  netAutres: number | null;
};

/**
 * Les ventes de chaque jour de `[du, au]` (jours sans paiement compris, à zéro).
 *
 * NOUVELLE VENTE = le premier paiement ENCAISSÉ d'un abonnement, quel que soit
 * son `billing_reason` : un achat unique (offre annuelle du Brésil) est une
 * acquisition, et c'est la même règle que « Nouveaux clients » de l'onglet
 * Analytics (premier paiement encaissé par abonnement). Le premier paiement se
 * cherche sur TOUT l'historique — un renouvellement d'un abonnement ouvert avant
 * la période n'est pas une nouvelle vente.
 *
 * Encaissé = `whopCollectedAmount > 0` (un litige en cours reste un client qui
 * a payé, son net, lui, vaut 0). Un paiement sans abonnement ne peut pas être
 * classé : il va dans les autres.
 *
 * `referentiel` = le résumé du lot (devise + conversions) : sans conversion
 * possible entre deux devises, les montants valent null — jamais une somme
 * d'euros et de dollars.
 */
export function ventesParJour(
  paiements: readonly PaiementDuJour[],
  referentiel: Parameters<typeof netInReference>[1],
  jourDe: (ms: number) => string,
  jours: readonly string[],
): VentesDuJour[] {
  const premier = new Map<string, PaiementDuJour>();
  for (const p of paiements) {
    if (p.membershipId === undefined || whopCollectedAmount(p) <= 0) continue;
    const vu = premier.get(p.membershipId);
    if (
      vu === undefined ||
      p.paidAt < vu.paidAt ||
      (p.paidAt === vu.paidAt && p.whopId < vu.whopId)
    ) {
      premier.set(p.membershipId, p);
    }
  }
  const premiers = new Set(premier.values());

  const nouveauxDuJour = new Map<string, PaiementDuJour[]>();
  const autresDuJour = new Map<string, PaiementDuJour[]>();
  for (const p of paiements) {
    if (whopCollectedAmount(p) <= 0) continue;
    const j = jourDe(p.paidAt);
    const cible = premiers.has(p) ? nouveauxDuJour : autresDuJour;
    const arr = cible.get(j);
    if (arr) arr.push(p);
    else cible.set(j, [p]);
  }
  const montant = (lignes: PaiementDuJour[] | undefined) =>
    referentiel.mixedCurrency ? null : netInReference(lignes ?? [], referentiel);

  return jours.map((jour) => ({
    jour,
    nouvelles: nouveauxDuJour.get(jour)?.length ?? 0,
    netNouvelles: montant(nouveauxDuJour.get(jour)),
    netAutres: montant(autresDuJour.get(jour)),
  }));
}

export type PostsDuJour = {
  jour: string;
  /** Vues gagnées ce jour-là par tous les posts suivis (courbe du Tracker). */
  vues: number;
  /**
   * La part de ces vues qui est ESTIMÉE : venue d'un écart de plus de 30 h entre
   * deux relevés d'un post, répartie au prorata des heures. Un MONTANT, pas un
   * drapeau : sur Snytch, un seul post resté sans relevé levait le drapeau
   * chaque jour de novembre 2026, ce qui ne disait plus rien.
   */
  vuesEstimees: number;
  /** Les posts qui ont fait le plus de vues ce jour-là, décroissant. */
  posts: { publicationId: string; vues: number; vuesEstimees: number }[];
};

/**
 * Les posts qui faisaient les vues, jour par jour — la MÊME répartition que la
 * courbe « Vues gagnées par jour » du Tracker (`computeDailyViewDeltasBy`,
 * groupe = la publication) : le total d'un jour retombe sur le point du Tracker,
 * et la somme des posts d'un jour sur son total.
 *
 * Chaque post cité dit aussi combien de ses vues du jour sont estimées : un post
 * resté une semaine sans relevé étale son saut au prorata, et se lirait sinon
 * comme un post qui fait la même chose chaque jour (vu sur Snytch : 4 852 vues
 * par jour du 12 au 17/11/2026, pour un seul écart).
 *
 * `points` : les relevés des posts suivis, départs de publication compris (cf
 * `ajouterDepartsDePublication`), lus quelques jours AVANT le premier jour —
 * sinon les vues du premier jour n'ont pas de relevé de référence.
 */
export function postsParJour(
  points: SnapshotPoint[],
  jours: readonly string[],
  combien: number,
): PostsDuJour[] {
  const serie = new Map(
    computeDailyViewDeltasBy(points, (id) => id).map((j) => [j.date, j]),
  );
  const estimeDuJour = new Map(
    computeDailyViewDeltasWithEstimate(points).map((j) => [j.date, j.estimatedValue]),
  );
  const pointsDuPost = new Map<string, SnapshotPoint[]>();
  for (const p of points) {
    const arr = pointsDuPost.get(p.publicationId);
    if (arr) arr.push(p);
    else pointsDuPost.set(p.publicationId, [p]);
  }
  /** post → (jour → vues estimées), calculé pour les seuls posts cités. */
  const estimeDuPost = new Map<string, Map<string, number>>();
  const estimeDe = (publicationId: string, jour: string): number => {
    let m = estimeDuPost.get(publicationId);
    if (m === undefined) {
      m = new Map(
        computeDailyViewDeltasWithEstimate(pointsDuPost.get(publicationId) ?? []).map(
          (j) => [j.date, j.estimatedValue],
        ),
      );
      estimeDuPost.set(publicationId, m);
    }
    return m.get(jour) ?? 0;
  };
  return jours.map((jour) => {
    const j = serie.get(jour);
    const vues = j?.value ?? 0;
    return {
      jour,
      vues,
      vuesEstimees: Math.min(vues, estimeDuJour.get(jour) ?? 0),
      posts: (j?.parts ?? []).slice(0, combien).map((p) => ({
        publicationId: p.group,
        vues: p.value,
        vuesEstimees: Math.min(p.value, estimeDe(p.group, jour)),
      })),
    };
  });
}

/* ── Ce que l'écran reçoit (action `getVentesEtPostsParJour`) ─────────────────
 * Les types vivent ICI, dans le module pur : l'écran les importe sans tirer
 * convex/ventesParJour et ses lectures (trackerData) dans son graphe d'imports.
 */

export type FichePost = {
  publicationId: string;
  createatrice: string;
  compte: string;
  plateforme: string;
  url: string | null;
  /** Le titre du post (légende relevée, sinon hook), coupé. */
  titre: string;
  /** Nom INTERNE de la campagne de scripts, sinon du format ; null = aucun. */
  format: string | null;
  publieLe: number;
};

export type JourVentesPosts = VentesDuJour & Omit<PostsDuJour, "jour">;

export type VentesEtPostsParJour =
  | { configured: false }
  | {
      configured: true;
      du: string;
      au: string;
      /** Devise du REVENU (Whop). */
      currency: string | null;
      /** Revenu dans plusieurs devises sans taux : montants null, les comptes restent justes. */
      mixedCurrency: boolean;
      conversions: { from: string; rate: number }[];
      /** Un par jour de la période, dans l'ordre. */
      jours: JourVentesPosts[];
      /** Les posts cités dans `jours`, une fois chacun. */
      posts: FichePost[];
    };


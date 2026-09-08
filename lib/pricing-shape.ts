/**
 * FORME d'un barème — pur, testé (Vitest), CLIENT SEUL.
 *
 * Ce module ne calcule AUCUN euro : il décrit un barème pour le rendre
 * comparable à l'œil (nature, prix par vidéo, échelle de paliers). Le moteur de
 * paie reste `lib/pricing-engine.ts` et sa réplique serveur (A6) ; rien ici n'a
 * de réplique convex, parce que rien ici n'entre dans un montant dû.
 *
 * POURQUOI IL EXISTE. L'écran Pricings rendait ses barèmes en PROSE — « Fixe
 * 0,00 $ pour 60 vidéos · CPM 1,00 $/1000 vues · 1 000 000 → 200,00 $ · … ».
 * Rien n'était aligné, donc rien ne se comparait : deux CPM à 1,00 et 1,50 ne
 * tombaient jamais l'un sous l'autre, et trois échelles de bonus recopiées à la
 * main passaient pour identiques alors que l'une avait un seuil à
 * 100 000 001 au lieu de 100 000 000.
 */

import type { BonusTier } from "./pricing-engine";

export type PricingTerms = {
  montantFixe: number;
  nbVideosCible: number;
  tauxCPM: number;
};

/**
 * NATURE du barème. Un `montantFixe` à 0 n'est pas « zéro dollar » : c'est un
 * barème qui ne paie qu'aux vues. Le distinguer d'un montant permet d'écrire un
 * tiret là où l'écran affichait « 0,00 $ » — un nombre qui invitait à comparer
 * ce qui n'était pas comparable.
 *
 * `aucun` (ni fixe ni CPM) est un barème qui ne paie que par ses paliers. C'est
 * exactement la forme des barèmes de DÉFI, dont le fixe NUL est imposé serveur.
 */
export type PricingKind = "cpm" | "fixe" | "mixte" | "aucun";

export function pricingKind(p: PricingTerms): PricingKind {
  const hasFixe = p.montantFixe > 0;
  const hasCpm = p.tauxCPM > 0;
  if (hasFixe && hasCpm) return "mixte";
  if (hasFixe) return "fixe";
  if (hasCpm) return "cpm";
  return "aucun";
}

export const PRICING_KIND_LABEL: Record<PricingKind, string> = {
  cpm: "CPM pur",
  fixe: "Fixe seul",
  mixte: "Mixte",
  aucun: "Paliers seuls",
};

/**
 * Prix FIXE par vidéo. « 580 $ pour 60 vidéos » ne se compare à rien ; 9,67 $ la
 * vidéo se compare. C'est la seule grandeur du fixe qui a un sens en face d'un
 * CPM, et c'est déjà celle que le moteur applique (montantFixe / nbVideosCible).
 *
 * `nbVideosCible >= 1` est imposé côté serveur ; la garde ici évite malgré tout
 * qu'une donnée ancienne rende un Infinity dans l'écran.
 */
export function fixedPerVideo(p: PricingTerms): number {
  if (p.nbVideosCible <= 0) return 0;
  return p.montantFixe / p.nbVideosCible;
}

/**
 * SEUIL de palier abrégé — et abrégé SEULEMENT s'il est rond.
 *
 * C'est la règle qui fait tout le travail : « 100 M » et « 100 M » se
 * ressemblent, 100 000 000 et 100 000 001 non. Abréger sans condition aurait
 * rendu les deux seuils identiques à l'écran et enterré la faute de frappe qui
 * traîne en production. Un seuil qui n'est pas rond s'écrit donc en toutes
 * lettres, et c'est LUI qui crève l'alignement de la colonne.
 *
 * Rond = multiple de 100 000 au-delà du million (→ « 1,5 M »), multiple de 100
 * au-delà du millier (→ « 500 k »). Sinon, nombre groupé complet.
 */
export function formatSeuil(
  seuilVues: number,
  locale: string = "fr-FR",
): string {
  const full = () => new Intl.NumberFormat(locale).format(seuilVues);
  if (!Number.isFinite(seuilVues) || seuilVues < 0) return full();
  if (seuilVues >= 1_000_000 && seuilVues % 100_000 === 0) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(seuilVues / 1_000_000)} M`;
  }
  if (seuilVues >= 1_000 && seuilVues % 100 === 0) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(seuilVues / 1_000)} k`;
  }
  return full();
}

/** Paliers triés par seuil croissant (l'ordre de saisie n'est pas garanti). */
export function sortedTiers(tiers: BonusTier[]): BonusTier[] {
  return [...tiers].sort((a, b) => a.seuilVues - b.seuilVues);
}

/**
 * Deux paliers sont-ils le MÊME palier ? Le coût réel en fait partie : c'est une
 * caractéristique de la récompense (ce qu'elle nous coûte), pas une annotation.
 * Une valeur absente et une valeur à 0 ne sont pas la même chose — « pas encore
 * chiffré » n'est pas « gratuit » — donc on compare les absences telles quelles.
 */
function sameTier(a: BonusTier, b: BonusTier): boolean {
  return (
    a.seuilVues === b.seuilVues &&
    a.rewardType === b.rewardType &&
    (a.montant ?? null) === (b.montant ?? null) &&
    (a.libelle ?? null) === (b.libelle ?? null) &&
    (a.coutReel ?? null) === (b.coutReel ?? null)
  );
}

export type LadderComparison = {
  /** Les deux échelles sont rigoureusement les mêmes (ordre de saisie ignoré). */
  identical: boolean;
  /**
   * Nombre de PALIERS qui diffèrent, apparié par SEUIL.
   *
   * L'appariement par seuil est ce qui rend le nombre lisible. Une première
   * version appariait les paliers ENTIERS : renommer « a Car » en « Une
   * voiture » comptait alors pour deux (un palier disparu, un apparu), et
   * l'écran annonçait « 4 paliers divergent » là où deux récompenses avaient
   * simplement changé de libellé. Un seuil est l'identité d'un palier ; ce
   * qu'on accroche dessus est sa valeur.
   *
   * Compte donc pour UN : un seuil présent des deux côtés mais aux termes
   * différents, un seuil présent d'un seul côté. Un palier réellement DÉPLACÉ
   * (100 000 000 → 100 000 001) compte pour deux, et c'est exact : un seuil a
   * disparu, un autre est apparu.
   */
  differing: number;
};

/**
 * Compare l'échelle d'un barème à une échelle de référence (un modèle). Sert à
 * afficher « identique au modèle » ou « 2 paliers divergent » sans forcer
 * l'admin à ouvrir les deux et à lire six lignes de chiffres l'une contre
 * l'autre.
 */
export function compareLadders(
  tiers: BonusTier[],
  reference: BonusTier[],
): LadderComparison {
  const bySeuil = new Map<number, BonusTier>();
  for (const r of reference) bySeuil.set(r.seuilVues, r);
  let differing = 0;
  const seen = new Set<number>();
  for (const t of tiers) {
    seen.add(t.seuilVues);
    const r = bySeuil.get(t.seuilVues);
    if (!r || !sameTier(t, r)) differing += 1;
  }
  for (const seuil of bySeuil.keys()) {
    if (!seen.has(seuil)) differing += 1;
  }
  return { identical: differing === 0, differing };
}

export type LadderSummary = {
  count: number;
  /** Récompense du palier le PLUS HAUT — ce vers quoi l'échelle tend. */
  topLabel: string | null;
  /** Hauteurs relatives (0..1) des paliers, pour la micro-échelle de la liste. */
  steps: number[];
};

/**
 * Résumé d'une échelle pour une ligne de liste : combien de paliers, et jusqu'où
 * ça monte. Le libellé du sommet (« Une voiture ») en dit plus long sur
 * l'ambition d'une grille que ses six seuils alignés.
 */
export function ladderSummary(
  tiers: BonusTier[],
  formatMontant: (n: number) => string,
): LadderSummary {
  const sorted = sortedTiers(tiers);
  if (sorted.length === 0) return { count: 0, topLabel: null, steps: [] };
  const top = sorted[sorted.length - 1];
  const topLabel =
    top.rewardType === "cash"
      ? formatMontant(top.montant ?? 0)
      : (top.libelle ?? "récompense");
  // Échelle relative des seuils, bornée pour rester lisible : le plus petit
  // palier garde une hauteur visible même face à un sommet 100 fois plus haut.
  const max = top.seuilVues || 1;
  const steps = sorted.map((t) =>
    Math.min(1, Math.max(0.25, Math.sqrt(t.seuilVues / max))),
  );
  return { count: sorted.length, topLabel, steps };
}

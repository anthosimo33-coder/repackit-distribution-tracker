/**
 * Moteur de calcul de PAIE par PRICING (pur, testé Vitest). De l'ARGENT : la
 * source de vérité du calcul. RÉPLIQUÉ à l'identique dans convex/pricing.ts
 * (règle A6 — un module convex/ ne peut pas importer lib/). Toute évolution
 * DOIT être appliquée des DEUX côtés + couverte par les tests.
 *
 * Modèle (v2), pour un (créateur, projet) :
 *
 *  1. FIXE mensuel — réparti par VIDÉO UNIQUE PUBLIÉE, groupé par pricing,
 *     plafonné à montantFixe par (créateur, pricingId, mois). PAR VIDÉO.
 *  2. CPM — par vidéo, sur les VUES TOTALES (somme des plateformes).
 *  3. BONUS À PALIERS — créateur-niveau, sur le CUMUL TOTAL À VIE de ses vues
 *     (somme de toutes ses vidéos publiées). Chaque palier (cash ou nature) se
 *     débloque UNE fois quand le cumul atteint son seuilVues. Le CASH compte
 *     dans le total $ ; le NATURE est une récompense due (hors total $). La
 *     PERSISTANCE du déblocage (idempotent, période d'attribution, freeze) est
 *     gérée côté serveur (bonusUnlocks) ; ici on fournit le PUR :
 *       - computeMonthlyPayout → fixe + CPM (PAS de bonus par vidéo en v2) ;
 *       - tiersOf → grille de paliers (avec fallback legacy seuil unique) ;
 *       - evaluateBonusTiers → état des paliers pour la jauge (AFFICHAGE).
 *
 * Tous les montants sont arrondis au centime pour que la somme soit exacte.
 */

import { isRemunerated, type RemunerationFlags } from "./remunerate";

export type PricingSnapshot = {
  pricingId: string;
  montantFixe: number;
  nbVideosCible: number;
  tauxCPM: number;
  // LEGACY v1 (seuil unique par vidéo) — conservés sur les snapshots existants,
  // PLUS utilisés par le moteur v2 (le bonus est désormais à paliers cumulés).
  seuilBonusVues?: number;
  montantBonus?: number;
};

/** Une vidéo publiée du mois : 1 assignment + ses vues totales (somme cibles). */
export type PayoutItem = {
  assignmentId: string;
  snapshot: PricingSnapshot;
  totalViews: number;
};

export type PerPricing = {
  pricingId: string;
  /** Un assignment RÉEL de ce groupe (représentant de la ligne « Fixe » gelée). */
  firstAssignmentId: string;
  videoCount: number;
  nbVideosCible: number;
  montantFixe: number;
  fixePerVideo: number;
  fixed: number;
  cpm: number;
};

export type PerAssignment = {
  assignmentId: string;
  pricingId: string;
  /** Assiette AVANT plafond (vues payables retenues). */
  totalViews: number;
  cpm: number;
  /**
   * Vues réellement FACTURÉES — celles qui ont produit le CPM versé.
   *
   * `totalViews` est l'assiette AVANT plafond ; au-delà du seuil où la vidéo
   * atteint MAX_PAY_PER_VIDEO_EUR, chaque vue supplémentaire est GRATUITE. Les
   * compter dans un ratio « par 1000 vues » fait baisser ce ratio sans qu'un
   * centime ait été dépensé — mesuré en prod le 03/09/2026 : une vidéo de Kelly
   * plafonnée à 150 $ a pris 107 400 vues en 24 h et a fait tomber le RPM d'août
   * de 1,88 € à 1,69 € pour 0 $.
   *
   * Barème au CPM : `min(vues, seuil)`, `seuil = (plafond − part fixe) / tauxCPM
   * × 1000`. Sous le plafond c'est exactement `totalViews` ; au-dessus, le seuil.
   * Barème au FIXE SEUL : `totalViews` — la vidéo est un achat forfaitaire, ses
   * vues sont toutes achetées (0 si le budget fixe est épuisé). Jamais de
   * division par zéro : `tauxCPM = 0` ne passe pas par la branche qui divise.
   */
  billedViews: number;
};

export interface MonthlyPayout {
  fixedTotal: number;
  cpmTotal: number;
  total: number; // fixe + CPM (le bonus cash à paliers est ajouté côté serveur)
  perPricing: PerPricing[];
  perAssignment: PerAssignment[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Plafond DUR de rémunération PAR VIDÉO — GLOBAL, tous projets (Snytch, RepackIt,
 * …), JAMAIS scopé par projet. Dès que la paie d'UNE vidéo (part fixe + CPM ; ou
 * base + bonus dans le modèle legacy) atteint ce montant, elle est plafonnée —
 * même à des dizaines de millions de vues. Appliqué à la SOURCE du calcul par
 * vidéo (computeMonthlyPayout / estimateMissionEarnings ici ; computeEarnings
 * dans lib/earnings) et RÉPLIQUÉ côté convex (A6). Le total mensuel = SOMME des
 * vidéos DÉJÀ plafonnées (le cap est par vidéo, jamais sur le total agrégé).
 */
export const MAX_PAY_PER_VIDEO_EUR = 150;

/** CPM d'une vidéo (vues totales, toutes plateformes confondues). */
export function assignmentCpm(snapshot: PricingSnapshot, totalViews: number): number {
  const v = Math.max(0, totalViews);
  return round2((v / 1000) * snapshot.tauxCPM);
}

/** Fixe par vidéo (figé) ; 0 si nbVideosCible invalide (garde anti /0). */
function fixePerVideo(snapshot: PricingSnapshot): number {
  if (!(snapshot.nbVideosCible > 0)) return 0;
  return snapshot.montantFixe / snapshot.nbVideosCible;
}

export interface MissionEstimate {
  /** Part FIXE par vidéo (montantFixe / nbVideosCible). */
  fixed: number;
  /** Part CPM pour `views` (tauxCPM × views / 1000). */
  cpm: number;
  /** fixed + cpm. */
  total: number;
}

/**
 * Estimation de rému d'UNE mission (affichage fiche créateur, modèle pricing v2),
 * pilotée par un nombre de vues (slider) : FIXE/vidéo + CPM(vues). RÉUTILISE les
 * fonctions pures du moteur (fixePerVideo, assignmentCpm) → cohérent avec
 * computeMonthlyPayout, qui exclut lui aussi tout bonus du per-mission. Les
 * paliers de bonus (créateur-niveau, cumul à vie) NE sont PAS inclus ici : ils
 * vivent sur le doc pricings et sont affichés sur l'écran Paiements
 * (evaluateBonusTiers / getMyBonusStatus), pas par mission.
 */
export function estimateMissionEarnings(
  snapshot: PricingSnapshot,
  views: number,
): MissionEstimate {
  const fixed = round2(fixePerVideo(snapshot));
  const cpm = assignmentCpm(snapshot, views);
  const total = round2(fixed + cpm);
  if (total <= MAX_PAY_PER_VIDEO_EUR) return { fixed, cpm, total };
  // Plafond 150 $/vidéo : on garde la part fixe et on rogne le CPM (puis le fixe
  // au cas pathologique fixe/vidéo > 150). Cohérent avec computeMonthlyPayout.
  const cappedFixed = Math.min(fixed, MAX_PAY_PER_VIDEO_EUR);
  const cappedCpm = round2(MAX_PAY_PER_VIDEO_EUR - cappedFixed);
  return { fixed: cappedFixed, cpm: cappedCpm, total: MAX_PAY_PER_VIDEO_EUR };
}

// ─── Warmup — exclusion des posts de la paie (par POST) ──────────────────────

/** Un post publié d'une vidéo : ses vues + son flag warmup. */
/** Vues d'un post + ses flags de rémunération (isRemunerated → paie). */
export type PublicationViews = RemunerationFlags & { views: number };

export interface PayableViews {
  /** Σ des vues des posts NON-warmup — base du CPM ET du cumul de paliers. */
  payableViews: number;
  /**
   * La vidéo compte-t-elle comme une VIDÉO PAYABLE (part fixe) ? true sauf si
   * elle a ≥1 post ET qu'ils sont TOUS warmup (→ vidéo entièrement warmup,
   * exclue du fixe). Une vidéo SANS post matérialisé garde le comportement
   * historique (compte pour le fixe) → un post warmup ne peut que RETIRER.
   */
  hasPayablePost: boolean;
}

/**
 * Vues PAYABLES d'une vidéo = somme des vues de ses posts RÉMUNÉRÉS (isRemunerated).
 * Les posts non rémunérés sont EXCLUS : ni CPM sur leurs vues, ni cumul pour les
 * paliers. `hasPayablePost` pilote le FIXE (une vidéo sans aucun post rémunéré ne
 * compte pas comme vidéo publiée). SOURCE UNIQUE (pure, testée Vitest) — RÉPLIQUÉE
 * dans convex/pricing.ts (règle A6). Tant que `remunere` est absent, isRemunerated
 * retombe sur !isWarmup → payableViews et hasPayablePost STRICTEMENT INCHANGÉS.
 */
export function payableAssignmentViews(pubs: PublicationViews[]): PayableViews {
  let payableViews = 0;
  let remuneratedCount = 0;
  for (const p of pubs) {
    if (!isRemunerated(p)) continue;
    remuneratedCount += 1;
    payableViews += Math.max(0, p.views);
  }
  return {
    payableViews,
    hasPayablePost: pubs.length === 0 || remuneratedCount > 0,
  };
}

/**
 * Part de la paie d'UNE vidéo réellement engagée pour ses posts PROMO — sert aux
 * indicateurs dont le DÉNOMINATEUR est en vues promo (RPM coût, coût
 * d'acquisition), où mélanger les deux périmètres gonfle le chiffre.
 *
 * Le CPM est payé sur les vues PAYABLES (posts rémunérés), qui incluent un post
 * warmup RÉMUNÉRÉ — l'exception historique traitée par le champ `remunere`. Ces
 * vues-là sont HORS promo : sans prorata, une vidéo qui mêle un post promo et un
 * post warmup rémunéré ferait entrer sa paie de warmup au numérateur alors que
 * ses vues de warmup restent hors du dénominateur. Le CPM étant linéaire en vues,
 * le prorata `promoPaidViews / payableViews` est EXACT, pas une estimation (et il
 * répartit proportionnellement une vidéo plafonnée à MAX_PAY_PER_VIDEO_EUR).
 *
 * Le FIXE, lui, est par VIDÉO : une vidéo qui porte au moins un post promo est
 * une vidéo promo, son fixe compte EN ENTIER. Une vidéo entièrement warmup n'a
 * aucun post promo et n'est pas censée passer par ici.
 *
 * `payableViews` à 0 (vidéo publiée pas encore mesurée) ⇒ aucun CPM n'a pu être
 * gagné, il ne reste que le fixe. Le CPM étant calculé SUR ces vues payables, il
 * vaut alors 0 de toute façon ; on retient 0 plutôt que 1 pour que le contrat de
 * la fonction (aucune paie hors promo au numérateur) tienne même sur une entrée
 * incohérente. SOURCE UNIQUE (pure, testée Vitest) — RÉPLIQUÉE dans
 * convex/pricing.ts (règle A6).
 */
export function promoVideoCost(
  fixed: number,
  cpm: number,
  payableViews: number,
  promoPaidViews: number,
): number {
  const payable = Math.max(0, payableViews);
  const promo = Math.min(Math.max(0, promoPaidViews), payable);
  const share = payable > 0 ? promo / payable : 0;
  return round2(Math.max(0, fixed) + Math.max(0, cpm) * share);
}

/**
 * Paie du mois (FIXE + CPM) à partir des vidéos publiées (1 item par assignment
 * publié). PAS de bonus par vidéo en v2 (le bonus est créateur-niveau à paliers
 * cumulés, géré séparément).
 */
/**
 * Clé de GROUPE — le pricingId NE SUFFIT PAS.
 *
 * Le barème est FIGÉ par assignation (`pricingSnapshot`) mais un pricing peut
 * être ÉDITÉ EN PLACE : deux assignations du MÊME pricingId portent alors des
 * termes différents. Grouper sur le seul pricingId mélangeait ces générations,
 * et le calcul de groupe lisait `groupItems[0].snapshot` → la part fixe
 * dépendait de l'ORDRE DES DOCUMENTS. Constaté en prod : un cycle de 7 vidéos
 * à 100 $/60 + 12 à 0 $/60 valait 69,50 $ ou 37,83 $ selon le tirage.
 *
 * La clé inclut donc TOUS les termes que le calcul de groupe utilise. Deux
 * générations = deux groupes, chacun avec SON budget `montantFixe` — ce qui est
 * la seule lecture cohérente avec le figement : les vidéos attribuées sous un
 * barème à 0 $ de fixe ne peuvent pas puiser dans le budget fixe d'un autre.
 *
 * ⚠️ Toute valeur de barème lue AU NIVEAU DU GROUPE doit figurer ici.
 */
function payoutGroupKey(s: PricingSnapshot): string {
  return [s.pricingId, s.montantFixe, s.nbVideosCible, s.tauxCPM].join("|");
}

export function computeMonthlyPayout(items: PayoutItem[]): MonthlyPayout {
  const groups = new Map<string, PayoutItem[]>();
  for (const it of items) {
    const key = payoutGroupKey(it.snapshot);
    const arr = groups.get(key);
    if (arr) arr.push(it);
    else groups.set(key, [it]);
  }

  const perPricing: PerPricing[] = [];
  const perAssignment: PerAssignment[] = [];
  let fixedTotal = 0;
  let cpmTotal = 0;

  for (const groupItems of groups.values()) {
    // Le budget fixe est le SEUL paramètre encore lu au niveau du groupe, et il
    // est identique pour tous ses membres par construction (cf payoutGroupKey) —
    // donc indépendant de l'ordre. Tout le reste se lit par ITEM, sur SON
    // snapshot, exactement comme le CPM.
    const groupSnapshot = groupItems[0].snapshot;
    const budgetFixe = groupSnapshot.montantFixe;
    const videoCount = groupItems.length;

    // ─── Plafond 150 $/vidéo ───────────────────────────────────────────────
    // Chaque vidéo = part fixe (répartie, bornée au budget montantFixe) + CPM.
    // Le dépassement au-delà de MAX_PAY_PER_VIDEO_EUR est rogné sur le CPM en
    // premier, puis sur la part fixe (cas pathologique fixe/vidéo > 150). Sans
    // dépassement, fixedOverflow reste 0 → fixe et CPM identiques à avant.
    let remainingFixe = budgetFixe;
    let fixedRaw = 0;
    let groupCpm = 0;
    let fixedOverflow = 0;
    for (const it of groupItems) {
      // Part fixe de CETTE vidéo, lue sur SON snapshot (jamais celui du voisin).
      const perVideo = fixePerVideo(it.snapshot);
      const fixedShare = Math.min(perVideo, Math.max(0, remainingFixe));
      remainingFixe -= fixedShare;
      fixedRaw += fixedShare;
      const cpm = assignmentCpm(it.snapshot, it.totalViews);
      const excess = Math.max(0, fixedShare + cpm - MAX_PAY_PER_VIDEO_EUR);
      const cpmOverflow = Math.min(cpm, excess);
      fixedOverflow += excess - cpmOverflow;
      const cappedCpm = round2(cpm - cpmOverflow);
      groupCpm = round2(groupCpm + cappedCpm);
      const views = Math.max(0, it.totalViews);
      // Vues FACTURÉES.
      //
      // Barème au CPM (tauxCPM > 0) : les vues en deçà du SEUIL où la vidéo
      // atteint le plafond. Au-delà, chaque vue est un EXCÉDENT gratuit. Le seuil
      // est calculé exactement, PAS depuis le ratio des montants arrondis au
      // centime — la conversion inverse dérivait (149 999 au lieu de 150 000).
      //
      // Barème au FIXE SEUL (tauxCPM = 0) : la paie ne scale PAS du tout avec les
      // vues, la vidéo est un achat FORFAITAIRE. Toutes ses vues sont donc
      // achetées — les exclure rendrait invisible une créatrice entière (cas
      // « Cintia - Brazil », 5 $/vidéo, 30 vidéos au contrat), alors que son coût,
      // lui, pèse sur la marge. C'est la différence avec l'excédent du plafond :
      // là il reste une part scalante et on ne rogne que ce qui la dépasse.
      // Budget fixe ÉPUISÉ (fixedShare = 0, p. ex. la 31ᵉ vidéo d'un barème à 30) :
      // la vidéo n'est payée ni au fixe ni au CPM → aucune vue achetée.
      const billableViews =
        it.snapshot.tauxCPM > 0
          ? Math.max(0, (MAX_PAY_PER_VIDEO_EUR - fixedShare) / it.snapshot.tauxCPM) * 1000
          : fixedShare > 0
            ? views
            : 0;
      perAssignment.push({
        assignmentId: it.assignmentId,
        pricingId: it.snapshot.pricingId,
        totalViews: views,
        cpm: cappedCpm,
        billedViews: Math.round(Math.min(views, billableViews)),
      });
    }
    // Arrondi AU NIVEAU DU GROUPE, comme avant : à snapshots homogènes (le cas
    // normal) la somme des parts vaut min(videoCount × perVideo, budget) et le
    // résultat est identique au centime près à l'implémentation précédente.
    const fixed = round2(round2(fixedRaw) - fixedOverflow);

    perPricing.push({
      pricingId: groupSnapshot.pricingId,
      // Un membre RÉEL de CE groupe : depuis que deux générations de snapshot
      // peuvent partager un pricingId, chercher un représentant par pricingId
      // seul renverrait le même assignment pour les deux groupes (ligne « Fixe »
      // gelée attribuée à la mauvaise vidéo).
      firstAssignmentId: groupItems[0].assignmentId,
      videoCount,
      nbVideosCible: groupSnapshot.nbVideosCible,
      montantFixe: budgetFixe,
      fixePerVideo: round2(fixePerVideo(groupSnapshot)),
      fixed,
      cpm: groupCpm,
    });
    fixedTotal = round2(fixedTotal + fixed);
    cpmTotal = round2(cpmTotal + groupCpm);
  }

  return {
    fixedTotal,
    cpmTotal,
    total: round2(fixedTotal + cpmTotal),
    perPricing,
    perAssignment,
  };
}

// ─── Paliers de bonus (cumul de vues créateur) ───────────────────────────────

export type BonusTier = {
  seuilVues: number;
  rewardType: "cash" | "nature";
  montant?: number;
  libelle?: string;
  /**
   * Récompense NATURE uniquement — ce que l'objet nous COÛTE réellement (prix
   * d'achat négocié), JAMAIS son prix public ni sa valeur perçue par la
   * créatrice. Sert à faire entrer les iPhone/MacBook/voitures dans l'économie du
   * moteur ; absent ⇒ la récompense s'affiche sans montant (tiret), jamais à 0.
   * Non affiché à la créatrice : c'est un coût interne, pas sa rémunération.
   */
  coutReel?: number;
};

/** Source de paliers d'un pricing (avec fallback legacy seuil unique → 1 cash). */
export function tiersOf(pricing: {
  bonusTiers?: BonusTier[];
  seuilBonusVues?: number;
  montantBonus?: number;
}): BonusTier[] {
  if (pricing.bonusTiers && pricing.bonusTiers.length > 0) {
    return pricing.bonusTiers;
  }
  if (
    (pricing.seuilBonusVues ?? 0) > 0 &&
    (pricing.montantBonus ?? 0) > 0
  ) {
    return [
      {
        seuilVues: pricing.seuilBonusVues!,
        rewardType: "cash",
        montant: pricing.montantBonus!,
      },
    ];
  }
  return [];
}

export interface BonusTierEvaluation {
  /** Paliers franchis (seuil ≤ cumul), triés par seuil croissant. */
  crossed: BonusTier[];
  /** Total $ des paliers CASH franchis (les nature sont exclus). */
  cashCrossedTotal: number;
  /** Paliers NATURE franchis (récompenses dues). */
  natureCrossed: BonusTier[];
  /** Prochain palier non encore franchi (le plus bas au-dessus du cumul). */
  nextTier: BonusTier | null;
  /** Vues restantes avant le prochain palier (null si aucun). */
  viewsToNext: number | null;
}

/**
 * État des paliers pour un cumul donné — AFFICHAGE (jauge) UNIQUEMENT. Le $
 * réellement crédité vient des bonusUnlocks persistés (serveur), jamais d'ici.
 */
export function evaluateBonusTiers(
  cumulViews: number,
  tiers: BonusTier[],
): BonusTierEvaluation {
  const cumul = Math.max(0, cumulViews);
  const sorted = [...tiers].sort((a, b) => a.seuilVues - b.seuilVues);
  const crossed = sorted.filter((t) => cumul >= t.seuilVues);
  const cashCrossedTotal = round2(
    crossed
      .filter((t) => t.rewardType === "cash")
      .reduce((s, t) => s + (t.montant ?? 0), 0),
  );
  const natureCrossed = crossed.filter((t) => t.rewardType === "nature");
  const nextTier = sorted.find((t) => cumul < t.seuilVues) ?? null;
  return {
    crossed,
    cashCrossedTotal,
    natureCrossed,
    nextTier,
    viewsToNext: nextTier ? Math.max(0, nextTier.seuilVues - cumul) : null,
  };
}

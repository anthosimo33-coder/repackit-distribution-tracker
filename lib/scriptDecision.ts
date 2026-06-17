/**
 * S4 — Moteur de DÉCISION du bulk testing. PUR (aucune dépendance Convex/React),
 * testé Vitest. Là où S3 (lib/scriptStats.ts + convex/scriptAnalytics.ts) MONTRE
 * les chiffres, S4 en TIRE des verdicts actionnables : quelle brique pousser,
 * laquelle couper, lesquelles encore tester, et quels signaux méritent l'œil de
 * l'admin.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. Cette logique est RÉPLIQUÉE
 * côté serveur (convex/scriptDecision.ts) pour l'adminQuery campaignDecisions ;
 * toute évolution ici doit l'être là-bas. Les tests vivent ici
 * (lib/scriptDecision.test.ts).
 *
 * PRINCIPE (cf décisions S4) :
 *  - On juge PAR BRIQUE/DIMENSION d'abord (un flux, un tier, un cta accumule 50
 *    posts bien plus vite qu'un combo précis), le combo entier en bonus.
 *  - Trois portes :
 *      1. EN TEST — sous le seuil de données → on continue d'assigner, AUCUN
 *         verdict (ni push ni coupe). On ne tranche jamais dans le vide.
 *      2. JUGEABLE — comparaison à la médiane des PAIRS jugeables du même kind :
 *         nettement au-dessus → À POUSSER ; nettement en-dessous → À COUPER ;
 *         dans la moyenne → NEUTRE (garder en rotation).
 *      3. SIGNAL FORT — un combo (ou une brique) qui explose un seuil HAUT MÊME
 *         sous le seuil de données → flag remonté à l'admin pour décision
 *         MANUELLE, JAMAIS d'auto-action (un seul carton peut être un accident).
 *
 *  - S4 RECOMMANDE, il n'agit pas : « à pousser » est une reco que l'admin suit
 *    en assignant plus de ce combo ; le système ne ré-assigne JAMAIS tout seul
 *    (l'humain reste dans la boucle — l'auto-assignation pilotée par les verdicts
 *    serait un chantier futur, hors scope ici).
 */

import { JUGEABLE_THRESHOLD, median } from "./scriptStats";

// ─── Seuils (constantes nommées, faciles à régler) ───────────────────────────

/**
 * Seuil de données : une brique/dimension n'est « jugeable » qu'à partir de ce
 * nombre de posts mesurés. Source unique : JUGEABLE_THRESHOLD de scriptStats
 * (50). En-dessous → en_test, aucun verdict.
 */
export const DECISION_THRESHOLD = JUGEABLE_THRESHOLD;

/**
 * Écart relatif (vs la médiane des pairs jugeables) à partir duquel on tranche.
 * +25 % au-dessus → À POUSSER ; −25 % en-dessous → À COUPER ; entre les deux →
 * NEUTRE. Choix : ±25 % est assez large pour ignorer le bruit statistique d'un
 * échantillon de ~50 posts (la médiane bouge peu mais pas à 5 % près) et assez
 * serré pour qu'un écart « net » à l'œil (un tier qui fait 1,5×–2× un autre)
 * tombe largement du bon côté. Réglable selon l'appétit au risque.
 */
export const PUSH_DELTA = 0.25;
export const CUT_DELTA = -0.25;

/**
 * Nombre minimum de pairs JUGEABLES requis pour oser comparer. À 0 ou 1 pair
 * jugeable, la « médiane des pairs » est un point isolé (ou inexistant) : on
 * refuse de trancher et on reste en_test. 1 = minimum viable (au moins un point
 * de comparaison crédible). Les dimensions du bulk testing ont peu de niveaux
 * (3 tiers, 2–3 flux/cta), donc on ne peut pas en exiger beaucoup.
 */
export const MIN_JUDGEABLE_PEERS = 1;

/**
 * Seuil HAUT du signal fort : médiane ≥ ce multiple de la médiane GLOBALE de la
 * campagne → flag manuel. 2× = « deux fois mieux que le tout-venant », un écart
 * qui ne s'explique pas par le hasard d'un échantillon même petit. Volontairement
 * exigeant : un signal fort doit mériter l'œil de l'admin, pas noyer le tableau.
 */
export const STRONG_SIGNAL_MULTIPLE = 2;

/**
 * Posts minimum pour qu'un « carton » compte comme signal fort. 1 seul post à
 * 5× la médiane est très probablement un accident (vidéo virale isolée) et ne
 * doit pas remonter. 3 = on veut un mini-faisceau, tout en restant LARGEMENT
 * sous le seuil de jugement (50). Le signal fort vit dans la fenêtre
 * [MIN_SIGNAL_POSTS, DECISION_THRESHOLD) : assez de matière pour être notable,
 * pas assez pour être un verdict — d'où la revue MANUELLE.
 */
export const MIN_SIGNAL_POSTS = 3;

// ─── Types ───────────────────────────────────────────────────────────────────

export type BrickVerdict = "en_test" | "a_pousser" | "a_couper" | "neutre";

/**
 * Entrée minimale d'une brique/dimension à juger. `key` identifie l'entité
 * (brickId, ou « S »/« A »/« B » pour un tier). `kind` regroupe les pairs
 * comparables (« tier », « corps », « flux », « cta »).
 */
export interface BrickInput {
  key: string;
  label: string;
  kind: string;
  postCount: number;
  viewsMedian: number | null;
}

export interface BrickDecision {
  key: string;
  label: string;
  kind: string;
  verdict: BrickVerdict;
  /** Phrase factuelle prête à afficher (français, dense). */
  reason: string;
  postCount: number;
  viewsMedian: number | null;
  /**
   * Écart relatif vs la médiane des pairs jugeables, en FRACTION signée
   * (0.3 = +30 %, −0.4 = −40 %). `null` si non jugé (en_test) ou pas de pairs.
   */
  deltaVsPeerMedian: number | null;
  /** Médiane de référence (médiane des médianes des pairs jugeables). `null` si non jugé. */
  peerMedian: number | null;
}

export interface DecisionOpts {
  threshold?: number;
  pushDelta?: number;
  cutDelta?: number;
  minJudgeablePeers?: number;
  strongSignalMultiple?: number;
  minSignalPosts?: number;
}

// ─── decideBrick : portes 1 & 2 ──────────────────────────────────────────────

/** Une brique est jugeable si elle a assez de posts ET une médiane définie. */
function isJudgeable(b: BrickInput, threshold: number): boolean {
  return b.postCount >= threshold && b.viewsMedian !== null;
}

function pct(fraction: number): string {
  const sign = fraction >= 0 ? "+" : "−";
  return `${sign}${Math.round(Math.abs(fraction) * 100)} %`;
}

/**
 * Verdict d'une brique/dimension face à ses pairs du même kind.
 *
 * @param brick  la brique à juger.
 * @param peersOfSameKind  les AUTRES briques du même kind (la self est filtrée
 *   défensivement par `key` si elle s'y trouve). La référence de comparaison est
 *   la médiane des médianes des pairs JUGEABLES uniquement.
 *
 * Porte 1 (en_test) : brick sous le seuil → aucun verdict.
 * Porte 1bis (en_test) : pas assez de pairs jugeables → on ne tranche pas dans le vide.
 * Porte 2 : écart relatif à la médiane des pairs → a_pousser / a_couper / neutre.
 */
export function decideBrick(
  brick: BrickInput,
  peersOfSameKind: readonly BrickInput[],
  opts: DecisionOpts = {},
): BrickDecision {
  const threshold = opts.threshold ?? DECISION_THRESHOLD;
  const pushDelta = opts.pushDelta ?? PUSH_DELTA;
  const cutDelta = opts.cutDelta ?? CUT_DELTA;
  const minPeers = opts.minJudgeablePeers ?? MIN_JUDGEABLE_PEERS;

  const base = {
    key: brick.key,
    label: brick.label,
    kind: brick.kind,
    postCount: brick.postCount,
    viewsMedian: brick.viewsMedian,
    deltaVsPeerMedian: null as number | null,
    peerMedian: null as number | null,
  };

  // Porte 1 — sous le seuil de données → en_test, jamais de verdict.
  if (!isJudgeable(brick, threshold)) {
    return {
      ...base,
      verdict: "en_test",
      reason: `${brick.postCount}/${threshold} posts — pas encore jugeable`,
    };
  }

  // Référence : pairs jugeables (hors self), médiane de leurs médianes.
  const judgeablePeers = peersOfSameKind.filter(
    (p) => p.key !== brick.key && isJudgeable(p, threshold),
  );
  if (judgeablePeers.length < minPeers) {
    return {
      ...base,
      verdict: "en_test",
      reason: `${brick.postCount} posts mais pas assez de pairs jugeables pour comparer`,
    };
  }

  const peerMedian = median(
    judgeablePeers.map((p) => p.viewsMedian as number),
  ) as number;
  const brickMedian = brick.viewsMedian as number;

  // Écart relatif. peerMedian peut être 0 (pairs sans vue) → on traite à part
  // pour éviter une division par zéro : toute médiane > 0 face à 0 surperforme.
  let delta: number;
  if (peerMedian === 0) {
    delta = brickMedian > 0 ? Infinity : 0;
  } else {
    delta = (brickMedian - peerMedian) / peerMedian;
  }

  let verdict: BrickVerdict;
  if (delta >= pushDelta) verdict = "a_pousser";
  else if (delta <= cutDelta) verdict = "a_couper";
  else verdict = "neutre";

  const deltaStr = Number.isFinite(delta) ? pct(delta) : "+∞";
  const reason =
    verdict === "a_pousser"
      ? `Médiane ${deltaStr} vs pairs, sur ${brick.postCount} posts`
      : verdict === "a_couper"
        ? `Médiane ${deltaStr} sous les pairs, sur ${brick.postCount} posts`
        : `Dans la moyenne des pairs (${deltaStr}), sur ${brick.postCount} posts`;

  return {
    ...base,
    verdict,
    reason,
    deltaVsPeerMedian: Number.isFinite(delta) ? delta : null,
    peerMedian,
  };
}

/**
 * Juge TOUTES les briques d'un même kind les unes contre les autres (chacune
 * face aux autres). Renvoie les décisions dans l'ordre d'entrée.
 */
export function decideKind(
  bricks: readonly BrickInput[],
  opts: DecisionOpts = {},
): BrickDecision[] {
  return bricks.map((b) => decideBrick(b, bricks, opts));
}

// ─── detectStrongSignals : porte 3 ───────────────────────────────────────────

export interface SignalInput {
  key: string;
  label: string;
  /** « combo » | « tier » | « corps » | « flux » | « cta » — pour l'affichage. */
  kind: string;
  postCount: number;
  viewsMedian: number | null;
}

export interface StrongSignal {
  key: string;
  label: string;
  kind: string;
  postCount: number;
  viewsMedian: number;
  /** Médiane / médiane globale de campagne (multiple, ex. 2.6). */
  multipleOfGlobal: number;
  reason: string;
}

/**
 * Porte 3 — signaux forts à VALIDER MANUELLEMENT. Flague les entités dont la
 * médiane explose le seuil haut (≥ multiple × médiane globale de campagne) MÊME
 * sous le seuil de jugement, dans la fenêtre [minSignalPosts, threshold) :
 *  - ≥ minSignalPosts : un mini-faisceau, pas un carton isolé (accident).
 *  - < threshold : au-delà, l'entité passe par un VERDICT (decideBrick), pas par
 *    un signal — le signal sert à attraper les pépites AVANT qu'elles soient
 *    jugeables, pour les confirmer à la main.
 *
 * AUCUNE auto-action : la sortie est une simple liste à remonter à l'admin.
 * Triée par multiple décroissant (le plus spectaculaire en tête).
 */
export function detectStrongSignals(
  items: readonly SignalInput[],
  globalMedian: number | null,
  opts: DecisionOpts = {},
): StrongSignal[] {
  if (globalMedian === null || globalMedian <= 0) return [];
  const threshold = opts.threshold ?? DECISION_THRESHOLD;
  const multiple = opts.strongSignalMultiple ?? STRONG_SIGNAL_MULTIPLE;
  const minPosts = opts.minSignalPosts ?? MIN_SIGNAL_POSTS;

  const out: StrongSignal[] = [];
  for (const it of items) {
    if (it.viewsMedian === null) continue;
    if (it.postCount < minPosts || it.postCount >= threshold) continue;
    const ratio = it.viewsMedian / globalMedian;
    if (ratio < multiple) continue;
    out.push({
      key: it.key,
      label: it.label,
      kind: it.kind,
      postCount: it.postCount,
      viewsMedian: it.viewsMedian,
      multipleOfGlobal: ratio,
      reason: `Médiane ${ratio.toFixed(1)}× la campagne sur ${it.postCount} posts — à confirmer manuellement`,
    });
  }
  return out.sort((a, b) => b.multipleOfGlobal - a.multipleOfGlobal);
}

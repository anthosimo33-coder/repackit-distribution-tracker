/**
 * DÉFIS — score, franchissement, et désignation des gagnantes.
 *
 * Module PUR (aucun import Convex) : importable par `convex/`, `lib/` et le
 * client, comme `convex/hookAvailability.ts` et `convex/comboCooldown.ts`. Toute
 * la décision vit ici ; les fonctions Convex ne font que collecter les faits et
 * appliquer ce que ce module rend. Les tests de référence sont en
 * `lib/challenge-score.test.ts`.
 *
 * ── Ce qui compte dans un score ──────────────────────────────────────────────
 * UNIQUEMENT les vidéos publiées DANS LE CADRE du défi (`assignments.challengeId`).
 * Le compteur part de zéro à l'ouverture : aucune vidéo antérieure, aucun report
 * d'historique. C'est une règle produit, pas une commodité de calcul — un défi
 * qui compterait le passé récompenserait un rythme déjà acquis.
 *
 * ── Les vues retenues ────────────────────────────────────────────────────────
 * `views` est le TOTAL de la vidéo (toutes ses cibles), c'est-à-dire exactement
 * ce que la créatrice voit dans « Mes vidéos ». Ni `payableViews` ni
 * `bonusTierViews` : le défi mesure une performance, pas une assiette de paie, et
 * faire diverger le score affiché de la performance affichée serait
 * incompréhensible. Le seul retrait possible est EXPLICITE (geste admin
 * « retirer du défi »), jamais un effet de bord d'un réglage de paie.
 *
 * ── L'instant de décision ────────────────────────────────────────────────────
 * Tout se joue au RELEVÉ NOCTURNE (23h30 Paris, cf convex/nightlyViewsSync.ts) :
 * c'est le seul moment où l'app connaît l'état de chacune. « La première à
 * franchir » n'est donc pas décidable — entre deux relevés, personne ne sait qui
 * est passée devant qui. Le départage est donc : à franchissement constaté au
 * MÊME relevé, celle qui a le plus de vues gagne. Cette règle est annoncée à la
 * créatrice avant qu'elle serve (cf messages `portal.challenge.tiebreak`).
 */

export type ChallengeMode = "cumulative" | "single";

/**
 * Combien de gagnantes le défi admet.
 *  - `first` : une seule (la première constatée) ;
 *  - `topN`  : les N premières ;
 *  - `all`   : toutes celles qui franchissent, sans plafond.
 *
 * ⚠️ La récompense est PAR GAGNANTE, jamais partagée : 200 € × 3 gagnantes =
 * 600 €. Aucun code de ce module ne divise quoi que ce soit — c'est dit ici
 * parce que « nombre de gagnants » évoque spontanément un partage.
 */
export type WinnerRule =
  | { kind: "first" }
  | { kind: "topN"; n: number }
  | { kind: "all" };

/** Nombre de places ouvertes par la règle. `Infinity` pour `all`. */
export function winnerSlots(rule: WinnerRule): number {
  switch (rule.kind) {
    case "first":
      return 1;
    case "topN":
      return Math.max(0, Math.floor(rule.n));
    case "all":
      return Number.POSITIVE_INFINITY;
  }
}

/** Une vidéo de défi, réduite à ce dont le score a besoin. */
export type ChallengeVideo = {
  /** Vues TOTALES de la vidéo au dernier relevé (somme de ses cibles). */
  views: number;
  /**
   * La vidéo est-elle publiée ? Une vidéo en production ou en revue ne compte
   * pas : elle n'a pas de vues, et l'inclure à 0 ne changerait rien — mais le
   * dire explicitement empêche qu'un jour on compte une soumission refusée.
   */
  published: boolean;
  /**
   * Retirée du défi par l'admin. Elle reste PUBLIÉE, PAYÉE et TRACKÉE : seul son
   * apport au score disparaît. C'est le seul levier de retrait — on ne se sert
   * jamais d'un réglage de paie (warmup/rémunération) pour sortir une vidéo d'un
   * défi, les deux notions n'ont rien à voir.
   */
  removed?: boolean;
};

/** Les vidéos qui comptent réellement : publiées et non retirées. */
export function countedVideos(
  videos: readonly ChallengeVideo[],
): ChallengeVideo[] {
  return videos.filter((v) => v.published && v.removed !== true);
}

/**
 * Score d'une participante.
 *
 *  - CUMULÉ : somme des vues de ses vidéos du défi ;
 *  - UNIQUE : vues de sa MEILLEURE vidéo du défi (la barre doit être atteinte
 *    par UNE vidéo, donc c'est le maximum qui décide, pas la somme).
 *
 * Aucune vidéo comptée ⇒ 0 dans les deux modes (et non `-Infinity` : `Math.max`
 * d'un tableau vide est un piège classique, il ferait afficher « -∞ vues »).
 */
export function scoreOf(
  videos: readonly ChallengeVideo[],
  mode: ChallengeMode,
): number {
  const counted = countedVideos(videos);
  if (counted.length === 0) return 0;
  const views = counted.map((v) => Math.max(0, v.views));
  return mode === "cumulative"
    ? views.reduce((s, v) => s + v, 0)
    : Math.max(...views);
}

/** Une participante, telle que le classement la manipule. */
export type Participant = {
  creatorId: string;
  /** Départage STABLE à score égal (voir `rankParticipants`). */
  name: string;
  videos: readonly ChallengeVideo[];
};

export type RankedParticipant = {
  creatorId: string;
  name: string;
  score: number;
  /** Vidéos comptées (publiées, non retirées) — affiché « N vidéos ». */
  videoCount: number;
  /** Rang 1-based après tri. */
  rank: number;
  /** A franchi la barre au moment du calcul. */
  crossed: boolean;
};

/**
 * Classement NOMINATIF des participantes, du meilleur score au moins bon.
 *
 * À score égal, on départage par le NOM (ordre français), pas par l'id : deux
 * participantes à 0 vue doivent apparaître dans un ordre lisible et stable, et
 * un id Convex donnerait un ordre arbitraire qui change au réensemencement.
 *
 * Le rang est simplement l'index : deux scores égaux occupent deux rangs
 * distincts. C'est assumé — un classement à ex æquo demanderait de dire ce que
 * vaut un ex æquo pour la victoire, et la règle de victoire (ci-dessous) tranche
 * déjà cette question autrement (par le score au relevé).
 */
export function rankParticipants(
  participants: readonly Participant[],
  mode: ChallengeMode,
  targetViews: number,
): RankedParticipant[] {
  return participants
    .map((p) => {
      const counted = countedVideos(p.videos);
      const score = scoreOf(p.videos, mode);
      return {
        creatorId: p.creatorId,
        name: p.name,
        score,
        videoCount: counted.length,
        crossed: score >= targetViews,
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr"))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

/** Une victoire DÉJÀ acquise (persistée) — elle ne se reprend pas toute seule. */
export type ExistingWin = {
  creatorId: string;
  /** Annulée à la main par l'admin : la place est LIBÉRÉE. */
  cancelled?: boolean;
};

/**
 * Gagnantes à ACTER à cet instant — celles qui viennent de franchir la barre et
 * pour qui il reste une place.
 *
 * ── Ce que la fonction refuse de faire ───────────────────────────────────────
 * Elle ne reprend JAMAIS une victoire acquise : les gagnantes existantes sont
 * une ENTRÉE, jamais un résultat recalculé. C'est ce qui rend l'annonce
 * automatique sûre — une créatrice à qui on a dit « c'est gagné » ne peut pas se
 * le voir retirer parce qu'une vidéo a disparu ou qu'une autre l'a dépassée. Une
 * victoire annulée (`cancelled`) libère sa place : c'est un geste admin explicite,
 * avec motif, pas une conséquence du calcul.
 *
 * ── La deadline ─────────────────────────────────────────────────────────────
 * Passée, plus aucune victoire n'est actée — même si la barre est franchie
 * ensuite. `at <= deadline` : le relevé qui tombe PILE à la deadline compte
 * encore (borne inclusive, comme la borne stricte du cooldown : on choisit une
 * convention et on l'écrit).
 *
 * ── Le départage ────────────────────────────────────────────────────────────
 * Plusieurs franchissements au MÊME relevé : le plus de vues gagne. À vues
 * strictement égales, le nom (même convention que `rankParticipants`) — il faut
 * bien trancher, et un ordre lisible vaut mieux qu'un ordre d'insertion.
 */
export function newWinnersAt(input: {
  ranked: readonly RankedParticipant[];
  rule: WinnerRule;
  existingWins: readonly ExistingWin[];
  /** Instant du relevé qui déclenche l'évaluation. */
  at: number;
  deadline: number;
}): RankedParticipant[] {
  const { ranked, rule, existingWins, at, deadline } = input;
  if (at > deadline) return [];

  const live = existingWins.filter((w) => w.cancelled !== true);
  const alreadyWon = new Set(live.map((w) => w.creatorId));
  const remaining = winnerSlots(rule) - live.length;
  if (remaining <= 0) return [];

  // `ranked` est déjà trié par score décroissant puis par nom : c'est exactement
  // l'ordre de départage. On ne re-trie pas — deux tris successifs sur les mêmes
  // clés sont une occasion de diverger.
  const candidates = ranked.filter(
    (p) => p.crossed && !alreadyWon.has(p.creatorId),
  );
  return Number.isFinite(remaining)
    ? candidates.slice(0, remaining)
    : [...candidates];
}

/**
 * Le défi est-il TERMINÉ ? Deadline dépassée, ou toutes les places prises.
 *
 * Dérivé, jamais stocké : un statut persisté se désynchronise du jour où
 * personne ne fait tourner le job qui l'écrit. Le seul état persisté est
 * `draft`/`active`/`closed` posé à la main par l'admin (ouvrir, clore
 * manuellement) ; cette fonction dit si le défi est de fait terminé.
 */
export function challengeIsOver(input: {
  rule: WinnerRule;
  existingWins: readonly ExistingWin[];
  deadline: number;
  now: number;
}): boolean {
  if (input.now > input.deadline) return true;
  const live = input.existingWins.filter((w) => w.cancelled !== true);
  return live.length >= winnerSlots(input.rule);
}

/**
 * Progression vers la barre, bornée à 1 — la barre de l'écran créatrice.
 * `targetViews <= 0` ⇒ 0 plutôt qu'une division par zéro : un objectif nul est
 * refusé à la saisie, mais une donnée corrompue ne doit pas rendre `NaN` à
 * l'écran.
 */
export function progressRatio(score: number, targetViews: number): number {
  if (!(targetViews > 0)) return 0;
  return Math.min(1, Math.max(0, score) / targetViews);
}

/** Vues restantes pour franchir. 0 une fois la barre atteinte. */
export function viewsToTarget(score: number, targetViews: number): number {
  return Math.max(0, targetViews - Math.max(0, score));
}

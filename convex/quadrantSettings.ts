/**
 * SEUILS du quadrant « Vues × Intent » — un seul endroit, commenté, parce
 * qu'ils vont bouger.
 *
 * Module PUR, sans aucun import : il est lu par le calcul serveur
 * (`convex/quadrant.ts`, appelé au relevé nocturne) ET par la carte du tracker.
 * Aucun composant ne redéfinit un seuil — un chiffre écrit dans du JSX est un
 * chiffre que personne ne retrouve le jour où il faut le changer.
 *
 * Même gabarit que `convex/decisionThresholds.ts` (seuils du dashboard
 * décisionnel) ; les deux jeux restent SÉPARÉS volontairement. Ils se
 * ressemblent (48 h, 15 000 vues) mais ne répondent pas à la même question :
 * là-bas « ce post mérite-t-il une action tout de suite ? », ici « ce format
 * mérite-t-il d'être reconduit ? ». Les fondre ferait bouger le dashboard
 * décisionnel à chaque réglage du quadrant.
 *
 * ⚠️ Toucher un seuil change la LECTURE, jamais la donnée : les vues et les
 * saves sont celles du relevé, le quadrant n'est qu'un classement dérivé
 * recalculé chaque nuit. Aucun de ces réglages ne touche la paie.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type QuadrantSettings = {
  /** Fenêtre glissante de la médiane de référence d'un compte. */
  baselineWindowMs: number;
  /** En dessous de ce nombre de posts mesurés, pas de médiane de référence. */
  baselineMinPosts: number;
  /**
   * Les posts de chauffe comptent-ils dans la médiane de référence du compte ?
   * Cf. `BASELINE_INCLUDES_WARMUP` pour l'arbitrage.
   */
  baselineIncludesWarmup: boolean;
  /** Âge en dessous duquel un post n'est pas jugeable (« en attente »). */
  maturityMs: number;
  /** Multiplicateur de la médiane à partir duquel la distribution est HAUTE. */
  distributionMultiplier: number;
  /** Volume de vues sous lequel le save rate n'est pas lisible (cf. `MIN_SAMPLE_VIEWS`). */
  minSampleViews: number;
  /** Save rate à partir duquel l'intent est HAUT. */
  intentSaveRate: number;
  /** Durée pendant laquelle un gros post ouvre une fenêtre sur son compte. */
  breakoutWindowMs: number;
  /** Vues à partir desquelles un post ouvre une fenêtre. */
  breakoutMinViews: number;
};

/* ── Les QUATRE seuils du quadrant ────────────────────────────────────────── */

/**
 * Fenêtre glissante de la médiane de référence. 14 jours : assez long pour
 * qu'un compte qui publie tous les deux jours ait un échantillon, assez court
 * pour que la référence suive la trajectoire réelle du compte (un compte qui
 * monte ne doit pas être jugé sur ce qu'il faisait il y a deux mois).
 */
export const BASELINE_WINDOW_DAYS = 14;

/**
 * Un post distribue « haut » quand il fait au moins 2× la médiane de son
 * compte. La MÉDIANE et pas la moyenne : une seule vidéo virale déplacerait la
 * moyenne et rendrait tout le reste médiocre par construction.
 *
 * ×2 et non ×3 — calibré le 2026-08-22 sur 14 jours de prod (126 posts publiés,
 * 70 classés). La bande ×2–×3 ne contient que 5 de ces 70 posts (50 sont sous
 * ×2, 15 au-dessus de ×3) : la distribution est bimodale, donc le choix du
 * multiplicateur est presque neutre sur le découpage. À neutralité près, on
 * prend le seuil SENSIBLE — sur cet axe un faux positif coûte un coup d'œil,
 * un faux négatif coûte un format qui marchait et qu'on ne reconduit pas.
 *
 * C'est `MIN_SAMPLE_VIEWS` qui porte la garde de fiabilité, pas ce
 * multiplicateur-ci. Les deux réglages ne répondent pas à la même question et
 * ne se compensent pas : celui-ci dit « à partir de quand c'est un burst »,
 * l'autre « à partir de quand la mesure veut dire quelque chose ».
 */
export const DISTRIBUTION_MULTIPLIER = 2;

/**
 * SEUIL DE FIABILITÉ STATISTIQUE — **ce n'est PAS une barre de performance.**
 *
 * Il garde l'axe INTENT, pas l'axe distribution. Le save rate est un ratio à
 * très petit numérateur : à 1 000 vues, le seuil d'intent (0,5 %) représente
 * CINQ saves. Une ou deux saves de bruit font alors changer un post de
 * quadrant, et la classification devient un tirage. À 2 000 vues le même seuil
 * représente dix saves — lisible. C'est tout ce que ce nombre dit.
 *
 * Il s'applique en ET avec le multiplicateur (`quadrantFor`) : un post sous ce
 * volume ne monte pas dans la moitié haute, celle dont les deux verdicts
 * (« reconduire », « resserrer l'intro produit ») se lisent sur le save rate.
 * On refuse de faire agir sur une mesure qu'on sait bruitée.
 *
 * ⚠️ NE PAS le retuner pour « durcir » le quadrant. Le monter ne rend pas la
 * lecture plus exigeante, il rend le quadrant AVEUGLE aux petits comptes : à
 * 5 000 (la valeur d'origine), c'était ce plancher et non le ratio qui décidait
 * pour 4 comptes sur 7 du roster — l'axe X cessait d'être relatif au compte
 * pour redevenir un compteur de vues absolu. Pour changer ce qui compte comme
 * burst, c'est `DISTRIBUTION_MULTIPLIER` qu'il faut bouger.
 *
 * Un plancher PROPORTIONNEL à la médiane du compte a été envisagé et écarté :
 * il résout le mauvais problème. Proportionnel sur une médiane de 495, il
 * admettrait des posts à 1 500 vues où le save rate est précisément le bruit
 * que ce seuil existe pour écarter.
 */
export const MIN_SAMPLE_VIEWS = 2_000;

/**
 * Save rate à partir duquel l'intent est HAUT. 0,5 % — un save est un geste
 * coûteux comparé au like, l'ordre de grandeur n'est pas le même (cf.
 * `SAVE_RATE_GOOD = 1 %` du dashboard décisionnel, qui répond à une autre
 * question : là-bas « ce post-ci mérite une action », ici « cet axe de contenu
 * déclenche l'intention »).
 */
export const INTENT_SAVE_RATE = 0.005;

/* ── Réglages de bordure — hors des quatre, mais jamais en dur non plus ────── */

/**
 * En dessous de 48 h, un post n'a pas fini de prendre ses vues : le juger le
 * condamnerait avant qu'il ait vécu. Ces posts sont AFFICHÉS (en gris) mais
 * jamais classés, et ils sont RETIRÉS de la médiane de référence — sans quoi
 * chaque publication de la veille tirerait la référence du compte vers le bas.
 */
export const MATURITY_HOURS = 48;

/**
 * Un post publié dans les 48 h qui suivent un gros post du MÊME compte hérite
 * d'une audience qu'il n'a pas construite. Le drapeau ne le disqualifie pas —
 * il dit « cette distribution est peut-être empruntée », ce qui change la
 * lecture d'un point en haut à droite.
 */
export const BREAKOUT_WINDOW_HOURS = 48;
export const BREAKOUT_MIN_VIEWS = 15_000;

/**
 * Une médiane sur un seul post est une tautologie : le post EST sa propre
 * référence, son score vaut 1, il ne peut par construction jamais distribuer
 * « haut ». Sur deux posts, la médiane est leur moyenne et un seul écart la
 * déplace de moitié. À partir de 3 mesures la médiane commence à dire quelque
 * chose ; en dessous on préfère afficher « pas de référence » qu'un chiffre qui
 * a l'air d'un chiffre.
 */
export const BASELINE_MIN_POSTS = 3;

/**
 * ARBITRAGE — les posts de chauffe comptent DANS la médiane de référence.
 *
 * La règle produit (TD-019, `convex/warmupMode.ts`) est que le warmup sort de
 * TOUT agrégat de performance et de tout dénominateur de taux. Ce réglage-ci
 * s'en écarte volontairement, et voici pourquoi : la médiane de référence ne
 * mesure pas une performance, elle mesure ce que le COMPTE fait normalement —
 * sa capacité de distribution, au même titre que son nombre d'abonnés. Le
 * warmup fait partie de ce que le compte publie, donc de ce qu'il distribue.
 *
 * L'écarter rendrait la comparaison plus flatteuse (les posts promo seraient
 * comparés entre eux, et ils distribuent structurellement moins) et, sur les
 * comptes majoritairement en chauffe, ferait tomber l'échantillon sous
 * `BASELINE_MIN_POSTS` — donc plus de référence du tout.
 *
 * Réglage EXPLICITE plutôt qu'implicite : le basculer à `false` est un
 * changement d'une ligne, et les tests couvrent les deux lectures.
 */
export const BASELINE_INCLUDES_WARMUP = true;

/** Le jeu de seuils par défaut, assemblé depuis les constantes ci-dessus. */
export const QUADRANT_SETTINGS: QuadrantSettings = {
  baselineWindowMs: BASELINE_WINDOW_DAYS * DAY_MS,
  baselineMinPosts: BASELINE_MIN_POSTS,
  baselineIncludesWarmup: BASELINE_INCLUDES_WARMUP,
  maturityMs: MATURITY_HOURS * HOUR_MS,
  distributionMultiplier: DISTRIBUTION_MULTIPLIER,
  minSampleViews: MIN_SAMPLE_VIEWS,
  intentSaveRate: INTENT_SAVE_RATE,
  breakoutWindowMs: BREAKOUT_WINDOW_HOURS * HOUR_MS,
  breakoutMinViews: BREAKOUT_MIN_VIEWS,
};

/* ── Périodes d'affichage de la carte ─────────────────────────────────────── */

/**
 * Fenêtres proposées par le sélecteur de la carte. 14 est la valeur par défaut
 * parce que c'est aussi la fenêtre de la médiane de référence : afficher
 * exactement la période sur laquelle les scores ont été calculés.
 *
 * ⚠️ C'est un filtre d'AFFICHAGE : il choisit les points tracés, jamais la
 * fenêtre de `BASELINE_WINDOW_DAYS`. Regarder 7 jours ne recalcule pas les
 * scores sur 7 jours — la référence d'un compte reste la même.
 */
export const QUADRANT_PERIOD_DAYS = [7, 14, 30] as const;
export type QuadrantPeriodDays = (typeof QUADRANT_PERIOD_DAYS)[number];
export const DEFAULT_QUADRANT_PERIOD_DAYS: QuadrantPeriodDays = 14;

/**
 * La plus longue période offerte. Sert de borne aux lectures serveur qui
 * doivent couvrir n'importe laquelle des fenêtres : au-delà, une donnée ne peut
 * plus être affichée par la carte. Dérivée de la liste, jamais recopiée.
 */
export const MAX_QUADRANT_PERIOD_DAYS: number = Math.max(
  ...QUADRANT_PERIOD_DAYS,
);

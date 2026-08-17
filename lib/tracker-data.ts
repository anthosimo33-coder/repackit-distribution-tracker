/**
 * Logique PURE de la vue Tracker (data des posts publiés). Testée en vitest
 * (lib/tracker-data.test.ts). Consommée côté client (stats globales + agrégats
 * par catégorie pour les charts) ET — pour `matchesDimensionFilters` —
 * DUPLIQUÉE côté serveur (convex/trackerData.ts) car convex/ ne peut pas
 * importer lib/ (règle A6, cross-tsconfig). Toute évolution doit être répliquée
 * dans les deux.
 *
 * EXCEPTION : `computeDailyViewDeltas` n'est PLUS une réplique. Son algorithme
 * a grossi (répartition au prorata, calendrier Europe/Paris) et vit maintenant
 * dans le module pur `convex/viewsDaily.ts`, importé à l'identique par les deux
 * côtés — un module pur sous convex/ étant importable du client, alors que
 * l'inverse ne l'est pas.
 */

import {
  passesWarmupMode,
  DEFAULT_WARMUP_MODE,
  type WarmupMode,
} from "./warmup-mode";

export type PostDimensions = {
  creatorId: string | null;
  compte: string;
  plateforme: string;
  /** id du format NOMMÉ rattaché (via l'assignment), null si aucun. */
  formatId: string | null;
  campaignId: string | null;
};

/**
 * Filtres de dimension MULTI-SELECT. Pour chaque dimension : undefined ou liste
 * vide = pas de filtre (toutes les valeurs) ; liste non vide = appartenance.
 */
export type DimensionFilters = {
  creatorIds?: readonly string[];
  comptes?: readonly string[];
  plateformes?: readonly string[];
  formatIds?: readonly string[];
  campaignIds?: readonly string[];
};

function activeFilter(list?: readonly string[]): list is readonly string[] {
  return Array.isArray(list) && list.length > 0;
}

/**
 * Lecture du warmup dans la vue tracker — ALIAS historiques du helper UNIQUE
 * `lib/warmup-mode.ts` (TD-019 : une seule logique d'exclusion, partagée par
 * tous les agrégats). Conservés pour ne pas casser les appelants du tracker. Le
 * tri-état reste VOLONTAIREMENT distinct des filtres de dimension multi-select :
 * ce n'est pas une appartenance à une liste mais un mode de lecture des agrégats.
 */
export type WarmupFilter = WarmupMode;

/** Défaut = "exclude". Cf `DEFAULT_WARMUP_MODE` (`lib/warmup-mode.ts`). */
export const DEFAULT_WARMUP_FILTER: WarmupFilter = DEFAULT_WARMUP_MODE;

/** Un post passe-t-il le filtre warmup ? Délègue au helper unique. */
export const matchesWarmupFilter = passesWarmupMode;

/**
 * Matching des filtres multi-select : OU À L'INTÉRIEUR d'une dimension
 * (appartenance à la liste), ET ENTRE dimensions (toutes les dimensions actives
 * doivent matcher). Une dimension sans sélection (vide/undefined) n'impose aucune
 * contrainte. Une valeur null du post (ex. pas de créateur / pas de format nommé)
 * ne matche JAMAIS une dimension active → le post est exclu quand on filtre sur
 * cette dimension, mais reste visible tant qu'elle est inactive.
 */
export function matchesDimensionFilters(
  d: PostDimensions,
  f: DimensionFilters,
): boolean {
  if (
    activeFilter(f.creatorIds) &&
    (d.creatorId === null || !f.creatorIds.includes(d.creatorId))
  ) {
    return false;
  }
  if (activeFilter(f.comptes) && !f.comptes.includes(d.compte)) return false;
  if (activeFilter(f.plateformes) && !f.plateformes.includes(d.plateforme)) {
    return false;
  }
  if (
    activeFilter(f.formatIds) &&
    (d.formatId === null || !f.formatIds.includes(d.formatId))
  ) {
    return false;
  }
  if (
    activeFilter(f.campaignIds) &&
    (d.campaignId === null || !f.campaignIds.includes(d.campaignId))
  ) {
    return false;
  }
  return true;
}

/**
 * Engagement rate = (likes + commentaires) / vues. Formule validée avec
 * l'utilisateur. Retourne null si vues <= 0 (pas de dénominateur exploitable),
 * affiché "—" côté UI.
 */
export function engagementRate(
  likes: number,
  comments: number,
  vues: number,
): number | null {
  if (vues <= 0) return null;
  return (likes + comments) / vues;
}

export type MetricTriple = {
  vues: number;
  likes: number;
  comments: number;
  /**
   * Warmup PAR POST. Le tri-état définit la POPULATION AFFICHÉE (sommes/counts) ;
   * ce flag pilote le DÉNOMINATEUR des TAUX (jamais les sommes). Absent = non-warmup.
   */
  isWarmup?: boolean;
};

export type GlobalStats = {
  vues: number;
  likes: number;
  comments: number;
  /** (Σlikes + Σcomments) / Σvues du sous-ensemble ratio, null si Σvues <= 0. */
  engagement: number | null;
  /** Vues du SOUS-ENSEMBLE servant de dénominateur à l'engagement (cf mode). */
  engagementVues: number;
};

/**
 * Sous-ensemble de lecture d'un TAUX pour un mode donné : hors warmup partout,
 * SAUF en mode "only" où le warmup EST l'objet mesuré. Le tri-état pilote la
 * population AFFICHÉE ; un taux, lui, ne mélange jamais chauffe et promo (TD-019).
 */
function ratioModeOf(mode: WarmupMode): WarmupMode {
  return mode === "only" ? "only" : "exclude";
}

/**
 * Stats globales (zone 2). Sommes des vues/likes/commentaires sur TOUS les posts
 * fournis (la population du mode). L'engagement agrégé — (Σlikes + Σcomments) /
 * Σvues, PAS une moyenne par post — se calcule sur le sous-ensemble HORS warmup
 * (SAUF mode "only"), parce qu'un taux mélangeant contenu de chauffe et promo
 * n'est pas interprétable et pénalise une créatrice pour la chauffe demandée.
 * `engagementVues` = le dénominateur réellement utilisé (à afficher près du taux).
 */
export function computeGlobalStats(
  posts: MetricTriple[],
  mode: WarmupMode = DEFAULT_WARMUP_MODE,
): GlobalStats {
  const ratioMode = ratioModeOf(mode);
  let vues = 0;
  let likes = 0;
  let comments = 0;
  let rVues = 0;
  let rLikes = 0;
  let rComments = 0;
  for (const p of posts) {
    vues += p.vues;
    likes += p.likes;
    comments += p.comments;
    if (passesWarmupMode(p.isWarmup === true, ratioMode)) {
      rVues += p.vues;
      rLikes += p.likes;
      rComments += p.comments;
    }
  }
  return {
    vues,
    likes,
    comments,
    engagement: engagementRate(rLikes, rComments, rVues),
    engagementVues: rVues,
  };
}

export type CategoryItem = MetricTriple & {
  /** Clé de regroupement (id de créateur, nom de plateforme, mediaType…). */
  key: string;
  /** Libellé affiché pour cette clé. */
  label: string;
};

export type CategoryAggregate = {
  key: string;
  label: string;
  vues: number;
  likes: number;
  comments: number;
  /** Engagement agrégé = (Σlikes + Σcomments) / Σvues du sous-ensemble ratio. */
  engagement: number | null;
  /** Vues du sous-ensemble servant de dénominateur à l'engagement (cf mode). */
  engagementVues: number;
};

type CategoryAcc = {
  key: string;
  label: string;
  vues: number;
  likes: number;
  comments: number;
  rVues: number;
  rLikes: number;
  rComments: number;
};

/**
 * Agrège une liste de posts (déjà projetés sur une dimension via {key,label})
 * en lignes par catégorie, triées par vues décroissantes. Sert aux 4 charts de
 * comparaison (Vues par plateforme/créateur/format + Engagement par plateforme).
 * Le label de la 1re occurrence d'une clé fait foi. Même règle que
 * `computeGlobalStats` : sommes sur TOUTE la catégorie, engagement sur son
 * sous-ensemble HORS warmup (SAUF mode "only").
 */
export function aggregateByCategory(
  items: CategoryItem[],
  mode: WarmupMode = DEFAULT_WARMUP_MODE,
): CategoryAggregate[] {
  const ratioMode = ratioModeOf(mode);
  const map = new Map<string, CategoryAcc>();
  for (const it of items) {
    let cur = map.get(it.key);
    if (!cur) {
      cur = {
        key: it.key,
        label: it.label,
        vues: 0,
        likes: 0,
        comments: 0,
        rVues: 0,
        rLikes: 0,
        rComments: 0,
      };
      map.set(it.key, cur);
    }
    cur.vues += it.vues;
    cur.likes += it.likes;
    cur.comments += it.comments;
    if (passesWarmupMode(it.isWarmup === true, ratioMode)) {
      cur.rVues += it.vues;
      cur.rLikes += it.likes;
      cur.rComments += it.comments;
    }
  }
  return [...map.values()]
    .map((r) => ({
      key: r.key,
      label: r.label,
      vues: r.vues,
      likes: r.likes,
      comments: r.comments,
      engagement: engagementRate(r.rLikes, r.rComments, r.rVues),
      engagementVues: r.rVues,
    }))
    .sort((a, b) => b.vues - a.vues);
}

/**
 * Série « vues gagnées par jour ». Plus une réplique : la DÉFINITION vit dans
 * `convex/viewsDaily.ts` (module pur, importable des deux côtés) et n'est que
 * ré-exportée ici pour les appelants historiques du tracker. Cf le précédent
 * `lib/model-video-embed.ts` ↔ `convex/postUrlDate.ts`.
 */
export {
  computeDailyViewDeltas,
  parisDayKey,
  ESTIMATED_SPAN_MS,
  type SnapshotPoint,
  type DailyPoint,
} from "../convex/viewsDaily";

/** Libellé du bucket des publications sans campagne rattachée. */
export const CAMPAIGN_NONE_LABEL = "Hors campagne";
/** Libellé du bucket d'agrégation au-delà du top N. */
export const CAMPAIGN_OTHERS_LABEL = "Autres";
/** Au-delà de ce nombre de campagnes AVEC des vues, le reste est agrégé. */
export const CAMPAIGN_TOP_N = 10;

/**
 * Mise en forme du graphe « Vues par campagne ».
 *
 * `aggregateByCategory` a déjà trié par vues décroissantes ; cette fonction ne
 * fait que RANGER : au-delà de `topN` campagnes ayant des vues, le reste est
 * agrégé en « Autres », et « Hors campagne » est toujours renvoyé EN DERNIER.
 *
 * Pourquoi « Hors campagne » à part et jamais dans « Autres » : ce n'est pas une
 * petite campagne, c'est une absence de rattachement. La fondre dans « Autres »
 * masquerait un défaut de données derrière un libellé de commodité.
 *
 * Les campagnes à 0 vue sont écartées : une barre de longueur nulle n'apprend
 * rien et pousse les autres hors de l'écran (le graphe dimensionne sa hauteur au
 * nombre de lignes).
 */
export function shapeCampaignRows(
  rows: CategoryAggregate[],
  topN: number = CAMPAIGN_TOP_N,
): CategoryAggregate[] {
  const horsCampagne = rows.filter((r) => r.label === CAMPAIGN_NONE_LABEL);
  const nommees = rows.filter(
    (r) => r.label !== CAMPAIGN_NONE_LABEL && r.vues > 0,
  );
  if (nommees.length <= topN) return [...nommees, ...horsCampagne];

  const top = nommees.slice(0, topN);
  const reste = nommees.slice(topN);
  const autres: CategoryAggregate = {
    key: "__autres__",
    label: `${CAMPAIGN_OTHERS_LABEL} (${reste.length})`,
    vues: reste.reduce((s, r) => s + r.vues, 0),
    likes: reste.reduce((s, r) => s + r.likes, 0),
    comments: reste.reduce((s, r) => s + r.comments, 0),
    // Engagement d'un agrégat : recalculé sur les totaux, jamais moyenné — une
    // moyenne de taux donnerait un poids égal à une campagne de 10 vues et à une
    // de 100 000.
    engagement: engagementRate(
      reste.reduce((s, r) => s + r.likes, 0),
      reste.reduce((s, r) => s + r.comments, 0),
      reste.reduce((s, r) => s + r.engagementVues, 0),
    ),
    engagementVues: reste.reduce((s, r) => s + r.engagementVues, 0),
  };
  return [...top, autres, ...horsCampagne];
}

/**
 * Logique PURE de la vue Tracker (data des posts publiés). Testée en vitest
 * (lib/tracker-data.test.ts). Consommée côté client (stats globales + agrégats
 * par catégorie pour les charts) ET — pour `computeDailyViewDeltas` et
 * `matchesDimensionFilters` — DUPLIQUÉE côté serveur (convex/trackerData.ts) car
 * convex/ ne peut pas importer lib/ (règle A6, cross-tsconfig). Toute évolution
 * doit être répliquée dans les deux.
 */

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
};

export type GlobalStats = {
  vues: number;
  likes: number;
  comments: number;
  /** (Σlikes + Σcomments) / Σvues, null si Σvues <= 0. */
  engagement: number | null;
};

/**
 * Stats globales (zone 2) : somme des vues/likes/commentaires des posts
 * filtrés + engagement agrégé. L'engagement agrégé se calcule sur les SOMMES
 * (Σlikes + Σcomments) / Σvues — PAS une moyenne des engagements par post.
 */
export function computeGlobalStats(posts: MetricTriple[]): GlobalStats {
  let vues = 0;
  let likes = 0;
  let comments = 0;
  for (const p of posts) {
    vues += p.vues;
    likes += p.likes;
    comments += p.comments;
  }
  return { vues, likes, comments, engagement: engagementRate(likes, comments, vues) };
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
  /** Engagement agrégé de la catégorie = (Σlikes + Σcomments) / Σvues. */
  engagement: number | null;
};

/**
 * Agrège une liste de posts (déjà projetés sur une dimension via {key,label})
 * en lignes par catégorie, triées par vues décroissantes. Sert aux 4 charts de
 * comparaison (Vues par plateforme/créateur/format + Engagement par plateforme).
 * Le label de la 1re occurrence d'une clé fait foi.
 */
export function aggregateByCategory(items: CategoryItem[]): CategoryAggregate[] {
  const map = new Map<string, CategoryAggregate>();
  for (const it of items) {
    const cur = map.get(it.key);
    if (cur) {
      cur.vues += it.vues;
      cur.likes += it.likes;
      cur.comments += it.comments;
    } else {
      map.set(it.key, {
        key: it.key,
        label: it.label,
        vues: it.vues,
        likes: it.likes,
        comments: it.comments,
        engagement: null,
      });
    }
  }
  const rows = [...map.values()].map((r) => ({
    ...r,
    engagement: engagementRate(r.likes, r.comments, r.vues),
  }));
  return rows.sort((a, b) => b.vues - a.vues);
}

export type SnapshotPoint = {
  publicationId: string;
  capturedAt: number;
  vues: number;
};

export type DailyPoint = {
  /** Jour calendaire UTC, "YYYY-MM-DD" (lexicographique = chronologique). */
  date: string;
  value: number;
};

/** Clé de jour calendaire UTC, "YYYY-MM-DD". Identique à bucketKey(day) côté
 *  metricSnapshots (cohérence des axes temporels). */
export function dayKeyUTC(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Vues GAGNÉES par jour (PAS cumulées) : pour chaque publication, on calcule le
 * delta de vues entre snapshots CONSÉCUTIFS, et on l'attribue au jour du
 * snapshot le plus récent du couple ; on somme ces deltas sur tous les posts,
 * par jour. La courbe montre donc le rythme réel de génération de vues (pics et
 * creux), pas une somme monotone croissante.
 *
 * Détails :
 *  - Le 1er snapshot in-window de chaque post sert de RÉFÉRENCE (aucun delta
 *    émis) : on ne compte que les vues gagnées À L'INTÉRIEUR de la fenêtre.
 *  - Deltas négatifs (recomptage plateforme, suppression de vues) ramenés à 0
 *    pour une lecture "vues gagnées" propre.
 *  - Plusieurs snapshots le même jour pour un même post : leurs deltas
 *    consécutifs s'additionnent (gain net du jour).
 *
 * `snaps` peut arriver dans n'importe quel ordre ; le tri par capturedAt est
 * fait ici, par publication.
 */
export function computeDailyViewDeltas(snaps: SnapshotPoint[]): DailyPoint[] {
  const byPub = new Map<string, SnapshotPoint[]>();
  for (const s of snaps) {
    const arr = byPub.get(s.publicationId);
    if (arr) arr.push(s);
    else byPub.set(s.publicationId, [s]);
  }

  const dayTotals = new Map<string, number>();
  for (const arr of byPub.values()) {
    arr.sort((a, b) => a.capturedAt - b.capturedAt);
    for (let i = 1; i < arr.length; i++) {
      const delta = Math.max(0, arr[i].vues - arr[i - 1].vues);
      if (delta === 0) continue;
      const key = dayKeyUTC(arr[i].capturedAt);
      dayTotals.set(key, (dayTotals.get(key) ?? 0) + delta);
    }
  }

  return [...dayTotals.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

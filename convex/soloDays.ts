/**
 * ATTRIBUTION PAR JOURS SOLO (règle A3) — remplace la fenêtre 24 h.
 *
 * Sans lien tracké, la fenêtre 24 h dupliquait les inscriptions sur TOUTES les
 * créatrices ayant publié le même jour (coût par client faussé d'un facteur ~13).
 * On ne garde donc que les JOURS SOLO : les jours où UNE SEULE créatrice a publié
 * en phase promo. Ces jours-là, les inscriptions/clients lui reviennent SANS
 * ambiguïté. Les autres jours affichent « non attribuable » — jamais un chiffre
 * inventé.
 *
 * Module PUR (pas de Date : les jours arrivent déjà bucketisés par l'appelant, en
 * UTC, pour coïncider avec la série quotidienne PostHog). Vit en convex/ (getAttribution
 * le consomme). Testé côté lib via `import ../convex/soloDays`.
 */

/** Une vidéo (assignment) publiée en promo un jour donné. */
export interface PromoVideo {
  /** Jour de publication "YYYY-MM-DD" (UTC — même bucket que la série PostHog). */
  day: string;
  creatorId: string;
  creatorName: string;
  /** Vues promo (non-warmup) de la vidéo. */
  promoViews: number;
}

/** Comportement quotidien issu de PostHog (série overview.daily, internes exclus). */
export interface DailyBehavior {
  day: string;
  visitors: number;
  signups: number;
  /** Clients (abonnements) du jour. */
  clients: number;
}

export interface SoloDayCreator {
  creatorId: string;
  creatorName: string;
  promoViews: number;
  videos: number;
}

export interface SoloDay {
  day: string;
  /** Créatrices distinctes ayant publié en promo ce jour (tri vues décroissant). */
  creators: SoloDayCreator[];
  promoViews: number;
  videos: number;
  /** Exactement une créatrice a publié ce jour. */
  isSolo: boolean;
  /**
   * Attribution CERTAINE — jour solo UNIQUEMENT. null = « non attribuable » (≥2
   * créatrices). Les compteurs restent null si le jour sort de la série PostHog.
   */
  attribution: {
    creatorId: string;
    creatorName: string;
    visitors: number | null;
    signups: number | null;
    clients: number | null;
  } | null;
}

/**
 * Jours solo + attribution certaine. Regroupe les vidéos par (jour, créatrice),
 * marque solo les jours à une seule créatrice, et n'attribue le comportement
 * quotidien PostHog QUE sur ces jours-là. Trié du plus récent au plus ancien.
 */
export function computeSoloDays(
  videos: readonly PromoVideo[],
  daily: readonly DailyBehavior[],
): SoloDay[] {
  const dailyByDay = new Map(daily.map((d) => [d.day, d]));
  const byDay = new Map<string, Map<string, SoloDayCreator>>();
  for (const v of videos) {
    const creators = byDay.get(v.day) ?? new Map<string, SoloDayCreator>();
    const c = creators.get(v.creatorId) ?? {
      creatorId: v.creatorId,
      creatorName: v.creatorName,
      promoViews: 0,
      videos: 0,
    };
    c.promoViews += Math.max(0, v.promoViews);
    c.videos += 1;
    creators.set(v.creatorId, c);
    byDay.set(v.day, creators);
  }

  const out: SoloDay[] = [];
  for (const [day, creatorsMap] of byDay) {
    const creators = [...creatorsMap.values()].sort(
      (a, b) => b.promoViews - a.promoViews,
    );
    const promoViews = creators.reduce((s, c) => s + c.promoViews, 0);
    const videos_ = creators.reduce((s, c) => s + c.videos, 0);
    const isSolo = creators.length === 1;
    let attribution: SoloDay["attribution"] = null;
    if (isSolo) {
      const c = creators[0];
      const d = dailyByDay.get(day);
      attribution = {
        creatorId: c.creatorId,
        creatorName: c.creatorName,
        visitors: d ? d.visitors : null,
        signups: d ? d.signups : null,
        clients: d ? d.clients : null,
      };
    }
    out.push({ day, creators, promoViews, videos: videos_, isSolo, attribution });
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : -1));
}

// ─── Efficacité par créatrice ────────────────────────────────────────────────

/** Seuil « hit » : une vidéo qui dépasse ce nombre de vues promo. */
export const HIT_VIEWS_THRESHOLD = 50_000;

export interface CreatorEfficiency {
  creatorId: string;
  creatorName: string;
  videos: number;
  promoViews: number;
  /** Médiane des vues par vidéo (prédit la prochaine). null si aucune vidéo. */
  medianViews: number | null;
  /** Nb de vidéos au-dessus du seuil hit (prédit le volume du mois). */
  hitCount: number;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Efficacité promo par créatrice : la MÉDIANE prédit la prochaine vidéo, le taux
 * de HIT prédit le volume du mois — la moyenne ne prédit rien, on ne la calcule pas.
 */
export function computeCreatorEfficiency(
  videos: readonly PromoVideo[],
): CreatorEfficiency[] {
  const byCreator = new Map<string, { name: string; views: number[] }>();
  for (const v of videos) {
    const e = byCreator.get(v.creatorId) ?? { name: v.creatorName, views: [] };
    e.views.push(Math.max(0, v.promoViews));
    byCreator.set(v.creatorId, e);
  }
  return [...byCreator.entries()]
    .map(([creatorId, e]) => ({
      creatorId,
      creatorName: e.name,
      videos: e.views.length,
      promoViews: e.views.reduce((s, x) => s + x, 0),
      medianViews: median(e.views),
      hitCount: e.views.filter((x) => x > HIT_VIEWS_THRESHOLD).length,
    }))
    .sort((a, b) => b.promoViews - a.promoViews);
}

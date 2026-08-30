/**
 * FUNNEL PAR SEGMENT (pays, langue) — mise en forme du payload PostHog.
 *
 * Le piège de cette carte n'est pas le calcul, c'est la LECTURE.
 *
 * `(inconnu)` n'est pas une ligne comme les autres : c'est la mesure de ce que
 * la carte NE dit PAS. Sur `language` elle vaut 84 % des visiteurs en prod,
 * parce que l'app pose la propriété à l'inscription, après les pageviews. Un
 * classement qui n'annonce pas cette part se lit comme une répartition du
 * trafic alors qu'il n'en décrit qu'une fraction — d'où `unknownShare`, rendu à
 * part pour que l'écran l'affiche avant le tableau et non dedans.
 *
 * Et les segments NE S'ADDITIONNENT PAS. Le pays vient de l'EVENT : une personne
 * qui visite depuis la France et achète depuis la Belgique compte dans les deux.
 * La somme des lignes dépasse donc le nombre réel de personnes — ce module ne
 * produit jamais de total, et l'écran ne doit pas en fabriquer un.
 */

/** Une étape du funnel, telle que PostHog la rend. */
export interface SegmentStep {
  key: string;
  count: number;
}

export interface SegmentPayload {
  segments: readonly { key: string; steps: readonly SegmentStep[] }[];
}

export interface SegmentRow {
  /** Libellé du segment (« France », « fr », « (inconnu) »). */
  key: string;
  visit: number;
  signup: number;
  paywall: number;
  checkout: number;
  subs: number;
  /** Visiteurs → clients, en FRACTION. null si aucun visiteur (pas de division inventée). */
  rate: number | null;
}

export interface SegmentRows {
  rows: SegmentRow[];
  /** Visiteurs du segment « (inconnu) ». */
  unknownVisitors: number;
  /**
   * Part des visiteurs non attribués, en fraction. `null` seulement quand il n'y
   * a AUCUNE donnée — 0 veut dire « tout est attribué », et les deux doivent se
   * distinguer à l'écran.
   */
  unknownShare: number | null;
}

/** Libellé du segment non renseigné, posé par `segExpr` côté HogQL. */
export const UNKNOWN_SEGMENT = "(inconnu)";

function stepOf(steps: readonly SegmentStep[], key: string): number {
  return steps.find((s) => s.key === key)?.count ?? 0;
}

export function buildSegmentRows(payload: SegmentPayload): SegmentRows {
  const rows: SegmentRow[] = payload.segments.map((s) => {
    const visit = stepOf(s.steps, "visit");
    const subs = stepOf(s.steps, "subscription_completed");
    return {
      key: s.key,
      visit,
      signup: stepOf(s.steps, "signup_completed"),
      paywall: stepOf(s.steps, "paywall_viewed"),
      checkout: stepOf(s.steps, "checkout_started"),
      subs,
      rate: visit > 0 ? subs / visit : null,
    };
  });
  rows.sort((a, b) => b.visit - a.visit || (a.key < b.key ? -1 : 1));

  const totalVisitors = rows.reduce((n, r) => n + r.visit, 0);
  const unknownVisitors = rows.find((r) => r.key === UNKNOWN_SEGMENT)?.visit ?? 0;
  return {
    rows,
    unknownVisitors,
    unknownShare: totalVisitors > 0 ? unknownVisitors / totalVisitors : null,
  };
}

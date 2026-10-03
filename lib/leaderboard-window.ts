/**
 * LE CLASSEMENT VU DE L'ACCUEIL — ta place, tes voisines, et l'écart.
 *
 * Module PUR. Le classement complet (podium + liste) reste dans Gains ; l'accueil
 * n'en montre qu'une FENÊTRE autour de la créatrice. Arbitrage du 13/09/2026 :
 * voir qu'on est 17e sur 19 démotive, voir qu'on est à 23 $ de la place du
 * dessus donne envie de publier.
 *
 * Les entrées arrivent TRIÉES et RANKÉES par le serveur (computeProjectLeaderboard) :
 * ce module ne reclasse rien, il découpe.
 */

export type RankedEntry = {
  creatorId: string;
  name: string;
  rank: number;
  /** Gains du cycle, dans la devise de CETTE créatrice. */
  totalDue: number;
  isMe: boolean;
  /**
   * 1 unité de la devise de la ligne = `rate` unités de la devise du projet
   * (cf convex/payCurrency). Absent ⇒ 1 : tout le monde est payé dans la devise
   * du projet, et l'écart se calcule comme avant.
   */
  rate?: number;
};

export type LeaderboardWindow<T extends RankedEntry> = {
  me: T;
  /** Les lignes à afficher, dans l'ordre du classement, `me` compris. */
  rows: T[];
  /** La créatrice juste au-dessus, ou `null` si tu es première. */
  ahead: T | null;
  /**
   * Ce qui te sépare d'elle (≥ 0 ; 0 à égalité), `null` si tu es première —
   * TOUJOURS dans TA devise : si elle est payée dans une autre, son gain y est
   * ramené au taux du projet avant la soustraction.
   */
  gapToAhead: number | null;
  /** Nombre de classées. */
  total: number;
};

/**
 * Fenêtre de `radius` lignes de chaque côté de la créatrice. Quand elle est en
 * tête ou en queue, la fenêtre glisse pour garder le même nombre de lignes :
 * une fenêtre de 3 reste de 3, première comprise.
 *
 * `null` si elle n'est pas classée (aucun post, donc aucun cycle) : l'accueil ne
 * doit pas inventer une place.
 */
export function leaderboardWindow<T extends RankedEntry>(
  entries: readonly T[],
  radius = 1,
): LeaderboardWindow<T> | null {
  const i = entries.findIndex((e) => e.isMe);
  if (i < 0) return null;
  const size = Math.min(entries.length, radius * 2 + 1);
  const start = Math.max(0, Math.min(i - radius, entries.length - size));
  const me = entries[i];
  const ahead = i > 0 ? entries[i - 1] : null;
  return {
    me,
    rows: entries.slice(start, start + size),
    ahead,
    // Arrondi au centime : 318.4 - 142.1 donnerait 176.29999999999998.
    gapToAhead:
      ahead === null
        ? null
        : Math.max(
            0,
            Math.round(
              (aheadInMyCurrency(ahead, me) - me.totalDue) * 100,
            ) / 100,
          ),
    total: entries.length,
  };
}

/** Le gain de `ahead` exprimé dans la devise de `me` (identique si même taux). */
function aheadInMyCurrency(ahead: RankedEntry, me: RankedEntry): number {
  const a = ahead.rate ?? 1;
  const m = me.rate ?? 1;
  return a === m || !(m > 0) ? ahead.totalDue : (ahead.totalDue * a) / m;
}

/**
 * FENÊTRE DE RÉMUNÉRATION D'UN POST — au-delà de J+30, les vues continuent
 * d'être relevées mais n'entrent plus dans la paie.
 *
 * LA RÈGLE. Les vues RETENUES d'un post sont celles de son DERNIER relevé dans
 * la fenêtre [datePubli, datePubli + 31 j[ — c'est-à-dire le dernier snapshot
 * dont `daysSincePublication ≤ 30`. Passé cette borne, la mesure continue (le
 * tracker, « Mes vidéos » et les analytics affichent toujours les vues réelles)
 * mais l'assiette de paie ne bouge plus.
 *
 * ⚠️ TROIS « 30 » COHABITENT DANS LE DÉPÔT, et ils n'ont aucun rapport :
 *   - `PAY_WINDOW_DAYS` (ici, 30 j)          → âge d'un POST au-delà duquel ses
 *     vues ne sont plus rémunérées ;
 *   - `CYCLE_LENGTH_DAYS` (lib/pay-cycle)    → longueur d'un CYCLE de paie,
 *     ancré sur le 1er post de la créatrice, qui DÉCOUPE le temps ;
 *   - `ACTIVE_ACCOUNT_WINDOW_DAYS` (syncScope) → un COMPTE est « actif » s'il a
 *     publié dans les 30 j, ce qui décide de ce qu'on relève la nuit.
 * Les faire converger accidentellement (« c'est le même 30 ») casserait trois
 * règles produit d'un coup. Le relevé, lui, va jusqu'à J+90
 * (`TRACKING_WINDOW_DAYS`) et n'est PAS touché par ce module : on garde la
 * mesure, on plafonne la rémunération.
 *
 * ⚠️ LE NOMBRE RETENU NE DÉPEND PAS DE L'HORLOGE. `retainedViews` calcule
 * l'assiette à partir du seul relevé de fenêtre ; `now` ne sert qu'à NOMMER
 * l'état (mesure en cours / fenêtre close). Une assiette qui changerait à
 * minuit sans qu'aucune donnée n'ait bougé serait invérifiable.
 *
 * ⚠️ JAMAIS DE ZÉRO FABRIQUÉ. Un post dont la fenêtre est close SANS aucun
 * relevé dedans (suivi démarré tard : lien Instagram non rapprochable,
 * shortlink, lien collé des semaines après) n'est PAS plafonné à zéro — on
 * retient ses vues mesurées et l'état dit `unmeasured`, pour que l'écran
 * distingue « plafonné » de « jamais mesuré ». Sur le parc au 30/08/2026 :
 * 0 post dans ce cas, et 59 posts > J+30 sans relevé qui sont tous à 0 vue.
 *
 * Module PUR (aucun import `_generated`) → importable côté serveur ET depuis
 * `lib/` pour les tests, en UNE seule définition (même patron que
 * `convex/viewCounters.ts`, `convex/remunerate.ts`, `convex/postUrlDate.ts`).
 * AUCUNE réplique A6 à maintenir.
 */

const DAY_MS = 86_400_000;

/**
 * Âge (en jours) au-delà duquel les vues d'un post cessent d'être rémunérées.
 * Cf. l'avertissement « trois 30 » en tête de fichier avant de le partager.
 */
export const PAY_WINDOW_DAYS = 30;

/**
 * Premier instant EXCLU de la fenêtre de rémunération.
 *
 * `daysSincePublication = floor((capturedAt − datePubli) / jour)`, donc
 * « ≤ 30 jours » ⇔ `capturedAt < datePubli + 31 jours`. Écrire la borne ainsi
 * (et non `+ 30 j`) est ce qui permet de la passer telle quelle à une plage
 * d'index sur `capturedAt` sans relire `daysSincePublication` — le jour J+30
 * entier reste dedans.
 */
export function payWindowEndsAt(datePubli: number): number {
  return datePubli + (PAY_WINDOW_DAYS + 1) * DAY_MS;
}

/** Le post a-t-il dépassé sa fenêtre de rémunération à l'instant `now` ? */
export function payWindowIsClosed(datePubli: number, now: number): boolean {
  return now >= payWindowEndsAt(datePubli);
}

/** Le relevé retenu : le DERNIER de la fenêtre. `null` = aucun. */
export type WindowSnapshot = {
  vues: number;
  /** Jour du relevé retenu — affiché, donc jamais deviné. */
  daysSincePublication: number;
};

export type RetainedViews = {
  /** Vues qui ENTRENT dans la paie (CPM + cumul de paliers). */
  views: number;
  /**
   * `open`       : fenêtre en cours, la paie suit les vues (cas nominal) ;
   * `closed`     : fenêtre close, l'assiette est figée au relevé retenu ;
   * `unmeasured` : fenêtre close mais jamais relevée dedans → on retient les
   *                vues mesurées, et l'écran doit le DIRE (≠ plafonné).
   */
  status: "open" | "closed" | "unmeasured";
  /** Jour du relevé retenu (`closed` uniquement), pour l'affichage. */
  retainedAtDay: number | null;
  /** Vues acquises HORS fenêtre (mesurées − retenues), ≥ 0. */
  viewsOutsideWindow: number;
};

/**
 * Vues retenues pour la paie d'UN post.
 *
 * `min(mesurées, relevé de fenêtre)` et non le relevé seul : un compteur qui
 * REDESCEND après J+30 (post masqué, vidéo retirée) ferait sinon payer plus que
 * ce que la plateforme affiche. Un plafond ne doit jamais qu'enlever.
 */
export function retainedViews(input: {
  datePubli: number;
  /** Vues mesurées les plus récentes (`publications.vuesLatest`). */
  measuredViews: number;
  /** Dernier relevé de la fenêtre, `null` s'il n'y en a aucun. */
  windowSnapshot: WindowSnapshot | null;
  now: number;
}): RetainedViews {
  const measured = Math.max(0, input.measuredViews);
  if (!payWindowIsClosed(input.datePubli, input.now)) {
    return {
      views: measured,
      status: "open",
      retainedAtDay: null,
      viewsOutsideWindow: 0,
    };
  }
  if (input.windowSnapshot === null) {
    return {
      views: measured,
      status: "unmeasured",
      retainedAtDay: null,
      viewsOutsideWindow: 0,
    };
  }
  const views = Math.min(measured, Math.max(0, input.windowSnapshot.vues));
  return {
    views,
    status: "closed",
    retainedAtDay: input.windowSnapshot.daysSincePublication,
    viewsOutsideWindow: measured - views,
  };
}

/**
 * Ce qu'on AFFICHE du plafond pour une VIDÉO (une assignation = N posts).
 *
 * Ne compte QUE les posts qui entrent dans la paie. Annoncer « plafonné » sur un
 * post warmup non rémunéré serait faux : il n'a jamais rien rapporté, il n'y a
 * rien à plafonner — et la créatrice lirait une perte qui n'existe pas.
 *
 * `closed` reste faux tant qu'aucun post rémunéré n'a de fenêtre close ET
 * mesurée : un post `unmeasured` n'est pas plafonné (on retient ses vues), donc
 * il n'y a rien à annoncer.
 */
export function aggregatePayWindow(
  posts: readonly { retained: RetainedViews; isPaid: boolean }[],
): { closed: boolean; viewsOutsideWindow: number } {
  let closed = false;
  let viewsOutsideWindow = 0;
  for (const p of posts) {
    if (!p.isPaid) continue;
    if (p.retained.status === "closed") closed = true;
    viewsOutsideWindow += p.retained.viewsOutsideWindow;
  }
  return { closed, viewsOutsideWindow };
}

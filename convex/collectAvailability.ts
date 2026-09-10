/**
 * DIRE « ON NE SAIT PAS » — statut de collecte d'une publication.
 *
 * ── Le défaut que ce module ferme ────────────────────────────────────────────
 * Partout dans la lecture, l'absence de mesure était repliée sur `0` :
 * `p.vuesLatest ?? 0` côté tracker, `pub.vuesLatest ?? 0` côté paie. Trois
 * situations très différentes finissaient identiques à l'écran :
 *   - la vidéo a vraiment fait zéro vue      → une MESURE ;
 *   - elle vient d'être publiée              → pas encore relevée ;
 *   - sa collecte échoue                     → on ne sait pas, et on sait pourquoi.
 *
 * Le 2026-08-31, sept publications Snytch cumulaient 78 476 vues réelles en
 * étant affichées « 0 vue » — et rémunérées comme telles. Le repli maison
 * (cf `convex/tiktokFallback.ts`) en récupère la plupart ; ce module traite ce
 * qui restera toujours : ce qu'aucune collecte ne pourra lire, comme un post
 * réglé « visible par son autrice uniquement ».
 *
 * ── La règle de paie, arbitrée ───────────────────────────────────────────────
 * On SIGNALE, on PAIE QUAND MÊME. Une vidéo non mesurée ne bloque pas le cycle
 * et ne le retarde pas ; elle apparaît comme non mesurée pour que la décision
 * soit prise en connaissance de cause, jamais à l'insu de qui valide. Ce module
 * ne change donc AUCUN montant — il ajoute ce qu'il faut pour le dire.
 *
 * Même vocabulaire que `savesAvailability` (cf `convex/decisionThresholds.ts`),
 * volontairement : un deuxième vocabulaire d'absence serait un troisième bug.
 */

export type CollectAvailability =
  /** Au moins un relevé existe : le chiffre affiché est une mesure. */
  | "measured"
  /** Jamais relevée et jamais en échec — publiée trop récemment, ça vient. */
  | "pending"
  /** La collecte a échoué. `lastCollectFailureReason` dit pourquoi. */
  | "failed";

/** Ce que la lecture connaît d'une publication pour trancher son statut. */
export type CollectState = {
  /** `publications.latestSnapshotAt` — présent dès le premier relevé. */
  latestSnapshotAt?: number;
  /** `publications.collectFailureStreak` — échecs consécutifs. */
  collectFailureStreak?: number;
};

/**
 * Statut de collecte.
 *
 * L'ordre compte : un relevé réussi PRIME sur un historique d'échecs. Une
 * publication qui a échoué trois nuits puis a été rattrapée est « mesurée » —
 * et de toute façon la réussite efface les marqueurs d'échec
 * (cf `upsertApifySnapshot`), donc les deux mécanismes disent la même chose.
 */
export function collectAvailability(pub: CollectState): CollectAvailability {
  if (pub.latestSnapshotAt !== undefined) return "measured";
  return (pub.collectFailureStreak ?? 0) > 0 ? "failed" : "pending";
}

/**
 * Phrase courte affichable, à la place du chiffre.
 *
 * `reason` est le motif enregistré par la collecte (« visible par son autrice
 * uniquement », « HTTP 429 »…). Il est REPRIS TEL QUEL quand il existe : il est
 * plus précis que tout ce qu'on pourrait redire ici, et c'est exactement ce que
 * la personne qui regarde l'écran a besoin de savoir.
 */
export function collectAvailabilityLabel(
  availability: CollectAvailability,
  reason?: string,
): string | null {
  if (availability === "measured") return null;
  if (availability === "pending") return "En attente du premier relevé";
  return reason !== undefined && reason.trim() !== ""
    ? `Non mesuré — ${reason}`
    : "Non mesuré";
}

/**
 * Faut-il afficher un chiffre, ou un tiret ?
 *
 * Le point unique où cette décision se prend. Un `0` affiché pour une mesure
 * absente est un mensonge ; un tiret ne l'est pas.
 */
export function showsMetric(availability: CollectAvailability): boolean {
  return availability === "measured";
}

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
 * étant affichées « 0 vue » — et rémunérées comme telles. Le relevé par page publique
 * (cf `convex/tiktokInternal.ts`) en récupère la plupart ; ce module traite ce
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
  /**
   * La plateforme MASQUE le compteur : on sait seulement « moins de N vues »
   * (`publications.viewsMaskedBelow` ; Snapchat sous 1 000). Toujours PAS une
   * mesure — la paie la compte comme non mesurée —, mais pas une ignorance
   * totale non plus : l'écran dit « < 1 000 » au lieu d'un tiret.
   */
  | "masked"
  /** La collecte a échoué. `lastCollectFailureReason` dit pourquoi. */
  | "failed";

/** Ce que la lecture connaît d'une publication pour trancher son statut. */
export type CollectState = {
  /** `publications.latestSnapshotAt` — présent dès le premier relevé. */
  latestSnapshotAt?: number;
  /** `publications.collectFailureStreak` — échecs consécutifs. */
  collectFailureStreak?: number;
  /** `publications.viewsMaskedBelow` — compteur masqué sous ce seuil. */
  viewsMaskedBelow?: number;
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
  if ((pub.collectFailureStreak ?? 0) === 0) return "pending";
  return pub.viewsMaskedBelow !== undefined ? "masked" : "failed";
}

/**
 * Phrase courte affichable, à la place du chiffre.
 *
 * `reason` est le motif enregistré par la collecte (« visible par son autrice
 * uniquement », « HTTP 429 »…). Il est REPRIS TEL QUEL quand il existe : il est
 * plus précis que tout ce qu'on pourrait redire ici, et c'est exactement ce que
 * la personne qui regarde l'écran a besoin de savoir.
 */
export type CollectAvailabilityCopy = {
  pending: string;
  failed: string;
  failedWithReason: (reason: string) => string;
  /** « Moins de 1 000 vues — Snapchat masque… » ; `below` déjà formaté. */
  masked?: (below: string) => string;
};

/**
 * Phrases de référence en français. L'écran passe les siennes, traduites
 * (`admin.common.MeasuredOrDash`) ; ce module reste pur.
 */
const COPY_FR: CollectAvailabilityCopy = {
  // i18n-exempt: repli de référence d'un module pur ; l'écran passe sa copie traduite
  pending: "En attente du premier relevé",
  // i18n-exempt: repli de référence d'un module pur ; l'écran passe sa copie traduite
  failed: "Non mesuré",
  // i18n-exempt: repli de référence d'un module pur ; l'écran passe sa copie traduite
  failedWithReason: (reason) => `Non mesuré — ${reason}`,
  // i18n-exempt: repli de référence d'un module pur ; l'écran passe sa copie traduite
  masked: (below) => `Moins de ${below} vues — la plateforme masque le compteur en dessous`,
};

/**
 * `maskedBelow` : le seuil d'un compteur masqué, DÉJÀ formaté pour l'écran
 * (« 1 000 »). Sans lui (ou sans phrase `masked`), un « masked » se dit comme
 * un échec, avec son motif.
 */
export function collectAvailabilityLabel(
  availability: CollectAvailability,
  reason?: string,
  copy: CollectAvailabilityCopy = COPY_FR,
  maskedBelow?: string,
): string | null {
  if (availability === "measured") return null;
  if (availability === "pending") return copy.pending;
  if (availability === "masked" && maskedBelow !== undefined && copy.masked) {
    return copy.masked(maskedBelow);
  }
  return reason !== undefined && reason.trim() !== ""
    ? copy.failedWithReason(reason)
    : copy.failed;
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

/**
 * TEMPS DE RÉPONSE DE LA VALIDATION — les règles PURES (le serveur :
 * convex/videoReviews ; l'écran : components/admin/ReviewDelayCard ; l'outil
 * MCP `validation`).
 *
 * Le délai d'UNE décision court de l'ENTRÉE de la vidéo dans la file
 * (`assignments.inReviewSince` : envoi, renvoi après un refus, mission rétablie,
 * confiance retirée) jusqu'au clic sur « Valider » ou « Refuser ». Heures
 * pleines, nuits et week-ends compris : c'est ce que la créatrice attend.
 *
 * Une vidéo renvoyée après un refus est une NOUVELLE attente : chaque décision
 * compte une fois.
 *
 * Aucune chaîne destinée à l'humain ici : le module est importé par l'écran,
 * qui les traduit.
 */

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;

/** Seuil de la part « traitée vite » : une vidéo envoyée le soir, validée au réveil. */
export const SEUIL_RAPIDE_MS = 12 * HEURE;

export type Decision = "approved" | "rejected";

export type DecisionMesuree = {
  submittedAt: number;
  decidedAt: number;
  decision: Decision;
};

export type Fenetre = {
  /** Décisions comptées. */
  videos: number;
  validees: number;
  refusees: number;
  /** null quand la fenêtre est vide — jamais 0 (« 0 min » mentirait). */
  moyenneMs: number | null;
  medianeMs: number | null;
  /** Part (0..1) des décisions prises en moins de `SEUIL_RAPIDE_MS`. */
  partRapide: number | null;
  plusLongMs: number | null;
};

/** Délai d'une décision, jamais négatif (deux horloges serveur, par prudence). */
export function delaiMs(d: Pick<DecisionMesuree, "submittedAt" | "decidedAt">): number {
  return Math.max(0, d.decidedAt - d.submittedAt);
}

function mediane(triees: readonly number[]): number {
  const n = triees.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? triees[mid] : (triees[mid - 1] + triees[mid]) / 2;
}

/** Les chiffres d'un ensemble de décisions. */
export function fenetre(decisions: readonly DecisionMesuree[]): Fenetre {
  const delais = decisions.map(delaiMs).sort((a, b) => a - b);
  const n = delais.length;
  const validees = decisions.filter((d) => d.decision === "approved").length;
  if (n === 0) {
    return { videos: 0, validees: 0, refusees: 0, moyenneMs: null, medianeMs: null, partRapide: null, plusLongMs: null };
  }
  return {
    videos: n,
    validees,
    refusees: n - validees,
    moyenneMs: delais.reduce((s, x) => s + x, 0) / n,
    medianeMs: mediane(delais),
    partRapide: delais.filter((x) => x < SEUIL_RAPIDE_MS).length / n,
    plusLongMs: delais[n - 1],
  };
}

/** Fenêtre glissante ]now − debutJours ; now − finJours] (en jours de 24 h). */
export function dansLaFenetre<T extends Pick<DecisionMesuree, "decidedAt">>(
  decisions: readonly T[],
  now: number,
  debutJours: number,
  finJours = 0,
): T[] {
  const debut = now - debutJours * JOUR;
  const fin = now - finJours * JOUR;
  // Écrit sans « < » : le contrôle i18n lirait « > … < » comme du texte d'écran.
  return decisions.filter((d) => d.decidedAt - debut > 0 && fin - d.decidedAt >= 0);
}

/** Jours couverts par la lecture du serveur (la plus longue fenêtre affichée). */
export const JOURS_LUS = 30;

export type TempsDeReponse = {
  septJours: Fenetre;
  septJoursAvant: Fenetre;
  trenteJours: Fenetre;
};

/** Les trois fenêtres de l'écran : 7 derniers jours, les 7 d'avant, 30 jours. */
export function tempsDeReponse(decisions: readonly DecisionMesuree[], now: number): TempsDeReponse {
  return {
    septJours: fenetre(dansLaFenetre(decisions, now, 7)),
    septJoursAvant: fenetre(dansLaFenetre(decisions, now, 14, 7)),
    trenteJours: fenetre(dansLaFenetre(decisions, now, JOURS_LUS)),
  };
}

/**
 * Une durée découpée pour l'affichage, à la minute près : jours + heures au-delà
 * d'un jour (les minutes n'y disent plus rien), heures + minutes en dessous,
 * minutes seules sous l'heure.
 */
export type DureeDecoupee =
  | { unite: "minutes"; m: number }
  | { unite: "heures"; h: number; m: number }
  | { unite: "jours"; j: number; h: number };

export function decoupeDuree(ms: number): DureeDecoupee {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 60) return { unite: "minutes", m: minutes };
  if (minutes < 24 * 60) return { unite: "heures", h: Math.floor(minutes / 60), m: minutes % 60 };
  const heures = Math.round(minutes / 60);
  return { unite: "jours", j: Math.floor(heures / 24), h: heures % 24 };
}

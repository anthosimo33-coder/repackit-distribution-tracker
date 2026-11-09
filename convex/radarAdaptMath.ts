/**
 * RADAR — TES ADAPTATIONS : une vidéo « à adapter » reliée à la campagne qui la
 * reprend, et ce que donnent nos publications. Le verdict est CELUI DU PILOTE
 * (convex/pilotePlan) : une vidéo se juge à 72 h sur sa meilleure publication
 * TikTok ou Instagram, gagnante à 1,5× la médiane de sa créatrice (même étage,
 * même plateforme) et 2 000 vues, ou 10 000 vues sans médiane.
 *
 * Une adaptation « marche chez nous » comme un format « réussit » chez les
 * concurrents : au moins 3 vidéos mesurées, une sur deux gagnante ou mieux.
 */
import { medianOf } from "./quadrant";
import { estGagnant, mesurer, PILOTE, type Etage, type VideoPassee } from "./pilotePlan";

export const ADAPT_MIN_MEASURED = 3;

export type AdaptResult = {
  /** Vidéos publiées (au moins une publication promo). */
  published: number;
  /** Vidéos mesurées : une publication relevée a 72 h. */
  measured: number;
  wins: number;
  /** Médiane des « × la médiane de sa créatrice » des vidéos mesurées qui en ont une. */
  medianRatio: number | null;
  medianViews: number | null;
  /** Quand la prochaine vidéo publiée sera mesurée (publication + 72 h). */
  nextResultAt: number | null;
  verdict: "marche" | "neMarchePas" | "tropTot";
};

export function adaptResult(
  videos: readonly VideoPassee[],
  etage: Etage | null,
  medianesDe: (creatorId: string) => Record<string, number | null>,
  now: number,
): AdaptResult {
  let measured = 0;
  let wins = 0;
  const ratios: number[] = [];
  const views: number[] = [];
  let nextResultAt: number | null = null;
  for (const v of videos) {
    const m = mesurer(v, etage, medianesDe(v.creatorId), now);
    if (m) {
      measured++;
      if (estGagnant(m, PILOTE.seuilDefaut)) wins++;
      if (m.ratio !== null) ratios.push(m.ratio);
      views.push(m.vues);
      continue;
    }
    for (const p of v.publications) {
      if (!PILOTE.plateformes.includes(p.plateforme)) continue;
      const at = p.publieeA + PILOTE.maturiteMs;
      if (at > now && (nextResultAt === null || at < nextResultAt)) nextResultAt = at;
    }
  }
  return {
    published: videos.length,
    measured,
    wins,
    medianRatio: medianOf(ratios),
    medianViews: medianOf(views),
    nextResultAt,
    verdict: measured < ADAPT_MIN_MEASURED ? "tropTot" : wins * 2 >= measured ? "marche" : "neMarchePas",
  };
}

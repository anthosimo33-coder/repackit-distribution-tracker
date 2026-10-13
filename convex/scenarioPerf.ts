/**
 * PERFORMANCE PAR SCÉNARIO — l'agrégat pur derrière convex/scenarioAnalytics.
 *
 * Un scénario peut tourner dans plusieurs campagnes (une brique « Scénario »
 * par campagne) : ses vues se cumulent par SCÉNARIO, toutes campagnes
 * confondues, avec le détail par campagne. Mêmes règles que les briques : un
 * post = sa vue à la fenêtre (J+7 par défaut), médiane, jugeable à 50 posts.
 *
 * Module PUR (aucun import `_generated`). Garde : lib/scenario-perf.test.ts.
 */

export type EchantillonScenario = { scenarioId: string; campaignId: string; vues: number };

export type PerfCampagne = { campaignId: string; posts: number; vuesMediane: number | null };

export type PerfScenario = {
  scenarioId: string;
  posts: number;
  vuesMediane: number | null;
  campagnes: PerfCampagne[];
};

/** Médiane (moyenne des deux du milieu sur un nombre pair) — celle de scriptAnalytics. */
export function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const s = [...valeurs].sort((a, b) => a - b);
  const k = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[k - 1]! + s[k]!) / 2 : s[k]!;
}

/**
 * Regroupe les échantillons par scénario, puis par campagne. Les scénarios
 * sortent du plus regardé (médiane) au moins regardé ; les campagnes d'un
 * scénario, de celle qui a le plus de posts à celle qui en a le moins.
 */
export function agregerParScenario(echantillons: readonly EchantillonScenario[]): PerfScenario[] {
  const parScenario = new Map<string, Map<string, number[]>>();
  for (const e of echantillons) {
    const parCampagne = parScenario.get(e.scenarioId) ?? new Map<string, number[]>();
    parCampagne.set(e.campaignId, [...(parCampagne.get(e.campaignId) ?? []), e.vues]);
    parScenario.set(e.scenarioId, parCampagne);
  }
  return [...parScenario.entries()]
    .map(([scenarioId, parCampagne]) => {
      const toutes = [...parCampagne.values()].flat();
      return {
        scenarioId,
        posts: toutes.length,
        vuesMediane: mediane(toutes),
        campagnes: [...parCampagne.entries()]
          .map(([campaignId, vues]) => ({ campaignId, posts: vues.length, vuesMediane: mediane(vues) }))
          .sort((a, b) => b.posts - a.posts || a.campaignId.localeCompare(b.campaignId)),
      };
    })
    .sort((a, b) => (b.vuesMediane ?? -1) - (a.vuesMediane ?? -1) || a.scenarioId.localeCompare(b.scenarioId));
}

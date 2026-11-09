/**
 * NOUVEAU RADAR — la recherche du réseau d'une app, telle que l'écran la suit :
 * son état (radarApps.networkSearch), sa phase (en cours, finie, tombée en
 * route) et son issue. Règles PURES, importées par l'écran : rien d'autre ici
 * (radarNetworkMath tirerait ses noms d'apps dans le périmètre i18n).
 */
import { v, type Infer } from "convex/values";

/**
 * Comment s'est terminée la recherche du réseau d'une app :
 *  - done : toutes ses recherches lues (certaines pages ont pu échouer) ;
 *  - budget : le budget du passage ou du jour s'est épuisé, elle reprend au suivant ;
 *  - no-credits : ScrapeCreators n'a plus de crédits ;
 *  - no-key : pas de clé ScrapeCreators sur ce déploiement ;
 *  - error : toutes les pages ont échoué, ou la tâche est tombée ;
 *  - paused : l'app a été mise en pause avant que la recherche parte.
 */
export const networkSearchOutcomeValidator = v.union(
  v.literal("done"),
  v.literal("budget"),
  v.literal("no-credits"),
  v.literal("no-key"),
  v.literal("error"),
  v.literal("paused"),
);
export type NetworkSearchOutcome = Infer<typeof networkSearchOutcomeValidator>;

/**
 * La recherche en cours d'une app, ou la dernière : demandée (bouton, app
 * ajoutée) ou lancée par la tâche, puis sa progression (recherche n° `step` sur
 * `steps`, comptes ajoutés) et son issue. Stocké dans radarApps.networkSearch.
 */
export const networkSearchValidator = v.object({
  requestedAt: v.number(),
  startedAt: v.optional(v.number()),
  finishedAt: v.optional(v.number()),
  step: v.number(),
  steps: v.number(),
  attached: v.number(),
  signals: v.number(),
  outcome: v.optional(networkSearchOutcomeValidator),
  error: v.optional(v.string()),
});
export type NetworkSearchState = Infer<typeof networkSearchValidator>;

/**
 * Une recherche qui n'a toujours pas fini au bout de 15 minutes est tombée en
 * route (une action Convex dure 10 minutes au plus) : on peut la relancer, et
 * l'écran dit qu'elle n'a pas abouti au lieu de tourner pour toujours.
 */
export const NETWORK_SEARCH_STALE_MS = 15 * 60_000;

export type NetworkSearchPhase = "idle" | "running" | "stale" | "finished";

export function networkSearchPhase(s: NetworkSearchState | null | undefined, now: number): NetworkSearchPhase {
  if (!s) return "idle";
  if (s.finishedAt !== undefined) return "finished";
  return now - (s.startedAt ?? s.requestedAt) >= NETWORK_SEARCH_STALE_MS ? "stale" : "running";
}

/** L'issue d'une recherche, d'après ce que ses appels ont rendu. */
export function networkSearchOutcome(r: { complete: boolean; noCredits: boolean; calls: number; failures: number }): NetworkSearchOutcome {
  if (r.noCredits) return "no-credits";
  if (!r.complete) return "budget";
  if (r.calls > 0 && r.failures === r.calls) return "error";
  return "done";
}

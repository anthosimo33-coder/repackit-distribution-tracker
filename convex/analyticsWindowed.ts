/**
 * AGRÉGATS POSTHOG À LA DEMANDE, sur une plage de dates LIBRE.
 *
 * ⚠️ POURQUOI UNE ACTION ET PAS LE CACHE. Le cron horaire calcule tout sur une
 * fenêtre FIXE de 90 jours et range le résultat dans `posthogCache`. Trois des
 * quatre onglets qui n'obéissaient pas au sélecteur lisent ce cache : il n'y a
 * rien à y découper, puisque les agrégats ne portent pas de jour.
 *
 * Et une colonne « jour » ne suffirait pas. Sur ces requêtes, cinq comptent des
 * PERSONNES DISTINCTES (`uniq(person_id)`) — additionner des uniques quotidiens
 * compte deux fois quiconque revient le lendemain, et les quatre entonnoirs sont
 * dans ce cas sur toutes leurs étapes. Quatre autres rendent des MÉDIANES : la
 * médiane de trente médianes quotidiennes n'est pas la médiane des trente jours.
 * Fenêtrer ces chiffres veut dire les RECALCULER, pas les trancher.
 *
 * COÛT MESURÉ (06/09/2026, 24 requêtes, concurrence 6, API PostHog réelle) :
 *   - première volée après > 2 min de silence : 10,6 s (8,7 – 11,8)
 *   - volées suivantes, dans la foulée : 1,4 s en moyenne, 0,8 s en médiane
 * La LARGEUR de la fenêtre ne change rien (7 j et 90 j prennent le même temps) :
 * ce qui coûte, c'est de repartir à froid. Au-delà de 8 requêtes simultanées
 * PostHog met en file et tout se dégrade — 45 s mesurées à 12. D'où SIX.
 */

import { v } from "convex/values";
import { authedAction } from "./functions";
import { internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requirePermission } from "./functions";
import { runHogQL, type PosthogTarget } from "./posthogApi";
import {
  buildQueries,
  shapeActivation,
  shapeCheckoutReliability,
  shapeFunnel,
  shapeServerSideSplit,
  WINDOW_DAYS,
  type ActivationPayload,
  type CheckoutReliabilityPayload,
  type FunnelPayload,
  type ServerSideSplitPayload,
} from "./posthogSync";
import {
  internalAccountsFor,
  internalMarkerHogQL,
  notForcedExperimentClause,
  notInternalClause,
} from "./internalAccounts";

/** Nombre de requêtes lancées de front. Voir la mesure en tête de fichier. */
const CONCURRENCE = 6;

/**
 * Garde de permission utilisable depuis une ACTION. Une action ne lit pas la
 * base : elle doit passer par une query. Sans cette indirection il n'y aurait
 * AUCUNE vérification — une action `authedAction` sait seulement qu'un humain
 * est connecté, pas qu'il a le droit de lire CE projet.
 */
export const assertBusinessRead = internalQuery({
  args: { userId: v.id("users"), projectId: v.id("projects") },
  handler: async (ctx, { userId, projectId }): Promise<true> => {
    await requirePermission(ctx, userId, projectId, "business.read");
    return true;
  },
});

/** Exécute `tasks` par lots de `n`, dans l'ordre des résultats. */
async function parLots<T>(
  tasks: readonly (() => Promise<T>)[],
  n: number,
): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, () => worker()),
  );
  return out;
}

export interface WindowedParcours {
  funnels: {
    global: FunnelPayload;
    sequential: FunnelPayload;
    source: FunnelPayload;
    language: FunnelPayload;
    country: FunnelPayload;
  };
  activation: ActivationPayload;
  checkoutReliability: CheckoutReliabilityPayload;
  serverSideSplit: ServerSideSplitPayload;
  /** Fenêtre effectivement interrogée — l'écran doit pouvoir la RÉ-AFFICHER. */
  from: string;
  to: string;
  /** Millisecondes passées côté PostHog, pour que la lenteur soit constatable. */
  elapsedMs: number;
}

/**
 * Recalcule les agrégats de l'onglet PARCOURS sur une plage libre.
 *
 * `window` est un PRÉDICAT complet (borne basse ET haute), traduit des jours
 * parisiens du sélecteur vers l'UTC de PostHog par `lib/hog-window` — le 6
 * septembre parisien commence le 5 à 22:00 UTC, et l'oublier décalerait chaque
 * borne d'une à deux heures.
 *
 * Une fenêtre illisible n'est PAS silencieusement remplacée par les 90 jours :
 * l'appelant recevrait des chiffres qui ne correspondent pas à ce qu'il a
 * demandé, sans rien pour s'en apercevoir. Elle lève.
 */
export const getWindowedParcours = authedAction({
  args: {
    projectId: v.id("projects"),
    /** Prédicat HogQL complet, produit par `hogWindowClause`. */
    window: v.string(),
    from: v.string(),
    to: v.string(),
  },
  handler: async (
    ctx,
    { projectId, window, from, to },
  ): Promise<WindowedParcours> => {
    await ctx.runQuery(internal.analyticsWindowed.assertBusinessRead, {
      userId: ctx.userId,
      projectId,
    });
    const projects = await ctx.runQuery(
      internal.posthogSync.listPosthogProjects,
      { projectId },
    );
    const proj = projects[0];
    if (!proj) throw new Error("Projet sans configuration PostHog.");
    const apiKey = process.env[proj.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(`Variable d'env ${proj.apiKeyEnvVar} absente.`);
    }
    const target: PosthogTarget = {
      posthogProjectId: proj.posthogProjectId,
      host: proj.host,
    };
    // MÊMES exclusions que le cron (comptes internes A4 + sessions à bras
    // forcé) : sans elles, choisir une période changerait la POPULATION en même
    // temps que la fenêtre, et l'écart se lirait comme un effet de la période.
    const internalCfg = internalAccountsFor(proj.slug);
    const Q = buildQueries(
      notInternalClause(internalCfg) + notForcedExperimentClause(WINDOW_DAYS),
      internalMarkerHogQL(internalCfg),
      window,
    );
    // Une requête en erreur ne doit pas passer pour un résultat VIDE : un
    // entonnoir à zéro et un entonnoir non mesuré se ressemblent à l'écran, et
    // seul le second doit faire échouer l'appel.
    const run = (sql: string) => async (): Promise<unknown[][]> => {
      const res = await runHogQL(apiKey, target, sql);
      if (res.error !== null) throw new Error(`PostHog : ${res.error}`);
      return res.rows;
    };
    const t0 = Date.now();
    const [global, sequential, source, language, country, act, chk, split] =
      await parLots(
        [
          run(Q.funnelGlobal),
          run(Q.funnelSequential),
          run(Q.funnelSource),
          run(Q.funnelLanguage),
          run(Q.funnelCountry),
          run(Q.activation),
          run(Q.checkoutReliability),
          run(Q.serverSideSplit),
        ],
        CONCURRENCE,
      );
    return {
      funnels: {
        global: shapeFunnel(global),
        sequential: shapeFunnel(sequential),
        source: shapeFunnel(source),
        language: shapeFunnel(language),
        country: shapeFunnel(country),
      },
      activation: shapeActivation(act),
      checkoutReliability: shapeCheckoutReliability(chk),
      serverSideSplit: shapeServerSideSplit(split),
      from,
      to,
      elapsedMs: Date.now() - t0,
    };
  },
});

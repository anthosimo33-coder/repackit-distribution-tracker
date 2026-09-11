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
 * COÛT MESURÉ (06/09/2026, API PostHog réelle, concurrence 6) :
 *   - première volée après > 2 min de silence : 10,6 s (8,7 - 11,8)
 *   - volées suivantes : 1,4 s pour un jeu léger, 2,8 à 5,8 s pour les seize
 *     requêtes servies ici
 * La LARGEUR de la fenêtre ne change rien : ce qui coûte, c'est de repartir à
 * froid. Au-delà de 8 requêtes simultanées PostHog met en file et tout se
 * dégrade — 45 s mesurées à 12. D'où SIX.
 *
 * Les trois requêtes d'A/B test ne profitent PAS du rétrécissement : leur
 * balayage reste sur quatre-vingt-dix jours par nécessité (cf buildQueries),
 * seuls leurs compteurs se bornent. Choisir une période ne les rend donc pas
 * plus rapides, et c'est le prix d'un « nouveau client » qui reste juste.
 */

import { v } from "convex/values";
import { authedAction } from "./functions";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requirePermission } from "./functions";
import { cellTimeMs, runHogQL, type PosthogTarget } from "./posthogApi";
import { windowCacheKey, windowCacheTtlMs } from "./windowCacheTtl";
import {
  buildQueries,
  shapeAbArms,
  shapeAbOffers,
  shapeAbPurchases,
  shapeAbVariants,
  shapeActivation,
  shapeCheckoutReliability,
  shapeConversion,
  shapeFreePlan,
  shapeFunnel,
  shapeScanCost,
  shapeServerSideSplit,
  WINDOW_DAYS,
  type AbArmsPayload,
  type AbOffersPayload,
  type AbPurchasesPayload,
  type AbVariantsPayload,
  type ActivationPayload,
  type CheckoutReliabilityPayload,
  type ConversionPayload,
  type FreePlanPayload,
  type FunnelPayload,
  type ScanCostPayload,
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

/** Lignes de cache gardées par projet (les plus récentes). */
const CACHE_MAX_PAR_PROJET = 30;

export const readWindowCache = internalQuery({
  args: { projectId: v.id("projects"), key: v.string() },
  handler: async (
    ctx,
    { projectId, key },
  ): Promise<{ json: string; computedAt: number } | null> => {
    const row = await ctx.db
      .query("posthogWindowCache")
      .withIndex("by_project_key", (q) =>
        q.eq("projectId", projectId).eq("key", key),
      )
      .unique();
    return row ? { json: row.json, computedAt: row.computedAt } : null;
  },
});

export const writeWindowCache = internalMutation({
  args: { projectId: v.id("projects"), key: v.string(), json: v.string() },
  handler: async (ctx, { projectId, key, json }): Promise<null> => {
    const existing = await ctx.db
      .query("posthogWindowCache")
      .withIndex("by_project_key", (q) =>
        q.eq("projectId", projectId).eq("key", key),
      )
      .unique();
    const computedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { json, computedAt });
      return null;
    }
    await ctx.db.insert("posthogWindowCache", {
      projectId,
      key,
      json,
      computedAt,
    });
    // ÉLAGAGE : chaque plage consultée laisse une ligne, et une ligne pèse
    // quelques dizaines de kilo-octets. Sans plafond, un après-midi à faire
    // glisser le sélecteur remplirait la table pour rien. On garde les plus
    // récemment calculées — ce sont celles qu'on revoit.
    const all = await ctx.db
      .query("posthogWindowCache")
      .withIndex("by_project_key", (q) => q.eq("projectId", projectId))
      .collect();
    if (all.length > CACHE_MAX_PAR_PROJET) {
      const surplus = all
        .sort((a, b) => b.computedAt - a.computedAt)
        .slice(CACHE_MAX_PAR_PROJET);
      for (const row of surplus) await ctx.db.delete(row._id);
    }
    return null;
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

export interface WindowedOffres {
  abVariants: AbVariantsPayload;
  abArms: AbArmsPayload;
  abOffers: AbOffersPayload;
  abPurchases: AbPurchasesPayload;
  paywallById: ConversionPayload;
  freePlan: FreePlanPayload;
  scanCost: ScanCostPayload;
}

export interface WindowedParcours {
  funnels: {
    global: FunnelPayload;
    sequential: FunnelPayload;
    source: FunnelPayload;
    language: FunnelPayload;
    country: FunnelPayload;
    /** Funnel par pays attribué PAR PERSONNE — cf QUERIES.countryPersons. */
    countryPersons: FunnelPayload;
  };
  activation: ActivationPayload;
  checkoutReliability: CheckoutReliabilityPayload;
  serverSideSplit: ServerSideSplitPayload;
  /**
   * Onglet OFFRES & TESTS, servi par la MÊME volée. Deux appels séparés
   * paieraient deux fois la latence de démarrage (10,6 s mesurées à froid) et
   * pourraient rendre deux périodes différentes si l'utilisateur change de dates
   * entre les deux.
   */
  offres: WindowedOffres;
  /** Fenêtre effectivement interrogée — l'écran doit pouvoir la RÉ-AFFICHER. */
  from: string;
  to: string;
  /** Millisecondes passées côté PostHog, pour que la lenteur soit constatable. */
  elapsedMs: number;
  /**
   * Instant du calcul quand la réponse vient du CACHE ; `null` si elle vient
   * d'être calculée. L'écran doit pouvoir dire « chiffres de 11 h 02 » plutôt
   * que laisser croire à un calcul instantané.
   */
  cachedAt: number | null;
  /**
   * Vrai quand PostHog a REFUSÉ la volée et qu'on a servi la dernière valeur
   * connue, même périmée. Un chiffre daté vaut mieux qu'un écran d'erreur —
   * mais il doit être annoncé comme tel.
   */
  stale: boolean;
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
export const getWindowedAnalytics = authedAction({
  args: {
    projectId: v.id("projects"),
    /** Prédicat HogQL complet, produit par `hogWindowClause`. */
    window: v.string(),
    /** Le même, exprimé sur `t_first_sub` — voir buildQueries. */
    windowOnFirstSub: v.string(),
    from: v.string(),
    to: v.string(),
  },
  handler: async (
    ctx,
    { projectId, window, windowOnFirstSub, from, to },
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

    // ─── CACHE ─────────────────────────────────────────────────────────────
    // Quinze requêtes HogQL par volée. Mesuré en production le 2026-09-08 :
    // p95 38,6 s, pointe 44,4 s, et huit refus `rate_limited (429)`. Le hook
    // client mémorise déjà les plages vues, mais en mémoire de SESSION : un
    // rechargement, un second onglet ou un autre administrateur repayaient
    // tout. Ici la mémoire est partagée et survit au rechargement.
    const key = windowCacheKey(from, to);
    const cached = await ctx.runQuery(
      internal.analyticsWindowed.readWindowCache,
      { projectId, key },
    );
    // Une plage entièrement PASSÉE ne bougera plus ; une plage qui touche
    // aujourd'hui suit la cadence horaire du reste du hub (cf windowCacheTtl).
    const ttl = windowCacheTtlMs(to, Date.now());
    if (cached && Date.now() - cached.computedAt < ttl) {
      return {
        ...(JSON.parse(cached.json) as WindowedParcours),
        cachedAt: cached.computedAt,
        stale: false,
      };
    }
    // MÊMES exclusions que le cron (comptes internes A4 + sessions à bras
    // forcé) : sans elles, choisir une période changerait la POPULATION en même
    // temps que la fenêtre, et l'écart se lirait comme un effet de la période.
    const internalCfg = internalAccountsFor(proj.slug);
    const Q = buildQueries(
      notInternalClause(internalCfg) + notForcedExperimentClause(WINDOW_DAYS),
      internalMarkerHogQL(internalCfg),
      window,
      windowOnFirstSub,
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
    /**
     * Un refus de PostHog (429) ne doit pas rendre l'onglet inutilisable quand
     * on a DÉJÀ une réponse pour cette plage. On sert la dernière connue,
     * annoncée comme périmée. Sans ce repli, la volée levait et la page entière
     * disparaissait — c'est l'écran noir signalé sur Analytics.
     */
    const surEchec = (e: unknown): WindowedParcours => {
      if (!cached) throw e;
      return {
        ...(JSON.parse(cached.json) as WindowedParcours),
        cachedAt: cached.computedAt,
        stale: true,
      };
    };
    let lots: unknown[][][];
    try {
      lots = await parLots(
        [
          run(Q.funnelGlobal),
          run(Q.funnelSequential),
          run(Q.funnelSource),
          run(Q.funnelLanguage),
          run(Q.funnelCountry),
          run(Q.countryPersons),
          run(Q.activation),
          run(Q.checkoutReliability),
          run(Q.serverSideSplit),
          run(Q.abVariants),
          run(Q.abArms),
          run(Q.abOffers),
          run(Q.abPurchases),
          run(Q.paywallById),
          run(Q.freePlan),
          run(Q.scanCost),
        ],
        CONCURRENCE,
      );
    } catch (e) {
      return surEchec(e);
    }
    const [
      global,
      sequential,
      source,
      language,
      country,
      countryPersons,
      act,
      chk,
      split,
      abVar,
      abArms,
      abOff,
      abPur,
      payById,
      free,
      scan,
    ] = lots;
    const resultat: WindowedParcours = {
      funnels: {
        global: shapeFunnel(global),
        sequential: shapeFunnel(sequential),
        source: shapeFunnel(source),
        language: shapeFunnel(language),
        country: shapeFunnel(country),
        countryPersons: shapeFunnel(countryPersons),
      },
      activation: shapeActivation(act),
      checkoutReliability: shapeCheckoutReliability(chk),
      serverSideSplit: shapeServerSideSplit(split),
      offres: {
        abVariants: shapeAbVariants(abVar),
        abArms: shapeAbArms(abArms),
        abOffers: shapeAbOffers(abOff),
        abPurchases: shapeAbPurchases(abPur),
        // La colonne « début de fenêtre » vient de la 1re émission de
        // paywall_id, identique sur chaque ligne : lue une fois.
        paywallById: {
          ...shapeConversion(payById),
          startMs: payById.length > 0 ? cellTimeMs(payById[0], 3) : null,
        },
        freePlan: shapeFreePlan(free),
        scanCost: shapeScanCost(scan),
      },
      from,
      to,
      elapsedMs: Date.now() - t0,
      cachedAt: null,
      stale: false,
    };
    await ctx.runMutation(internal.analyticsWindowed.writeWindowCache, {
      projectId,
      key,
      json: JSON.stringify(resultat),
    });
    return resultat;
  },
});

import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { adminMutation, adminQuery } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  runHogQL,
  cellNum,
  cellStr,
  cellTimeMs,
  type PosthogTarget,
} from "./posthogApi";

/**
 * Ingestion des AGRÉGATS PostHog par projet (hub Analytics). Un cron horaire
 * (convex/crons.ts) exécute, pour CHAQUE projet configuré (projects.posthog), un
 * jeu de requêtes HogQL et stocke leur résultat dans posthogCache. Les queries
 * lues par l'UI ne tapent JAMAIS l'API (lente + rate-limitée) : elles servent le
 * cache. Un bouton « Actualiser » replanifie la même action à la demande.
 *
 * 🔐 La clé API n'est JAMAIS en base : projects.posthog.apiKeyEnvVar NOMME la
 * variable d'env (Convex) qui la porte ; l'action la lit via process.env et la
 * passe à posthogApi (en-tête Authorization uniquement, jamais loguée).
 *
 * ⚠️ ROBUSTESSE — chaque requête est indépendante : un event pas encore émis
 * côté produit rend 0 ligne, ce qui donne un agrégat VIDE (et non une erreur).
 * Une requête en échec n'écrase PAS la dernière valeur connue (on écrit alors
 * seulement `error`) et n'empêche pas les autres d'aboutir → une carte ne casse
 * jamais à cause d'une autre.
 *
 * ⚠️ Les requêtes ci-dessous sont écrites CONTRE LE CONTRAT D'EVENTS attendu
 * (signup_completed, target_added, …) qui n'est pas encore émis par Snytch :
 * elles sont donc NON VÉRIFIÉES en conditions réelles. Tant qu'aucun event
 * n'arrive, toutes les cartes PostHog affichent leur état vide.
 *
 * ⚠️ TS7022 — runHourlySync appelle ctx.runQuery/runMutation(internal.*) et est
 * référencée par le scheduler : son type de retour est ANNOTÉ (PosthogSyncSummary).
 */

/** Profondeur d'historique des requêtes d'agrégat (jours). */
const WINDOW_DAYS = 90;
/** Profondeur de la série horaire d'attribution (couvre les posts plus anciens). */
const ATTRIBUTION_WINDOW_DAYS = 120;
/** Largeur de la grille de rétention (S+0 → S+8). */
const RETENTION_WEEKS = 9;
/** Borne des segments listés (sources, variants, langues) — anti-explosion d'UI. */
const SEGMENT_LIMIT = 20;

/** Clés d'agrégat stockées dans posthogCache (une row par (projet, key)). */
export const POSTHOG_CACHE_KEYS = {
  overview: "overview",
  funnelGlobal: "funnel:global",
  funnelSource: "funnel:source",
  funnelLanguage: "funnel:language",
  timeToValue: "timeToValue",
  paywall: "paywall",
  sources: "sources",
  attributionHourly: "attributionHourly",
  cohorts: "cohorts",
  predictors: "predictors",
} as const;

// ─── Formes des agrégats cachés ──────────────────────────────────────────────

export interface OverviewPayload {
  daily: { ts: number; visitors: number; signups: number; subs: number }[];
}
export interface FunnelSegment {
  key: string;
  steps: { key: string; count: number }[];
}
export interface FunnelPayload {
  segments: FunnelSegment[];
}
export interface TimeToValuePayload {
  steps: { key: string; medianMs: number | null; p90Ms: number | null; n: number }[];
}
export interface ConversionPayload {
  rows: { key: string; n: number; converted: number }[];
}
export interface AttributionHourlyPayload {
  hours: { ts: number; signups: number; subs: number }[];
}
export interface CohortsPayload {
  segments: {
    key: string;
    cohorts: { cohort: string; size: number; retainedByWeek: number[] }[];
  }[];
}
export interface PredictorsPayload {
  total: number;
  totalConverted: number;
  behaviors: { key: string; n: number; converted: number }[];
}

/** Étapes du funnel principal (l'UI mappe ces clés vers des libellés). */
export const FUNNEL_STEP_KEYS = [
  "visit",
  "username_entered",
  "signup_completed",
  "target_added",
  "first_alert_received",
  "paywall_viewed",
  "subscription_completed",
] as const;

/** Étapes de time-to-value (l'UI mappe ces clés vers des libellés + budgets). */
export const TTV_STEP_KEYS = [
  "signup_to_target",
  "target_to_alert",
  "alert_to_payment",
] as const;

/** Comportements testés comme prédicteurs d'abonnement. */
export const PREDICTOR_KEYS = [
  "squad",
  "alerts_3",
  "targets_2",
  "push_enabled",
  "referral_shared",
] as const;

// ─── Requêtes HogQL ──────────────────────────────────────────────────────────
// Toutes AGRÉGÉES (count/uniq/quantile + group by) : aucun event brut, aucune
// propriété nominative ne sort de PostHog.

/** Colonnes `uniqIf` d'atteinte d'étape, réutilisées par les 3 variantes de funnel. */
const FUNNEL_COLUMNS = `
    uniqIf(person_id, event = '$pageview') AS visit,
    uniqIf(person_id, event = 'username_entered') AS username_entered,
    uniqIf(person_id, event = 'signup_completed') AS signup_completed,
    uniqIf(person_id, event = 'target_added') AS target_added,
    uniqIf(person_id, event = 'first_alert_received') AS first_alert_received,
    uniqIf(person_id, event = 'paywall_viewed') AS paywall_viewed,
    uniqIf(person_id, event = 'subscription_completed') AS subscription_completed`;

/** Expression de segment robuste au vide/null (→ libellé explicite). */
function segExpr(prop: string): string {
  return `coalesce(nullIf(toString(${prop}), ''), '(inconnu)')`;
}

const QUERIES = {
  /** Série quotidienne : visiteurs uniques, inscriptions, abonnements. */
  overview: `
SELECT toStartOfDay(timestamp) AS d,
       uniqIf(person_id, event = '$pageview') AS visitors,
       countIf(event = 'signup_completed') AS signups,
       countIf(event = 'subscription_completed') AS subs
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
GROUP BY d
ORDER BY d`,

  /**
   * Funnel GLOBAL — atteinte d'étape (personnes distinctes ayant réalisé chaque
   * étape), pas un funnel séquentiel strict : une étape peut donc dépasser la
   * précédente si le produit permet de la court-circuiter. L'UI le dit.
   */
  funnelGlobal: `
SELECT 'global' AS seg,${FUNNEL_COLUMNS}
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY`,

  funnelSource: `
SELECT ${segExpr("person.properties.source")} AS seg,${FUNNEL_COLUMNS}
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
GROUP BY seg
ORDER BY visit DESC
LIMIT ${SEGMENT_LIMIT}`,

  funnelLanguage: `
SELECT ${segExpr("person.properties.language")} AS seg,${FUNNEL_COLUMNS}
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
GROUP BY seg
ORDER BY visit DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * Délais médians/p90 (en secondes) entre les jalons d'activation, par personne.
   * Un delta n'entre dans le quantile que si les DEUX jalons existent pour la
   * personne ET que l'aval suit l'amont (delta > 0).
   *
   * ⚠️ Le garde-fou de PRÉSENCE (has_*) est indispensable : `minIf` rend l'epoch 0
   * (1970-01-01), et NON null, quand aucun event ne matche. Un jalon AMONT manquant
   * donnerait alors `dateDiff(1970, aujourd'hui)` ≈ 20 000 j — un delta faussement
   * POSITIF que le seul filtre `> 0` laisserait passer (il n'exclut que le jalon
   * AVAL manquant, qui rend un delta négatif). On gate donc chaque delta à NULL
   * hors des deux jalons présents, puis on conserve `> 0` pour l'ordre chronologique.
   */
  timeToValue: `
SELECT
  quantileIf(0.5)(d_signup_target, d_signup_target > 0) AS m_signup_target,
  quantileIf(0.9)(d_signup_target, d_signup_target > 0) AS p_signup_target,
  countIf(d_signup_target > 0) AS n_signup_target,
  quantileIf(0.5)(d_target_alert, d_target_alert > 0) AS m_target_alert,
  quantileIf(0.9)(d_target_alert, d_target_alert > 0) AS p_target_alert,
  countIf(d_target_alert > 0) AS n_target_alert,
  quantileIf(0.5)(d_alert_payment, d_alert_payment > 0) AS m_alert_payment,
  quantileIf(0.9)(d_alert_payment, d_alert_payment > 0) AS p_alert_payment,
  countIf(d_alert_payment > 0) AS n_alert_payment
FROM (
  SELECT
    if(has_signup > 0 AND has_target > 0, dateDiff('second', t_signup, t_target), NULL) AS d_signup_target,
    if(has_target > 0 AND has_alert > 0, dateDiff('second', t_target, t_alert), NULL) AS d_target_alert,
    if(has_alert > 0 AND has_sub > 0, dateDiff('second', t_alert, t_sub), NULL) AS d_alert_payment
  FROM (
    SELECT person_id,
      minIf(timestamp, event = 'signup_completed') AS t_signup,
      minIf(timestamp, event = 'target_added') AS t_target,
      minIf(timestamp, event = 'first_alert_received') AS t_alert,
      minIf(timestamp, event = 'subscription_completed') AS t_sub,
      countIf(event = 'signup_completed') AS has_signup,
      countIf(event = 'target_added') AS has_target,
      countIf(event = 'first_alert_received') AS has_alert,
      countIf(event = 'subscription_completed') AS has_sub
    FROM events
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
    GROUP BY person_id
  )
)`,

  /**
   * Conversion par variante de paywall : population = personnes ayant VU un
   * paywall ; variante = la DERNIÈRE vue (argMax) ; converti = a un
   * subscription_completed sur la fenêtre.
   */
  paywall: `
SELECT ${segExpr("variant")} AS seg, count() AS n, countIf(subscribed > 0) AS converted
FROM (
  SELECT person_id,
    argMaxIf(properties.variant, timestamp, event = 'paywall_viewed') AS variant,
    countIf(event = 'subscription_completed') AS subscribed,
    countIf(event = 'paywall_viewed') AS viewed
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
    AND event IN ('paywall_viewed', 'subscription_completed')
  GROUP BY person_id
)
WHERE viewed > 0
GROUP BY seg
ORDER BY n DESC
LIMIT ${SEGMENT_LIMIT}`,

  /** Sources → inscrits / abonnés (une personne compte une fois par source). */
  sources: `
SELECT seg, countIf(signed > 0) AS signups, countIf(subbed > 0) AS subs
FROM (
  SELECT person_id, ${segExpr("person.properties.source")} AS seg,
    countIf(event = 'signup_completed') AS signed,
    countIf(event = 'subscription_completed') AS subbed
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
  GROUP BY person_id, seg
)
GROUP BY seg
HAVING signups > 0 OR subs > 0
ORDER BY signups DESC
LIMIT ${SEGMENT_LIMIT}`,

  /**
   * Série HORAIRE inscriptions/abonnements — support de l'attribution par
   * fenêtre 24 h (le rapprochement post ↔ events se fait côté Convex, en
   * sommant les 24 seaux qui suivent la publication).
   */
  attributionHourly: `
SELECT toStartOfHour(timestamp) AS h,
       countIf(event = 'signup_completed') AS signups,
       countIf(event = 'subscription_completed') AS subs
FROM events
WHERE timestamp >= now() - INTERVAL ${ATTRIBUTION_WINDOW_DAYS} DAY
  AND event IN ('signup_completed', 'subscription_completed')
GROUP BY h
ORDER BY h`,

  /**
   * Rétention par cohorte HEBDO d'inscription, ventilée par comportement
   * (squad / nombre de cibles). « Retenu à S+k » = la personne a encore une
   * activité au moins k semaines après son inscription.
   */
  cohorts: `
SELECT
  toString(toStartOfWeek(t_signup)) AS cohort,
  segment,
  count() AS size,
  ${Array.from(
    { length: RETENTION_WEEKS },
    (_, k) => `countIf(weeks_span >= ${k}) AS w${k}`,
  ).join(",\n  ")}
FROM (
  SELECT person_id, t_signup, t_last,
    dateDiff('week', toStartOfWeek(t_signup), toStartOfWeek(t_last)) AS weeks_span,
    arrayJoin([
      if(squads > 0, 'squad', 'no_squad'),
      if(targets > 1, 'multi_target', 'single_target')
    ]) AS segment
  FROM (
    SELECT person_id,
      minIf(timestamp, event = 'signup_completed') AS t_signup,
      max(timestamp) AS t_last,
      countIf(event IN ('squad_created', 'squad_joined')) AS squads,
      countIf(event = 'target_added') AS targets
    FROM events
    WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
    GROUP BY person_id
    HAVING countIf(event = 'signup_completed') > 0
  )
)
GROUP BY cohort, segment
ORDER BY cohort DESC`,

  /**
   * Prédicteurs d'abonnement : pour chaque comportement, effectif et convertis,
   * plus la base globale (référence du facteur). Une seule ligne — l'UI la
   * découpe en lignes de comparaison.
   */
  predictors: `
SELECT
  count() AS total,
  countIf(subbed > 0) AS total_converted,
  countIf(squads > 0) AS n_squad,
  countIf(squads > 0 AND subbed > 0) AS c_squad,
  countIf(alerts >= 3) AS n_alerts_3,
  countIf(alerts >= 3 AND subbed > 0) AS c_alerts_3,
  countIf(targets >= 2) AS n_targets_2,
  countIf(targets >= 2 AND subbed > 0) AS c_targets_2,
  countIf(push > 0) AS n_push_enabled,
  countIf(push > 0 AND subbed > 0) AS c_push_enabled,
  countIf(referrals > 0) AS n_referral_shared,
  countIf(referrals > 0 AND subbed > 0) AS c_referral_shared
FROM (
  SELECT person_id,
    countIf(event = 'subscription_completed') AS subbed,
    countIf(event IN ('squad_created', 'squad_joined')) AS squads,
    countIf(event = 'first_alert_received') AS alerts,
    countIf(event = 'target_added') AS targets,
    countIf(event = 'push_enabled') AS push,
    countIf(event = 'referral_link_shared') AS referrals
  FROM events
  WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
  GROUP BY person_id
  HAVING countIf(event = 'signup_completed') > 0
)`,
} as const;

// ─── Config projet ↔ PostHog (opérateur, via `npx convex run`) ───────────────

/**
 * Configure (ou retire) le mapping projet → projet PostHog. La CLÉ n'est PAS
 * passée ici (secret env) : seulement le NOM de sa variable d'env
 * (`apiKeyEnvVar`, défaut dérivé du slug). Exemple Snytch :
 *   1. npx convex env set POSTHOG_API_KEY_SNYTCH <clé perso PostHog>  (--prod pour la prod)
 *   2. npx convex run posthogSync:setPosthogConfigBySlug '{"slug":"snytch","posthogProjectId":"12345","host":"eu"}'
 * Retirer : '{"slug":"snytch","clear":true}'.
 */
export const setPosthogConfigBySlug = internalMutation({
  args: {
    slug: v.string(),
    posthogProjectId: v.optional(v.string()),
    host: v.optional(v.union(v.literal("eu"), v.literal("us"))),
    apiKeyEnvVar: v.optional(v.string()),
    clear: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { slug, posthogProjectId, host, apiKeyEnvVar, clear },
  ): Promise<{ updated: boolean; apiKeyEnvVar?: string }> => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!project) return { updated: false };
    if (clear) {
      await ctx.db.patch(project._id, { posthog: undefined });
      return { updated: true };
    }
    if (!posthogProjectId || posthogProjectId.trim() === "") {
      throw new Error(
        "posthogProjectId requis (l'ID numérique du projet PostHog) pour configurer PostHog.",
      );
    }
    const envVar =
      apiKeyEnvVar && apiKeyEnvVar.trim() !== ""
        ? apiKeyEnvVar.trim()
        : `POSTHOG_API_KEY_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    await ctx.db.patch(project._id, {
      posthog: {
        posthogProjectId: posthogProjectId.trim(),
        host: host ?? "eu",
        apiKeyEnvVar: envVar,
      },
    });
    return { updated: true, apiKeyEnvVar: envVar };
  },
});

// ─── Sync (cron + manuel) ────────────────────────────────────────────────────

type PosthogProjectConfig = {
  _id: Id<"projects">;
  slug: string;
  posthogProjectId: string;
  host: "eu" | "us";
  apiKeyEnvVar: string;
};

/** Projets configurés pour PostHog (config non secrète : NOM de la var d'env). */
export const listPosthogProjects = internalQuery({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<PosthogProjectConfig[]> => {
    const projects = projectId
      ? [await ctx.db.get(projectId)].filter(
          (p): p is Doc<"projects"> => p !== null,
        )
      : await ctx.db.query("projects").collect();
    return projects
      .filter((p) => p.posthog !== undefined)
      .map((p) => ({
        _id: p._id,
        slug: p.slug,
        posthogProjectId: p.posthog!.posthogProjectId,
        host: p.posthog!.host,
        apiKeyEnvVar: p.posthog!.apiKeyEnvVar,
      }));
  },
});

/**
 * Écrit les agrégats d'un projet. Une entrée EN ERREUR ne remplace pas la
 * dernière valeur connue : on ne patche que `error` + `computedAt` → l'UI peut
 * continuer à servir la donnée précédente en l'horodatant.
 */
export const upsertPosthogCache = internalMutation({
  args: {
    projectId: v.id("projects"),
    computedAt: v.number(),
    entries: v.array(
      v.object({
        key: v.string(),
        json: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { projectId, computedAt, entries }) => {
    for (const e of entries) {
      const existing = await ctx.db
        .query("posthogCache")
        .withIndex("by_project_key", (q) =>
          q.eq("projectId", projectId).eq("key", e.key),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("posthogCache", {
          projectId,
          key: e.key,
          json: e.json ?? "",
          computedAt,
          error: e.error,
        });
        continue;
      }
      await ctx.db.patch(existing._id, {
        // json conservé si la requête a échoué (dernière valeur connue).
        json: e.json ?? existing.json,
        computedAt,
        error: e.error,
      });
    }
    return { written: entries.length };
  },
});

export interface PosthogSyncSummary {
  ok: boolean;
  projectsSynced: number;
  aggregates: number;
  errors: string[];
}

/** Une entrée d'agrégat prête pour le cache. */
type CacheEntry = { key: string; json?: string; error?: string };

/**
 * Exécute une requête HogQL et façonne son résultat. Toute erreur est capturée
 * dans l'entrée (pas de throw) → les autres agrégats du projet aboutissent.
 */
async function collect<T>(
  key: string,
  apiKey: string,
  target: PosthogTarget,
  query: string,
  shape: (rows: unknown[][]) => T,
): Promise<CacheEntry> {
  const res = await runHogQL(apiKey, target, query);
  if (res.error !== null) return { key, error: res.error };
  try {
    return { key, json: JSON.stringify(shape(res.rows)) };
  } catch (e) {
    return { key, error: `shape: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Lignes de funnel (seg + 7 étapes) → segments. */
function shapeFunnel(rows: unknown[][]): FunnelPayload {
  return {
    segments: rows.map((r) => ({
      key: cellStr(r, 0),
      steps: FUNNEL_STEP_KEYS.map((k, i) => ({ key: k, count: cellNum(r, i + 1) })),
    })),
  };
}

/** Lignes (seg, n, converted) → lignes de conversion. */
function shapeConversion(rows: unknown[][]): ConversionPayload {
  return {
    rows: rows.map((r) => ({
      key: cellStr(r, 0),
      n: cellNum(r, 1),
      converted: cellNum(r, 2),
    })),
  };
}

/**
 * Sync horaire de TOUS les projets configurés (ou d'un seul, pour le bouton
 * « Actualiser »). Une clé d'env absente ⇒ projet SAUTÉ (log clair, pas de
 * throw) ; une requête en échec ⇒ agrégat marqué en erreur, les autres passent.
 */
export const runHourlySync = internalAction({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<PosthogSyncSummary> => {
    const projects: PosthogProjectConfig[] = await ctx.runQuery(
      internal.posthogSync.listPosthogProjects,
      { projectId },
    );
    const errors: string[] = [];
    let aggregates = 0;
    let projectsSynced = 0;

    for (const proj of projects) {
      const apiKey = process.env[proj.apiKeyEnvVar];
      if (!apiKey) {
        console.warn(
          `[posthog] ${proj.slug}: variable d'env ${proj.apiKeyEnvVar} absente — projet sauté.`,
        );
        errors.push(`${proj.slug}: missing-api-key`);
        continue;
      }
      const target: PosthogTarget = {
        posthogProjectId: proj.posthogProjectId,
        host: proj.host,
      };

      const entries: CacheEntry[] = [
        await collect(
          POSTHOG_CACHE_KEYS.overview,
          apiKey,
          target,
          QUERIES.overview,
          (rows): OverviewPayload => ({
            daily: rows
              .map((r) => ({
                ts: cellTimeMs(r, 0),
                visitors: cellNum(r, 1),
                signups: cellNum(r, 2),
                subs: cellNum(r, 3),
              }))
              .filter((d): d is OverviewPayload["daily"][number] => d.ts !== null),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.funnelGlobal,
          apiKey,
          target,
          QUERIES.funnelGlobal,
          shapeFunnel,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.funnelSource,
          apiKey,
          target,
          QUERIES.funnelSource,
          shapeFunnel,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.funnelLanguage,
          apiKey,
          target,
          QUERIES.funnelLanguage,
          shapeFunnel,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.timeToValue,
          apiKey,
          target,
          QUERIES.timeToValue,
          (rows): TimeToValuePayload => {
            const r = rows[0] ?? [];
            return {
              steps: TTV_STEP_KEYS.map((k, i) => {
                const median = cellNum(r, i * 3);
                const p90 = cellNum(r, i * 3 + 1);
                const n = cellNum(r, i * 3 + 2);
                // Quantiles rendus en SECONDES par HogQL → ms. n = 0 ⇒ pas de
                // mesure (et non « 0 seconde »).
                return {
                  key: k,
                  medianMs: n > 0 ? median * 1000 : null,
                  p90Ms: n > 0 ? p90 * 1000 : null,
                  n,
                };
              }),
            };
          },
        ),
        await collect(
          POSTHOG_CACHE_KEYS.paywall,
          apiKey,
          target,
          QUERIES.paywall,
          shapeConversion,
        ),
        await collect(
          POSTHOG_CACHE_KEYS.sources,
          apiKey,
          target,
          QUERIES.sources,
          (rows): ConversionPayload => ({
            // n = inscrits, converted = abonnés → taux d'abonnement par source.
            rows: rows.map((r) => ({
              key: cellStr(r, 0),
              n: cellNum(r, 1),
              converted: cellNum(r, 2),
            })),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.attributionHourly,
          apiKey,
          target,
          QUERIES.attributionHourly,
          (rows): AttributionHourlyPayload => ({
            hours: rows
              .map((r) => ({
                ts: cellTimeMs(r, 0),
                signups: cellNum(r, 1),
                subs: cellNum(r, 2),
              }))
              .filter(
                (h): h is AttributionHourlyPayload["hours"][number] => h.ts !== null,
              ),
          }),
        ),
        await collect(
          POSTHOG_CACHE_KEYS.cohorts,
          apiKey,
          target,
          QUERIES.cohorts,
          (rows): CohortsPayload => {
            const bySegment = new Map<
              string,
              { cohort: string; size: number; retainedByWeek: number[] }[]
            >();
            for (const r of rows) {
              const cohort = cellStr(r, 0);
              const segment = cellStr(r, 1);
              const size = cellNum(r, 2);
              const retainedByWeek = Array.from(
                { length: RETENTION_WEEKS },
                (_, k) => cellNum(r, 3 + k),
              );
              const list = bySegment.get(segment) ?? [];
              list.push({ cohort, size, retainedByWeek });
              bySegment.set(segment, list);
            }
            return {
              segments: [...bySegment.entries()].map(([key, cohorts]) => ({
                key,
                cohorts,
              })),
            };
          },
        ),
        await collect(
          POSTHOG_CACHE_KEYS.predictors,
          apiKey,
          target,
          QUERIES.predictors,
          (rows): PredictorsPayload => {
            const r = rows[0] ?? [];
            return {
              total: cellNum(r, 0),
              totalConverted: cellNum(r, 1),
              behaviors: PREDICTOR_KEYS.map((k, i) => ({
                key: k,
                n: cellNum(r, 2 + i * 2),
                converted: cellNum(r, 3 + i * 2),
              })),
            };
          },
        ),
      ];

      await ctx.runMutation(internal.posthogSync.upsertPosthogCache, {
        projectId: proj._id,
        computedAt: Date.now(),
        entries,
      });
      projectsSynced += 1;
      aggregates += entries.filter((e) => e.error === undefined).length;
      for (const e of entries) {
        if (e.error) errors.push(`${proj.slug}/${e.key}: ${e.error}`);
      }
    }

    return { ok: errors.length === 0, projectsSynced, aggregates, errors };
  },
});

/**
 * Bouton « Actualiser » — replanifie la sync POUR CE PROJET. Court-circuit si le
 * projet n'a pas de config PostHog (aucun appel API).
 */
export const requestPosthogSync = adminMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: boolean; reason?: string }> => {
    const project = await ctx.db.get(ctx.projectId);
    if (!project?.posthog) return { scheduled: false, reason: "not-configured" };
    await ctx.scheduler.runAfter(0, internal.posthogSync.runHourlySync, {
      projectId: ctx.projectId,
    });
    return { scheduled: true };
  },
});

// ─── Lecture (UI) — CACHE UNIQUEMENT ─────────────────────────────────────────

function safeParse<T>(json: string, fallback: T): T {
  if (json === "") return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export interface ProductAnalytics {
  /** false ⇒ projet sans config PostHog : la section affiche « non configuré ». */
  configured: boolean;
  /** Horodatage du dernier passage de sync (null = jamais synchronisé). */
  computedAt: number | null;
  /** Erreurs de la dernière sync, par clé d'agrégat (affichage discret). */
  errors: { key: string; message: string }[];
  overview: OverviewPayload;
  funnels: { global: FunnelPayload; source: FunnelPayload; language: FunnelPayload };
  timeToValue: TimeToValuePayload;
  paywall: ConversionPayload;
  sources: ConversionPayload;
  cohorts: CohortsPayload;
  predictors: PredictorsPayload;
}

const EMPTY_FUNNEL: FunnelPayload = { segments: [] };
const EMPTY_CONVERSION: ConversionPayload = { rows: [] };

/**
 * Agrégats PostHog du projet, servis DEPUIS LE CACHE (jamais d'appel API dans le
 * rendu). Un projet non configuré rend `configured:false` et des payloads vides
 * → chaque carte bascule sur son état vide sans jamais afficher un 0 trompeur.
 */
export const getProductAnalytics = adminQuery({
  args: {},
  handler: async (ctx): Promise<ProductAnalytics> => {
    const project = await ctx.db.get(ctx.projectId);
    const empty: ProductAnalytics = {
      configured: project?.posthog !== undefined,
      computedAt: null,
      errors: [],
      overview: { daily: [] },
      funnels: {
        global: EMPTY_FUNNEL,
        source: EMPTY_FUNNEL,
        language: EMPTY_FUNNEL,
      },
      timeToValue: { steps: [] },
      paywall: EMPTY_CONVERSION,
      sources: EMPTY_CONVERSION,
      cohorts: { segments: [] },
      predictors: { total: 0, totalConverted: 0, behaviors: [] },
    };
    if (!empty.configured) return empty;

    const rows = await ctx.db
      .query("posthogCache")
      .withIndex("by_project_key", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const read = <T,>(key: string, fallback: T): T => {
      const row = byKey.get(key);
      return row ? safeParse<T>(row.json, fallback) : fallback;
    };

    return {
      configured: true,
      computedAt:
        rows.length > 0 ? Math.max(...rows.map((r) => r.computedAt)) : null,
      errors: rows
        .filter((r) => r.error !== undefined)
        .map((r) => ({ key: r.key, message: r.error! })),
      overview: read(POSTHOG_CACHE_KEYS.overview, empty.overview),
      funnels: {
        global: read(POSTHOG_CACHE_KEYS.funnelGlobal, EMPTY_FUNNEL),
        source: read(POSTHOG_CACHE_KEYS.funnelSource, EMPTY_FUNNEL),
        language: read(POSTHOG_CACHE_KEYS.funnelLanguage, EMPTY_FUNNEL),
      },
      timeToValue: read(POSTHOG_CACHE_KEYS.timeToValue, empty.timeToValue),
      paywall: read(POSTHOG_CACHE_KEYS.paywall, EMPTY_CONVERSION),
      sources: read(POSTHOG_CACHE_KEYS.sources, EMPTY_CONVERSION),
      cohorts: read(POSTHOG_CACHE_KEYS.cohorts, empty.cohorts),
      predictors: read(POSTHOG_CACHE_KEYS.predictors, empty.predictors),
    };
  },
});

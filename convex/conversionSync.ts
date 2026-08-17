import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { adminQuery } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { runHogQL, type PosthogTarget } from "./posthogApi";
import { internalAccountsFor, notInternalClause } from "./internalAccounts";
import { parisDayKey, parisMidnightUtc } from "./viewsDaily";
import { parisHour } from "./calendarStatus";
import {
  mergeDayRows,
  normalizeRef,
  type DayRefRow,
  type PosthogDayResult,
  type WhopDayResult,
} from "./conversionAttribution";

/**
 * COLLECTE de l'attribution de conversion par créatrice — cron quotidien.
 *
 * ── Les deux sources, et leur asymétrie ──────────────────────────────────────
 *  - VISITEURS/SIGNUPS : API PostHog (HogQL), la ref est une propriété de
 *    PERSONNE posée par snytch.co/<ref>. UNE seule requête par run, agrégée par
 *    jour Paris — même transport, même clé d'env et même exclusion des comptes
 *    internes que le hub Analytics (posthogSync).
 *  - VENTES/REVENU : AUCUN appel externe — nos tables locales suffisent. La ref
 *    voyage dans metadata du membership (même canal que abVariant, déjà
 *    ingérée par le sync horaire whopSync) ; les paiements `paid` s'y joignent
 *    par membershipId. Renouvellements COMPRIS : l'attribution est une lecture
 *    « valeur à vie » de la ref, pas une lecture d'acquisition.
 *
 * ── Robustesse par source ────────────────────────────────────────────────────
 * Chaque source rend un résultat `ok: boolean` ; la fusion (mergeDayRows,
 * testée en vitest) est champ par champ : si Whop répond et pas PostHog, on
 * stocke les ventes et les visiteurs déjà connus restent intacts. Un re-run du
 * même jour écrase proprement, ne double jamais.
 *
 * ── Fenêtre ──────────────────────────────────────────────────────────────────
 * Cron HORAIRE gardé sur l'heure de PARIS (23 h, juste après le relevé de vues
 * de 23h30 — cf convex/crons.ts) : on collecte LA VEILLE, jour Paris complet.
 * Premier run d'un projet (aucune ligne) → BACKFILL des 30 derniers jours, en
 * une seule requête PostHog (agrégée par jour) et une passe locale Whop.
 */

const DAY_MS = 86_400_000;
const BACKFILL_DAYS = 30;

/** Bornes UTC d'un jour calendaire Paris "YYYY-MM-DD". */
function parisDayBounds(key: string): { start: number; end: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { start: parisMidnightUtc(y, m, d), end: parisMidnightUtc(y, m, d + 1) };
}

/** Clé du jour Paris PRÉCÉDANT `key` (arithmétique calendaire, DST comprise). */
function previousParisDay(key: string): string {
  return parisDayKey(parisDayBounds(key).start - 12 * 3_600_000);
}

/** Les `n` jours Paris se terminant par `last` (ordre chronologique). */
function lastParisDays(last: string, n: number): string[] {
  const out = [last];
  while (out.length < n) out.unshift(previousParisDay(out[0]));
  return out;
}

// ─── Projets à collecter ─────────────────────────────────────────────────────

export const listConversionProjects = internalQuery({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    const out = [];
    for (const p of projects) {
      const hasPosthog = p.posthog !== undefined;
      const hasWhop = p.whop !== undefined;
      if (!hasPosthog && !hasWhop) continue;
      // Backfill au PREMIER run : aucune ligne d'agrégat pour ce projet.
      const any = await ctx.db
        .query("creatorConversions")
        .withIndex("by_project_date", (q) => q.eq("projectId", p._id))
        .first();
      out.push({
        projectId: p._id,
        slug: p.slug,
        posthog: hasPosthog
          ? {
              posthogProjectId: p.posthog!.posthogProjectId,
              host: p.posthog!.host,
              apiKeyEnvVar: p.posthog!.apiKeyEnvVar,
            }
          : null,
        hasWhop,
        needsBackfill: any === null,
      });
    }
    return out;
  },
});

// ─── Source Whop (tables locales, zéro appel externe) ────────────────────────

/**
 * Ventes/revenu par ref et par jour Paris sur [fromMs, toMs) — paiements
 * `paid`, joints membershipId → metadata.ref. Un paiement sans membership ou
 * dont le membership n'a pas de ref va dans « sans source ».
 */
export const gatherWhopDays = internalQuery({
  args: {
    projectId: v.id("projects"),
    fromMs: v.number(),
    toMs: v.number(),
  },
  handler: async (ctx, { projectId, fromMs, toMs }) => {
    const memberships = await ctx.db
      .query("whopMemberships")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const refByMembership = new Map<string, string | null>();
    for (const m of memberships) {
      refByMembership.set(m.whopMembershipId, normalizeRef(m.ref ?? null));
    }

    const payments = await ctx.db
      .query("whopPayments")
      .withIndex("by_project_paidAt", (q) =>
        q.eq("projectId", projectId).gte("paidAt", fromMs).lt("paidAt", toMs),
      )
      .collect();

    const byDay = new Map<
      string,
      {
        byRef: Record<string, { sales: number; revenue: number; currency?: string }>;
        unattributed: { sales: number; revenue: number; currency?: string };
      }
    >();
    for (const p of payments) {
      if (p.status !== "paid") continue;
      const day = parisDayKey(p.paidAt);
      const slot = byDay.get(day) ?? {
        byRef: {},
        unattributed: { sales: 0, revenue: 0 },
      };
      const ref = p.membershipId
        ? (refByMembership.get(p.membershipId) ?? null)
        : null;
      const bucket =
        ref === null
          ? slot.unattributed
          : (slot.byRef[ref] ??= { sales: 0, revenue: 0 });
      bucket.sales += 1;
      bucket.revenue += p.netAmount;
      bucket.currency ??= p.currency;
      byDay.set(day, slot);
    }
    return [...byDay.entries()].map(([date, slot]) => ({ date, ...slot }));
  },
});

// ─── Écriture idempotente d'un jour ──────────────────────────────────────────

const countersValidator = v.object({
  visitors: v.number(),
  signups: v.number(),
});
const whopCountersValidator = v.object({
  sales: v.number(),
  revenue: v.number(),
  currency: v.optional(v.string()),
});

/**
 * Fusionne et écrit UN jour. La sémantique (autorité d'une source qui répond,
 * intangibilité d'une source en échec, idempotence du re-run) vit dans
 * mergeDayRows — testée en vitest ; ici on ne fait que réconcilier le résultat
 * avec les rows existantes : patch ce qui change, insère le nouveau, supprime
 * ce qui est retombé à néant. Re-jouer le même jour ne double jamais.
 */
export const upsertConversionDay = internalMutation({
  args: {
    projectId: v.id("projects"),
    date: v.string(),
    posthog: v.object({
      ok: v.boolean(),
      byRef: v.record(v.string(), countersValidator),
      unattributed: countersValidator,
    }),
    whop: v.object({
      ok: v.boolean(),
      byRef: v.record(v.string(), whopCountersValidator),
      unattributed: whopCountersValidator,
    }),
  },
  handler: async (ctx, { projectId, date, posthog, whop }) => {
    const existing = await ctx.db
      .query("creatorConversions")
      .withIndex("by_project_date", (q) =>
        q.eq("projectId", projectId).eq("date", date),
      )
      .collect();

    const merged = mergeDayRows(
      existing.map((r) => ({
        ref: r.ref,
        visitors: r.visitors,
        signups: r.signups,
        sales: r.sales,
        revenue: r.revenue,
        currency: r.currency,
      })),
      posthog as PosthogDayResult,
      whop as WhopDayResult,
    );

    const keyOf = (ref: string | undefined) => ref ?? " ";
    const mergedByKey = new Map<string, DayRefRow>(
      merged.map((r) => [keyOf(r.ref), r]),
    );
    const now = Date.now();
    const seen = new Set<string>();
    for (const row of existing) {
      const k = keyOf(row.ref);
      // Doublon de clé (ne devrait pas exister) : on le résorbe au passage.
      const m = seen.has(k) ? undefined : mergedByKey.get(k);
      seen.add(k);
      if (m === undefined) {
        await ctx.db.delete(row._id);
        continue;
      }
      await ctx.db.patch(row._id, {
        visitors: m.visitors,
        signups: m.signups,
        sales: m.sales,
        revenue: m.revenue,
        currency: m.currency,
        updatedAt: now,
      });
    }
    for (const m of merged) {
      if (seen.has(keyOf(m.ref))) continue;
      await ctx.db.insert("creatorConversions", {
        projectId,
        date,
        ref: m.ref,
        visitors: m.visitors,
        signups: m.signups,
        sales: m.sales,
        revenue: m.revenue,
        currency: m.currency,
        updatedAt: now,
      });
    }
    return { rows: merged.length };
  },
});

// ─── Le cron ─────────────────────────────────────────────────────────────────

export interface ConversionSyncSummary {
  ran: boolean;
  reason?: string;
  projects: number;
  days: number;
  posthogErrors: number;
}

/**
 * Point d'entrée du cron HORAIRE (minuteUTC:50). No-op hors de 23 h Paris —
 * même garde que le relevé de vues (l'heure UTC fixe glisserait au changement
 * d'heure). `force` court-circuite la garde (run manuel / test).
 */
export const runConversionSync = internalAction({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, { force }): Promise<ConversionSyncSummary> => {
    const now = Date.now();
    const heure = parisHour(now);
    if (force !== true) {
      if (heure === null) {
        console.error(
          "[conversion] heure de Paris incalculable — collecte NON lancée.",
        );
        return { ran: false, reason: "paris-hour-unavailable", projects: 0, days: 0, posthogErrors: 0 };
      }
      if (heure !== 23) {
        return { ran: false, reason: "not-the-hour", projects: 0, days: 0, posthogErrors: 0 };
      }
    }

    const hier = previousParisDay(parisDayKey(now));
    const projects = await ctx.runQuery(
      internal.conversionSync.listConversionProjects,
      {},
    );
    let days = 0;
    let posthogErrors = 0;

    for (const proj of projects) {
      const daysToCollect = proj.needsBackfill
        ? lastParisDays(hier, BACKFILL_DAYS)
        : [hier];
      const from = parisDayBounds(daysToCollect[0]).start;
      const to = parisDayBounds(daysToCollect[daysToCollect.length - 1]).end;

      // ── PostHog : UNE requête pour tout l'intervalle, par jour et par ref ──
      // person.properties.ref = la ref posée par le chemin court. L'anonyme
      // (ref vide) alimente la ligne « sans source ». Comptes internes exclus,
      // comme partout dans le hub.
      const phByDay = new Map<string, PosthogDayResult>();
      let posthogOk = false;
      if (proj.posthog !== null) {
        const apiKey = process.env[proj.posthog.apiKeyEnvVar];
        if (!apiKey) {
          console.warn(
            `[conversion] ${proj.slug}: env ${proj.posthog.apiKeyEnvVar} absente — visiteurs sautés.`,
          );
        } else {
          const target: PosthogTarget = {
            posthogProjectId: proj.posthog.posthogProjectId,
            host: proj.posthog.host,
          };
          const query = `
SELECT toDate(timestamp, 'Europe/Paris') AS d,
       coalesce(person.properties.ref, '') AS ref,
       uniqIf(person_id, event = '$pageview') AS visitors,
       uniqIf(person_id, event = 'signup_completed') AS signups
FROM events
WHERE event IN ('$pageview', 'signup_completed')
  AND toDate(timestamp, 'Europe/Paris') >= toDate('${daysToCollect[0]}')
  AND toDate(timestamp, 'Europe/Paris') <= toDate('${daysToCollect[daysToCollect.length - 1]}')${notInternalClause(internalAccountsFor(proj.slug))}
GROUP BY d, ref`;
          const res = await runHogQL(apiKey, target, query);
          if (res.error !== null) {
            posthogErrors += 1;
            console.error(`[conversion] ${proj.slug}: PostHog en échec — ${res.error}`);
          } else {
            posthogOk = true;
            for (const row of res.rows) {
              const [d, ref, visitors, signups] = row as [
                string,
                string,
                number,
                number,
              ];
              const slot = phByDay.get(d) ?? {
                ok: true,
                byRef: {},
                unattributed: { visitors: 0, signups: 0 },
              };
              const norm = normalizeRef(ref);
              if (norm === null) {
                slot.unattributed.visitors += visitors;
                slot.unattributed.signups += signups;
              } else {
                slot.byRef[norm] = { visitors, signups };
              }
              phByDay.set(d, slot);
            }
          }
        }
      }

      // ── Whop : tables locales sur le même intervalle ───────────────────────
      const whopDays = proj.hasWhop
        ? await ctx.runQuery(internal.conversionSync.gatherWhopDays, {
            projectId: proj.projectId,
            fromMs: from,
            toMs: to,
          })
        : [];
      const whByDay = new Map(whopDays.map((d) => [d.date, d]));

      for (const day of daysToCollect) {
        const ph = posthogOk
          ? (phByDay.get(day) ?? {
              ok: true,
              byRef: {},
              unattributed: { visitors: 0, signups: 0 },
            })
          : { ok: false, byRef: {}, unattributed: { visitors: 0, signups: 0 } };
        const whSlot = whByDay.get(day);
        const wh = proj.hasWhop
          ? {
              ok: true,
              byRef: whSlot?.byRef ?? {},
              unattributed: whSlot?.unattributed ?? { sales: 0, revenue: 0 },
            }
          : { ok: false, byRef: {}, unattributed: { sales: 0, revenue: 0 } };
        await ctx.runMutation(internal.conversionSync.upsertConversionDay, {
          projectId: proj.projectId,
          date: day,
          posthog: ph,
          whop: wh,
        });
        days += 1;
      }
    }

    console.info(
      `[conversion] collecte terminée — ${projects.length} projet(s), ${days} jour(s), ${posthogErrors} erreur(s) PostHog.`,
    );
    return { ran: true, projects: projects.length, days, posthogErrors };
  },
});

// ─── Lecture écran ───────────────────────────────────────────────────────────

/**
 * Le jour AFFICHÉ par la section « Ce que ça a rapporté » : la veille si elle a
 * des lignes, sinon le jour le plus récent qui en a (collecte en retard vaut
 * mieux qu'un écran vide) — accompagné des créatrices et de leur refSlug pour
 * la jointure côté client (shapeConversionDay, pur et testé).
 */
export const readConversionDay = adminQuery({
  args: {},
  handler: async (ctx) => {
    const hier = previousParisDay(parisDayKey(Date.now()));
    let rows = await ctx.db
      .query("creatorConversions")
      .withIndex("by_project_date", (q) =>
        q.eq("projectId", ctx.projectId).eq("date", hier),
      )
      .collect();
    let date = hier;
    if (rows.length === 0) {
      // Dernier jour collecté (l'index range-scanne par date croissante).
      const latest = await ctx.db
        .query("creatorConversions")
        .withIndex("by_project_date", (q) => q.eq("projectId", ctx.projectId))
        .order("desc")
        .first();
      if (latest === null) return null;
      date = latest.date;
      rows = await ctx.db
        .query("creatorConversions")
        .withIndex("by_project_date", (q) =>
          q.eq("projectId", ctx.projectId).eq("date", date),
        )
        .collect();
    }
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return {
      date,
      rows: rows.map((r) => ({
        ref: r.ref,
        visitors: r.visitors,
        signups: r.signups,
        sales: r.sales,
        revenue: r.revenue,
        currency: r.currency,
      })),
      creators: creators
        .filter((c) => c.status !== "churned")
        .map((c) => ({
          creatorId: c._id as string,
          name: c.name,
          refSlug: c.refSlug ?? null,
        })),
    };
  },
});

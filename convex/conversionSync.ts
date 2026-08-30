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
import { collectProjectWhopPayments } from "./whopPaymentsAccess";
import { whopNetContribution } from "./whopRevenue";
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
  args: {
    force: v.optional(v.boolean()),
    /**
     * Rejoue les N derniers jours au lieu de la seule veille — un rattrapage
     * MANUEL après un défaut de source (ex. la requête PostHog invalide du
     * 17/08, qui avait laissé 30 jours à visiteurs=null). Idempotent par
     * construction (mergeDayRows) : rejouer n'écrase que la source qui répond
     * et ne double jamais. Implique `force`.
     */
    backfillDays: v.optional(v.number()),
  },
  handler: async (ctx, { force, backfillDays }): Promise<ConversionSyncSummary> => {
    const now = Date.now();
    const heure = parisHour(now);
    if (force !== true && backfillDays === undefined) {
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
      const daysToCollect =
        backfillDays !== undefined && backfillDays > 0
          ? lastParisDays(hier, Math.min(backfillDays, 90))
          : proj.needsBackfill
            ? lastParisDays(hier, BACKFILL_DAYS)
            : [hier];
      const from = parisDayBounds(daysToCollect[0]).start;
      const to = parisDayBounds(daysToCollect[daysToCollect.length - 1]).end;

      // ── PostHog : UNE requête pour tout l'intervalle, par jour et par ref ──
      // ⚠️ `LIMIT` explicite : sans lui PostHog tronque SILENCIEUSEMENT à 100
      // lignes. Le run nominal n'en produit que ~8 (un jour), mais le rattrapage
      // en collecte 30 au premier run et jusqu'à 90 en manuel — à 8 refs/jour, un
      // backfill de 30 jours dépasse déjà le plafond. Et sans `ORDER BY`, le
      // sous-ensemble perdu aurait été ARBITRAIRE : pire que la perte prévisible
      // des jours récents constatée sur `subsByMembership`. Tenu par
      // lib/posthog-person-counters.test.ts, qui scanne désormais tout le dépôt.
      // `properties.creator_ref` AU NIVEAU EVENT : c'est là que snytch.co pose
      // la ref du chemin court (mapping confirmé le 18/08 par le dev du site).
      // Elle ne remonte sur la personne que pour une minorité de visiteurs —
      // la lire sur `person.properties` en perdait plus de la moitié. Le jour
      // Paris se calcule avec toStartOfDay(ts, tz) : HogQL refuse le fuseau en
      // 2e argument de toDate() (« expects 1 argument ») — la requête d'origine
      // échouait à CHAQUE run et la fusion par source laissait PostHog à null.
      // L'anonyme (ref vide) alimente la ligne « sans source ». Comptes
      // internes exclus, comme partout dans le hub.
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
SELECT formatDateTime(toStartOfDay(timestamp, 'Europe/Paris'), '%Y-%m-%d') AS d,
       coalesce(properties.creator_ref, '') AS ref,
       uniqIf(person_id, event = '$pageview') AS visitors,
       uniqIf(person_id, event = 'signup_completed') AS signups
FROM events
WHERE event IN ('$pageview', 'signup_completed')
  AND timestamp >= toDateTime('${daysToCollect[0]} 00:00:00', 'Europe/Paris')
  AND timestamp < toDateTime('${parisDayKey(to)} 00:00:00', 'Europe/Paris')${notInternalClause(internalAccountsFor(proj.slug))}
GROUP BY d, ref
ORDER BY d
LIMIT 10000`;
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
 * Le bloc « Ce que ça a rapporté » en ALL-TIME : tout l'historique agrégé par
 * ref, et non plus une seule journée.
 *
 * La fenêtre n'a JAMAIS vécu dans la collecte : `creatorConversions` stocke déjà
 * une ligne par (projet, jour Paris, ref) pour tous les jours. Passer en
 * all-time est donc une agrégation en lecture — aucune requête HogQL n'est
 * touchée.
 *
 * `collectedDays` est ce qui donne son sens au VIDE : c'est le nombre de jours
 * pour lesquels au moins une ligne existe, donc des jours où les sources ont
 * répondu. Une ref sans ligne sur ces jours-là n'est pas une donnée manquante,
 * c'est un zéro mesuré (cf shapeConversionDay).
 *
 * Chaque ref porte SA plage réelle (`firstDate`/`lastDate`) : en all-time, « 146
 * visiteurs » ne veut pas dire la même chose sur 2 jours et sur 41.
 */
/** Arrondi au centime — une somme de montants flottants traîne sinon. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const readConversionAllTime = adminQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("creatorConversions")
      .withIndex("by_project_date", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    const project = await ctx.db.get(ctx.projectId);

    // ── VISITEURS / INSCRITS : l'agrégat quotidien (source PostHog) ─────────
    // Un champ reste ABSENT tant qu'aucun jour ne le porte — c'est ce qui
    // distingue « jamais collecté » d'un « zéro mesuré », et la distinction doit
    // survivre à la somme.
    type Acc = {
      ref?: string;
      visitors?: number;
      signups?: number;
      sales?: number;
      revenue?: number;
      currency?: string;
      firstDate: string;
      lastDate: string;
    };
    const byRef = new Map<string, Acc>();
    const days = new Set<string>();
    const touch = (key: string, ref: string | undefined, date: string): Acc => {
      const cur = byRef.get(key) ?? { ref, firstDate: date, lastDate: date };
      if (date < cur.firstDate) cur.firstDate = date;
      if (date > cur.lastDate) cur.lastDate = date;
      byRef.set(key, cur);
      return cur;
    };
    for (const r of all) {
      days.add(r.date);
      const cur = touch(r.ref ?? "", r.ref, r.date);
      if (r.visitors !== undefined) cur.visitors = (cur.visitors ?? 0) + r.visitors;
      if (r.signups !== undefined) cur.signups = (cur.signups ?? 0) + r.signups;
      // `sales`/`revenue` de la table ne sont PLUS LUS : ils viennent désormais
      // en direct de Whop (ci-dessous). Ils restent ÉCRITS — c'est un instantané
      // quotidien figé de l'attribution Whop, que le calcul en direct ne peut
      // pas reproduire si `whopMemberships.ref` change (re-synchro, ref
      // réaffectée). Ce n'est en revanche PAS une trace de ce que PostHog a vu
      // sur les ventes : la requête de collecte ne demande que `$pageview` et
      // `signup_completed`, jamais `subscription_completed`.
    }

    // ── VENTES / REVENU : lus EN DIRECT, sans passer par l'agrégat ──────────
    // Ils n'ont jamais eu besoin de PostHog : `whopPayments` et
    // `whopMemberships.ref` sont déjà en Convex, rafraîchis toutes les heures
    // par whop-revenue-sync. Les faire transiter par la collecte quotidienne
    // leur imposait le retard de CELLE-CI : le cron conversion est un no-op hors
    // de 23 h Paris et collecte la veille, soit jusqu'à 47 h. Symptôme vécu :
    // `paredes` affichée à 0 alors qu'elle avait 3 ventes encaissées (27,81 €)
    // les 29 et 30/08.
    //
    // Même lecture que le reste du hub : point de passage A4 (internes exclus —
    // `gatherWhopDays` ne les excluait pas, ils gonflaient la ligne « sans
    // source ») et `whopNetContribution`, qui retire les remboursements
    // partiels au lieu de compter le net brut.
    const { payments } = await collectProjectWhopPayments(
      ctx,
      ctx.projectId,
      project?.slug ?? "",
    );
    const memberships = await ctx.db
      .query("whopMemberships")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const refOfMembership = new Map<string, string | null>(
      memberships.map((m) => [m.whopMembershipId, normalizeRef(m.ref ?? null)]),
    );
    let salesSyncMs: number | null = null;
    for (const p of payments) {
      salesSyncMs = Math.max(salesSyncMs ?? 0, p.updatedAt);
      if (p.status !== "paid") continue;
      const net = whopNetContribution(p);
      const ref = p.membershipId
        ? (refOfMembership.get(p.membershipId) ?? null)
        : null;
      const day = parisDayKey(p.paidAt);
      const cur = touch(ref ?? "", ref ?? undefined, day);
      cur.sales = (cur.sales ?? 0) + 1;
      cur.revenue = round2((cur.revenue ?? 0) + net);
      if (p.currency) cur.currency ??= p.currency;
    }
    // La source des ventes est COMPLÈTE : une absence y vaut zéro, pas
    // « inconnu ». Sans ça une ref sans vente afficherait « — » alors qu'on
    // sait, à l'heure près, qu'elle n'en a aucune.
    for (const acc of byRef.values()) {
      acc.sales ??= 0;
      acc.revenue ??= 0;
    }

    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    // Rien nulle part ⇒ pas de bloc. Le contrôle est fait APRÈS les deux sources :
    // un projet avec des ventes Whop mais dont la collecte PostHog n'a pas encore
    // tourné affichait « pas encore de données » alors que l'argent était là —
    // le même défaut que celui qu'on vient de corriger pour `paredes`, un cran
    // plus tôt.
    if (byRef.size === 0) return null;

    // Bornes de la PLAGE DE DONNÉES, sur les deux sources réunies : un jour de
    // vente est une donnée au même titre qu'un jour de trafic.
    const spans = [...byRef.values()];
    const firstDate = spans.reduce((a, r) => (r.firstDate < a ? r.firstDate : a), spans[0].firstDate);
    const lastDate = spans.reduce((a, r) => (r.lastDate > a ? r.lastDate : a), spans[0].lastDate);
    const collectedSorted = [...days].sort();
    return {
      firstDate,
      lastDate,
      collectedDays: days.size,
      /** Dernier jour COLLECTÉ côté PostHog — fraîcheur des colonnes visiteurs
       *  et inscrits, arrêtées à ce jour-là. */
      visitorsThroughDate: collectedSorted[collectedSorted.length - 1] ?? null,
      /** Dernière synchro Whop — fraîcheur des colonnes ventes et revenu, lues
       *  en direct. Les deux cadences diffèrent, l'écran doit le dire. */
      salesSyncMs,
      // Refs d'influenceuses — nommées, sans fiche créatrice (cf schema).
      influencers: project?.influencerRefs ?? [],
      rows: [...byRef.values()].map((a) => ({
        ref: a.ref,
        visitors: a.visitors,
        signups: a.signups,
        sales: a.sales,
        revenue:
          a.revenue === undefined ? undefined : Math.round(a.revenue * 100) / 100,
        currency: a.currency,
        firstDate: a.firstDate,
        lastDate: a.lastDate,
      })),
      // PLUS DE FILTRE `churned` (TD-027). Il écartait les fiches parties, donc
      // tout leur travail retombait sous le slug nu et leur revenu sortait du
      // « Total attribué » : en all-time, chaque départ réécrivait le passé.
      // Simulé sur l'export de prod — le Total attribué tombait de 92,67 € à
      // 37,08 € au départ de Kelly. Le tri de ce qui reste listé se fait
      // désormais à l'affichage, sur la présence de DONNÉES (shapeConversionDay),
      // pas sur le statut à la source.
      //
      // Effet de bord souhaitable : le bandeau de conflits de refs voit enfin
      // les fiches parties. Le refus à l'écriture, lui, les couvrait déjà —
      // `assertRefSlugFree` interroge toutes les fiches sans filtre de statut.
      creators: creators
        .map((c) => ({
          creatorId: c._id as string,
          name: c.name,
          refSlug: c.refSlug ?? null,
          status: c.status,
          // Pour signaler une attribution DOUTEUSE : des données de conversion
          // antérieures à l'existence même de la créatrice ne peuvent pas être
          // les siennes (ref réaffectée, ou reprise d'un slug déjà utilisé).
          // C'est le seul repère disponible — la DATE DE POSE du refSlug n'est
          // stockée nulle part, donc une ref configurée tardivement sur une
          // créatrice ancienne ne déclenchera PAS l'avertissement. Le contrôle
          // ne crie jamais à tort ; il ne voit simplement pas tout.
          createdAt: c.createdAt,
        })),
    };
  },
});

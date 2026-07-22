import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { adminMutation, adminQuery } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { fetchWhopPayments } from "./whopApi";
import { summarizeWhopRevenue } from "./whopRevenue";
import { periodOf } from "./payments";

/**
 * Ingestion du REVENU WHOP par projet (rentabilité P2). Un cron horaire
 * (convex/crons.ts) interroge l'API Whop du compte rattaché à CHAQUE projet
 * (projects.whop) et stocke ses paiements (brut/frais/net + statut) dans
 * whopPayments, DÉDUPLIQUÉS par whopId (idempotent). Le NET (après frais Whop)
 * est le chiffre de pilotage (prompt 3 = marge).
 *
 * 🔐 La clé API n'est JAMAIS en base : projects.whop.apiKeyEnvVar NOMME la
 * variable d'env (Convex) qui la porte ; l'action la lit via process.env et la
 * passe à whopApi (en-tête Authorization uniquement, jamais loguée).
 *
 * ⚠️ TS7022 — runHourlySync appelle ctx.runQuery/runMutation(internal.*) et est
 * référencée par le scheduler : son type de retour est ANNOTÉ (WhopSyncSummary).
 */

const UPSERT_CHUNK = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ─── Validateur du paiement normalisé (aligné sur NormalizedWhopPayment + schéma) ─
const whopStatusValidator = v.union(
  v.literal("paid"),
  v.literal("refunded"),
  v.literal("failed"),
  v.literal("pending"),
  v.literal("disputed"),
  v.literal("other"),
);

const whopPaymentArg = v.object({
  whopId: v.string(),
  status: whopStatusValidator,
  rawStatus: v.string(),
  currency: v.string(),
  grossAmount: v.number(),
  feeAmount: v.number(),
  netAmount: v.number(),
  refundedAmount: v.number(),
  paidAt: v.number(),
  planId: v.optional(v.string()),
  membershipId: v.optional(v.string()),
});

// ─── Config projet ↔ Whop (opérateur, via `npx convex run`) ──────────────────

/**
 * Configure (ou retire) le mapping projet → compte Whop. La CLÉ n'est PAS passée
 * ici (secret env) : seulement le NOM de sa variable d'env (`apiKeyEnvVar`,
 * défaut dérivé du slug), la company et d'éventuels plans. Exemple Snytch :
 *   1. npx convex env set WHOP_API_KEY_SNYTCH <clé>   (--prod pour la prod)
 *   2. npx convex run whopSync:setWhopConfigBySlug '{"slug":"snytch","companyId":"biz_e1zcXWKzcgHgt9"}'
 * Retirer : '{"slug":"snytch","clear":true}'.
 */
export const setWhopConfigBySlug = internalMutation({
  args: {
    slug: v.string(),
    companyId: v.optional(v.string()),
    apiKeyEnvVar: v.optional(v.string()),
    planIds: v.optional(v.array(v.string())),
    clear: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { slug, companyId, apiKeyEnvVar, planIds, clear },
  ): Promise<{ updated: boolean; apiKeyEnvVar?: string }> => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!project) return { updated: false };
    if (clear) {
      await ctx.db.patch(project._id, { whop: undefined });
      return { updated: true };
    }
    if (!companyId || companyId.trim() === "") {
      throw new Error("companyId requis (ex. biz_e1zcXWKzcgHgt9) pour configurer Whop.");
    }
    const envVar =
      apiKeyEnvVar && apiKeyEnvVar.trim() !== ""
        ? apiKeyEnvVar.trim()
        : `WHOP_API_KEY_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    await ctx.db.patch(project._id, {
      whop: {
        companyId: companyId.trim(),
        apiKeyEnvVar: envVar,
        planIds: planIds && planIds.length > 0 ? planIds : undefined,
      },
    });
    return { updated: true, apiKeyEnvVar: envVar };
  },
});

// ─── Sync (cron + manuel) ────────────────────────────────────────────────────

type WhopProjectConfig = {
  _id: Id<"projects">;
  slug: string;
  companyId: string;
  planIds?: string[];
  apiKeyEnvVar: string;
};

/** Projets configurés pour Whop (config non secrète : NOM de la var d'env, jamais la clé). */
export const listWhopProjects = internalQuery({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<WhopProjectConfig[]> => {
    const projects = projectId
      ? [await ctx.db.get(projectId)].filter(
          (p): p is Doc<"projects"> => p !== null,
        )
      : await ctx.db.query("projects").collect();
    return projects
      .filter((p) => p.whop !== undefined)
      .map((p) => ({
        _id: p._id,
        slug: p.slug,
        companyId: p.whop!.companyId,
        planIds: p.whop!.planIds,
        apiKeyEnvVar: p.whop!.apiKeyEnvVar,
      }));
  },
});

/**
 * Upsert IDEMPOTENT des paiements d'un projet, DÉDUPLIQUÉS par whopId. Une row
 * existante est MISE À JOUR (statut/montants — ex. paid→refunded) sans dupliquer.
 * ANTI-MÉLANGE : on ne réaffecte jamais un paiement d'un autre projet (garde sur
 * projectId), un whopId reste rattaché à son projet d'import.
 */
export const upsertWhopPayments = internalMutation({
  args: {
    projectId: v.id("projects"),
    payments: v.array(whopPaymentArg),
  },
  handler: async (
    ctx,
    { projectId, payments },
  ): Promise<{ inserted: number; updated: number; skipped: number }> => {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const now = Date.now();
    for (const p of payments) {
      const existing = await ctx.db
        .query("whopPayments")
        .withIndex("by_whopId", (q) => q.eq("whopId", p.whopId))
        .first();
      if (existing) {
        if (existing.projectId !== projectId) {
          // Ce paiement appartient déjà à un AUTRE projet → on ne le déplace pas.
          skipped += 1;
          continue;
        }
        await ctx.db.patch(existing._id, {
          status: p.status,
          rawStatus: p.rawStatus,
          currency: p.currency,
          grossAmount: p.grossAmount,
          feeAmount: p.feeAmount,
          netAmount: p.netAmount,
          refundedAmount: p.refundedAmount,
          paidAt: p.paidAt,
          planId: p.planId,
          membershipId: p.membershipId,
          updatedAt: now,
        });
        updated += 1;
      } else {
        await ctx.db.insert("whopPayments", {
          projectId,
          whopId: p.whopId,
          status: p.status,
          rawStatus: p.rawStatus,
          currency: p.currency,
          grossAmount: p.grossAmount,
          feeAmount: p.feeAmount,
          netAmount: p.netAmount,
          refundedAmount: p.refundedAmount,
          paidAt: p.paidAt,
          planId: p.planId,
          membershipId: p.membershipId,
          importedAt: now,
          updatedAt: now,
        });
        inserted += 1;
      }
    }
    return { inserted, updated, skipped };
  },
});

export interface WhopSyncSummary {
  ok: boolean;
  /** Projets configurés effectivement synchronisés. */
  projectsSynced: number;
  /** Paiements nouvellement insérés. */
  imported: number;
  /** Paiements existants mis à jour (statut/montants). */
  updated: number;
  /** Messages d'erreur par projet (clé absente, API, 429) — non bloquants. */
  errors: string[];
}

/**
 * Cœur de l'ingestion. `projectId` absent = tous les projets configurés (cron) ;
 * présent = un seul (sync manuelle admin). Pour chaque projet : lit la clé depuis
 * process.env[apiKeyEnvVar] (log clair si absente, projet sauté), liste ses
 * paiements Whop et les upsert. Un projet en erreur n'empêche pas les autres.
 */
export const runHourlySync = internalAction({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<WhopSyncSummary> => {
    const projects = await ctx.runQuery(
      internal.whopSync.listWhopProjects,
      projectId ? { projectId } : {},
    );
    if (projects.length === 0) {
      console.info("[whop-sync] Aucun projet configuré pour Whop.");
      return { ok: true, projectsSynced: 0, imported: 0, updated: 0, errors: [] };
    }

    let imported = 0;
    let updated = 0;
    let projectsSynced = 0;
    const errors: string[] = [];

    for (const proj of projects) {
      const apiKey = process.env[proj.apiKeyEnvVar];
      if (!apiKey) {
        console.error(
          `[whop-sync] ${proj.slug} : clé API absente (env ${proj.apiKeyEnvVar}). ` +
            `Posez-la : npx convex env set ${proj.apiKeyEnvVar} <clé>.`,
        );
        errors.push(`${proj.slug}: missing-api-key`);
        continue;
      }

      const result = await fetchWhopPayments(apiKey, proj.companyId, {
        planIds: proj.planIds,
      });
      if (result.error) {
        // Erreur API/réseau/429 : on garde ce qui a été lu (idempotent, le
        // prochain cron reprend). Le message ne contient jamais la clé.
        console.error(`[whop-sync] ${proj.slug} : ${result.error}`);
        errors.push(`${proj.slug}: ${result.error}`);
      }
      if (result.truncated) {
        console.warn(
          `[whop-sync] ${proj.slug} : pagination coupée (borne de sécurité) — ` +
            `des paiements plus anciens n'ont pas été relus ce cycle.`,
        );
      }

      for (const part of chunk(result.payments, UPSERT_CHUNK)) {
        const r = await ctx.runMutation(internal.whopSync.upsertWhopPayments, {
          projectId: proj._id,
          payments: part,
        });
        imported += r.inserted;
        updated += r.updated;
      }
      projectsSynced += 1;
      console.info(
        `[whop-sync] ${proj.slug} : ${result.payments.length} paiement(s) lus (${result.pages} page(s)).`,
      );
    }

    return { ok: errors.length === 0, projectsSynced, imported, updated, errors };
  },
});

/**
 * Déclenchement MANUEL (admin) — « Synchroniser le revenu Whop maintenant ».
 * Planifie la sync SCOPÉE au projet courant, sans attendre le cron. Rejeté si le
 * projet n'est pas configuré. Gated adminMutation (créateur rejeté).
 */
export const requestWhopSync = adminMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ scheduled: boolean; reason?: string }> => {
    const project = await ctx.db.get(ctx.projectId);
    if (!project?.whop) return { scheduled: false, reason: "not-configured" };
    await ctx.scheduler.runAfter(0, internal.whopSync.runHourlySync, {
      projectId: ctx.projectId,
    });
    return { scheduled: true };
  },
});

// ─── Vue lecture — revenu net par projet & période ───────────────────────────

/**
 * Revenu Whop du projet, agrégé PAR MOIS (UTC, aligné sur periodOf). Le NET
 * (après frais Whop ET remboursements) est le chiffre de pilotage ; brut/frais/
 * remboursements exposés pour la transparence. `configured` = false → le projet
 * n'a pas de mapping Whop (l'UI invite à le configurer). Ne lit QUE les paiements
 * du projet courant (jamais de mélange).
 */
export const getWhopRevenue = adminQuery({
  args: {},
  handler: async (ctx) => {
    const project = await ctx.db.get(ctx.projectId);
    const rows = await ctx.db
      .query("whopPayments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    const byMonth = new Map<string, Doc<"whopPayments">[]>();
    for (const r of rows) {
      const period = periodOf(r.paidAt);
      const arr = byMonth.get(period);
      if (arr) arr.push(r);
      else byMonth.set(period, [r]);
    }
    const months = [...byMonth.entries()]
      .map(([period, list]) => ({ period, summary: summarizeWhopRevenue(list) }))
      .sort((a, b) => (a.period < b.period ? 1 : -1)); // plus récent d'abord

    return {
      configured: project?.whop !== undefined,
      companyId: project?.whop?.companyId ?? null,
      currentPeriod: periodOf(Date.now()),
      total: summarizeWhopRevenue(rows),
      months,
    };
  },
});

import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { REPACKIT_SLUG, getProjectBySlug, SNYTCH_SLUG } from "./projects";
import { isWarmupComplete } from "./warmup";

const DEFAULT_ACCENT = "#FF5200";
const DEFAULT_PAYOUT_DAY = 5;

/**
 * P2 Multi-tenant — migration ONE-SHOT (internal, idempotente, relançable).
 * À lancer une fois par deployment, AVANT le resserrage du schéma en
 * projectId non-optional :
 *   ./node_modules/.bin/convex run migrations:setupRepackitProject [--prod]
 *
 * Étapes :
 *  1. Crée (ou réutilise) le projet "repackit".
 *  2. Donne un membership admin à CHAQUE superadmin existant (idempotent).
 *  3. Backfill projectId = repackit sur les 8 tables métier dépourvues du
 *     champ + dénormalise metricSnapshots.projectId depuis la publication
 *     parente.
 *  4. TD-016 : supprime les champs legacy vuesJ1/vuesJ3/vuesJ7 des
 *     publications (déjà migrés en metricSnapshots, plus aucun lecteur hors
 *     ce nettoyage). TD-017 (comptes.actif) est VOLONTAIREMENT différé :
 *     lib/compte-status.ts + ~12 specs e2e le lisent encore.
 */
export const setupRepackitProject = internalMutation({
  args: {},
  handler: async (ctx) => {
    // 1. Projet repackit (idempotent par slug).
    let project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", REPACKIT_SLUG))
      .first();
    let projectCreated = false;
    if (project === null) {
      const id = await ctx.db.insert("projects", {
        name: "RepackIt",
        slug: REPACKIT_SLUG,
        accentColor: DEFAULT_ACCENT,
        payoutDay: DEFAULT_PAYOUT_DAY,
        status: "active",
        createdAt: Date.now(),
      });
      project = await ctx.db.get(id);
      projectCreated = true;
    }
    const projectId = project!._id;

    // 2. Membership admin pour chaque superadmin (idempotent).
    let membershipsCreated = 0;
    const users = await ctx.db.query("users").collect();
    for (const u of users) {
      if (u.role !== "superadmin") continue;
      const existing = await ctx.db
        .query("memberships")
        .withIndex("by_user_project", (q) =>
          q.eq("userId", u._id).eq("projectId", projectId),
        )
        .first();
      if (existing === null) {
        await ctx.db.insert("memberships", {
          userId: u._id,
          projectId,
          role: "admin",
        });
        membershipsCreated += 1;
      }
    }

    // 3. Backfill projectId sur les tables métier simples.
    const counts: Record<string, number> = {};
    const simpleTables = [
      "publications",
      "comptes",
      "personnes",
      "icps",
      "hooks",
      "filterPresets",
      "inspirations",
      "folders",
    ] as const;
    for (const table of simpleTables) {
      const rows = await ctx.db.query(table).collect();
      let n = 0;
      for (const row of rows) {
        if (row.projectId === undefined) {
          await ctx.db.patch(row._id, { projectId });
          n += 1;
        }
      }
      counts[table] = n;
    }

    // 3 bis. metricSnapshots : projectId dénormalisé depuis la publication
    // parente (toutes backfillées juste au-dessus → projectId présent).
    const snaps = await ctx.db.query("metricSnapshots").collect();
    let snapsBackfilled = 0;
    for (const s of snaps) {
      if (s.projectId !== undefined) continue;
      const pub = await ctx.db.get(s.publicationId);
      const pid = pub?.projectId ?? projectId;
      await ctx.db.patch(s._id, { projectId: pid });
      snapsBackfilled += 1;
    }
    counts["metricSnapshots"] = snapsBackfilled;

    // 4. TD-016 : unset des champs legacy vuesJ1/J3/J7 sur les publications.
    const pubs = await ctx.db.query("publications").collect();
    let legacyUnset = 0;
    for (const p of pubs) {
      const hasLegacy =
        (p as Record<string, unknown>).vuesJ1 !== undefined ||
        (p as Record<string, unknown>).vuesJ3 !== undefined ||
        (p as Record<string, unknown>).vuesJ7 !== undefined;
      if (hasLegacy) {
        await ctx.db.patch(p._id, {
          vuesJ1: undefined,
          vuesJ3: undefined,
          vuesJ7: undefined,
        } as Record<string, undefined>);
        legacyUnset += 1;
      }
    }

    return {
      projectId,
      projectCreated,
      membershipsCreated,
      backfilled: counts,
      legacyFieldsUnset: legacyUnset,
    };
  },
});

/**
 * Crée (ou réutilise) un projet arbitraire + un membership pour un user donné.
 * Internal — utilisé pour amorcer un 2e projet (validation compteur d'IDs) ou
 * des scénarios manuels. Pour l'e2e, voir projects:e2eEnsureProject.
 */
export const seedProject = internalMutation({
  args: {
    name: v.string(),
    slug: v.string(),
    accentColor: v.optional(v.string()),
    payoutDay: v.optional(v.number()),
    ownerUserId: v.optional(v.id("users")),
    ownerRole: v.optional(v.union(v.literal("admin"), v.literal("creator"))),
  },
  handler: async (ctx, args) => {
    let project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (project === null) {
      const id = await ctx.db.insert("projects", {
        name: args.name,
        slug: args.slug,
        accentColor: args.accentColor ?? DEFAULT_ACCENT,
        payoutDay: args.payoutDay ?? DEFAULT_PAYOUT_DAY,
        status: "active",
        createdAt: Date.now(),
      });
      project = await ctx.db.get(id);
    }
    const projectId = project!._id as Id<"projects">;

    if (args.ownerUserId) {
      const existing = await ctx.db
        .query("memberships")
        .withIndex("by_user_project", (q) =>
          q.eq("userId", args.ownerUserId!).eq("projectId", projectId),
        )
        .first();
      if (existing === null) {
        await ctx.db.insert("memberships", {
          userId: args.ownerUserId,
          projectId,
          role: args.ownerRole ?? "admin",
        });
      }
    }
    return { projectId };
  },
});

/**
 * SNYTCH — backfill du GATE STRICT "actif" (one-shot, idempotent, relançable).
 *
 * Contexte : avant le gate strict, isAccountAvailable laissait un compte
 * status:"warmup" MAIS warmup TERMINÉ être ciblé par des assignments. En passant
 * au gate strict (Snytch : seul "actif" est disponible), ces comptes déjà
 * utilisés deviendraient soudain "non disponibles" → risque de bloquer la
 * publication d'assignments EN COURS (confirmPublication re-garde).
 *
 * Ce backfill recense les comptes Snytch { status "warmup" && warmup terminé }
 * qui sont RÉFÉRENCÉS comme cible d'un assignment NON terminal (tout sauf
 * published/paid) et les passe "actif" (ils étaient de facto validés puisque
 * déjà utilisés). Les comptes warmup-terminé JAMAIS utilisés ne sont PAS touchés
 * (comportement voulu : l'admin doit les valider avant de nouveaux scripts).
 *
 *   Dry-run (compter sans écrire) :
 *     ./node_modules/.bin/convex run migrations:backfillSnytchWarmupDoneToActif '{"dryRun":true}' [--prod]
 *   Appliquer :
 *     ./node_modules/.bin/convex run migrations:backfillSnytchWarmupDoneToActif '{"dryRun":false}' [--prod]
 */
export const backfillSnytchWarmupDoneToActif = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const project = await getProjectBySlug(ctx, SNYTCH_SLUG);
    if (project === null) {
      return {
        snytch: false as const,
        dryRun,
        warmupDoneTotal: 0,
        inUse: 0,
        flipped: 0,
        handles: [] as string[],
      };
    }

    // 1. Comptes Snytch en status "warmup" ET warmup terminé (checks atteints).
    const comptes = await ctx.db
      .query("comptes")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const warmupDone = comptes.filter((c) => {
      const status = c.status ?? (c.actif === false ? "archived" : "actif");
      return (
        status === "warmup" &&
        isWarmupComplete({
          plateforme: c.plateforme,
          warmupProtocol: c.warmupProtocol,
        })
      );
    });

    // 2. Ids de comptes référencés par un assignment NON terminal (targets +
    //    legacy accountId). Terminal = published / paid (post déjà sorti, jamais
    //    re-gaté par confirmPublication).
    const TERMINAL = new Set(["published", "paid"]);
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const referenced = new Set<Id<"comptes">>();
    for (const a of assignments) {
      if (TERMINAL.has(a.status)) continue;
      for (const t of a.targets ?? []) {
        if (t.accountId) referenced.add(t.accountId);
      }
      if (a.accountId) referenced.add(a.accountId);
    }

    // 3. Intersection : warmup-terminé ET déjà utilisé → à passer actif.
    const inUse = warmupDone.filter((c) => referenced.has(c._id));

    if (!dryRun) {
      for (const c of inUse) {
        await ctx.db.patch(c._id, {
          status: "actif",
          actif: true,
          warmupStartedAt: undefined,
        });
      }
    }

    return {
      snytch: true as const,
      dryRun,
      warmupDoneTotal: warmupDone.length,
      inUse: inUse.length,
      flipped: dryRun ? 0 : inUse.length,
      handles: inUse.map((c) => `${c.plateforme}:${c.handle}`),
    };
  },
});

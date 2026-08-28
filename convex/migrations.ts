import { internalMutation, internalQuery } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { divergesFromWarmup, isRemunerated } from "./remunerate";
import type { Id } from "./_generated/dataModel";
import { REPACKIT_SLUG, getProjectBySlug, SNYTCH_SLUG } from "./projects";
import { isWarmupComplete } from "./warmup";
import {
  assignmentPublishedAt,
  computeLivePricingBreakdown,
  creatorCumulViews,
  syncBonusUnlocks,
} from "./pricing";
import { periodOf } from "./payments";
import { GUIDE_MODULES_EN } from "./guideModulesEn";
import { moduleLocale } from "./guideModuleLocale";
import { warmupTargetDaysOf, defaultTargetDays } from "./warmup";
import {
  WARMUP_GUIDE_BY_PROJECT,
  WARMUP_MODULE_TITLE,
} from "./warmupGuideFused";
import { GUIDE_FR_FIXES } from "./guideFrFixes";

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
        isWarmupComplete(
          { plateforme: c.plateforme, warmupProtocol: c.warmupProtocol },
          warmupTargetDaysOf(project),
        )
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

/**
 * LOT 2 — Backfill `remunere` = valeur ACTUELLE du moteur de paie (`!isWarmup`)
 * sur les publications où `remunere` est absent. IDEMPOTENT. La paie ne change
 * sur AUCUNE vidéo : `isRemunerated(p) = remunere ?? !isWarmup`, donc poser
 * `remunere = !isWarmup` donne exactement le même résultat que le fallback.
 * dryRun par défaut (compte seulement) ; commit=true patche.
 *   ./node_modules/.bin/convex run migrations:backfillRemunere '{"commit":true}' [--prod]
 */
export const backfillRemunere = internalMutation({
  args: { commit: v.optional(v.boolean()) },
  handler: async (ctx, { commit }) => {
    const dryRun = commit !== true;
    const pubs = await ctx.db.query("publications").collect();
    const toSet = pubs.filter((p) => p.remunere === undefined);
    if (!dryRun) {
      for (const p of toSet) {
        await ctx.db.patch(p._id, { remunere: p.isWarmup !== true });
      }
    }
    return {
      dryRun,
      totalPublications: pubs.length,
      missingRemunere: toSet.length,
      wouldSetTrue: toSet.filter((p) => p.isWarmup !== true).length,
      wouldSetFalse: toSet.filter((p) => p.isWarmup === true).length,
      patched: dryRun ? 0 : toSet.length,
    };
  },
});

/**
 * DÉSÉPINGLAGE — efface `remunere` partout où il ne fait que RÉPÉTER la
 * déduction `!isWarmup`, ne le conservant que sur les posts qui en DIVERGENT.
 *
 * POURQUOI. `backfillRemunere` a posé une valeur explicite sur toutes les
 * publications existantes. Comme `isRemunerated` fait primer l'explicite, ces
 * posts se sont retrouvés ÉPINGLÉS : basculer leur warmup ne changeait plus rien
 * à la paie, en silence. Les posts créés APRÈS le backfill, eux, n'ont pas de
 * valeur et suivent la déduction — la bascule y fonctionne. Résultat : le
 * comportement du toggle dépendait de la date de publication du post, sans que
 * rien ne le montre à l'écran.
 *
 * En n'épinglant que la divergence, la bascule warmup redevient opérante partout
 * où l'admin n'a pas explicitement décidé le contraire, et `remunere !== undefined`
 * désigne exactement les cas à piloter à la main.
 *
 * ISO-PAIE, par construction : on n'efface QUE les valeurs égales à `!isWarmup`,
 * donc `isRemunerated` rend le même résultat avant et après, sur chaque post.
 * Verrouillé par test (lib/remunerate.test.ts, « désépinglage »).
 *
 * dryRun par défaut → compte et LISTE les divergentes conservées ; commit=true
 * patche. Les cycles déjà payés lisent leurs lineItems gelées → aucun montant ne
 * peut bouger, même sur un post verrouillé.
 *   ./node_modules/.bin/convex run migrations:unpinRedundantRemunere '{"commit":true}' [--prod]
 */
export const unpinRedundantRemunere = internalMutation({
  args: { commit: v.optional(v.boolean()) },
  handler: async (ctx, { commit }) => {
    const dryRun = commit !== true;
    const pubs = await ctx.db.query("publications").collect();

    const explicit = pubs.filter((p) => p.remunere !== undefined);
    const kept = explicit.filter((p) =>
      divergesFromWarmup({ isWarmup: p.isWarmup === true, remunere: p.remunere }),
    );
    const redundant = explicit.filter(
      (p) =>
        !divergesFromWarmup({
          isWarmup: p.isWarmup === true,
          remunere: p.remunere,
        }),
    );

    // Filet : on RE-VÉRIFIE l'iso-paie post par post avant d'écrire. Une seule
    // divergence annule tout — une migration qui touche à la paie doit prouver
    // qu'elle ne la touche pas, pas l'affirmer.
    const wouldChangePay = redundant.filter(
      (p) =>
        isRemunerated({ isWarmup: p.isWarmup === true, remunere: p.remunere }) !==
        isRemunerated({ isWarmup: p.isWarmup === true, remunere: undefined }),
    );
    if (wouldChangePay.length > 0) {
      throw new ConvexError(
        `ABANDON : ${wouldChangePay.length} publication(s) verraient leur paie changer. Aucune écriture.`,
      );
    }

    if (!dryRun) {
      for (const p of redundant) {
        await ctx.db.patch(p._id, { remunere: undefined });
      }
    }

    return {
      dryRun,
      totalPublications: pubs.length,
      explicitBefore: explicit.length,
      unpinned: dryRun ? 0 : redundant.length,
      wouldUnpin: redundant.length,
      explicitAfter: kept.length,
      /** Les SEULS cas où warmup et rémunération divergent — à piloter à la main. */
      divergentes: kept
        .map((p) => ({
          publicationId: p._id,
          datePubli: p.datePubli,
          compte: p.compte,
          vues: p.vuesLatest ?? 0,
          isWarmup: p.isWarmup === true,
          remunere: p.remunere === true,
        }))
        .sort((a, b) => a.datePubli - b.datePubli),
    };
  },
});

/**
 * LOT 2 — Backfill « cas Kelly » CAS PAR CAS : marque une LISTE EXPLICITE de
 * publications comme `isWarmup=true` (éditorial : ne mentionnaient pas l'app) ET
 * `remunere=true` (financier : restent PAYÉES). Sur ce petit volume (17 posts),
 * la liste d'IDs validée à la main est plus juste qu'un seuil de date — le champ
 * `creators.datePromoStart` (LOT 3) prendra le relais à 30 créatrices. dryRun par
 * défaut → LISTE l'état actuel des publications ciblées pour validation ;
 * commit=true patche. Les cycles déjà payés lisent leurs lineItems gelées → aucun
 * montant ne bouge (remunere=true garde le post payé). Patch direct = bypass
 * volontaire du verrou UI setPublicationWarmup (migration admin).
 *   convex run migrations:backfillCreatorPrePromoWarmup '{"publicationIds":["..."],"commit":true}' [--prod]
 */
export const backfillCreatorPrePromoWarmup = internalMutation({
  args: {
    publicationIds: v.array(v.id("publications")),
    commit: v.optional(v.boolean()),
  },
  handler: async (ctx, { publicationIds, commit }) => {
    const dryRun = commit !== true;
    const affected: Array<{
      publicationId: string;
      carouselId: string;
      compte: string;
      datePubli: number;
      vuesLatest: number;
      isWarmup: boolean;
      remunere: boolean | undefined;
    }> = [];
    const missing: string[] = [];
    for (const pid of publicationIds) {
      const p = await ctx.db.get(pid);
      if (!p) {
        missing.push(pid);
        continue;
      }
      affected.push({
        publicationId: pid,
        carouselId: p.carouselId,
        compte: p.compte,
        datePubli: p.datePubli,
        vuesLatest: p.vuesLatest ?? 0,
        isWarmup: p.isWarmup === true,
        remunere: p.remunere,
      });
      if (!dryRun) await ctx.db.patch(pid, { isWarmup: true, remunere: true });
    }
    affected.sort((a, b) => a.datePubli - b.datePubli);

    return {
      dryRun,
      requested: publicationIds.length,
      missing,
      affectedCount: affected.length,
      patched: dryRun ? 0 : affected.length,
      publications: affected,
    };
  },
});

/**
 * Chantier « bonus sur vues rémunérées » — RECALCUL RÉTROACTIF des paliers.
 *
 * Depuis le passage du cumul de paliers sur `bonusTierViews` (rémunéré ET promo,
 * cf convex/viewCounters.isBonusTierPost), un palier débloqué grâce à des vues
 * warmup n'est plus justifié. `syncBonusUnlocks` sait désormais révoquer ; cette
 * migration ne fait que le RAPPORTER puis le DÉCLENCHER sur tout le monde.
 *
 * dryRun par défaut (n'écrit RIEN, liste ce qui tomberait) ; commit=true applique.
 *   ./node_modules/.bin/convex run migrations:resyncBonusTiers [--prod]
 *   ./node_modules/.bin/convex run migrations:resyncBonusTiers '{"commit":true}' [--prod]
 *
 * Un unlock déjà GELÉ dans un paiement payé est ÉPARGNÉ (l'argent est versé) et
 * remonte dans `proteges` — à traiter à la main si tu veux vraiment le reprendre.
 */
export const resyncBonusTiers = internalMutation({
  args: { commit: v.optional(v.boolean()) },
  handler: async (ctx, { commit }) => {
    const dryRun = commit !== true;
    const creators = await ctx.db.query("creators").collect();
    const revoques: {
      creator: string;
      seuilVues: number;
      rewardType: string;
      montant: number | null;
      libelle: string | null;
      cumulAtUnlock: number;
      cumulRecalcule: number;
      attributionPeriod: string;
    }[] = [];
    const proteges: typeof revoques = [];
    let cashRevoque = 0;

    for (const c of creators) {
      const cumul = await creatorCumulViews(ctx, c.projectId, c._id);
      const unlocks = (
        await ctx.db
          .query("bonusUnlocks")
          .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
          .collect()
      ).filter((u) => u.projectId === c.projectId);
      for (const u of unlocks) {
        if (cumul >= u.seuilVues) continue;
        const row = {
          creator: c.name,
          seuilVues: u.seuilVues,
          rewardType: u.rewardType,
          montant: u.montant ?? null,
          libelle: u.libelle ?? null,
          cumulAtUnlock: u.cumulAtUnlock,
          cumulRecalcule: cumul,
          attributionPeriod: u.attributionPeriod,
        };
        // Même prédicat que syncBonusUnlocks : gelé dans un paiement payé ⇒ épargné.
        const paid = (
          await ctx.db
            .query("payments")
            .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
            .collect()
        ).filter((p) => p.projectId === c.projectId && p.status === "paid");
        if (paid.some((p) => p.period === u.attributionPeriod)) {
          proteges.push(row);
          continue;
        }
        revoques.push(row);
        if (u.rewardType === "cash") cashRevoque += u.montant ?? 0;
      }
    }

    let unlocked = 0;
    let revoked = 0;
    if (!dryRun) {
      for (const c of creators) {
        const r = await syncBonusUnlocks(ctx, c.projectId, c._id);
        unlocked += r.unlocked;
        revoked += r.revoked;
      }
    }

    return {
      dryRun,
      creators: creators.length,
      aRevoquer: revoques.length,
      cashRevoque: Math.round(cashRevoque * 100) / 100,
      proteges: proteges.length,
      revoques,
      protegesDetail: proteges,
      applique: dryRun ? null : { unlocked, revoked },
    };
  },
});

/**
 * AUDIT des paliers de bonus (lecture seule, aucune écriture) — outil de
 * contrôle après le chantier « bonus sur vues rémunérées », et de diagnostic en
 * cas de litige sur un payout.
 *
 * Par créatrice : le cumul de PALIERS tel que le calcule le moteur DÉPLOYÉ
 * (creatorCumulViews → bonusTierViews), le total FIXE + CPM (base `payableViews`,
 * qui NE doit PAS bouger avec ce chantier — c'est l'invariant du choix retenu),
 * et l'état de chaque unlock. `incoherent: true` = un unlock dont le seuil n'est
 * plus atteint et qui n'est pas gelé dans un paiement payé → ne devrait jamais
 * exister après un resyncBonusTiers.
 *   ./node_modules/.bin/convex run migrations:auditBonusTiers --prod
 */
export const auditBonusTiers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db.query("creators").collect();
    const lignes = [];
    let incoherents = 0;

    for (const c of creators) {
      const cumulPaliers = await creatorCumulViews(ctx, c.projectId, c._id);

      // FIXE + CPM sur toutes les périodes où la créatrice a publié. Base
      // `payableViews` — volontairement DISJOINT du cumul de paliers.
      const assignments = (
        await ctx.db
          .query("assignments")
          .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
          .collect()
      ).filter(
        (a) =>
          a.projectId === c.projectId &&
          a.pricingSnapshot !== undefined &&
          (a.status === "published" || a.status === "paid"),
      );
      const periodes = [
        ...new Set(assignments.map((a) => periodOf(assignmentPublishedAt(a)))),
      ];
      let fixe = 0;
      let cpm = 0;
      for (const p of periodes) {
        const b = await computeLivePricingBreakdown(
          ctx,
          c.projectId,
          c._id,
          p,
          new Set(),
        );
        fixe += b.fixedTotal;
        cpm += b.cpmTotal;
      }

      const paid = (
        await ctx.db
          .query("payments")
          .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
          .collect()
      ).filter((p) => p.projectId === c.projectId && p.status === "paid");
      const unlocks = (
        await ctx.db
          .query("bonusUnlocks")
          .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
          .collect()
      )
        .filter((u) => u.projectId === c.projectId)
        .map((u) => {
          const gele = paid.some((p) => p.period === u.attributionPeriod);
          const incoherent = cumulPaliers < u.seuilVues && !gele;
          if (incoherent) incoherents += 1;
          return {
            seuilVues: u.seuilVues,
            rewardType: u.rewardType,
            montant: u.montant ?? null,
            tenu: cumulPaliers >= u.seuilVues,
            gele,
            incoherent,
          };
        });

      if (cumulPaliers === 0 && fixe === 0 && cpm === 0 && unlocks.length === 0) {
        continue; // créatrice sans activité — hors rapport
      }
      lignes.push({
        creatrice: c.name,
        cumulPaliers,
        fixe: Math.round(fixe * 100) / 100,
        cpm: Math.round(cpm * 100) / 100,
        fixeCpm: Math.round((fixe + cpm) * 100) / 100,
        unlocks,
      });
    }

    lignes.sort((a, b) => b.cumulPaliers - a.cumulPaliers);
    return { creatrices: lignes.length, incoherents, lignes };
  },
});

/**
 * LOT B (i18n du guide) — rend EXPLICITE la langue des modules « Comment ça
 * marche » écrits avant le champ `locale` : ils sont français, ils le disent.
 *
 * ISO-AFFICHAGE, par construction : `moduleLocale` traite déjà une `locale`
 * absente comme du français (convex/guideModuleLocale.ts), donc écrire « fr »
 * rend exactement la même chose à chaque lecteur, avant comme après. Ce que la
 * migration change, c'est la LISIBILITÉ de la base : après elle, un module sans
 * langue est un module créé par un chemin qui a oublié de la poser, pas un
 * vestige — et l'éditeur admin range chaque module dans le bon jeu sans avoir à
 * inférer quoi que ce soit.
 *
 * On ne stocke PAS que la divergence ici, contrairement à `creators.locale` :
 * la langue d'un module n'est pas une préférence qui s'écarte d'un défaut, c'est
 * un attribut du CONTENU. Un jeu français et un jeu anglais sont deux citoyens
 * de même rang ; l'absence de valeur ne veut rien dire d'utile.
 *
 * IDEMPOTENTE : ne touche QUE les modules dont la langue est absente ou vide.
 * Un module déjà rangé en « en » n'est jamais réécrit.
 *
 * dryRun par défaut — la liste rendue est EXACTEMENT ce qui sera écrit :
 *   ./node_modules/.bin/convex run migrations:setGuideModuleLocaleFr '{}' [--prod]
 *   ./node_modules/.bin/convex run migrations:setGuideModuleLocaleFr '{"commit":true}' [--prod]
 */
export const setGuideModuleLocaleFr = internalMutation({
  args: { commit: v.optional(v.boolean()) },
  handler: async (ctx, { commit }) => {
    const dryRun = commit !== true;
    const all = await ctx.db.query("guideModules").collect();
    const missing = all.filter(
      (m) => m.locale === undefined || m.locale.trim() === "",
    );

    // Slug du projet plutôt que son id : la sortie est faite pour être RELUE
    // par un humain avant l'exécution, pas corrélée à la main.
    const slugs = new Map<Id<"projects">, string>();
    for (const m of missing) {
      if (!slugs.has(m.projectId)) {
        const p = await ctx.db.get(m.projectId);
        slugs.set(m.projectId, p?.slug ?? "(projet supprimé)");
      }
    }

    if (!dryRun) {
      for (const m of missing) await ctx.db.patch(m._id, { locale: "fr" });
    }

    return {
      dryRun,
      totalModules: all.length,
      alreadySet: all.length - missing.length,
      willWrite: missing.map((m) => ({
        projet: slugs.get(m.projectId),
        titre: m.title,
        order: m.order,
        status: m.status,
        localeAvant: m.locale ?? null,
        localeApres: "fr",
      })),
      patched: dryRun ? 0 : missing.length,
    };
  },
});


/**
 * LOT B (i18n du guide), ÉTAPE 2 — pose le JEU ANGLAIS des modules
 * « Comment ça marche » (`convex/guideModulesEn.ts`), projet par projet.
 *
 * SANS TOUCHER AU FRANÇAIS, par construction : la mutation n'insère que des
 * lignes `locale: "en"` et ne lit les modules existants que pour savoir
 * lesquels existent déjà. Aucun `patch`, aucun `delete` sur un module français
 * — il n'y a pas de chemin de code qui puisse en atteindre un.
 *
 * IDEMPOTENTE par (projet, locale « en », titre) : relancer ne crée pas de
 * doublon et ne réécrit pas un module anglais déjà posé, même s'il a été édité
 * dans l'éditeur admin depuis. C'est délibéré — une relecture humaine ne doit
 * pas pouvoir être écrasée par une relance de migration.
 *
 * Le jour où le guide bascule, il bascule POUR DE BON : dès le premier module
 * anglais publié, une lectrice EN cesse de voir le français et le bandeau
 * disparaît (convex/guideModuleLocale.ts). D'où `status: "published"` d'entrée
 * — poser la moitié du jeu en brouillon donnerait un guide anglais à trous.
 *
 * dryRun par défaut ; la liste rendue est EXACTEMENT ce qui sera écrit :
 *   ./scripts/convex-prod.sh run migrations:seedGuideModulesEn '{}'
 *   ./scripts/convex-prod.sh run migrations:seedGuideModulesEn '{"commit":true}'
 */
export const seedGuideModulesEn = internalMutation({
  args: { commit: v.optional(v.boolean()) },
  handler: async (ctx, { commit }) => {
    const dryRun = commit !== true;
    const willInsert: {
      projet: string;
      order: number;
      titre: string;
      caracteres: number;
    }[] = [];
    const dejaPresents: { projet: string; titre: string }[] = [];
    const projetsIntrouvables: string[] = [];
    let frIntacts = 0;

    for (const [slug, seeds] of Object.entries(GUIDE_MODULES_EN)) {
      const project = await getProjectBySlug(ctx, slug);
      if (project === null) {
        projetsIntrouvables.push(slug);
        continue;
      }
      const existing = await ctx.db
        .query("guideModules")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      frIntacts += existing.filter((m) => moduleLocale(m) !== "en").length;
      const titresEn = new Set(
        existing.filter((m) => moduleLocale(m) === "en").map((m) => m.title),
      );

      for (const seed of seeds) {
        if (titresEn.has(seed.title)) {
          dejaPresents.push({ projet: slug, titre: seed.title });
          continue;
        }
        willInsert.push({
          projet: slug,
          order: seed.order,
          titre: seed.title,
          caracteres: seed.contentMarkdown.length,
        });
        if (!dryRun) {
          const now = Date.now();
          await ctx.db.insert("guideModules", {
            projectId: project._id,
            title: seed.title,
            contentMarkdown: seed.contentMarkdown,
            order: seed.order,
            status: "published",
            locale: "en",
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    return {
      dryRun,
      // Compté, pas affirmé : le nombre de modules NON anglais avant écriture.
      // Il doit être identique avant et après — c'est la preuve chiffrée que le
      // jeu français n'a pas bougé.
      modulesNonAnglaisAvant: frIntacts,
      dejaPresents,
      projetsIntrouvables,
      willInsert,
      inserted: dryRun ? 0 : willInsert.length,
    };
  },
});


/**
 * CORRECTION DU GUIDE FRANÇAIS — coquilles, puces perdues, plateformes.
 *
 * Le guide vit en BASE : corriger une coquille, c'est patcher une ligne, pas
 * éditer un fichier. Les retouches sont listées dans `convex/guideFrFixes.ts`,
 * revues en diff ; celle-ci les applique.
 *
 * TROIS GARDES, parce qu'un remplacement aveugle sur du texte rédigé par un
 * humain — qui a pu bouger entre le relevé et l'exécution — corromprait un
 * contenu que personne ne relit ligne à ligne :
 *   1. le module doit exister à ce (projet, order) ET porter `expectTitle` ;
 *   2. il doit être FRANÇAIS (`moduleLocale` ≠ « en ») — une retouche ne peut
 *      pas atteindre le jeu anglais, même si un titre coïncidait ;
 *   3. `find` doit apparaître EXACTEMENT UNE FOIS. Zéro : déjà corrigé, ou le
 *      texte a changé. Plusieurs : l'ancre est ambiguë. Dans les deux cas on
 *      REFUSE et on le dit, plutôt que de deviner.
 *
 * IDEMPOTENTE par le compte à zéro : une retouche déjà appliquée ne trouve plus
 * son ancre et est rangée en `dejaFaites`, pas en échec.
 *
 * dryRun par défaut, avec l'AVANT et l'APRÈS de chaque retouche :
 *   ./scripts/convex-prod.sh run migrations:fixFrenchGuideTypos '{}'
 *   ./scripts/convex-prod.sh run migrations:fixFrenchGuideTypos '{"commit":true}'
 */
export const fixFrenchGuideTypos = internalMutation({
  args: { commit: v.optional(v.boolean()) },
  handler: async (ctx, { commit }) => {
    const dryRun = commit !== true;
    const appliquees: {
      projet: string;
      order: number;
      champ: string;
      pourquoi: string;
      avant: string;
      apres: string;
    }[] = [];
    const dejaFaites: { projet: string; order: number; pourquoi: string }[] = [];
    const refusees: { projet: string; order: number; pourquoi: string; motif: string }[] = [];

    // Le contenu courant PAR MODULE, pour enchaîner deux retouches sur le même
    // texte (snytch/5 en a deux) sans que la seconde travaille sur une version
    // périmée.
    const courant = new Map<string, { title: string; content: string }>();

    for (const fix of GUIDE_FR_FIXES) {
      const project = await getProjectBySlug(ctx, fix.slug);
      if (project === null) {
        refusees.push({ projet: fix.slug, order: fix.order, pourquoi: fix.why, motif: "projet introuvable" });
        continue;
      }
      const modules = await ctx.db
        .query("guideModules")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      const cible = modules.find(
        (m) => m.order === fix.order && moduleLocale(m) !== "en",
      );
      if (cible === undefined) {
        refusees.push({ projet: fix.slug, order: fix.order, pourquoi: fix.why, motif: "aucun module français à cet order" });
        continue;
      }
      const cle = String(cible._id);
      if (!courant.has(cle)) {
        courant.set(cle, { title: cible.title, content: cible.contentMarkdown });
      }
      const etat = courant.get(cle)!;
      if (etat.title !== fix.expectTitle && fix.field !== "title") {
        refusees.push({ projet: fix.slug, order: fix.order, pourquoi: fix.why, motif: `titre inattendu : ${etat.title}` });
        continue;
      }
      const source = fix.field === "title" ? etat.title : etat.content;
      const occurrences = source.split(fix.find).length - 1;
      if (occurrences === 0) {
        dejaFaites.push({ projet: fix.slug, order: fix.order, pourquoi: fix.why });
        continue;
      }
      if (occurrences > 1) {
        refusees.push({ projet: fix.slug, order: fix.order, pourquoi: fix.why, motif: `ancre trouvée ${occurrences} fois` });
        continue;
      }
      const remplace = source.replace(fix.find, fix.replace);
      if (fix.field === "title") etat.title = remplace;
      else etat.content = remplace;
      appliquees.push({
        projet: fix.slug,
        order: fix.order,
        champ: fix.field,
        pourquoi: fix.why,
        avant: fix.find,
        apres: fix.replace,
      });
      if (!dryRun) {
        await ctx.db.patch(cible._id, {
          ...(fix.field === "title" ? { title: etat.title } : { contentMarkdown: etat.content }),
          updatedAt: Date.now(),
        });
      }
    }

    return {
      dryRun,
      appliquees,
      dejaFaites,
      refusees,
      patched: dryRun ? 0 : appliquees.length,
    };
  },
});

/**
 * DURÉE DE WARMUP PAR PROJET — pose le barème de chaque projet, puis REBASE les
 * warmups EN COURS dessus.
 *
 * POURQUOI DEUX TEMPS. La durée est FIGÉE sur `comptes.warmupProtocol.targetDays`
 * au démarrage du warmup : poser le barème du projet ne débloque personne, les
 * comptes déjà lancés gardent leur cible. Sans le rebasage, les créatrices
 * Snytch continueraient d'attendre 7 et 14 jours pour une règle qui dit 3.
 *
 * PERSONNE NE SAUTE D'ÉTAPE. La complétion se compte en CHECKS RÉELLEMENT POSÉS,
 * pas en jours calendaires, et un check par jour au maximum : un compte à 2
 * checks rebasé sur 3 a encore un check à poser, il ne bascule pas « terminé »
 * d'un coup. C'est vérifié dans la sortie (`termineImmediatement`).
 *
 * NE TOUCHE QUE LES PROJETS NOMMÉS. `thea-app` et ses comptes ne bougent pas.
 *
 * IDEMPOTENTE : un projet déjà au bon barème et un compte déjà à la bonne cible
 * ne sont pas réécrits.
 *
 * dryRun par défaut ; la sortie EST ce qui sera écrit :
 *   ./scripts/convex-prod.sh run migrations:setWarmupTargetDaysPerProject '{}'
 *   ./scripts/convex-prod.sh run migrations:setWarmupTargetDaysPerProject '{"commit":true}'
 */
const WARMUP_DAYS_BY_PROJECT: Record<
  string,
  { tiktok?: number; instagram?: number; youtube?: number }
> = {
  // Règle produit : Snytch chauffe 3 jours, TikTok comme Instagram. YouTube
  // n'est PAS défini — il est hors périmètre Snytch, et lui donner une valeur
  // affirmerait une règle qui n'existe pas.
  snytch: { tiktok: 3, instagram: 3 },
  // Explicite plutôt qu'implicite : RepackIt ne doit pas dépendre d'un barème
  // global qu'un autre projet pourrait faire bouger — c'est exactement ce qui
  // est arrivé le 2026-06-23.
  repackit: { tiktok: 7, instagram: 14, youtube: 7 },
};

export const setWarmupTargetDaysPerProject = internalMutation({
  args: { commit: v.optional(v.boolean()) },
  handler: async (ctx, { commit }) => {
    const dryRun = commit !== true;
    const projets: {
      slug: string;
      avant: unknown;
      apres: unknown;
      deja: boolean;
    }[] = [];
    const comptes: {
      projet: string;
      handle: string;
      plateforme: string;
      checks: number;
      cibleAvant: number;
      cibleApres: number;
      resteApres: number;
      termineImmediatement: boolean;
    }[] = [];

    for (const [slug, days] of Object.entries(WARMUP_DAYS_BY_PROJECT)) {
      const project = await getProjectBySlug(ctx, slug);
      if (project === null) continue;
      const avant = project.warmupTargetDays ?? null;
      const deja =
        avant !== null &&
        avant.tiktok === days.tiktok &&
        avant.instagram === days.instagram &&
        avant.youtube === days.youtube;
      // Le rebasage lit le barème RÉSOLU (repli champ par champ), pas la
      // déclaration brute : un compte YouTube chez Snytch prendrait 7.
      projets.push({ slug, avant, apres: days, deja });
      if (!dryRun && !deja) {
        await ctx.db.patch(project._id, { warmupTargetDays: days });
      }

      // Rebasage des warmups EN COURS de ce projet.
      const rows = await ctx.db
        .query("comptes")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      for (const c of rows) {
        if (c.status !== "warmup" || !c.warmupProtocol) continue;
        const cibleApres = defaultTargetDays(
          c.plateforme,
          warmupTargetDaysOf({ warmupTargetDays: days }),
        );
        if (c.warmupProtocol.targetDays === cibleApres) continue;
        const checks = c.warmupProtocol.dailyChecks.length;
        comptes.push({
          projet: slug,
          handle: c.handle,
          plateforme: c.plateforme,
          checks,
          cibleAvant: c.warmupProtocol.targetDays,
          cibleApres,
          resteApres: Math.max(0, cibleApres - checks),
          termineImmediatement: checks >= cibleApres,
        });
        if (!dryRun) {
          await ctx.db.patch(c._id, {
            warmupProtocol: { ...c.warmupProtocol, targetDays: cibleApres },
          });
        }
      }
    }

    return {
      dryRun,
      projets,
      comptesRebases: comptes,
      // Doit rester 0 : personne ne doit basculer « terminé » par la migration.
      termineImmediatement: comptes.filter((c) => c.termineImmediatement).length,
      joursDAttenteSupprimes: comptes.reduce(
        (n, c) => n + (c.cibleAvant - c.cibleApres),
        0,
      ),
      patched: dryRun ? 0 : projets.filter((p) => !p.deja).length + comptes.length,
    };
  },
});

/**
 * FUSION DU GUIDE WARMUP — verse le protocole de la modale dans le module
 * « Warmup » du guide, par projet et par langue, et le marque `slot: "warmup"`.
 *
 * REMPLACE le contenu des modules warm-up existants (FR et EN) plutôt que d'en
 * créer de nouveaux : le but est de SUPPRIMER la double source, pas d'en ajouter
 * une troisième. C'est la seule migration du chantier qui écrase du contenu
 * rédigé — d'où l'ancrage par `slot` puis par titre connu, et le refus net si
 * le module visé est introuvable.
 *
 * IDEMPOTENTE : un module déjà au bon contenu n'est pas réécrit.
 *
 * dryRun par défaut :
 *   ./scripts/convex-prod.sh run migrations:fuseWarmupGuide '{}'
 *   ./scripts/convex-prod.sh run migrations:fuseWarmupGuide '{"commit":true}'
 */
export const fuseWarmupGuide = internalMutation({
  args: { commit: v.optional(v.boolean()) },
  handler: async (ctx, { commit }) => {
    const dryRun = commit !== true;
    const maj: {
      projet: string;
      locale: string;
      titre: string;
      carAvant: number;
      carApres: number;
      slotAvant: string | null;
    }[] = [];
    const introuvables: { projet: string; locale: string }[] = [];
    const dejaFaits: { projet: string; locale: string }[] = [];

    for (const [slug, seed] of Object.entries(WARMUP_GUIDE_BY_PROJECT)) {
      const project = await getProjectBySlug(ctx, slug);
      if (project === null) continue;
      const modules = await ctx.db
        .query("guideModules")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();

      for (const locale of ["fr", "en"] as const) {
        const dansLaLangue = modules.filter((m) => moduleLocale(m) === locale);
        // Ancrage : le slot d'abord (stable), le titre connu ensuite (premier
        // passage, avant que le slot n'existe).
        const cible =
          dansLaLangue.find((m) => m.slot === "warmup") ??
          dansLaLangue.find((m) => m.title === WARMUP_MODULE_TITLE[locale]);
        if (cible === undefined) {
          introuvables.push({ projet: slug, locale });
          continue;
        }
        const contenu = seed[locale];
        if (cible.contentMarkdown === contenu && cible.slot === "warmup") {
          dejaFaits.push({ projet: slug, locale });
          continue;
        }
        maj.push({
          projet: slug,
          locale,
          titre: cible.title,
          carAvant: cible.contentMarkdown.length,
          carApres: contenu.length,
          slotAvant: cible.slot ?? null,
        });
        if (!dryRun) {
          await ctx.db.patch(cible._id, {
            contentMarkdown: contenu,
            slot: "warmup",
            updatedAt: Date.now(),
          });
        }
      }
    }

    return {
      dryRun,
      misAJour: maj,
      dejaFaits,
      // Doit rester vide : un module warm-up introuvable veut dire que le guide
      // a été réorganisé, et qu'il faut regarder avant d'écrire.
      introuvables,
      patched: dryRun ? 0 : maj.length,
    };
  },
});

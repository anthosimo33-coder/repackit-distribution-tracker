import {
  adminMutation,
  adminQuery,
  creatorMutation,
  creatorQuery,
  e2eMutation,
} from "./functions";
import { withResolvedExamples } from "./formats";
import { isFormatAllowedOnPlatform } from "./publications";
import {
  accrueBaseLineItem,
  upsertBonusLineItem,
  computeEarnings,
} from "./payments";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * P7 Portail créateur — assignments. ISOLATION serveur non négociable : toutes
 * les fonctions creator (creatorQuery/creatorMutation) ne renvoient/touchent
 * QUE les rows du creator courant (ctx.creatorId). Les fonctions admin
 * (adminQuery/adminMutation) sont inaccessibles au rôle creator.
 */

type Plateforme = "TikTok" | "Instagram" | "YouTube";

/** Détection plateforme depuis l'URL (réplique serveur minimale, règle A6 —
 *  lib/inspiration-url ne peut pas être importée dans convex/). */
function detectPlatform(url: string): Plateforme | undefined {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com")) return "TikTok";
  if (u.includes("instagram.com")) return "Instagram";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "YouTube";
  return undefined;
}

// ─── Admin ─────────────────────────────────────────────────────────────────

/**
 * Créateurs assignables : onboardés (userId posé) et au travail (status
 * active ou onboarding). Exclut invited (pas de compte), paused, churned.
 */
export const listAssignableCreators = adminQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return creators
      .filter(
        (c) =>
          c.userId !== undefined &&
          (c.status === "active" || c.status === "onboarding"),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map((c) => ({ _id: c._id, name: c.name, status: c.status }));
  },
});

/**
 * Assignation en masse : 1 assignment = 1 livrable. N créateurs × P posts =
 * N×P rows en "todo". rateSnapshot = copie figée du rateModel du format.
 */
export const assignFormat = adminMutation({
  args: {
    formatId: v.id("formats"),
    creatorIds: v.array(v.id("creators")),
    postsPerCreator: v.number(),
    dueDate: v.number(),
    accountId: v.optional(v.id("comptes")),
  },
  handler: async (ctx, args) => {
    const format = await ctx.db.get(args.formatId);
    if (!format || format.projectId !== ctx.projectId) {
      throw new ConvexError("Format introuvable.");
    }
    if (format.status === "archived") {
      throw new ConvexError("Format archivé : réactive-le pour l'assigner.");
    }
    if (
      !Number.isInteger(args.postsPerCreator) ||
      args.postsPerCreator < 1 ||
      args.postsPerCreator > 50
    ) {
      throw new ConvexError("Nombre de posts par créateur invalide (1–50).");
    }
    if (args.creatorIds.length === 0) {
      throw new ConvexError("Sélectionne au moins un créateur.");
    }
    if (args.accountId) {
      const account = await ctx.db.get(args.accountId);
      if (!account || account.projectId !== ctx.projectId) {
        throw new ConvexError("Compte cible introuvable.");
      }
    }
    const now = Date.now();
    let created = 0;
    for (const creatorId of args.creatorIds) {
      const creator = await ctx.db.get(creatorId);
      if (!creator || creator.projectId !== ctx.projectId) {
        throw new ConvexError("Créateur introuvable dans le projet.");
      }
      // Règle d'assignabilité imposée SERVEUR (pas seulement dans
      // listAssignableCreators) : onboardé (userId) + au travail.
      if (
        creator.userId === undefined ||
        (creator.status !== "active" && creator.status !== "onboarding")
      ) {
        throw new ConvexError(
          `Créateur non assignable (${creator.name} : non onboardé ou inactif).`,
        );
      }
      for (let i = 0; i < args.postsPerCreator; i++) {
        await ctx.db.insert("assignments", {
          projectId: ctx.projectId,
          creatorId,
          formatId: args.formatId,
          accountId: args.accountId,
          dueDate: args.dueDate,
          status: "todo",
          rateSnapshot: format.rateModel,
          createdAt: now,
        });
        created++;
      }
    }
    return { created };
  },
});

/** Table admin : tous les assignments du projet, enrichis. */
export const listAssignments = adminQuery({
  args: {},
  handler: async (ctx) => {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const [creators, formats, comptes, campaigns, scriptBricks] =
      await Promise.all([
        ctx.db
          .query("creators")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("formats")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("comptes")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("scriptCampaigns")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
        ctx.db
          .query("scriptBricks")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect(),
      ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    const compteMap = new Map(comptes.map((c) => [c._id, c.handle]));
    const campaignMap = new Map(campaigns.map((c) => [c._id, c.name]));
    const brickMap = new Map(scriptBricks.map((b) => [b._id, b]));
    return assignments
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((a) => {
        // S2 — résumé combo (ADMIN voit la décomposition ; le créateur, non).
        let scriptCampaignName: string | null = null;
        let comboSummary: string | null = null;
        if (a.scriptCombo) {
          scriptCampaignName =
            campaignMap.get(a.scriptCombo.campaignId) ?? "—";
          const hook = brickMap.get(a.scriptCombo.hookBrickId);
          const corps = brickMap.get(a.scriptCombo.corpsBrickId);
          const flux = brickMap.get(a.scriptCombo.fluxBrickId);
          const cta = brickMap.get(a.scriptCombo.ctaBrickId);
          comboSummary = `Tier ${hook?.tier ?? "?"} · ${corps?.label ?? "?"} · ${flux?.label ?? "?"} · ${cta?.label ?? "?"}`;
        }
        return {
          ...a,
          creatorName: creatorMap.get(a.creatorId) ?? "—",
          formatName: a.formatId ? (formatMap.get(a.formatId) ?? "—") : null,
          accountHandle: a.accountId
            ? (compteMap.get(a.accountId) ?? null)
            : null,
          origin: (a.scriptCombo ? "script" : "format") as "script" | "format",
          scriptCampaignName,
          comboSummary,
        };
      });
  },
});

/** Compteur d'assignments "video_submitted" — badge sidebar de la file de revue. */
export const countVideoSubmitted = adminQuery({
  args: {},
  handler: async (ctx) => {
    const subs = await ctx.db
      .query("assignments")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", ctx.projectId).eq("status", "video_submitted"),
      )
      .collect();
    return subs.length;
  },
});

/**
 * Matérialise la publication d'un assignment de SCRIPT et y RACCORDE le combo
 * (analytics S3). Un script = vidéo verticale → mediaType "short". `opts` porte
 * l'URL/plateforme/date du POST PUBLIÉ (résolus à l'étape `published`).
 *
 * Type de retour ANNOTÉ (ctx.runMutation(internal.*) → TS7022). NE PAS retirer.
 */
async function materializeScriptPublication(
  ctx: MutationCtx,
  a: Doc<"assignments">,
  projectId: Id<"projects">,
  opts: { url: string; platform: Plateforme; datePubli: number },
): Promise<Id<"publications">> {
  if (!a.scriptCombo || a.comboKey === undefined) {
    throw new ConvexError("Combo de script manquant — matérialisation impossible.");
  }
  let compte: string;
  if (a.accountId) {
    const account = await ctx.db.get(a.accountId);
    compte = account?.handle ?? "—";
  } else {
    const creator = await ctx.db.get(a.creatorId);
    compte = creator?.name ?? "—";
  }
  return await ctx.runMutation(internal.publications.createFromAssignment, {
    projectId,
    mediaType: "short",
    plateforme: opts.platform,
    compte,
    datePubli: opts.datePubli,
    postUrl: opts.url,
    scriptCombo: {
      campaignId: a.scriptCombo.campaignId,
      hookBrickId: a.scriptCombo.hookBrickId,
      corpsBrickId: a.scriptCombo.corpsBrickId,
      fluxBrickId: a.scriptCombo.fluxBrickId,
      ctaBrickId: a.scriptCombo.ctaBrickId,
      comboKey: a.comboKey,
    },
  });
}

/**
 * Cœur du nouveau modèle : à la PUBLICATION (creator confirme l'URL), en UNE
 * transaction — (1) matérialise la publication (script avec combo, ou format
 * non-custom ; custom = pas de pub), (2) accrue la lineItem de BASE. Idempotent :
 * réutilise publicationId existant + accrueBaseLineItem est idempotent par
 * assignmentId → re-confirmer ne double ni la pub ni le crédit.
 *
 * Type de retour ANNOTÉ (ctx.runMutation(internal.*) → TS7022). NE PAS retirer.
 */
async function materializeAndAccrueOnPublish(
  ctx: MutationCtx,
  a: Doc<"assignments">,
  projectId: Id<"projects">,
  opts: { url: string; platform: Plateforme | undefined; publishedAt: number },
): Promise<Id<"publications"> | null> {
  const now = Date.now();
  const dateLabel = new Date(opts.publishedAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });

  let publicationId: Id<"publications"> | null = a.publicationId ?? null;
  let label: string;

  if (a.scriptCombo && a.formatId === undefined) {
    if (publicationId === null) {
      if (opts.platform === undefined) {
        throw new ConvexError("Plateforme du post non détectée.");
      }
      publicationId = await materializeScriptPublication(ctx, a, projectId, {
        url: opts.url,
        platform: opts.platform,
        datePubli: opts.publishedAt,
      });
    }
    // ISOLATION : label NEUTRE — jamais le nom de campagne côté créateur.
    label = `Vidéo — ${dateLabel}`;
  } else {
    const format = a.formatId ? await ctx.db.get(a.formatId) : null;
    if (!format) throw new ConvexError("Format introuvable.");
    if (format.type !== "custom" && publicationId === null) {
      if (opts.platform === undefined) {
        throw new ConvexError("Plateforme du post non détectée.");
      }
      let compte: string;
      if (a.accountId) {
        const account = await ctx.db.get(a.accountId);
        compte = account?.handle ?? "—";
      } else {
        const creator = await ctx.db.get(a.creatorId);
        compte = creator?.name ?? "—";
      }
      publicationId = await ctx.runMutation(
        internal.publications.createFromAssignment,
        {
          projectId,
          mediaType: format.type,
          plateforme: opts.platform,
          compte,
          datePubli: opts.publishedAt,
          postUrl: opts.url,
        },
      );
    }
    label = `${format.name} — ${dateLabel}`;
  }

  // Accrual de la BASE (idempotent par assignmentId — pas de double crédit).
  await accrueBaseLineItem(ctx, {
    projectId,
    creatorId: a.creatorId,
    assignmentId: a._id,
    label,
    amount: a.rateSnapshot.basePerPost,
    now,
  });

  return publicationId;
}

// ─── Revue vidéo (admin) — NE crédite ni ne matérialise RIEN (cf published) ───

/** video_submitted → to_publish. Approuve la vidéo ; le paiement attend la
 *  publication (published). Idempotent. */
export const reviewVideoApprove = adminMutation({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status === "to_publish") return { ok: true, alreadyApproved: true };
    if (a.status !== "video_submitted") {
      throw new ConvexError("Seules les vidéos en revue peuvent être validées.");
    }
    await ctx.db.patch(id, { status: "to_publish" });
    return { ok: true, alreadyApproved: false };
  },
});

/** video_submitted → video_rejected (feedback obligatoire, visible créateur). */
export const reviewVideoReject = adminMutation({
  args: { id: v.id("assignments"), feedback: v.string() },
  handler: async (ctx, { id, feedback }) => {
    const a = await ctx.db.get(id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "video_submitted") {
      throw new ConvexError("Seules les vidéos en revue peuvent être refusées.");
    }
    const fb = feedback.trim();
    if (fb.length === 0) {
      throw new ConvexError("Un motif de refus est requis.");
    }
    await ctx.db.patch(id, { status: "video_rejected", videoReviewFeedback: fb });
    return { ok: true };
  },
});

/**
 * File de revue vidéo : assignments en video_submitted, avec le MP4 résolu en URL
 * signée (lecture in-app admin). Origin script → nom de campagne visible ADMIN.
 */
export const listVideoSubmitted = adminQuery({
  args: {},
  handler: async (ctx) => {
    const subs = await ctx.db
      .query("assignments")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", ctx.projectId).eq("status", "video_submitted"),
      )
      .collect();
    const [creators, formats, campaigns] = await Promise.all([
      ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("scriptCampaigns")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    const campaignMap = new Map(campaigns.map((c) => [c._id, c.name]));
    return Promise.all(
      subs
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(async (a) => ({
          _id: a._id,
          creatorName: creatorMap.get(a.creatorId) ?? "—",
          label: a.scriptCombo
            ? (campaignMap.get(a.scriptCombo.campaignId) ?? "Script")
            : a.formatId
              ? (formatMap.get(a.formatId) ?? "—")
              : "—",
          origin: (a.scriptCombo ? "script" : "format") as "script" | "format",
          dueDate: a.dueDate,
          videoStorageId: a.submittedVideoStorageId ?? null,
          videoUrl: a.submittedVideoStorageId
            ? await ctx.storage.getUrl(a.submittedVideoStorageId)
            : null,
          videoMimeType: a.submittedVideoMimeType ?? "video/mp4",
        })),
    );
  },
});

/** « Publiées récemment » (admin) : assignments en published, URL + créateur. */
export const listPublished = adminQuery({
  args: {},
  handler: async (ctx) => {
    const pubs = await ctx.db
      .query("assignments")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", ctx.projectId).eq("status", "published"),
      )
      .collect();
    const [creators, formats] = await Promise.all([
      ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    return pubs
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
      .map((a) => ({
        _id: a._id,
        creatorName: creatorMap.get(a.creatorId) ?? "—",
        label: a.scriptCombo
          ? "Script"
          : a.formatId
            ? (formatMap.get(a.formatId) ?? "—")
            : "—",
        publishedUrl: a.publishedUrl ?? a.submittedUrl ?? null,
        publishedAt: a.publishedAt ?? null,
        submittedPlatform: a.submittedPlatform ?? null,
      }));
  },
});

/**
 * S3 — BACKFILL idempotent du raccord combo ↔ publication. À lancer une fois si
 * des posts de SCRIPT ont été validés AVANT S3 (sous S2 : aucune publication
 * n'était matérialisée → publicationId absent). Pour chaque assignment de script
 * validé :
 *   - publication absente (cas S2)  → matérialise + pose publicationId + combo ;
 *   - publication présente sans combo → patche scriptCombo ;
 *   - publication présente avec combo → no-op (idempotent).
 * Un assignment non matérialisable (plateforme/URL manquante) est compté en
 * `skipped` sans interrompre le reste.
 *
 * Runnable : `npx convex run assignments:backfillPublicationCombos` (dev / --prod).
 * Type de retour ANNOTÉ (ctx.runMutation(internal.*) via le helper → TS7022).
 */
export const backfillPublicationCombos = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    materialized: number;
    attached: number;
    alreadyOk: number;
    skipped: number;
  }> => {
    const assignments = await ctx.db.query("assignments").collect();
    let materialized = 0;
    let attached = 0;
    let alreadyOk = 0;
    let skipped = 0;
    for (const a of assignments) {
      // Cible : assignments de SCRIPT validés (ou payés) uniquement.
      if (!a.scriptCombo || a.formatId !== undefined) continue;
      if (a.status !== "validated" && a.status !== "paid") continue;
      if (a.comboKey === undefined) {
        skipped++;
        continue;
      }
      const combo = {
        campaignId: a.scriptCombo.campaignId,
        hookBrickId: a.scriptCombo.hookBrickId,
        corpsBrickId: a.scriptCombo.corpsBrickId,
        fluxBrickId: a.scriptCombo.fluxBrickId,
        ctaBrickId: a.scriptCombo.ctaBrickId,
        comboKey: a.comboKey,
      };
      if (a.publicationId === undefined) {
        // Cas S2 : pas de publication. La matérialiser rétroactivement exige une
        // plateforme + URL (published ou legacy submitted) ; sinon skip propre.
        const url = a.publishedUrl ?? a.submittedUrl;
        if (a.submittedPlatform === undefined || url === undefined) {
          skipped++;
          continue;
        }
        const publicationId = await materializeScriptPublication(
          ctx,
          a,
          a.projectId,
          {
            url,
            platform: a.submittedPlatform,
            datePubli: a.publishedAt ?? a.submittedAt ?? Date.now(),
          },
        );
        await ctx.db.patch(a._id, { publicationId });
        materialized++;
        continue;
      }
      const pub = await ctx.db.get(a.publicationId);
      if (!pub) {
        skipped++;
        continue;
      }
      if (pub.scriptCombo !== undefined) {
        alreadyOk++;
        continue;
      }
      await ctx.db.patch(a.publicationId, { scriptCombo: combo });
      attached++;
    }
    return { materialized, attached, alreadyOk, skipped };
  },
});

/**
 * MIGRATION — réécrit les statuts LEGACY vers la machine MP4 (0 perte, idempotent).
 *   submitted  → video_submitted   (en attente d'action admin)
 *   validated  → published         (URL fournie + pub matérialisée + base créditée)
 *   rejected   → video_rejected     (+ videoReviewFeedback = ancien adminFeedback)
 * Aligne aussi les champs : publishedUrl/publishedAt ← submittedUrl/submittedAt
 * pour les rows désormais published/paid. Idempotent : ne touche que les rows
 * encore sur un statut legacy ou aux champs published manquants.
 *
 * CHOIX : prod n'a que la démo (pas de vrais créateurs) → on migre proprement
 * vers la nouvelle machine. Le retrait des littéraux legacy de l'union (status)
 * est un RESSERRAGE ultérieur, une fois la migration passée partout.
 *
 * Runnable : `npx convex run assignments:migrateAssignmentStatuses [--prod]`.
 */
export const migrateAssignmentStatuses = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    submitted: number;
    validated: number;
    rejected: number;
    fieldsAligned: number;
  }> => {
    const all = await ctx.db.query("assignments").collect();
    let submitted = 0;
    let validated = 0;
    let rejected = 0;
    let fieldsAligned = 0;
    for (const a of all) {
      const patch: Partial<Doc<"assignments">> = {};
      if (a.status === "submitted") {
        patch.status = "video_submitted";
        submitted++;
      } else if (a.status === "validated") {
        patch.status = "published";
        validated++;
      } else if (a.status === "rejected") {
        patch.status = "video_rejected";
        if (a.videoReviewFeedback === undefined && a.adminFeedback !== undefined) {
          patch.videoReviewFeedback = a.adminFeedback;
        }
        rejected++;
      }
      const nextStatus = patch.status ?? a.status;
      if (
        (nextStatus === "published" || nextStatus === "paid") &&
        a.publishedUrl === undefined &&
        a.submittedUrl !== undefined
      ) {
        patch.publishedUrl = a.submittedUrl;
        patch.publishedAt = a.submittedAt ?? a.createdAt;
        fieldsAligned++;
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(a._id, patch);
    }
    return { submitted, validated, rejected, fieldsAligned };
  },
});

/**
 * P8 — assignments PUBLIÉS (avec publication) candidats au calcul de bonus,
 * enrichis des vues du dernier snapshot (préremplissage) et du bonus déjà
 * crédité s'il existe.
 */
export const listValidatedForBonus = adminQuery({
  args: {},
  handler: async (ctx) => {
    const validated = (
      await ctx.db
        .query("assignments")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", ctx.projectId).eq("status", "published"),
        )
        .collect()
    ).filter((a) => a.publicationId !== undefined);

    const [creators, formats, payments] = await Promise.all([
      ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("payments")
        .withIndex("by_project_period", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    const bonusByAssignment = new Map<string, number>();
    for (const p of payments) {
      for (const li of p.lineItems) {
        if (li.kind === "bonus") bonusByAssignment.set(li.assignmentId, li.amount);
      }
    }

    const rows = await Promise.all(
      validated.map(async (a) => {
        const pub = a.publicationId ? await ctx.db.get(a.publicationId) : null;
        return {
          assignmentId: a._id,
          creatorName: creatorMap.get(a.creatorId) ?? "—",
          formatName: a.formatId ? (formatMap.get(a.formatId) ?? "—") : "—",
          carouselId: pub?.carouselId ?? null,
          latestViews: pub?.vuesLatest ?? null,
          hasSnapshot: pub?.latestSnapshotAt !== undefined,
          existingBonus: bonusByAssignment.get(a._id) ?? null,
        };
      }),
    );
    // Actionnables (avec snapshot) d'abord.
    return rows.sort((x, y) => Number(y.hasSnapshot) - Number(x.hasSnapshot));
  },
});

/**
 * P8 — BONUS DE VUES (manuel). Sur un assignment validé dont la publication a
 * des snapshots : montant calculé AUTORITATIVEMENT serveur depuis le
 * rateSnapshot figé (jamais un montant fourni par le client) = part liée aux
 * vues (viewBonus + bounty ; la base est déjà créditée à la validation). UN
 * seul bonus par assignment : recalculer REMPLACE la ligne (cf
 * upsertBonusLineItem), jamais d'ajout → idempotent.
 */
export const computeViewBonus = adminMutation({
  args: { id: v.id("assignments"), views: v.number() },
  handler: async (ctx, { id, views }) => {
    const a = await ctx.db.get(id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "published") {
      throw new ConvexError("Le bonus se calcule sur un assignment publié.");
    }
    if (a.publicationId === undefined) {
      throw new ConvexError(
        "Pas de publication matérialisée (format custom ?) — bonus non applicable.",
      );
    }
    if (!Number.isFinite(views) || views < 0) {
      throw new ConvexError("Nombre de vues invalide.");
    }
    const format = a.formatId ? await ctx.db.get(a.formatId) : null;
    const earnings = computeEarnings(a.rateSnapshot, views);
    // bonus = part liée aux vues uniquement (la base est déjà créditée).
    const bonusAmount =
      Math.round((earnings.viewBonus + earnings.bounty) * 100) / 100;
    await upsertBonusLineItem(ctx, {
      projectId: ctx.projectId,
      creatorId: a.creatorId,
      assignmentId: id,
      label: `${format?.name ?? "Format"} — bonus (${views} vues)`,
      amount: bonusAmount,
      now: Date.now(),
    });
    return { ok: true, bonus: bonusAmount };
  },
});

// ─── Créateur (isolé par ctx.creatorId) ──────────────────────────────────────

/**
 * Enrichit un assignment pour le CRÉATEUR. ISOLATION : on retire `scriptCombo`
 * et `comboKey` (décomposition/brick ids/campagne) — le créateur ne reçoit
 * QUE le script monté (`assembledScript`), jamais les briques ni le tier. Un
 * assignment script s'affiche « Vidéo à tourner » (pas de type, pas de campagne).
 */
async function enrichForCreator(ctx: QueryCtx, a: Doc<"assignments">) {
  const account = a.accountId ? await ctx.db.get(a.accountId) : null;
  const { scriptCombo, comboKey, ...safe } = a;
  void comboKey;
  if (scriptCombo) {
    return {
      ...safe,
      formatName: "Vidéo à tourner",
      formatType: null as string | null,
      accountHandle: account?.handle ?? null,
      origin: "script" as const,
      assembledScript: scriptCombo.assembledScript,
    };
  }
  const format = a.formatId ? await ctx.db.get(a.formatId) : null;
  return {
    ...safe,
    formatName: format?.name ?? "—",
    formatType: (format?.type ?? "custom") as string | null,
    accountHandle: account?.handle ?? null,
    origin: "format" as const,
    assembledScript: null as string | null,
  };
}

/** Mes assignments UNIQUEMENT (filtre serveur par creatorId), triés deadline. */
export const listMyAssignments = creatorQuery({
  args: {},
  handler: async (ctx) => {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", ctx.creatorId))
      .collect();
    const enriched = await Promise.all(
      assignments.map((a) => enrichForCreator(ctx, a)),
    );
    return enriched.sort((a, b) => a.dueDate - b.dueDate);
  },
});

/**
 * Fiche assignment côté créateur. null si pas la mienne. ISOLATION : `scriptCombo`
 * et `comboKey` sont RETIRÉS de l'objet renvoyé — pour un assignment script, le
 * créateur reçoit le script monté (`assembledScript`) et la rému, JAMAIS la
 * décomposition (briques/ids/tiers/campagne).
 */
export const getMyAssignment = creatorQuery({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    // Isolation : un assignment d'un autre créateur → introuvable.
    if (!a || a.creatorId !== ctx.creatorId) return null;
    const account = a.accountId ? await ctx.db.get(a.accountId) : null;
    const { scriptCombo, comboKey, ...safe } = a;
    void comboKey;
    // ISOLATION : SA vidéo soumise, résolue côté serveur (URL signée). Le blob
    // n'est jamais lisible que par le créateur (ici) et l'admin (listVideoSubmitted).
    const submittedVideoUrl = a.submittedVideoStorageId
      ? await ctx.storage.getUrl(a.submittedVideoStorageId)
      : null;
    const submittedVideoMimeType = a.submittedVideoMimeType ?? "video/mp4";
    if (scriptCombo) {
      return {
        assignment: safe,
        format: null,
        assembledScript: scriptCombo.assembledScript,
        accountHandle: account?.handle ?? null,
        submittedVideoUrl,
        submittedVideoMimeType,
      };
    }
    const format = a.formatId ? await ctx.db.get(a.formatId) : null;
    const brief = format ? await withResolvedExamples(ctx, format) : null;
    return {
      assignment: safe,
      format: brief,
      assembledScript: null as string | null,
      accountHandle: account?.handle ?? null,
      submittedVideoUrl,
      submittedVideoMimeType,
    };
  },
});

/** todo → in_progress (« Je commence »). */
export const startAssignment = creatorMutation({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || a.creatorId !== ctx.creatorId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "todo") {
      throw new ConvexError("Cet assignment est déjà démarré.");
    }
    await ctx.db.patch(id, { status: "in_progress" });
  },
});

/**
 * SOUMISSION VIDÉO (MP4) — le créateur upload sa vidéo NON publiée. Le client a
 * déjà poussé le blob (generateUploadUrl → storage) et fournit le storageId.
 * Autorisé depuis todo / in_progress / video_rejected (re-soumission après
 * refus). Une re-soumission PURGE l'ancien blob refusé.
 */
export const submitVideo = creatorMutation({
  args: {
    id: v.id("assignments"),
    storageId: v.id("_storage"),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, { id, storageId, mimeType }) => {
    const a = await ctx.db.get(id);
    if (!a || a.creatorId !== ctx.creatorId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (
      a.status !== "todo" &&
      a.status !== "in_progress" &&
      a.status !== "video_rejected"
    ) {
      throw new ConvexError("Soumission vidéo impossible dans cet état.");
    }
    // Remplacement : l'ancienne vidéo (refusée) est purgée du storage.
    if (a.submittedVideoStorageId && a.submittedVideoStorageId !== storageId) {
      await ctx.storage.delete(a.submittedVideoStorageId);
    }
    await ctx.db.patch(id, {
      status: "video_submitted",
      submittedVideoStorageId: storageId,
      submittedVideoMimeType: mimeType ?? "video/mp4",
      videoReviewFeedback: undefined,
    });
    return { ok: true };
  },
});

/**
 * PUBLICATION — le créateur fournit l'URL du post publié (étape `to_publish`).
 * C'EST ICI le DÉCLENCHEUR : matérialise la publication (tracking de vues),
 * accrue le paiement de BASE, et PURGE le MP4 de soumission. Plateforme détectée
 * serveur. IDEMPOTENT : re-confirmer un assignment déjà published est un no-op
 * (ni double pub, ni double crédit, ni re-purge).
 *
 * Type de retour ANNOTÉ (matérialise via ctx.runMutation(internal.*) → TS7022).
 */
export const confirmPublication = creatorMutation({
  args: { id: v.id("assignments"), url: v.string() },
  handler: async (
    ctx,
    { id, url },
  ): Promise<{
    ok: true;
    alreadyPublished: boolean;
    publicationId: Id<"publications"> | null;
  }> => {
    const a = await ctx.db.get(id);
    if (!a || a.creatorId !== ctx.creatorId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status === "published" || a.status === "paid") {
      return {
        ok: true,
        alreadyPublished: true,
        publicationId: a.publicationId ?? null,
      };
    }
    if (a.status !== "to_publish") {
      throw new ConvexError(
        "Publication possible seulement après validation de ta vidéo.",
      );
    }
    const trimmed = url.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      throw new ConvexError("URL du post invalide (lien http(s) attendu).");
    }
    const platform = detectPlatform(trimmed);

    // Garde plateforme : un post MATÉRIALISABLE (format non-custom OU script)
    // exige une plateforme reconnue + (format) la compatibilité format/plateforme.
    const isScript = a.scriptCombo !== undefined && a.formatId === undefined;
    const format = a.formatId ? await ctx.db.get(a.formatId) : null;
    const materializable = isScript || (format !== null && format.type !== "custom");
    if (materializable) {
      if (platform === undefined) {
        throw new ConvexError(
          "Plateforme du lien non reconnue (TikTok, Instagram ou YouTube attendu).",
        );
      }
      if (format && format.type !== "custom" && !isFormatAllowedOnPlatform(format.type, platform)) {
        throw new ConvexError(
          `Le format « ${format.name} » (${format.type}) ne peut pas être publié sur ${platform}.`,
        );
      }
    }

    const publishedAt = Date.now();
    const publicationId = await materializeAndAccrueOnPublish(
      ctx,
      a,
      ctx.projectId,
      { url: trimmed, platform, publishedAt },
    );

    // PURGE du MP4 de soumission (la vidéo non publiée n'a plus de raison d'être).
    if (a.submittedVideoStorageId) {
      await ctx.storage.delete(a.submittedVideoStorageId);
    }

    await ctx.db.patch(id, {
      status: "published",
      publishedUrl: trimmed,
      publishedAt,
      submittedPlatform: platform,
      publicationId: publicationId ?? undefined,
      submittedVideoStorageId: undefined,
      submittedVideoMimeType: undefined,
    });

    return { ok: true, alreadyPublished: false, publicationId };
  },
});

/** Notif in-app : nb de mes assignments « à publier » (vidéo validée). */
export const countMyToPublish = creatorQuery({
  args: {},
  handler: async (ctx) => {
    const mine = await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", ctx.creatorId))
      .collect();
    return mine.filter((a) => a.status === "to_publish").length;
  },
});

// ─── Cleanup e2e (gated E2E_SECRET) ──────────────────────────────────────────

/**
 * Force le statut (+ feedback) d'un assignment — UNIQUEMENT pour les tests
 * (la validation/rejet admin arrive au chantier suivant). Permet de tester la
 * resoumission depuis "rejected".
 */
export const e2eSetAssignmentStatus = e2eMutation({
  args: {
    id: v.id("assignments"),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("video_submitted"),
      v.literal("video_rejected"),
      v.literal("to_publish"),
      v.literal("published"),
      v.literal("paid"),
    ),
    videoReviewFeedback: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, videoReviewFeedback }) => {
    await ctx.db.patch(id, { status, videoReviewFeedback });
    return { ok: true };
  },
});

/** Supprime les assignments liés à un créateur/format de test ([E2E_TEST]). */
export const cleanupTestAssignments = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("assignments").collect();
    let deleted = 0;
    for (const a of all) {
      const creator = await ctx.db.get(a.creatorId);
      const format = a.formatId ? await ctx.db.get(a.formatId) : null;
      const isTest =
        (creator && creator.name.startsWith("[E2E_TEST]")) ||
        (creator && creator.email.includes("e2e-creator")) ||
        (format && format.name.startsWith("[E2E_TEST]"));
      if (isTest) {
        // P8 — cascade : la publication matérialisée a notes="" (non captée par
        // cleanupTestPublications) → on la supprime ici, avec ses snapshots.
        const pubId = a.publicationId;
        if (pubId) {
          const snaps = await ctx.db
            .query("metricSnapshots")
            .withIndex("by_publication", (q) => q.eq("publicationId", pubId))
            .collect();
          for (const s of snaps) await ctx.db.delete(s._id);
          await ctx.db.delete(pubId);
        }
        await ctx.db.delete(a._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

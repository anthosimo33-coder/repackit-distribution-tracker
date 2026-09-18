import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  e2eMutation,
  permissionMutation,
  permissionQuery,
  publicMutation,
  publicQuery,
} from "./functions";
import { ERR, err } from "./errorCodes";
import {
  buildPublicationAssignmentMap,
  postLabel,
  publishedAndMatches,
} from "./trackerData";
import { computeDailyViewDeltas } from "./viewsDaily";
import {
  blocksForAudience,
  effectiveFilters,
  newShareToken,
  projectPublicTracker,
  shareStatus,
  shareWindow,
  type InternalSharePost,
  type PublicSharePayload,
  type ShareAudience,
  type SharePerimeter,
} from "./publicShare";

/**
 * LIENS PUBLICS D'UN DASHBOARD — lecture, création, révocation.
 *
 * Deux populations, deux portes :
 *   - l'équipe, gardée par le bloc `content.share` : créer, prévisualiser,
 *     lister, révoquer ;
 *   - le visiteur SANS compte, par le jeton : `getPublicShare` et
 *     `recordShareOpen`. Rien d'autre n'est joignable sans session.
 *
 * La projection (ce qui sort) est dans convex/publicShare.ts, pure et testée.
 * Ce fichier ne fait que lire la base dans le périmètre et la lui passer :
 * l'aperçu de l'équipe et la page publique passent par LE MÊME
 * `buildPublicPayload`, donc « ce que tu vois est ce qu'ils verront » est une
 * propriété du code, pas une intention.
 */

const periodArg = v.union(
  v.object({ kind: v.literal("rolling"), days: v.number() }),
  v.object({ kind: v.literal("fixed"), from: v.number(), to: v.number() }),
  v.object({ kind: v.literal("all") }),
);

const perimeterArg = v.object({
  period: periodArg,
  creatorIds: v.optional(v.array(v.id("creators"))),
  comptes: v.optional(v.array(v.string())),
  plateformes: v.optional(
    v.array(
      v.union(v.literal("TikTok"), v.literal("Instagram"), v.literal("YouTube")),
    ),
  ),
  campaignIds: v.optional(v.array(v.id("scriptCampaigns"))),
  warmup: v.union(v.literal("exclude"), v.literal("all"), v.literal("only")),
});

/** La configuration d'un lien, commune à l'aperçu et à la création. */
const configArgs = {
  audience: v.union(v.literal("brand"), v.literal("creator")),
  creatorId: v.optional(v.id("creators")),
  perimeter: perimeterArg,
  blocks: v.array(v.string()),
  showCreatorNames: v.boolean(),
  postLinks: v.boolean(),
  playableVideos: v.optional(v.boolean()),
} as const;

/** Le périmètre du cœur pur, avec les identifiants typés de la base. */
type StoredPerimeter = Omit<SharePerimeter, "creatorIds" | "campaignIds"> & {
  creatorIds?: Id<"creators">[];
  campaignIds?: Id<"scriptCampaigns">[];
};

type ShareConfig = {
  audience: ShareAudience;
  creatorId?: Id<"creators">;
  perimeter: StoredPerimeter;
  blocks: string[];
  showCreatorNames: boolean;
  postLinks: boolean;
  playableVideos: boolean;
};

async function buildPublicPayload(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  cfg: ShareConfig,
  name: string,
  now: number,
): Promise<PublicSharePayload | null> {
  const project = await ctx.db.get(projectId);
  if (project === null) return null;
  const creator =
    cfg.audience === "creator" && cfg.creatorId !== undefined
      ? await ctx.db.get(cfg.creatorId)
      : null;
  // Une créatrice qui n'est plus dans le projet ne rend pas le lien « de tout le
  // monde » : il ne montre plus rien.
  if (
    cfg.audience === "creator" &&
    (creator === null || creator.projectId !== projectId)
  ) {
    return null;
  }

  const filters = effectiveFilters(
    {
      audience: cfg.audience,
      creatorId: cfg.creatorId ?? null,
      perimeter: cfg.perimeter,
    },
    now,
  );
  const scoped = Object.assign({}, ctx, { projectId });
  const refs = await buildPublicationAssignmentMap(scoped);
  const pubs = await ctx.db
    .query("publications")
    .withIndex("by_project_datePubli", (q) => q.eq("projectId", projectId))
    .order("desc")
    .collect();

  const kept: Doc<"publications">[] = [];
  for (const p of pubs) {
    if (
      publishedAndMatches(
        p,
        {
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          creatorIds: filters.creatorIds as Id<"creators">[] | undefined,
          comptes: filters.comptes,
          plateformes: filters.plateformes,
          campaignIds: filters.campaignIds as Id<"scriptCampaigns">[] | undefined,
          warmup: filters.warmup,
        },
        (id) => refs.get(id),
      )
    ) {
      kept.push(p);
    }
  }

  const internal: InternalSharePost[] = kept.map((p) => {
    const ref = refs.get(p._id as string);
    return {
      id: p._id as string,
      label: postLabel(p),
      plateforme: p.plateforme,
      compte: p.compte,
      datePubli: p.datePubli,
      vues: p.vuesLatest ?? 0,
      likes: p.likesLatest ?? 0,
      comments: p.commentsLatest ?? 0,
      isWarmup: p.isWarmup === true,
      creatorId: (ref?.creatorId as string | undefined) ?? null,
      creatorName: ref?.creatorName ?? null,
      postUrl: p.postUrl ?? null,
    };
  });

  const blocks = blocksForAudience(cfg.blocks, cfg.audience);
  const view = projectPublicTracker(internal, {
    audience: cfg.audience,
    blocks,
    showCreatorNames: cfg.showCreatorNames,
    postLinks: cfg.postLinks,
    playableVideos: cfg.playableVideos,
    warmup: cfg.perimeter.warmup,
  });

  // Courbe : même répartition que le Tracker (convex/viewsDaily), sur un scan
  // BORNÉ par index — lu seulement si le bloc est coché.
  let daily: PublicSharePayload["daily"] = null;
  if (blocks.includes("daily")) {
    daily = [];
    if (kept.length > 0) {
      const ids = new Set(kept.map((p) => p._id as string));
      const lower =
        filters.dateFrom ??
        kept.reduce((m, p) => Math.min(m, p.datePubli), Number.POSITIVE_INFINITY);
      const snaps = await ctx.db
        .query("metricSnapshots")
        .withIndex("by_project_capturedAt", (ix) => {
          const lo = ix.eq("projectId", projectId).gte("capturedAt", lower);
          return filters.dateTo !== undefined
            ? lo.lte("capturedAt", filters.dateTo)
            : lo;
        })
        .collect();
      daily = computeDailyViewDeltas(
        snaps
          .filter((s) => ids.has(s.publicationId as string))
          .map((s) => ({
            publicationId: s.publicationId as string,
            capturedAt: s.capturedAt,
            vues: s.vues,
          })),
      ).map((d) => ({ date: d.date, value: d.value }));
    }
  }

  const lastSnap = await ctx.db
    .query("metricSnapshots")
    .withIndex("by_project_capturedAt", (ix) => ix.eq("projectId", projectId))
    .order("desc")
    .first();

  const win = shareWindow(cfg.perimeter.period, now);
  return {
    status: "valid",
    dashboard: "tracker",
    name,
    projectName: project.name,
    projectLogoUrl: project.logoUrl ?? null,
    accentColor: project.accentColor,
    audience: cfg.audience,
    creatorName: creator?.name ?? null,
    period: {
      kind: cfg.perimeter.period.kind,
      from: win.from ?? null,
      to: win.to ?? null,
    },
    updatedAt: lastSnap?.capturedAt ?? null,
    blocks,
    view,
    daily,
  };
}

// ─── Validation d'une configuration ─────────────────────────────────────────

async function assertValidConfig(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  cfg: ShareConfig,
): Promise<void> {
  if (blocksForAudience(cfg.blocks, cfg.audience).length === 0) {
    throw err(ERR.SHARE_NO_BLOCK, "Choisis au moins un bloc à partager.");
  }
  const period = cfg.perimeter.period;
  if (
    period.kind === "rolling" &&
    !(Number.isInteger(period.days) && period.days >= 1 && period.days <= 365)
  ) {
    throw err(ERR.SHARE_PERIOD_INVALID, "Période glissante : de 1 à 365 jours.");
  }
  if (period.kind === "fixed" && !(period.from < period.to)) {
    throw err(ERR.SHARE_PERIOD_INVALID, "La date de début doit précéder la date de fin.");
  }
  if (cfg.audience === "creator") {
    if (cfg.creatorId === undefined) {
      throw err(ERR.SHARE_CREATOR_REQUIRED, "Choisis la créatrice qui recevra ce lien.");
    }
    const c = await ctx.db.get(cfg.creatorId);
    if (c === null || c.projectId !== projectId) {
      throw err(ERR.CREATOR_NOT_IN_PROJECT, "Créatrice introuvable dans le projet.");
    }
  }
  for (const id of cfg.perimeter.creatorIds ?? []) {
    const c = await ctx.db.get(id);
    if (c === null || c.projectId !== projectId) {
      throw err(ERR.CREATOR_NOT_IN_PROJECT, "Créatrice introuvable dans le projet.");
    }
  }
  for (const id of cfg.perimeter.campaignIds ?? []) {
    const c = await ctx.db.get(id);
    if (c === null || c.projectId !== projectId) {
      throw err(ERR.SHARE_CAMPAIGN_NOT_IN_PROJECT, "Campagne introuvable dans le projet.");
    }
  }
}

// ─── Équipe ─────────────────────────────────────────────────────────────────

/** L'aperçu du mode partage : EXACTEMENT ce que la page publique recevra. */
export const previewShare = permissionQuery("content.share")({
  // Configuration GROUPÉE, pas étalée : la garde anti-fuite refuse tout spread
  // dans une query (cf trackerViewsDayDetail, même contrainte).
  args: { config: v.object(configArgs), name: v.string() },
  handler: async (ctx, { config, name }): Promise<PublicSharePayload | null> => {
    const cfg: ShareConfig = {
      audience: config.audience,
      creatorId: config.creatorId,
      perimeter: config.perimeter,
      blocks: config.blocks,
      showCreatorNames: config.audience === "brand" && config.showCreatorNames,
      postLinks: config.postLinks,
      playableVideos: config.playableVideos === true,
    };
    if (cfg.audience === "creator" && cfg.creatorId === undefined) return null;
    return await buildPublicPayload(ctx, ctx.projectId, cfg, name, Date.now());
  },
});

export const createShare = permissionMutation("content.share")({
  args: {
    ...configArgs,
    name: v.string(),
    // En JOURS, et l'échéance est calculée ICI : l'horloge qui compte est celle
    // du serveur, pas celle du poste qui crée le lien.
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0 || name.length > 120) {
      throw err(ERR.SHARE_NAME_INVALID, "Donne un nom au lien (120 caractères au plus).");
    }
    const now = Date.now();
    if (
      args.expiresInDays !== undefined &&
      !(Number.isInteger(args.expiresInDays) &&
        args.expiresInDays >= 1 &&
        args.expiresInDays <= 365)
    ) {
      throw err(ERR.SHARE_EXPIRY_INVALID, "Expiration : de 1 à 365 jours.");
    }
    const expiresAt =
      args.expiresInDays === undefined
        ? undefined
        : now + args.expiresInDays * 24 * 60 * 60 * 1000;
    const cfg: ShareConfig = {
      audience: args.audience,
      creatorId: args.audience === "creator" ? args.creatorId : undefined,
      perimeter: args.perimeter,
      blocks: blocksForAudience(args.blocks, args.audience),
      showCreatorNames: args.audience === "brand" && args.showCreatorNames,
      postLinks: args.postLinks,
      playableVideos: args.playableVideos === true,
    };
    await assertValidConfig(ctx, ctx.projectId, cfg);

    const token = newShareToken();
    const shareId = await ctx.db.insert("publicShares", {
      projectId: ctx.projectId,
      token,
      dashboard: "tracker",
      name,
      audience: cfg.audience,
      creatorId: cfg.creatorId,
      perimeter: {
        period: cfg.perimeter.period,
        creatorIds:
          cfg.audience === "brand" ? args.perimeter.creatorIds : undefined,
        comptes: args.perimeter.comptes,
        plateformes: args.perimeter.plateformes,
        campaignIds: args.perimeter.campaignIds,
        warmup: args.perimeter.warmup,
      },
      blocks: cfg.blocks,
      showCreatorNames: cfg.showCreatorNames,
      postLinks: cfg.postLinks,
      playableVideos: cfg.playableVideos,
      expiresAt,
      createdBy: ctx.userId,
      createdAt: now,
      openCount: 0,
    });
    return { shareId, token };
  },
});

export const listShares = permissionQuery("content.share")({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("publicShares")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const out = [];
    for (const s of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const creator = s.creatorId ? await ctx.db.get(s.creatorId) : null;
      // Un lien de créatrice dont la fiche a disparu ne montre plus rien
      // (cf buildPublicPayload) : l'afficher « Actif » serait mentir.
      const orphan =
        s.audience === "creator" &&
        (creator === null || creator.projectId !== ctx.projectId);
      out.push({
        _id: s._id,
        token: s.token,
        name: s.name,
        audience: s.audience,
        creatorName: creator?.name ?? null,
        blocks: s.blocks,
        showCreatorNames: s.showCreatorNames,
        postLinks: s.postLinks,
        periodKind: s.perimeter.period.kind,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt ?? null,
        revokedAt: s.revokedAt ?? null,
        status:
          s.revokedAt !== undefined
            ? ("revoked" as const)
            : shareStatus(s, now) === "invalid"
              ? ("expired" as const)
              : orphan
                ? ("unavailable" as const)
                : ("active" as const),
        active: shareStatus(s, now) === "valid" && !orphan,
        openCount: s.openCount,
        lastOpenedAt: s.lastOpenedAt ?? null,
      });
    }
    return out;
  },
});

export const revokeShare = permissionMutation("content.share")({
  args: { shareId: v.id("publicShares") },
  handler: async (ctx, { shareId }) => {
    const s = await ctx.db.get(shareId);
    if (s === null || s.projectId !== ctx.projectId) {
      throw err(ERR.SHARE_NOT_FOUND, "Lien introuvable.");
    }
    if (s.revokedAt === undefined) {
      await ctx.db.patch(shareId, { revokedAt: Date.now() });
    }
  },
});

// ─── Visiteur sans compte ───────────────────────────────────────────────────

async function shareByToken(ctx: QueryCtx, token: string) {
  // Un jeton mal formé ne coûte même pas une lecture d'index.
  if (!/^[0-9A-Za-z]{22}$/.test(token)) return null;
  return await ctx.db
    .query("publicShares")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
}

/**
 * La page `/s/<token>`. Inconnu, révoqué, expiré, créatrice partie : la MÊME
 * réponse `{ status: "invalid" }`. On ne révèle ni qu'un lien a existé, ni
 * pourquoi il ne marche plus.
 */
export const getPublicShare = publicQuery({
  args: { token: v.string() },
  handler: async (
    ctx,
    { token },
  ): Promise<PublicSharePayload | { status: "invalid" }> => {
    const now = Date.now();
    const s = await shareByToken(ctx, token);
    if (s === null || shareStatus(s, now) === "invalid") {
      return { status: "invalid" };
    }
    const payload = await buildPublicPayload(
      ctx,
      s.projectId,
      {
        audience: s.audience,
        creatorId: s.creatorId,
        perimeter: s.perimeter,
        blocks: s.blocks,
        showCreatorNames: s.showCreatorNames,
        postLinks: s.postLinks,
        playableVideos: s.playableVideos === true,
      },
      s.name,
      now,
    );
    return payload ?? { status: "invalid" };
  },
});

/** Compteur d'ouvertures. Silencieux sur un lien invalide : rien à apprendre ici. */
export const recordShareOpen = publicMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await shareByToken(ctx, token);
    if (s === null) return null;
    const now = Date.now();
    if (shareStatus(s, now) === "invalid") return null;
    await ctx.db.patch(s._id, { openCount: s.openCount + 1, lastOpenedAt: now });
    return null;
  },
});

/** Nettoyage e2e : les liens dont le nom porte le marqueur de test. */
export const cleanupTestShares = e2eMutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0;
    for (const s of await ctx.db.query("publicShares").collect()) {
      if (s.name.startsWith("[E2E_TEST]")) {
        await ctx.db.delete(s._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

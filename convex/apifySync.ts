import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { adminMutation, e2eMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  fetchApifyViewsForPlatform,
  tiktokPostId,
  instagramShortcode,
  type ApifyPlatform,
} from "./apifyApi";
import {
  recoverMissingTikTokPosts,
  type FallbackTarget,
} from "./tiktokFallback";
import { recomputeLatestMetrics } from "./metricSnapshots";
import { TRACKING_WINDOW_DAYS } from "./syncScope";
import { unmatchableUrlReason } from "./postUrlShape";
import { isTikTokShortlink } from "./postUrlDate";
import { syncBonusForPublication } from "./pricing";

/**
 * S — Tracking AUTO des vues TikTok/Instagram via Apify. CALQUÉ sur le tracking
 * YouTube (convex/youtubeSync.ts) : un cron quotidien (convex/crons.ts) relève
 * les vues de tous les posts TikTok/Insta ACTIFS via Apify (convex/apifyApi) et
 * écrit un snapshot/jour/publication dans metricSnapshots → CPM, cumul et paliers
 * s'alimentent EXACTEMENT comme pour YouTube (recompute + syncBonus).
 *
 * Tout est interne/admin : le cron tourne sans identité (internalAction), le
 * déclenchement manuel est gated admin (requestApifySync). Aucun token Apify ne
 * fuit côté créateur.
 *
 * SANS APIFY_API_TOKEN → désactivation PROPRE (log + skip, pas de crash), comme
 * le fallback YouTube sans clé.
 *
 * ⚠️ TS7022 — runDailySync appelle ctx.runQuery/runMutation(internal.*) : type
 * de retour ANNOTÉ (ApifySyncSummary) pour casser le cycle d'inférence.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fenêtre de tracking partagée avec YouTube — définition unique dans
 *  convex/syncScope.ts (plus deux constantes « à garder synchrones »). */
const ACTIVE_WINDOW_DAYS = TRACKING_WINDOW_DAYS;

/** Plateformes Apify + la `source` du snapshot correspondant. */
const APIFY_PLATFORMS: { plateforme: ApifyPlatform; source: ApifySource }[] = [
  { plateforme: "TikTok", source: "tiktok" },
  { plateforme: "Instagram", source: "instagram" },
];

type ApifySource = "tiktok" | "instagram";

const apifySourceValidator = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
);

export interface ApifySyncSummary {
  ok: boolean;
  /** Raison de l'arrêt précoce (ex. token absent). */
  reason?: string;
  /** Publications TikTok/Insta actives scannées (toutes plateformes). */
  scanned: number;
  /** Publications dont l'URL a donné une clé de post valide. */
  matched: number;
  /** Snapshots écrits (insérés ou mis à jour). */
  synced: number;
  /** Posts indisponibles (privés/supprimés/image Insta sans vues). */
  unavailable: number;
  /** Lots Apify en erreur (non bloquant). */
  errors: number;
  /** Runs Apify lancés (≈ unité de coût). */
  runs: number;
  /** Posts rattrapés par le REPLI maison après un abandon d'Apify. */
  recovered: number;
  /** Posts perdus malgré le repli — échec persisté sur la publication. */
  failed: number;
}

/**
 * Upsert IDEMPOTENT du snapshot Apify du JOUR pour une publication. Si un
 * snapshot de MÊME `source` (tiktok/instagram) existe déjà aujourd'hui (même jour
 * UTC) pour cette publication, on le MET À JOUR au lieu d'en créer un second →
 * relancer la sync le même jour ne duplique pas. Maintient `vuesLatest`
 * (recomputeLatestMetrics), les paliers de bonus (syncBonusForPublication) et
 * l'indicateur `lastApifySyncAt`. Même mécanisme d'écriture que YouTube.
 *
 * Likes : on écrit le like Apify (diggCount TikTok / likesCount Instagram) quand
 * il est fourni ; sinon on PRÉSERVE le dernier like connu (likesLatest) plutôt
 * que d'écraser à 0 (comme YouTube quand likeCount est masqué).
 *
 * Titre : si fourni (légende du post), patché sur la publication (postTitle) —
 * propriété du post, pas une série temporelle, donc hors snapshot.
 *
 * Partagé par recordApifySnapshot (cron) et e2eRecordApifySnapshot (test).
 */
async function upsertApifySnapshot(
  ctx: MutationCtx,
  args: {
    publicationId: Id<"publications">;
    vues: number;
    likes?: number | null;
    comments?: number | null;
    saves?: number | null;
    title?: string | null;
    capturedAt: number;
    source: ApifySource;
  },
): Promise<{ action: "inserted" | "updated" | "skipped" }> {
  const pub = await ctx.db.get(args.publicationId);
  if (!pub) return { action: "skipped" };
  // Invariant metricSnapshots : capturedAt jamais antérieur à la publication.
  if (args.capturedAt < pub.datePubli) return { action: "skipped" };

  const dayStart = Math.floor(args.capturedAt / DAY_MS) * DAY_MS;
  const dayEnd = dayStart + DAY_MS;
  const todays = await ctx.db
    .query("metricSnapshots")
    .withIndex("by_publication_and_capturedAt", (q) =>
      q
        .eq("publicationId", args.publicationId)
        .gte("capturedAt", dayStart)
        .lt("capturedAt", dayEnd),
    )
    .collect();
  const existing = todays.find((s) => s.source === args.source);

  const daysSincePublication = Math.floor(
    (args.capturedAt - pub.datePubli) / DAY_MS,
  );
  // Like Apify s'il est fourni, sinon dernier like connu (jamais d'écrasement à 0).
  const likes = args.likes ?? pub.likesLatest ?? 0;
  // Commentaires : MÊME règle que likes (préserve le dernier connu si non fourni).
  const comments = args.comments ?? pub.commentsLatest ?? 0;
  // SAVES : règle DIFFÉRENTE des likes — on ne replie PAS sur 0. `undefined`
  // signifie « non collecté » (Instagram/YouTube n'exposent pas la métrique, et
  // les relevés d'avant ce chantier ne la portaient pas) ; l'écrire à 0 ferait
  // passer une absence pour une mesure et satisferait des seuils à tort.
  // On préserve le dernier connu plutôt que d'effacer une mesure valable.
  const saves = args.saves ?? pub.savesLatest ?? undefined;
  // Patch publication : indicateur de sync + titre (légende) si capturé.
  //
  // La RÉUSSITE EFFACE L'ÉCHEC — les trois marqueurs sont remis à `undefined`,
  // pas laissés à leur ancienne valeur. Un compteur d'échecs consécutifs qui ne
  // se remet pas à zéro finirait par accuser une publication qui va très bien.
  const pubPatch: {
    lastApifySyncAt: number;
    postTitle?: string;
    lastCollectFailureAt: undefined;
    collectFailureStreak: undefined;
    lastCollectFailureReason: undefined;
  } = {
    lastApifySyncAt: args.capturedAt,
    lastCollectFailureAt: undefined,
    collectFailureStreak: undefined,
    lastCollectFailureReason: undefined,
  };
  if (typeof args.title === "string" && args.title.length > 0) {
    pubPatch.postTitle = args.title;
  }

  if (existing) {
    await ctx.db.patch(existing._id, {
      vues: args.vues,
      likes,
      comments,
      saves,
      capturedAt: args.capturedAt,
      daysSincePublication,
    });
    await recomputeLatestMetrics(ctx, args.publicationId);
    await syncBonusForPublication(ctx, args.publicationId);
    await ctx.db.patch(args.publicationId, pubPatch);
    return { action: "updated" };
  }

  await ctx.db.insert("metricSnapshots", {
    projectId: pub.projectId,
    publicationId: args.publicationId,
    capturedAt: args.capturedAt,
    daysSincePublication,
    vues: args.vues,
    likes,
    comments,
    saves,
    createdAt: Date.now(),
    source: args.source,
  });
  await recomputeLatestMetrics(ctx, args.publicationId);
  await syncBonusForPublication(ctx, args.publicationId);
  await ctx.db.patch(args.publicationId, pubPatch);
  return { action: "inserted" };
}

/**
 * Publications actives (publiées + < ACTIVE_WINDOW_DAYS) d'UNE plateforme
 * (TikTok ou Instagram). `cutoff` passé par l'appelant (une query ne peut pas
 * appeler Date.now()). `projectId` optionnel : absent (cron) = tous les projets ;
 * présent (sync manuelle) = scopé.
 *
 * Rend aussi `compte`, `projectId` et `lastSyncAt` — de quoi appliquer la
 * politique du relevé NOCTURNE (comptes actifs, garde des 2 h, imputation des
 * échecs par projet, cf `convex/syncScope.ts`) sans deuxième scan. Le chemin
 * MANUEL ignore simplement ces champs : son périmètre reste inchangé.
 *
 * `lastSyncAt` = `latestSnapshotAt` (dernier snapshot TOUTES sources) et non
 * `lastApifySyncAt` : c'est le signal « il existe déjà un point de mesure
 * frais », qui est ce que la garde des 2 h veut vraiment savoir, et il vaut pour
 * YouTube comme pour Apify.
 */
export const listActiveApifyPublications = internalQuery({
  args: {
    cutoff: v.number(),
    plateforme: v.union(v.literal("TikTok"), v.literal("Instagram")),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (
    ctx,
    { cutoff, plateforme, projectId },
  ): Promise<
    {
      _id: Id<"publications">;
      postUrl: string;
      compte: string;
      projectId: Id<"projects">;
      datePubli: number;
      lastSyncAt?: number;
    }[]
  > => {
    const pubs = projectId
      ? await ctx.db
          .query("publications")
          .withIndex("by_project_plateforme", (q) =>
            q.eq("projectId", projectId).eq("plateforme", plateforme),
          )
          .collect()
      : await ctx.db
          .query("publications")
          .withIndex("by_plateforme", (q) => q.eq("plateforme", plateforme))
          .collect();
    return pubs
      .filter(
        (p) =>
          typeof p.postUrl === "string" &&
          p.postUrl.length > 0 &&
          p.datePubli >= cutoff,
      )
      .map((p) => ({
        _id: p._id,
        postUrl: p.postUrl as string,
        compte: p.compte,
        projectId: p.projectId,
        datePubli: p.datePubli,
        lastSyncAt: p.latestSnapshotAt,
      }));
  },
});

/** Écrit (upsert idempotent) le snapshot Apify du jour. Appelé par le cron. */
export const recordApifySnapshot = internalMutation({
  args: {
    publicationId: v.id("publications"),
    vues: v.number(),
    likes: v.union(v.number(), v.null()),
    comments: v.union(v.number(), v.null()),
    saves: v.optional(v.union(v.number(), v.null())),
    title: v.optional(v.string()),
    capturedAt: v.number(),
    source: apifySourceValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ action: "inserted" | "updated" | "skipped" }> =>
    upsertApifySnapshot(ctx, args),
});

/**
 * Écrit un relevé de PROFIL de compte, déduit d'une publication.
 *
 * L'appelant fournit `publicationId` plutôt qu'un handle : le handle rendu par
 * l'acteur (« kellyleydie ») ne coïncide pas avec celui saisi en base
 * (« @kelly.leydie »), un appariement par chaîne serait faux. La publication,
 * elle, porte son `compte` sans ambiguïté.
 *
 * UN relevé par compte et par jour UTC — même bucketisation que les snapshots de
 * post : rejouer la nuit ne crée pas de doublon, il met à jour.
 *
 * Ignore silencieusement un profil SANS aucun compteur : historiser des lignes
 * vides ferait calculer le delta d'abonnés sur du vide.
 */
/**
 * Enregistre un ÉCHEC de collecte sur une publication.
 *
 * Appelée quand Apify n'a pas rendu le post ET que le repli maison n'a pas pu
 * le lire non plus. C'est la contrepartie de `recordApifySnapshot` : l'un efface
 * les marqueurs d'échec, l'autre les pose.
 *
 * `streak` s'INCRÉMENTE : c'est lui qui permet de distinguer l'aléa d'une nuit
 * d'un post durablement perdu — la distinction que l'ancien `console.warn` ne
 * permettait pas, et qui a laissé 10 publications non relevées pendant 26 jours.
 *
 * Le `reason` est destiné à être LU (« visible par son autrice uniquement »,
 * « HTTP 429 ») : c'est ce qui permettra à l'écran de dire pourquoi une ligne
 * n'a pas de chiffres, au lieu de la peindre à 0.
 */
export const recordCollectFailure = internalMutation({
  args: {
    publicationId: v.id("publications"),
    at: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, { publicationId, at, reason }) => {
    const pub = await ctx.db.get(publicationId);
    if (!pub) return { streak: 0 };
    const streak = (pub.collectFailureStreak ?? 0) + 1;
    await ctx.db.patch(publicationId, {
      lastCollectFailureAt: at,
      collectFailureStreak: streak,
      // Tronqué : un motif est une phrase, pas un dump de page.
      lastCollectFailureReason: reason.slice(0, 200),
    });
    return { streak };
  },
});

export const recordAccountProfile = internalMutation({
  args: {
    publicationId: v.id("publications"),
    capturedAt: v.number(),
    followers: v.optional(v.union(v.number(), v.null())),
    following: v.optional(v.union(v.number(), v.null())),
    totalLikes: v.optional(v.union(v.number(), v.null())),
    source: apifySourceValidator,
  },
  handler: async (ctx, args): Promise<{ action: "written" | "skipped" }> => {
    const followers = args.followers ?? undefined;
    const following = args.following ?? undefined;
    const totalLikes = args.totalLikes ?? undefined;
    if (
      followers === undefined &&
      following === undefined &&
      totalLikes === undefined
    ) {
      return { action: "skipped" };
    }

    const pub = await ctx.db.get(args.publicationId);
    if (!pub) return { action: "skipped" };
    const compte = (
      await ctx.db
        .query("comptes")
        .withIndex("by_project", (q) => q.eq("projectId", pub.projectId))
        .collect()
    ).find((c) => c.handle === pub.compte);
    // Compte non déclaré en base (publication saisie à la main) : rien à
    // historiser, mais ce n'est pas une erreur de relevé.
    if (!compte) return { action: "skipped" };

    const dayStart = Math.floor(args.capturedAt / DAY_MS) * DAY_MS;
    const existing = await ctx.db
      .query("accountProfileSnapshots")
      .withIndex("by_compte_capturedAt", (q) =>
        q
          .eq("compteId", compte._id)
          .gte("capturedAt", dayStart)
          .lt("capturedAt", dayStart + DAY_MS),
      )
      .first();

    const row = {
      projectId: pub.projectId,
      compteId: compte._id,
      handle: compte.handle,
      plateforme: compte.plateforme,
      capturedAt: args.capturedAt,
      followers,
      following,
      totalLikes,
      source: args.source,
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("accountProfileSnapshots", row);
    return { action: "written" };
  },
});

/**
 * Comptes du projet correspondant aux handles donnés — pour les plateformes dont
 * les compteurs de profil demandent un appel DÉDIÉ (Instagram, YouTube).
 *
 * Rend `url` : c'est elle qui sert d'entrée au run de profil Instagram. Un
 * compte sans URL publique ne peut pas être relevé — l'appelant le saute.
 */
export const listComptesForProfiles = internalQuery({
  args: { handles: v.array(v.string()) },
  handler: async (ctx, { handles }) => {
    const wanted = new Set(handles);
    const out: {
      _id: Id<"comptes">;
      projectId: Id<"projects">;
      handle: string;
      plateforme: "TikTok" | "Instagram" | "YouTube";
      url: string | null;
    }[] = [];
    for (const c of await ctx.db.query("comptes").collect()) {
      if (!wanted.has(c.handle)) continue;
      out.push({
        _id: c._id,
        projectId: c.projectId,
        handle: c.handle,
        plateforme: c.plateforme,
        url: c.url ?? null,
      });
    }
    return out;
  },
});

/**
 * Écrit un relevé de profil pour un compte DÉSIGNÉ (Instagram/YouTube, dont les
 * compteurs viennent d'un appel dédié) — variante de `recordAccountProfile`, qui
 * part d'une publication parce que TikTok sert ses compteurs avec les vidéos.
 *
 * Même bucketisation par jour UTC, même refus d'historiser un relevé vide.
 */
export const recordAccountProfileByCompte = internalMutation({
  args: {
    compteId: v.id("comptes"),
    capturedAt: v.number(),
    followers: v.optional(v.union(v.number(), v.null())),
    following: v.optional(v.union(v.number(), v.null())),
    totalLikes: v.optional(v.union(v.number(), v.null())),
    source: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
    ),
  },
  handler: async (ctx, args): Promise<{ action: "written" | "skipped" }> => {
    const followers = args.followers ?? undefined;
    const following = args.following ?? undefined;
    const totalLikes = args.totalLikes ?? undefined;
    if (
      followers === undefined &&
      following === undefined &&
      totalLikes === undefined
    ) {
      return { action: "skipped" };
    }
    const compte = await ctx.db.get(args.compteId);
    if (!compte) return { action: "skipped" };

    const dayStart = Math.floor(args.capturedAt / DAY_MS) * DAY_MS;
    const existing = await ctx.db
      .query("accountProfileSnapshots")
      .withIndex("by_compte_capturedAt", (q) =>
        q
          .eq("compteId", compte._id)
          .gte("capturedAt", dayStart)
          .lt("capturedAt", dayStart + DAY_MS),
      )
      .first();

    const row = {
      projectId: compte.projectId,
      compteId: compte._id,
      handle: compte.handle,
      plateforme: compte.plateforme,
      capturedAt: args.capturedAt,
      followers,
      following,
      totalLikes,
      source: args.source,
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("accountProfileSnapshots", row);
    return { action: "written" };
  },
});

/**
 * Cœur du relevé Apify. `projectId` absent = tous les projets (cron) ; présent =
 * scopé (sync manuelle d'un admin). Si APIFY_API_TOKEN est absent du deployment,
 * log clair + rejet PROPRE (pas d'exception). Un lot Apify en erreur n'empêche
 * pas les autres ; un post indisponible (privé/supprimé/image Insta) est ignoré
 * sans crash. Traite TikTok puis Instagram (1 run par lot par plateforme).
 */
export const runDailySync = internalAction({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<ApifySyncSummary> => {
    const apiToken = process.env.APIFY_API_TOKEN;
    if (!apiToken) {
      console.error(
        "[apify-sync] APIFY_API_TOKEN absent — relevé TikTok/Insta annulé. " +
          "Posez le token : npx convex env set APIFY_API_TOKEN <token>.",
      );
      return {
        ok: false,
        reason: "missing-api-token",
        scanned: 0,
        matched: 0,
        synced: 0,
        unavailable: 0,
        errors: 0,
        runs: 0,
        recovered: 0,
        failed: 0,
      };
    }

    const now = Date.now();
    const cutoff = now - ACTIVE_WINDOW_DAYS * DAY_MS;
    const summary: ApifySyncSummary = {
      ok: true,
      scanned: 0,
      matched: 0,
      synced: 0,
      unavailable: 0,
      errors: 0,
      runs: 0,
      recovered: 0,
      failed: 0,
    };

    for (const { plateforme, source } of APIFY_PLATFORMS) {
      const pubs = await ctx.runQuery(
        internal.apifySync.listActiveApifyPublications,
        projectId ? { cutoff, plateforme, projectId } : { cutoff, plateforme },
      );
      summary.scanned += pubs.length;

      // Clé de post par publication (id TikTok / shortcode Insta).
      const keyFor = (url: string): string | null =>
        plateforme === "TikTok" ? tiktokPostId(url) : instagramShortcode(url);
      const targets: {
        publicationId: Id<"publications">;
        key: string;
        url: string;
      }[] = [];
      const urls: string[] = [];
      for (const p of pubs) {
        const key = keyFor(p.postUrl);
        // URL non rapprochable : inscrite comme échec de collecte AVEC son motif
        // (même traitement que le relevé nocturne, cf convex/nightlyViewsSync).
        // Le `continue` d'origine ne laissait qu'un écart entre `scanned` et
        // `matched` dans un log — invisible depuis l'application.
        if (!key) {
          await ctx.runMutation(internal.apifySync.recordCollectFailure, {
            publicationId: p._id,
            at: now,
            reason: unmatchableUrlReason(p.postUrl, plateforme),
          });
          if (plateforme === "TikTok" && isTikTokShortlink(p.postUrl)) {
            await ctx.scheduler.runAfter(
              0,
              internal.postUrlResolution.resolvePublicationShortlink,
              { publicationId: p._id },
            );
          }
          continue;
        }
        targets.push({ publicationId: p._id, key, url: p.postUrl });
        urls.push(p.postUrl);
      }
      summary.matched += targets.length;
      if (targets.length === 0) continue;

      const { stats, unavailable, errors, runs } =
        await fetchApifyViewsForPlatform(plateforme, urls, apiToken);
      summary.unavailable += unavailable.length;
      summary.errors += errors.length;
      summary.runs += runs;

      // Même point de bascule que le cron : ce `continue` était l'endroit exact
      // où un post abandonné par Apify disparaissait sans laisser de trace.
      const manques: FallbackTarget[] = [];
      for (const t of targets) {
        const stat = stats[t.key];
        if (stat === undefined) {
          manques.push({ publicationId: t.publicationId, key: t.key, url: t.url });
          continue;
        }
        const r = await ctx.runMutation(internal.apifySync.recordApifySnapshot, {
          publicationId: t.publicationId,
          vues: stat.views,
          likes: stat.likes,
          comments: stat.comments,
          saves: stat.saves,
          title: stat.title ?? undefined,
          capturedAt: now,
          source,
        });
        if (r.action !== "skipped") summary.synced += 1;
      }

      if (manques.length > 0) {
        if (plateforme === "TikTok") {
          const r = await recoverMissingTikTokPosts(ctx, manques, now);
          summary.recovered += r.recovered;
          summary.synced += r.recovered;
          summary.failed += r.refused + r.unreadable + r.deferred;
        } else {
          for (const t of manques) {
            await ctx.runMutation(internal.apifySync.recordCollectFailure, {
              publicationId: t.publicationId,
              at: now,
              reason:
                "Apify n'a pas rendu le post (aucun repli sur cette plateforme)",
            });
          }
          summary.failed += manques.length;
        }
      }

      if (errors.length > 0) {
        console.error(
          `[apify-sync] ${plateforme} — ${errors.length} lot(s) en erreur:`,
          errors,
        );
      }
      if (unavailable.length > 0) {
        console.warn(
          `[apify-sync] ${plateforme} — ${unavailable.length} post(s) indisponible(s) (privé/supprimé/image).`,
        );
      }
      console.info(
        `[apify-sync] ${plateforme} OK — ${pubs.length} pub(s) active(s), ${targets.length} post(s), ${runs} run(s) Apify.`,
      );
    }

    console.info(
      `[apify-sync] Terminé — ${summary.synced} snapshot(s), ${summary.runs} run(s) Apify au total (~coût).`,
    );
    return summary;
  },
});

/**
 * Déclenchement MANUEL (admin) — « Synchroniser TikTok/Insta maintenant ».
 * Planifie le même relevé, SCOPÉ au projet de l'admin (ctx.projectId), sans
 * attendre le cron. Asynchrone : les snapshots apparaissent dans la seconde
 * (réactivité Convex). Gated adminMutation → le créateur est rejeté.
 *
 * ⚠️ TS7022 — référence internal.apifySync.runDailySync via le scheduler : type
 * de retour annoté.
 */
export const requestApifySync = adminMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: true }> => {
    await ctx.scheduler.runAfter(0, internal.apifySync.runDailySync, {
      projectId: ctx.projectId,
    });
    return { scheduled: true };
  },
});

/**
 * Test e2e — exerce l'upsert idempotent réel SANS dépendre d'Apify (pas de token
 * requis sur le deployment de test). Gated par le secret e2e.
 */
export const e2eRecordApifySnapshot = e2eMutation({
  args: {
    publicationId: v.id("publications"),
    vues: v.number(),
    likes: v.optional(v.union(v.number(), v.null())),
    comments: v.optional(v.union(v.number(), v.null())),
    saves: v.optional(v.union(v.number(), v.null())),
    title: v.optional(v.string()),
    capturedAt: v.number(),
    source: apifySourceValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ action: "inserted" | "updated" | "skipped" }> =>
    upsertApifySnapshot(ctx, args),
});

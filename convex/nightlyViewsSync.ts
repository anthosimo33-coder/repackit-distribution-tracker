import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  fetchApifyViewsForPlatform,
  fetchInstagramProfiles,
  tiktokPostId,
  instagramShortcode,
} from "./apifyApi";
import {
  extractYouTubeId,
  fetchYouTubeViews,
  fetchYouTubeChannelStats,
} from "./youtubeApi";
import { parisHour } from "./calendarStatus";
import { deliver, resolveNotifyContext } from "./notifications";
import { buildSyncFailureMessage } from "./notificationMessage";
import {
  NIGHTLY_HOUR_PARIS,
  NIGHTLY_MINUTE_PARIS,
  TRACKING_WINDOW_DAYS,
  selectNightlyPublications,
  planLots,
  jitterMs,
  mergeTallies,
  failedComptes,
  shouldAlert,
  groupByProject,
  type CompteTally,
} from "./syncScope";

/**
 * RELEVÉ DE VUES NOCTURNE — 23h30 Europe/Paris.
 *
 * ── Pourquoi 23h30 ───────────────────────────────────────────────────────────
 * Fin de journée réelle de contenu : les publications du soir (21-23 h) ont eu
 * le temps de prendre leurs vues, et le snapshot ferme la journée qu'il mesure.
 * Les relevés du matin (07:00/08:00 UTC) fermaient la journée de la VEILLE avec
 * 10 heures de retard — c'est ce décalage que la répartition au prorata
 * (`convex/viewsDaily.ts`) corrige côté lecture, et que cette heure corrige à
 * la source.
 *
 * ⚠️ CONSÉQUENCE ASSUMÉE sur les colonnes J+X. `daysSincePublication` est FIGÉ à
 * l'écriture du snapshot (`floor((capturedAt − datePubli) / 24 h)`) et la
 * colonne J+1 exige `daysSince === 1` EXACTEMENT (`TOLERANCE_DAYS.j1 = 0`). Les
 * publications étant datées à minuit Paris, un relevé à 23h30 le jour J donne
 * `daysSince = 0`, et c'est celui de J+1 qui porte la colonne « J+1 » — soit
 * ~47,5 h de vues au lieu de ~34 h avec l'ancien cron du matin. La colonne J+1
 * (et les suivantes) mesure donc PLUS qu'avant. Décision prise en connaissance
 * de cause ; re-stamper l'historique ou ancrer J+X sur l'écart réel plutôt que
 * sur le champ figé est un chantier distinct.
 *
 * ── Comment ──────────────────────────────────────────────────────────────────
 * Cron HORAIRE gardé sur l'heure de Paris (jamais un cron quotidien à heure UTC
 * fixe, qui glisserait d'une heure au changement d'heure — même remède que
 * `runEveningReports`).
 *
 * PÉRIMÈTRE : comptes ACTIFS seulement (≥ 1 publication sur 30 j), moins les
 * comptes relevés dans les 2 dernières heures. Politique dans
 * `convex/syncScope.ts`, testée en vitest.
 *
 * CADENCE : les relevés Apify partent SÉQUENTIELLEMENT, un lot à la fois, avec
 * 30-60 s de temporisation aléatoire entre deux lots. Jamais de parallélisme.
 * L'enchaînement passe par le SCHEDULER (une action par lot qui replanifie la
 * suivante) et non par des `sleep` dans une action unique : une action Convex a
 * une durée maximale, et vingt lots × 45 s la dépasseraient.
 *
 * ⚠️ DURÉE DE LA CHAÎNE. Les snapshots sont dédupliqués par jour UTC
 * (`upsertApifySnapshot`) : la chaîne doit tenir dans la journée UTC où elle
 * démarre, sans quoi ses derniers lots écriraient dans le bucket du lendemain.
 * Marge réelle : 23h30 Paris = 22:30 UTC en hiver (le cas serré), soit ~90 min
 * avant minuit UTC, donc ~120 lots ≈ 3 000 publications. L'ordre de grandeur
 * actuel est de ~10 lots (~7 min). Si le catalogue franchissait ce seuil, il
 * faudrait figer `capturedAt` au démarrage du run plutôt que par lot.
 *
 * ERREURS : par lot, en try/catch — un lot qui échoue n'arrête pas la chaîne.
 * Les échecs s'imputent aux COMPTES du lot, et un run dont plus de la moitié des
 * comptes n'ont rien remonté notifie l'admin du projet concerné. Un run normal
 * est silencieux.
 *
 * Le bouton manuel « Synchroniser » (`requestApifySync` / `requestYouTubeSync`)
 * est INCHANGÉ : il appelle toujours `runDailySync`, sans périmètre nocturne ni
 * temporisation. Ce module s'ajoute, il ne remplace pas.
 */

const DAY_MS = 86_400_000;

type LotTarget = {
  publicationId: Id<"publications">;
  projectId: Id<"projects">;
  compte: string;
  /** Clé de post (id TikTok / shortcode Instagram) pour relire le résultat. */
  key: string;
  url: string;
};

const lotTargetValidator = v.object({
  publicationId: v.id("publications"),
  projectId: v.id("projects"),
  compte: v.string(),
  key: v.string(),
  url: v.string(),
});

const lotValidator = v.object({
  plateforme: v.union(v.literal("TikTok"), v.literal("Instagram")),
  source: v.union(v.literal("tiktok"), v.literal("instagram")),
  targets: v.array(lotTargetValidator),
});

/** Miroir de `CompteTally` : `projectId` y est optionnel (le module pur sert
 *  aussi des usages mono-projet), la chaîne nocturne le renseigne toujours. */
const tallyValidator = v.object({
  projectId: v.optional(v.string()),
  compte: v.string(),
  ok: v.number(),
  ko: v.number(),
});

/** Ce qu'un run a décidé de faire — rendu pour les logs d'ops et la
 *  vérification manuelle (`npx convex run nightlyViewsSync:runNightlySync`). */
export type NightlyPlan = {
  started: boolean;
  reason?: string;
  /** Lots Apify enchaînés (= runs facturés). */
  lots: number;
  /** Comptes YouTube relevés dans la foulée. */
  youtubeComptes: number;
};

const APIFY_PLATFORMS = [
  { plateforme: "TikTok" as const, source: "tiktok" as const },
  { plateforme: "Instagram" as const, source: "instagram" as const },
];

/**
 * Comptage par compte d'un ensemble de cibles : une cible dont la publication
 * figure dans `releves` compte pour un succès, sinon pour un échec. Les cibles
 * d'un même compte sont agrégées.
 */
function tallyFor(
  targets: readonly {
    publicationId: Id<"publications">;
    projectId: Id<"projects">;
    compte: string;
  }[],
  releves: ReadonlySet<string>,
): CompteTally[] {
  return mergeTallies(
    [],
    targets.map((t) => {
      const ok = releves.has(t.publicationId as string);
      return {
        projectId: t.projectId as string,
        compte: t.compte,
        ok: ok ? 1 : 0,
        ko: ok ? 0 : 1,
      };
    }),
  );
}

/**
 * Point d'entrée du cron HORAIRE. No-op complet hors de l'heure de Paris voulue
 * — donc 23 exécutions triviales par jour, et une vraie.
 *
 * ⚠️ Si l'heure de Paris n'est pas calculable, on ne relève RIEN. Un repli sur
 * UTC ferait tourner le relevé à la mauvaise heure toute l'année ; une
 * comparaison qui échoue « vers vrai » le lancerait 24 fois par jour, sur une
 * API facturée à l'appel. En cas de doute, on se tait.
 */
export const runNightlySync = internalAction({
  args: {},
  handler: async (ctx): Promise<NightlyPlan> => {
    const now = Date.now();
    const heureParis = parisHour(now);
    if (heureParis === null) {
      console.error(
        "[nightly-views] heure de Paris incalculable — relevé NON lancé " +
          "(un repli sur UTC relèverait à la mauvaise heure).",
      );
      return { started: false, reason: "paris-hour-unavailable", lots: 0, youtubeComptes: 0 };
    }
    if (heureParis !== NIGHTLY_HOUR_PARIS) {
      return { started: false, reason: "not-the-hour", lots: 0, youtubeComptes: 0 };
    }

    const cutoff = now - TRACKING_WINDOW_DAYS * DAY_MS;

    // ── 1. YouTube — d'un bloc, sans temporisation ────────────────────────────
    // L'API Data v3 est gratuite au quota et groupe 50 vidéos par appel : ni le
    // coût ni le rate limit ne justifient d'étaler. Elle tourne donc ici, et son
    // comptage SERT DE GRAINE à la chaîne Apify pour que l'alerte de fin de run
    // couvre les deux plateformes.
    const tallyYouTube = await syncYouTube(ctx, cutoff, now);

    // ── 2. Apify — plan de lots ───────────────────────────────────────────────
    const lots: {
      plateforme: "TikTok" | "Instagram";
      source: "tiktok" | "instagram";
      targets: LotTarget[];
    }[] = [];
    for (const { plateforme, source } of APIFY_PLATFORMS) {
      const pubs = await ctx.runQuery(
        internal.apifySync.listActiveApifyPublications,
        { cutoff, plateforme },
      );
      const retenues = selectNightlyPublications(pubs, now);
      const targets: LotTarget[] = [];
      for (const p of retenues) {
        const key =
          plateforme === "TikTok"
            ? tiktokPostId(p.postUrl)
            : instagramShortcode(p.postUrl);
        // URL non rapprochable (shortlink tiktok.com/t/…) : ni relevable ni
        // imputable à un échec de plateforme — on ne la compte pas du tout.
        if (!key) continue;
        targets.push({
          publicationId: p._id,
          projectId: p.projectId,
          compte: p.compte,
          key,
          url: p.postUrl,
        });
      }
      for (const lot of planLots(targets)) {
        lots.push({ plateforme, source, targets: lot });
      }
    }

    // ── 3. Profils des plateformes à appel DÉDIÉ ─────────────────────────────
    // TikTok est déjà servi par les items vidéo (aucun appel de plus) ; ces
    // deux-là ne le sont pas. Fait ici, hors de la chaîne de lots : c'est un
    // relevé par COMPTE, pas par post, et il ne doit pas être répété à chaque lot.
    await syncDedicatedProfiles(ctx, comptesParPlateforme(lots), now);

    console.info(
      `[nightly-views] ${NIGHTLY_HOUR_PARIS}h${NIGHTLY_MINUTE_PARIS} Paris — ` +
        `${lots.length} lot(s) Apify à enchaîner, ` +
        `${tallyYouTube.length} compte(s) YouTube relevé(s).`,
    );

    if (lots.length === 0) {
      await ctx.runAction(internal.nightlyViewsSync.finishNightlyRun, {
        tally: tallyYouTube,
        startedAt: now,
      });
      return { started: true, reason: "youtube-only", lots: 0, youtubeComptes: tallyYouTube.length };
    }

    await ctx.scheduler.runAfter(0, internal.nightlyViewsSync.syncApifyLot, {
      lots,
      tally: tallyYouTube,
      startedAt: now,
      lotIndex: 0,
      lotTotal: lots.length,
    });
    return { started: true, lots: lots.length, youtubeComptes: tallyYouTube.length };
  },
});

/**
 * Relevé YouTube du run nocturne. Réutilise les fonctions internes existantes
 * (query de périmètre + mutation d'écriture) : seule la SÉLECTION change, pas
 * l'écriture. Rend le comptage par compte.
 *
 * Sans clé API : log + comptage vide. Ce n'est PAS un échec de compte — sinon
 * un déploiement sans YouTube déclencherait l'alerte toutes les nuits.
 */
async function syncYouTube(
  ctx: ActionCtx,
  cutoff: number,
  now: number,
): Promise<CompteTally[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.info(
      "[nightly-views] YOUTUBE_API_KEY absente — volet YouTube ignoré (pas un échec).",
    );
    return [];
  }

  const pubs = await ctx.runQuery(
    internal.youtubeSync.listActiveYouTubePublications,
    { cutoff },
  );
  const targets: {
    publicationId: Id<"publications">;
    projectId: Id<"projects">;
    compte: string;
    videoId: string;
  }[] = [];
  for (const p of selectNightlyPublications(pubs, now)) {
    const videoId = extractYouTubeId(p.postUrl);
    if (!videoId) continue;
    targets.push({
      publicationId: p._id,
      projectId: p.projectId,
      compte: p.compte,
      videoId,
    });
  }
  if (targets.length === 0) return [];

  const debut = Date.now();
  try {
    const { stats } = await fetchYouTubeViews(
      [...new Set(targets.map((t) => t.videoId))],
      apiKey,
    );
    const releves = new Set<string>();
    for (const t of targets) {
      const stat = stats[t.videoId];
      if (!stat) continue;
      const r = await ctx.runMutation(
        internal.youtubeSync.recordYouTubeSnapshot,
        {
          publicationId: t.publicationId,
          vues: stat.views,
          likes: stat.likes,
          comments: stat.comments,
          title: stat.title ?? undefined,
          capturedAt: now,
        },
      );
      if (r.action !== "skipped") releves.add(t.publicationId as string);
    }
    console.info(
      `[nightly-views] YouTube — ${targets.length} vidéo(s), ` +
        `${releves.size} relevée(s), ${Date.now() - debut} ms.`,
    );
    return tallyFor(targets, releves);
  } catch (e) {
    // Panne franche de l'API : TOUS les comptes YouTube du run sont en échec,
    // c'est exactement ce que l'alerte doit voir.
    console.error(
      `[nightly-views] YouTube — relevé en échec après ${Date.now() - debut} ms :`,
      e,
    );
    return tallyFor(targets, new Set());
  }
}

/**
 * UN lot Apify (= 1 run = 1 unité de coût), puis replanification du suivant
 * après 30-60 s. La chaîne porte son état dans ses arguments : pas de table de
 * run à maintenir, et un enchaînement qui reprend proprement là où il en est
 * même si une action est rejouée.
 *
 * Le try/catch est au LOT : `fetchApifyViewsForPlatform` avale déjà ses propres
 * erreurs de lot, celui-ci rattrape l'imprévu (réseau, token révoqué en cours
 * de run) pour que la chaîne continue coûte que coûte.
 */
export const syncApifyLot = internalAction({
  args: {
    lots: v.array(lotValidator),
    tally: v.array(tallyValidator),
    startedAt: v.number(),
    lotIndex: v.number(),
    lotTotal: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    const [lot, ...reste] = args.lots;
    if (lot === undefined) {
      await ctx.runAction(internal.nightlyViewsSync.finishNightlyRun, {
        tally: args.tally,
        startedAt: args.startedAt,
      });
      return null;
    }

    const apiToken = process.env.APIFY_API_TOKEN;
    const comptes = [...new Set(lot.targets.map((t) => t.compte))];
    const debut = Date.now();
    let tallyLot: CompteTally[];

    if (!apiToken) {
      // Token absent : inutile d'enchaîner 20 lots pour rien.
      console.error(
        "[nightly-views] APIFY_API_TOKEN absent — chaîne interrompue. " +
          "Posez le token : npx convex env set APIFY_API_TOKEN <token>.",
      );
      await ctx.runAction(internal.nightlyViewsSync.finishNightlyRun, {
        tally: mergeTallies(args.tally, tallyFor(lot.targets, new Set())),
        startedAt: args.startedAt,
      });
      return null;
    }

    try {
      const { stats } = await fetchApifyViewsForPlatform(
        lot.plateforme,
        lot.targets.map((t) => t.url),
        apiToken,
      );
      const releves = new Set<string>();
      // Un seul relevé de profil par COMPTE et par lot : `authorMeta` est
      // identique sur toutes les vidéos d'un même compte, l'écrire une fois par
      // post ferait N écritures pour une seule information.
      const comptesReleves = new Set<string>();
      for (const t of lot.targets) {
        const stat = stats[t.key];
        if (stat === undefined) continue; // indisponible ou lot en erreur
        const capturedAt = Date.now();
        const r = await ctx.runMutation(internal.apifySync.recordApifySnapshot, {
          publicationId: t.publicationId,
          vues: stat.views,
          likes: stat.likes,
          comments: stat.comments,
          saves: stat.saves,
          title: stat.title ?? undefined,
          capturedAt,
          source: lot.source,
        });
        if (r.action !== "skipped") releves.add(t.publicationId as string);

        // Compteurs du COMPTE, servis avec l'item vidéo : zéro appel Apify de
        // plus. Rattachés via la PUBLICATION (le handle de l'URL ne coïncide
        // pas avec celui saisi en base).
        if (stat.author !== null && !comptesReleves.has(t.compte)) {
          comptesReleves.add(t.compte);
          await ctx.runMutation(internal.apifySync.recordAccountProfile, {
            publicationId: t.publicationId,
            capturedAt,
            followers: stat.author.followers,
            following: stat.author.following,
            totalLikes: stat.author.totalLikes,
            source: lot.source,
          });
        }
      }
      tallyLot = tallyFor(lot.targets, releves);
      console.info(
        `[nightly-views] lot ${args.lotIndex + 1}/${args.lotTotal} ${lot.plateforme} — ` +
          `${comptes.length} compte(s), ${releves.size}/${lot.targets.length} relevée(s), ` +
          `${comptesReleves.size} profil(s), ` +
          `${Date.now() - debut} ms.`,
      );
    } catch (e) {
      tallyLot = tallyFor(lot.targets, new Set());
      console.error(
        `[nightly-views] lot ${args.lotIndex + 1}/${args.lotTotal} ${lot.plateforme} ÉCHEC après ` +
          `${Date.now() - debut} ms — ${comptes.length} compte(s) impacté(s) :`,
        e,
      );
    }

    const tally = mergeTallies(args.tally, tallyLot);
    if (reste.length === 0) {
      await ctx.runAction(internal.nightlyViewsSync.finishNightlyRun, {
        tally,
        startedAt: args.startedAt,
      });
      return null;
    }

    await ctx.scheduler.runAfter(
      jitterMs(Math.random()),
      internal.nightlyViewsSync.syncApifyLot,
      {
        lots: reste,
        tally,
        startedAt: args.startedAt,
        lotIndex: args.lotIndex + 1,
        lotTotal: args.lotTotal,
      },
    );
    return null;
  },
});

/**
 * Fin de run : un bilan dans les logs, et une alerte PAR PROJET dont plus de la
 * moitié des comptes n'ont rien remonté.
 *
 * L'alerte est par projet et non globale parce que le canal l'est : envoyer à
 * tous les projets la panne d'un seul serait une fuite d'information entre
 * clients autant qu'un faux positif.
 */
export const finishNightlyRun = internalAction({
  args: {
    tally: v.array(tallyValidator),
    startedAt: v.number(),
  },
  handler: async (ctx, { tally, startedAt }): Promise<null> => {
    const dureeMin = Math.round((Date.now() - startedAt) / 60_000);
    const enEchec = failedComptes(tally);
    console.info(
      `[nightly-views] run terminé en ~${dureeMin} min — ${tally.length} compte(s) tenté(s), ` +
        `${enEchec.length} sans aucun relevé.`,
    );

    // QUADRANT « Vues × Intent » — recalculé ICI et nulle part ailleurs : les
    // vues et les saves qu'il lit viennent d'être écrites, un classement calculé
    // à un autre moment porterait le même chiffre avec un horodatage trompeur.
    // Tous les projets, pas seulement ceux du tally : un compte non relevé cette
    // nuit a quand même vieilli, et la fenêtre de 14 jours a glissé sous lui.
    //
    // Encapsulé : un recalcul en échec ne doit pas priver l'admin de l'alerte de
    // panne de relevé ci-dessous, qui est le vrai sujet de cette action.
    try {
      await ctx.runAction(internal.quadrantSync.runQuadrantRecompute, {});
    } catch (e) {
      console.error("[nightly-views] recalcul du quadrant en échec :", e);
    }

    for (const [projectId, comptes] of groupByProject(tally)) {
      if (projectId === "" || !shouldAlert(comptes)) continue;
      const failed = failedComptes(comptes);
      console.error(
        `[nightly-views] projet ${projectId} — ${failed.length}/${comptes.length} compte(s) en échec, alerte envoyée.`,
      );
      const nctx = await resolveNotifyContext(
        ctx,
        projectId as Id<"projects">,
        "sync_failures",
      );
      if (nctx === null) continue;
      await deliver(
        nctx.cfg,
        "relevé de vues en panne",
        buildSyncFailureMessage({
          failed,
          attempted: comptes.length,
          appBaseUrl: nctx.cfg.appBaseUrl,
          projectSlug: nctx.projectSlug,
        }),
      );
    }
    return null;
  },
});

/** Handles concernés par le run, par plateforme, déduits du plan de lots. */
function comptesParPlateforme(
  lots: readonly { plateforme: "TikTok" | "Instagram"; targets: readonly LotTarget[] }[],
): Map<"Instagram", Set<string>> {
  const out = new Map<"Instagram", Set<string>>();
  for (const lot of lots) {
    // TikTok est exclu VOLONTAIREMENT : ses compteurs arrivent avec les vidéos,
    // un appel dédié serait payé pour rien.
    if (lot.plateforme !== "Instagram") continue;
    const set = out.get("Instagram") ?? new Set<string>();
    for (const t of lot.targets) set.add(t.compte);
    out.set("Instagram", set);
  }
  return out;
}

/**
 * Relève les compteurs des comptes dont la plateforme ne les sert pas avec les
 * posts : Instagram (+1 run Apify) et YouTube (channels.list, gratuit).
 *
 * Tout échec est LOGUÉ et avalé : ces compteurs sont un supplément, le cœur du
 * cron reste le relevé des vues. Une panne d'abonnés ne doit pas priver la nuit
 * de ses snapshots de posts.
 */
async function syncDedicatedProfiles(
  ctx: ActionCtx,
  parPlateforme: Map<"Instagram", Set<string>>,
  now: number,
): Promise<void> {
  const handlesInsta = [...(parPlateforme.get("Instagram") ?? [])];

  // YouTube : les comptes ne passent pas par les lots Apify, on les relit.
  const cutoff = now - TRACKING_WINDOW_DAYS * DAY_MS;
  const pubsYt = await ctx.runQuery(
    internal.youtubeSync.listActiveYouTubePublications,
    { cutoff },
  );
  const handlesYt = [
    ...new Set(
      selectNightlyPublications(pubsYt, now).map((p) => p.compte),
    ),
  ];

  if (handlesInsta.length === 0 && handlesYt.length === 0) return;
  const comptes = await ctx.runQuery(
    internal.apifySync.listComptesForProfiles,
    { handles: [...handlesInsta, ...handlesYt] },
  );

  // ── Instagram : un run dédié pour tous les profils ────────────────────────
  const apifyToken = process.env.APIFY_API_TOKEN;
  const ciblesInsta = comptes.filter(
    (c) => c.plateforme === "Instagram" && c.url !== null,
  );
  if (apifyToken && ciblesInsta.length > 0) {
    try {
      const { profiles, runs, errors } = await fetchInstagramProfiles(
        ciblesInsta.map((c) => c.url as string),
        apifyToken,
      );
      for (const c of ciblesInsta) {
        // Rattachement par handle NORMALISÉ : côté Instagram le handle de l'app
        // et celui de l'API coïncident au « @ » et à la casse près (≠ TikTok,
        // où ils divergent — d'où le rattachement par publication là-bas).
        const p = profiles[c.handle.replace(/^@/, "").toLowerCase()];
        if (!p) continue;
        await ctx.runMutation(internal.apifySync.recordAccountProfileByCompte, {
          compteId: c._id,
          capturedAt: now,
          followers: p.followers,
          following: p.following,
          source: "instagram",
        });
      }
      console.info(
        `[nightly-views] profils Instagram — ${ciblesInsta.length} compte(s), ` +
          `${Object.keys(profiles).length} relevé(s), ${runs} run(s), ${errors.length} erreur(s).`,
      );
    } catch (e) {
      console.error("[nightly-views] profils Instagram en échec :", e);
    }
  }

  // ── YouTube : channels.list, 1 unité de quota par chaîne ──────────────────
  const apiKey = process.env.YOUTUBE_API_KEY;
  const ciblesYt = comptes.filter((c) => c.plateforme === "YouTube");
  if (apiKey && ciblesYt.length > 0) {
    try {
      const { stats, errors } = await fetchYouTubeChannelStats(
        ciblesYt.map((c) => c.url ?? c.handle),
        apiKey,
      );
      const parHandle = new Map(
        Object.values(stats).map((s) => [s.handle.toLowerCase(), s]),
      );
      for (const c of ciblesYt) {
        const cle = (c.url ?? c.handle).toLowerCase();
        const s =
          parHandle.get(`@${c.handle.replace(/^@/, "").toLowerCase()}`) ??
          [...parHandle.values()].find((v) => cle.includes(v.handle.slice(1).toLowerCase()));
        if (!s) continue;
        await ctx.runMutation(internal.apifySync.recordAccountProfileByCompte, {
          compteId: c._id,
          capturedAt: now,
          followers: s.subscribers,
          source: "youtube",
        });
      }
      console.info(
        `[nightly-views] profils YouTube — ${ciblesYt.length} chaîne(s), ` +
          `${Object.keys(stats).length} relevée(s), ${errors.length} erreur(s).`,
      );
    } catch (e) {
      console.error("[nightly-views] profils YouTube en échec :", e);
    }
  }
}

import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  fetchApifyViewsForPlatform,
  fetchInstagramProfiles,
  tiktokPostId,
  instagramShortcode,
  type ApifyPostStat,
} from "./apifyApi";
import {
  extractYouTubeId,
  fetchYouTubeViews,
  fetchYouTubeChannelStats,
} from "./youtubeApi";
import {
  APIFY_RESCUE_BUDGET,
  BREAKER_CLOSED,
  collectTikTokInternally,
  rescueWithApify,
  type BreakerState,
} from "./tiktokInternal";
import { parisHour } from "./calendarStatus";
import { unmatchableUrlReason } from "./postUrlShape";
import { isTikTokShortlink } from "./postUrlDate";
import { deliver, resolveNotifyContext } from "./notifications";
import { buildSyncFailureMessage } from "./notificationMessage";
import {
  NIGHTLY_HOUR_PARIS,
  NIGHTLY_MINUTE_PARIS,
  TRACKING_WINDOW_DAYS,
  selectNightlyPublications,
  selectDueTonight,
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
 * CADENCE DES VIDÉOS (TikTok/Instagram, cf `selectDueTonight`) : chaque nuit
 * jusqu'à 14 jours, puis une fois par semaine — sauf la veille et le jour de
 * clôture de la fenêtre de paie (J+29, J+30) et les vidéos d'un défi actif,
 * relevées chaque nuit. YouTube, gratuit, reste quotidien.
 *
 * SOURCES : TikTok est lu sur la page publique du post, Apify n'y sert plus
 * que de secours borné (cf `convex/tiktokInternal.ts`) ; Instagram reste chez
 * Apify, sa page publique exigeant une connexion.
 *
 * RYTHME : les lots partent SÉQUENTIELLEMENT, un à la fois, avec 30-60 s de
 * temporisation aléatoire entre deux lots, et 1,5-3 s entre deux pages TikTok
 * dans un lot. Jamais de parallélisme.
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
  /** Lots enchaînés (TikTok : 25 pages ; Instagram : 1 run Apify facturé). */
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
    const defisActifs = new Set<string>(
      await ctx.runQuery(internal.challengeSync.listLiveChallengePublicationIds, {}),
    );
    for (const { plateforme, source } of APIFY_PLATFORMS) {
      const pubs = await ctx.runQuery(
        internal.apifySync.listActiveApifyPublications,
        { cutoff, plateforme },
      );
      const perimetre = selectNightlyPublications(pubs, now);
      const retenues = selectDueTonight(perimetre, now, defisActifs);
      console.info(
        `[nightly-views] ${plateforme} — ${retenues.length}/${perimetre.length} vidéo(s) ` +
          `à relever cette nuit (cadence hebdomadaire au-delà de 14 jours).`,
      );
      const targets: LotTarget[] = [];
      for (const p of retenues) {
        const key =
          plateforme === "TikTok"
            ? tiktokPostId(p.postUrl)
            : instagramShortcode(p.postUrl);
        // URL non rapprochable (shortlink tiktok.com/t/… non résolu, lien de
        // profil, format inconnu) : le relevé n'a AUCUN identifiant à demander
        // à Apify. Ce `continue` était MUET — la publication n'était ni relevée
        // ni comptée en échec, donc affichée à 0 vue indéfiniment, sans que rien
        // ne le signale. On l'inscrit maintenant comme échec de collecte, avec
        // son motif : l'écran sait déjà dire « non mesuré — <motif> » plutôt que
        // de peindre un zéro (cf convex/collectAvailability.ts).
        if (!key) {
          await ctx.runMutation(internal.apifySync.recordCollectFailure, {
            publicationId: p._id,
            at: now,
            reason: unmatchableUrlReason(p.postUrl, plateforme),
          });
          // Un lien court non résolu est RATTRAPABLE : la résolution est un
          // simple aller-retour de redirection, gratuit (aucun run Apify). On
          // la relance ici — c'est le seul endroit qui repasse chaque nuit sur
          // les publications restées non rapprochables.
          if (plateforme === "TikTok" && isTikTokShortlink(p.postUrl)) {
            await ctx.scheduler.runAfter(
              0,
              internal.postUrlResolution.resolvePublicationShortlink,
              { publicationId: p._id },
            );
          }
          continue;
        }
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
        `${lots.length} lot(s) à enchaîner, ` +
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
 * UN lot de la chaîne, puis replanification du suivant après 30-60 s. La chaîne
 * porte son état dans ses arguments (coupe-circuit, budget de secours) : pas de
 * table de run à maintenir.
 *
 * TikTok : page publique d'abord, Apify en secours borné (cf
 * `convex/tiktokInternal.ts`). Instagram : Apify, inchangé — sa page publique
 * exige une connexion.
 *
 * Tout échec est avalé AU LOT : la chaîne continue coûte que coûte.
 */
export const syncApifyLot = internalAction({
  args: {
    lots: v.array(lotValidator),
    tally: v.array(tallyValidator),
    startedAt: v.number(),
    lotIndex: v.number(),
    lotTotal: v.number(),
    /** Coupe-circuit du relevé maison TikTok. Absent au premier lot = fermé. */
    breaker: v.optional(
      v.object({
        suspects: v.number(),
        trippedReason: v.union(v.string(), v.null()),
      }),
    ),
    /**
     * Posts TikTok que le secours Apify peut encore prendre CETTE nuit, tous
     * lots confondus. Absent au premier lot = budget plein. Décrémenté et
     * transmis : sans ce report, chaque lot repartirait à zéro et un blocage
     * TikTok renverrait toute la collecte vers Apify, donc vers la facture.
     */
    rescueBudget: v.optional(v.number()),
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
    let breaker: BreakerState = args.breaker ?? BREAKER_CLOSED;
    let rescueBudget = args.rescueBudget ?? APIFY_RESCUE_BUDGET;
    let releves: Set<string>;

    try {
      if (lot.plateforme === "TikTok") {
        const r = await syncTikTokLot(ctx, lot.targets, apiToken, breaker, rescueBudget, args);
        releves = r.releves;
        breaker = r.breaker;
        rescueBudget = r.rescueBudget;
      } else {
        releves = await syncInstagramLot(ctx, lot, apiToken, args);
      }
    } catch (e) {
      // L'imprévu (mutation en échec, réseau) : le lot compte en échec pour ce
      // qui n'a pas été écrit, et la chaîne continue.
      releves = new Set();
      console.error(
        `[nightly-views] lot ${args.lotIndex + 1}/${args.lotTotal} ${lot.plateforme} en échec :`,
        e,
      );
    }

    const tally = mergeTallies(args.tally, tallyFor(lot.targets, releves));
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
        breaker,
        rescueBudget,
      },
    );
    return null;
  },
});

/** Repère de lot pour les journaux. */
type LotLabel = { lotIndex: number; lotTotal: number };

/**
 * Lot TikTok : pages publiques, puis secours Apify pour ce qu'elles n'ont pas
 * rendu. Rend les publications relevées et l'état à transmettre au lot suivant.
 */
async function syncTikTokLot(
  ctx: ActionCtx,
  targets: readonly LotTarget[],
  apiToken: string | undefined,
  breakerIn: BreakerState,
  budgetIn: number,
  label: LotLabel,
): Promise<{ releves: Set<string>; breaker: BreakerState; rescueBudget: number }> {
  const debut = Date.now();
  const capturedAt = Date.now();
  const interne = await collectTikTokInternally(ctx, targets, capturedAt, breakerIn);
  if (breakerIn.trippedReason === null && interne.breaker.trippedReason !== null) {
    console.error(
      `[nightly-views] COUPE-CIRCUIT TikTok au lot ${label.lotIndex + 1}/${label.lotTotal} — ` +
        `${interne.breaker.trippedReason}. Relevé maison suspendu pour la nuit.`,
    );
  }
  if (interne.avatars.length > 0) {
    await ctx.runAction(internal.compteAvatar.rafraichirAvatars, {
      candidats: interne.avatars.map((a) => ({ ...a, plateforme: "TikTok" as const })),
    });
  }

  const secours = await rescueWithApify(
    ctx,
    interne.aSecourir,
    capturedAt,
    apiToken,
    budgetIn,
  );
  const releves = new Set([...interne.releves, ...secours.releves]);
  console.info(
    `[nightly-views] lot ${label.lotIndex + 1}/${label.lotTotal} TikTok — ` +
      `${releves.size}/${targets.length} relevée(s) : ${interne.releves.length} par la page ` +
      `(${interne.pages} page(s)), ${secours.releves.length} par Apify (${secours.runs} run(s)), ` +
      `${interne.refused} refusée(s) par TikTok, ${secours.failed} perdue(s). ` +
      `Budget de secours restant ${secours.budgetRestant}, ${Date.now() - debut} ms.`,
  );
  return {
    releves,
    breaker: interne.breaker,
    rescueBudget: secours.budgetRestant,
  };
}

/**
 * Lot Instagram : un run Apify (= une unité de coût). Un post non rendu est
 * inscrit en échec avec son motif — Instagram n'a pas de lecture publique.
 */
async function syncInstagramLot(
  ctx: ActionCtx,
  lot: { plateforme: "TikTok" | "Instagram"; source: "tiktok" | "instagram"; targets: LotTarget[] },
  apiToken: string | undefined,
  label: LotLabel,
): Promise<Set<string>> {
  const debut = Date.now();
  const releves = new Set<string>();
  const capturedAt = Date.now();

  let stats: Record<string, ApifyPostStat> = {};
  let motif = "Apify n'a pas rendu le post (aucun repli sur cette plateforme)";
  if (!apiToken) {
    motif = "pas de relevé Instagram (APIFY_API_TOKEN absent)";
  } else {
    try {
      const r = await fetchApifyViewsForPlatform(
        lot.plateforme,
        lot.targets.map((t) => t.url),
        apiToken,
      );
      stats = r.stats;
      if (r.errors.length > 0) {
        motif = `Apify en erreur (${r.errors[0].status}) — aucun repli sur cette plateforme`;
      }
    } catch (e) {
      console.error(
        `[nightly-views] lot ${label.lotIndex + 1}/${label.lotTotal} Instagram — Apify en échec :`,
        e,
      );
    }
  }

  for (const t of lot.targets) {
    const stat = stats[t.key];
    if (stat === undefined) {
      await ctx.runMutation(internal.apifySync.recordCollectFailure, {
        publicationId: t.publicationId,
        at: capturedAt,
        reason: motif,
      });
      continue;
    }
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
  }
  console.info(
    `[nightly-views] lot ${label.lotIndex + 1}/${label.lotTotal} Instagram — ` +
      `${releves.size}/${lot.targets.length} relevée(s), ${Date.now() - debut} ms.`,
  );
  return releves;
}

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

    // DÉFIS — les victoires se constatent ICI, pour la MÊME raison que le
    // quadrant : les vues qu'elles lisent viennent d'être écrites. Une
    // évaluation menée à un autre moment rendrait le même résultat avec un
    // horodatage trompeur — et `wonAt` est la preuve du départage.
    //
    // `at: startedAt` et non `Date.now()` : la victoire est datée du RELEVÉ, pas
    // de la minute où la chaîne s'achève. Sans ça, deux gagnantes constatées au
    // même relevé porteraient des instants différents selon la longueur de la
    // chaîne, et « à franchissement constaté au même relevé » cesserait d'être
    // vérifiable dans la donnée.
    //
    // Encapsulé, comme le quadrant : un défi en échec ne doit pas priver l'admin
    // de l'alerte de panne de relevé ci-dessous.
    try {
      await ctx.runAction(internal.challengeSync.runChallengeEvaluation, {
        at: startedAt,
      });
    } catch (e) {
      console.error("[nightly-views] évaluation des défis en échec :", e);
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

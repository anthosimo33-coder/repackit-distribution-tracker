import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  fetchTikTokPublicStats,
  refusalLabel,
  type TikTokPublicResult,
} from "./tiktokPublicPage";
import { fetchApifyViewsForPlatform, type ApifyPostStat } from "./apifyApi";

/**
 * RELEVÉ TIKTOK MAISON — source PRINCIPALE, Apify en secours.
 *
 * ── Pourquoi ─────────────────────────────────────────────────────────────────
 * Le 2026-09-13, le crédit Apify gratuit (5 $/mois) était épuisé en trois nuits :
 * 0,0037 $ par post TikTok, ~350 posts par nuit. La page publique d'un post
 * porte les mêmes compteurs (et les saves en plus), gratuitement. Le repli qui
 * la lisait déjà tournait en prod depuis les serveurs Convex sans blocage.
 *
 * ── Ce qui n'expose PAS les comptes des créatrices ──────────────────────────
 * Lecture ANONYME d'une page publique : aucun identifiant, aucun cookie, aucun
 * compte TikTok derrière la requête. TikTok n'a aucun moyen de rattacher ces
 * lectures au compte d'une créatrice — un blocage frappe l'IP de Convex, jamais
 * ses comptes. Et le HTML seul n'exécute pas le lecteur vidéo : aucune vue
 * n'est ajoutée au compteur qu'on mesure.
 *
 * ── Le risque réel, et ses trois garde-fous ─────────────────────────────────
 * Que TikTok ralentisse ou bloque l'IP de Convex. Signes : HTTP 403/429, page
 * sans payload (captcha), réseau coupé. D'où :
 *   1. un RYTHME de lecture humain — une page toutes les 1,5 à 3 s, jamais en
 *      parallèle, et 30-60 s entre deux lots (cf `jitterMs`) ;
 *   2. un COUPE-CIRCUIT — `BREAKER_THRESHOLD` pages illisibles D'AFFILÉE et on
 *      cesse de frapper pour la nuit : insister sur une IP qu'on vient de
 *      signaler est ce qui transforme un ralentissement en blocage durable ;
 *   3. un SECOURS Apify borné — les posts que la page n'a pas rendus partent
 *      chez Apify, dans la limite de `APIFY_RESCUE_BUDGET` posts par nuit, pour
 *      qu'un blocage ne se transforme pas en facture.
 *
 * Un REFUS de TikTok (`statusCode` non nul : « visible par son autrice »,
 * `10231 cross_border_violation`, supprimé) n'est PAS un signe de blocage — la
 * page a été servie, avec son motif. Il ne part pas chez Apify non plus : ces
 * posts étaient justement ceux qu'Apify ne rendait pas.
 */

/** Pages illisibles consécutives qui coupent le relevé maison pour la nuit. */
export const BREAKER_THRESHOLD = 5;

/** Posts TikTok envoyés au secours Apify, au plus, sur une nuit. ~0,40 $. */
export const APIFY_RESCUE_BUDGET = 100;

/** Pause entre deux pages : 1,5 à 3 s, tirée au hasard. */
export const PAGE_DELAY_MIN_MS = 1_500;
export const PAGE_DELAY_MAX_MS = 3_000;

export function pageDelayMs(random: number): number {
  const borne = Math.min(Math.max(random, 0), 0.999_999_999);
  return (
    PAGE_DELAY_MIN_MS +
    Math.floor(borne * (PAGE_DELAY_MAX_MS - PAGE_DELAY_MIN_MS + 1))
  );
}

/**
 * État du coupe-circuit, porté d'un lot à l'autre dans les arguments de la
 * chaîne nocturne (même mécanisme que le budget de repli d'avant).
 */
export type BreakerState = {
  /** Pages illisibles d'affilée. Remis à zéro par toute page servie. */
  suspects: number;
  /** Motif de la coupure, `null` tant que le relevé maison est ouvert. */
  trippedReason: string | null;
};

export const BREAKER_CLOSED: BreakerState = { suspects: 0, trippedReason: null };

/**
 * Transition du coupe-circuit après UNE page. Pure, testée.
 *
 * Seule une page ILLISIBLE compte : une page servie — compteurs ou refus
 * motivé — prouve que TikTok répond normalement à cette IP.
 */
export function nextBreaker(
  state: BreakerState,
  result: TikTokPublicResult,
): BreakerState {
  if (state.trippedReason !== null) return state;
  if (result.kind !== "unreadable") return BREAKER_CLOSED;
  const suspects = state.suspects + 1;
  return suspects >= BREAKER_THRESHOLD
    ? {
        suspects,
        trippedReason: `${suspects} pages illisibles d'affilée (dernière : ${result.reason})`,
      }
    : { suspects, trippedReason: null };
}

export type InternalTarget = {
  publicationId: Id<"publications">;
  projectId: Id<"projects">;
  compte: string;
  /** Id de post TikTok — contrôle aussi que la page lue est la bonne. */
  key: string;
  url: string;
};

/** Post que la page n'a pas rendu, avec la raison — candidat au secours. */
export type RescueTarget = InternalTarget & { reason: string };

export type AvatarCandidate = {
  projectId: Id<"projects">;
  handle: string;
  sourceUrl: string;
};

export type InternalOutcome = {
  /** publicationId des posts dont le snapshot a été écrit. */
  releves: string[];
  /** Posts refusés par TikTok (échec persisté, définitif). */
  refused: number;
  /** Posts à confier au secours — AUCUN échec n'est encore écrit pour eux. */
  aSecourir: RescueTarget[];
  /**
   * Posts NON TENTÉS faute de temps (`deadline`). Ni échec, ni secours : rien
   * ne dit qu'ils sont illisibles, ils attendent simplement le relevé suivant.
   */
  nonTentes: InternalTarget[];
  /** Pages effectivement demandées à TikTok. */
  pages: number;
  breaker: BreakerState;
  /** Photos de profil vues, une par compte. */
  avatars: AvatarCandidate[];
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Relève une série de posts TikTok par leur page publique, séquentiellement.
 * Ne lève JAMAIS.
 *
 * `deadline` (horodatage) : au-delà, on cesse de lire ; le reste est rendu dans
 * `nonTentes`. Sert la sync MANUELLE, qui vit dans une seule action de durée
 * bornée ; le relevé nocturne découpe en lots et n'en a pas besoin.
 */
export async function collectTikTokInternally(
  ctx: ActionCtx,
  targets: readonly InternalTarget[],
  capturedAt: number,
  breakerIn: BreakerState,
  opts: {
    fetchImpl?: typeof fetch;
    delayMs?: () => number;
    deadline?: number;
    clock?: () => number;
  } = {},
): Promise<InternalOutcome> {
  const {
    fetchImpl,
    delayMs = () => pageDelayMs(Math.random()),
    deadline,
    clock = Date.now,
  } = opts;
  const out: InternalOutcome = {
    releves: [],
    refused: 0,
    aSecourir: [],
    nonTentes: [],
    pages: 0,
    breaker: breakerIn,
    avatars: [],
  };
  // Un seul relevé de profil par compte : les compteurs de compte sont les
  // mêmes sur toutes ses vidéos. La clé porte le projet (deux projets peuvent
  // suivre le même @).
  const profilsEcrits = new Set<string>();

  for (const t of targets) {
    if (out.breaker.trippedReason !== null) {
      out.aSecourir.push({
        ...t,
        reason: `relevé maison suspendu — ${out.breaker.trippedReason}`,
      });
      continue;
    }
    if (deadline !== undefined && clock() >= deadline) {
      out.nonTentes.push(t);
      continue;
    }
    if (out.pages > 0) {
      const d = delayMs();
      if (d > 0) await sleep(d);
    }

    out.pages += 1;
    const r = await fetchTikTokPublicStats(t.url, t.key, fetchImpl);
    out.breaker = nextBreaker(out.breaker, r);

    if (r.kind === "unreadable") {
      out.aSecourir.push({ ...t, reason: r.reason });
      continue;
    }
    if (r.kind === "refused") {
      out.refused += 1;
      await ctx.runMutation(internal.apifySync.recordCollectFailure, {
        publicationId: t.publicationId,
        at: capturedAt,
        reason: refusalLabel(r.statusCode, r.statusMsg),
      });
      continue;
    }

    const res = await ctx.runMutation(internal.apifySync.recordApifySnapshot, {
      publicationId: t.publicationId,
      vues: r.stats.views,
      likes: r.stats.likes,
      comments: r.stats.comments,
      saves: r.stats.saves,
      title: r.stats.title ?? undefined,
      capturedAt,
      // `source: "tiktok"` : c'est un relevé TikTok, la série reste homogène.
      // La provenance (page ou Apify) n'a aucune conséquence à la lecture.
      source: "tiktok" as const,
    });
    // `skipped` = snapshot refusé par l'invariant (capture antérieure à la
    // publication) : ni un relevé, ni un échec de collecte.
    if (res.action === "skipped") continue;
    out.releves.push(t.publicationId as string);

    const author = r.stats.author;
    const cleCompte = `${t.projectId}|${t.compte}`;
    if (author !== null && !profilsEcrits.has(cleCompte)) {
      profilsEcrits.add(cleCompte);
      await ctx.runMutation(internal.apifySync.recordAccountProfile, {
        publicationId: t.publicationId,
        capturedAt,
        followers: author.followers,
        following: author.following,
        totalLikes: author.totalLikes,
        source: "tiktok" as const,
      });
      if (author.avatarUrl) {
        out.avatars.push({
          projectId: t.projectId,
          handle: t.compte,
          sourceUrl: author.avatarUrl,
        });
      }
    }
  }
  return out;
}

export type RescueOutcome = {
  releves: string[];
  /** Posts perdus (échec persisté avec son motif). */
  failed: number;
  /** Runs Apify lancés — l'unité de coût. */
  runs: number;
  budgetRestant: number;
};

/**
 * Confie à Apify les posts que la page n'a pas rendus, dans la limite du
 * budget. Tout post qui n'en revient pas avec des compteurs est inscrit en
 * échec, avec la raison de la page ET celle d'Apify — jamais un « 0 vue ».
 * Ne lève JAMAIS.
 */
export async function rescueWithApify(
  ctx: ActionCtx,
  targets: readonly RescueTarget[],
  capturedAt: number,
  apiToken: string | undefined,
  budget: number,
  fetchImpl?: typeof fetch,
): Promise<RescueOutcome> {
  const out: RescueOutcome = {
    releves: [],
    failed: 0,
    runs: 0,
    budgetRestant: budget,
  };
  if (targets.length === 0) return out;

  const place = apiToken ? Math.max(0, budget) : 0;
  const tentes = targets.slice(0, place);
  const horsBudget = targets.slice(tentes.length);
  out.budgetRestant = budget - tentes.length;

  let stats: Record<string, ApifyPostStat> = {};
  let motifApify = "Apify n'a pas rendu le post";
  if (tentes.length > 0 && apiToken) {
    try {
      const r = await fetchApifyViewsForPlatform(
        "TikTok",
        tentes.map((t) => t.url),
        apiToken,
        fetchImpl,
      );
      stats = r.stats;
      out.runs = r.runs;
      if (r.errors.length > 0) {
        const e = r.errors[0];
        motifApify = `Apify en erreur (${e.status})`;
      }
    } catch (e) {
      motifApify = `Apify en erreur (${String(e).slice(0, 60)})`;
    }
  }

  for (const t of tentes) {
    const stat = stats[t.key];
    if (stat !== undefined) {
      const res = await ctx.runMutation(internal.apifySync.recordApifySnapshot, {
        publicationId: t.publicationId,
        vues: stat.views,
        likes: stat.likes,
        comments: stat.comments,
        saves: stat.saves,
        title: stat.title ?? undefined,
        capturedAt,
        source: "tiktok" as const,
      });
      if (res.action !== "skipped") out.releves.push(t.publicationId as string);
      continue;
    }
    out.failed += 1;
    await ctx.runMutation(internal.apifySync.recordCollectFailure, {
      publicationId: t.publicationId,
      at: capturedAt,
      reason: `${t.reason} ; ${motifApify}`,
    });
  }

  const motifHorsBudget = apiToken
    ? "secours Apify reporté (budget de la nuit épuisé)"
    : "pas de secours Apify (APIFY_API_TOKEN absent)";
  for (const t of horsBudget) {
    out.failed += 1;
    await ctx.runMutation(internal.apifySync.recordCollectFailure, {
      publicationId: t.publicationId,
      at: capturedAt,
      reason: `${t.reason} ; ${motifHorsBudget}`,
    });
  }
  return out;
}

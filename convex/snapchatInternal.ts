import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  fetchSnapchatProfile,
  fetchSnapchatSpotlightStats,
} from "./snapchatPublicPage";
import {
  nextBreaker,
  pageDelayMs,
  type BreakerState,
} from "./tiktokInternal";

/**
 * RELEVÉ SNAPCHAT — pages publiques uniquement, AUCUN secours payant.
 *
 * Même rythme et même coupe-circuit que le relevé TikTok maison
 * (`convex/tiktokInternal.ts`) : une page toutes les 1,5 à 3 s, jamais en
 * parallèle, et on cesse de frapper Snapchat pour la nuit après
 * `BREAKER_THRESHOLD` pages illisibles d'affilée.
 *
 * DIFFÉRENCE ASSUMÉE avec TikTok : pas de secours Apify. Aucun actor officiel
 * n'existe pour Snapchat, et l'arbitrage du 2026-09-25 est « gratuit ». Un
 * Spotlight que la page n'a pas rendu est donc inscrit EN ÉCHEC tout de suite,
 * avec son motif — l'écran dit « non mesuré — HTTP 429 » plutôt qu'un zéro.
 *
 * ⚠️ NON VÉRIFIÉ au 2026-09-25 : que Snapchat serve ces pages aux serveurs
 * Convex comme il les sert à un poste. Les premières nuits le diront ; le
 * coupe-circuit borne ce qu'un blocage coûterait (5 pages, puis silence).
 */

export type SnapchatTarget = {
  publicationId: Id<"publications">;
  projectId: Id<"projects">;
  compte: string;
  /** Identifiant du Spotlight, ou "" pour un lien court (lu après redirection). */
  key: string;
  url: string;
};

export type SnapchatOutcome = {
  /** publicationId des Spotlight dont le snapshot a été écrit. */
  releves: string[];
  /** Spotlight introuvables (404) — échec persisté, définitif. */
  gone: number;
  /** Pages illisibles — échec persisté avec le motif. */
  failed: number;
  /** Non tentés faute de temps : ni échec, ils attendent le relevé suivant. */
  nonTentes: SnapchatTarget[];
  pages: number;
  breaker: BreakerState;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Relève une série de Spotlight par leur page publique, séquentiellement. Ne
 * lève JAMAIS. `deadline` sert la sync manuelle (une seule action de durée
 * bornée) ; le relevé nocturne découpe en lots.
 */
export async function collectSnapchatInternally(
  ctx: ActionCtx,
  targets: readonly SnapchatTarget[],
  capturedAt: number,
  breakerIn: BreakerState,
  opts: {
    fetchImpl?: typeof fetch;
    delayMs?: () => number;
    deadline?: number;
    clock?: () => number;
  } = {},
): Promise<SnapchatOutcome> {
  const {
    fetchImpl,
    delayMs = () => pageDelayMs(Math.random()),
    deadline,
    clock = Date.now,
  } = opts;
  const out: SnapchatOutcome = {
    releves: [],
    gone: 0,
    failed: 0,
    nonTentes: [],
    pages: 0,
    breaker: breakerIn,
  };

  for (const t of targets) {
    if (out.breaker.trippedReason !== null) {
      out.failed += 1;
      await ctx.runMutation(internal.apifySync.recordCollectFailure, {
        publicationId: t.publicationId,
        at: capturedAt,
        reason: `relevé Snapchat suspendu pour la nuit — ${out.breaker.trippedReason}`,
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
    const r = await fetchSnapchatSpotlightStats(
      t.url,
      t.key === "" ? null : t.key,
      fetchImpl,
    );
    out.breaker = nextBreaker(out.breaker, r);

    if (r.kind !== "stats") {
      if (r.kind === "gone") out.gone += 1;
      else out.failed += 1;
      await ctx.runMutation(internal.apifySync.recordCollectFailure, {
        publicationId: t.publicationId,
        at: capturedAt,
        reason: r.reason,
      });
      continue;
    }

    const res = await ctx.runMutation(internal.apifySync.recordApifySnapshot, {
      publicationId: t.publicationId,
      vues: r.stats.views,
      likes: r.stats.likes,
      comments: r.stats.comments,
      // Snapchat n'expose AUCUNE métrique de saves : null est définitif.
      saves: null,
      capturedAt,
      source: "snapchat" as const,
    });
    if (res.action !== "skipped") out.releves.push(t.publicationId as string);
  }
  return out;
}

export type SnapchatProfileTarget = {
  compteId: Id<"comptes">;
  projectId: Id<"projects">;
  handle: string;
  /** Adresse publique du profil (`snapchat.com/add/<user>`). */
  profileUrl: string;
};

/**
 * Abonnés (et photo) des comptes Snapchat, un profil par compte. Même rythme et
 * même coupe-circuit que les posts. Ne lève JAMAIS : ces compteurs sont un
 * supplément, une panne ne doit pas priver la nuit de ses relevés de vues.
 */
export async function collectSnapchatProfiles(
  ctx: ActionCtx,
  comptes: readonly SnapchatProfileTarget[],
  capturedAt: number,
  opts: {
    fetchImpl?: typeof fetch;
    delayMs?: () => number;
    deadline?: number;
    clock?: () => number;
  } = {},
): Promise<{
  written: number;
  pages: number;
  breaker: BreakerState;
  avatars: { projectId: Id<"projects">; handle: string; sourceUrl: string }[];
}> {
  const {
    fetchImpl,
    delayMs = () => pageDelayMs(Math.random()),
    deadline,
    clock = Date.now,
  } = opts;
  let breaker: BreakerState = { suspects: 0, trippedReason: null };
  let pages = 0;
  let written = 0;
  const avatars: { projectId: Id<"projects">; handle: string; sourceUrl: string }[] = [];

  for (const c of comptes) {
    if (breaker.trippedReason !== null) break;
    if (deadline !== undefined && clock() >= deadline) break;
    if (pages > 0) {
      const d = delayMs();
      if (d > 0) await sleep(d);
    }
    pages += 1;
    const r = await fetchSnapchatProfile(c.profileUrl, fetchImpl);
    breaker = nextBreaker(breaker, r);
    if (r.kind !== "profile") continue;

    const res = await ctx.runMutation(
      internal.apifySync.recordAccountProfileByCompte,
      {
        compteId: c.compteId,
        capturedAt,
        followers: r.profile.subscribers,
        source: "snapchat" as const,
      },
    );
    if (res.action === "written") written += 1;
    if (r.profile.avatarUrl) {
      avatars.push({
        projectId: c.projectId,
        handle: c.handle,
        sourceUrl: r.profile.avatarUrl,
      });
    }
  }
  return { written, pages, breaker, avatars };
}

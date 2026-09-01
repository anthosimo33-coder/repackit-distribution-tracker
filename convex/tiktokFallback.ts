import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  fetchTikTokPublicStats,
  refusalLabel,
} from "./tiktokPublicPage";

/**
 * REPLI AUTOMATIQUE — rattrape les posts TikTok qu'Apify a abandonnés.
 *
 * Branché sur les DEUX chemins de relevé (cron nocturne et sync manuelle), au
 * seul endroit où un post était jusqu'ici silencieusement laissé de côté :
 * `if (stat === undefined) continue`.
 *
 * Trois issues, et aucune ne produit un « 0 vue » :
 *   - compteurs lus      → snapshot écrit, exactement comme un relevé Apify ;
 *   - TikTok refuse      → échec PERSISTÉ avec son motif en clair ;
 *   - page illisible     → échec PERSISTÉ avec la raison technique.
 *
 * ⚠️ POURQUOI UN PLAFOND ET UNE TEMPORISATION. Ce repli marche parce qu'il est
 * RARE (10 posts sur 222 le 2026-08-31). Un soir de panne Apify, sans garde, il
 * partirait en 220 requêtes séquentielles depuis l'IP unique de Convex — le
 * motif exact qui fait blacklister, donc le moyen sûr de perdre le repli au
 * moment où on en a le plus besoin. Au-delà du plafond, les posts restants sont
 * comptés en échec SANS être appelés : ils repasseront la nuit suivante.
 */

/** Posts rattrapés au maximum par exécution. Au-delà : reporté à la nuit suivante. */
export const MAX_FALLBACK_FETCHES = 25;

/** Temporisation entre deux pages, pour ne pas marteler. */
export const FALLBACK_DELAY_MS = 1_200;

export type FallbackTarget = {
  publicationId: Id<"publications">;
  /** Id de post TikTok — sert AUSSI de contrôle que la page lue est la bonne. */
  key: string;
  url: string;
};

export type FallbackOutcome = {
  /** Posts dont les compteurs ont été récupérés et écrits. */
  recovered: number;
  /** Posts que TikTok refuse de servir (motif enregistré). */
  refused: number;
  /** Posts illisibles pour une autre raison (réseau, HTTP, payload). */
  unreadable: number;
  /** Posts non tentés faute de place sous le plafond. */
  deferred: number;
  /** publicationId des posts récupérés — pour le comptage de l'appelant. */
  recoveredIds: string[];
};

/**
 * Répartit les posts manquants d'un lot entre « on appelle » et « on inscrit
 * l'échec sans appeler ».
 *
 * Fonction PURE, extraite du cron pour être testable — la règle qu'elle porte
 * est trop conséquente pour vivre dans une action Convex que rien ne couvre :
 *   - hors TikTok, on n'appelle JAMAIS (le payload public est propre à TikTok) ;
 *   - sur TikTok, on appelle dans la limite du budget RESTANT de la nuit ;
 *   - le surplus n'est pas perdu : il est inscrit en échec, donc visible, et
 *     repassera la nuit suivante.
 *
 * Le budget de nuit existe pour un scénario précis : Apify tombe entièrement
 * (crédits épuisés) et TOUS les lots atterrissent dans le repli. Sans borne
 * globale, le repli deviendrait la collecte principale — ~220 lectures depuis
 * l'IP unique de Convex, jamais testé à ce volume.
 */
export function splitFallbackBudget<T>(
  manques: readonly T[],
  plateforme: "TikTok" | "Instagram",
  budget: number,
): { aTenter: T[]; sansAppel: T[]; budgetRestant: number } {
  const place = plateforme === "TikTok" ? Math.max(0, budget) : 0;
  const aTenter = manques.slice(0, place);
  return {
    aTenter,
    sansAppel: manques.slice(aTenter.length),
    budgetRestant: budget - aTenter.length,
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Tente le repli sur chaque cible. Ne lève JAMAIS : un repli qui explose ne doit
 * pas emporter le relevé des posts qui, eux, ont réussi.
 */
export async function recoverMissingTikTokPosts(
  ctx: ActionCtx,
  targets: readonly FallbackTarget[],
  capturedAt: number,
  /**
   * `fetchImpl` et `delayMs` sont INJECTÉS pour les tests (même arrangement que
   * `apifyApi`). En production, aucun appelant ne les passe : la temporisation
   * réelle s'applique, et c'est elle qui protège le repli.
   */
  opts: { fetchImpl?: typeof fetch; delayMs?: number } = {},
): Promise<FallbackOutcome> {
  const { fetchImpl, delayMs = FALLBACK_DELAY_MS } = opts;
  const out: FallbackOutcome = {
    recovered: 0,
    refused: 0,
    unreadable: 0,
    deferred: Math.max(targets.length - MAX_FALLBACK_FETCHES, 0),
    recoveredIds: [],
  };

  const aTenter = targets.slice(0, MAX_FALLBACK_FETCHES);
  for (const [i, t] of aTenter.entries()) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);

    const r = await fetchTikTokPublicStats(t.url, t.key, fetchImpl);

    if (r.kind === "stats") {
      const res = await ctx.runMutation(internal.apifySync.recordApifySnapshot, {
        publicationId: t.publicationId,
        vues: r.stats.views,
        likes: r.stats.likes,
        comments: r.stats.comments,
        saves: r.stats.saves,
        title: r.stats.title ?? undefined,
        capturedAt,
        // `source: "tiktok"` — c'est bien un relevé TikTok, et le laisser tel
        // quel garde la série homogène. La provenance (Apify vs repli) n'a pas
        // de conséquence sur la lecture, et un 7e littéral de `source` obligerait
        // à toucher toutes les répartitions par source déjà en place.
        source: "tiktok" as const,
      });
      if (res.action !== "skipped") {
        out.recovered += 1;
        out.recoveredIds.push(t.publicationId as string);
        console.info(
          `[repli-tiktok] ${t.key} rattrapé — ${r.stats.views} vue(s), ` +
            `${r.stats.likes ?? "—"} like(s).`,
        );
        continue;
      }
      // Snapshot refusé par l'invariant (capturedAt < datePubli) : ce n'est pas
      // un échec de collecte, on ne l'enregistre pas comme tel.
      continue;
    }

    const reason =
      r.kind === "refused"
        ? refusalLabel(r.statusCode, r.statusMsg)
        : r.reason;
    if (r.kind === "refused") out.refused += 1;
    else out.unreadable += 1;

    await ctx.runMutation(internal.apifySync.recordCollectFailure, {
      publicationId: t.publicationId,
      at: capturedAt,
      reason,
    });
  }

  // Les cibles au-delà du plafond comptent aussi comme un échec du jour : sans
  // ça, un post reporté nuit après nuit n'accumulerait jamais de streak et
  // resterait invisible — le défaut même qu'on corrige.
  for (const t of targets.slice(MAX_FALLBACK_FETCHES)) {
    await ctx.runMutation(internal.apifySync.recordCollectFailure, {
      publicationId: t.publicationId,
      at: capturedAt,
      reason: `repli reporté (plafond de ${MAX_FALLBACK_FETCHES} atteint)`,
    });
  }

  return out;
}

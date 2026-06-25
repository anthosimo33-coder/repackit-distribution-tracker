import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  isTikTokShortlink,
  resolveTikTokShortlink,
} from "./modelVideoEmbeds";

/**
 * Résolution des SHORTLINKS TikTok (vm./vt.tiktok.com) → URL canonique
 * /@user/video/ID, pour le tracking des métriques. Sans ça, `tiktokPostId`
 * renvoie null sur un shortlink → la publication est écartée AVANT l'appel Apify
 * (jamais de snapshot). On résout donc UNE FOIS à la saisie (planifié par les
 * mutations qui posent un postUrl) + un BACKFILL ponctuel des posts existants, et
 * on stocke la canonique dans `postUrl` → la sync fonctionne ensuite sans
 * re-résoudre (coûteux) à chaque relevé.
 *
 * La résolution est une I/O réseau (suivi de redirect) → ACTION. Les mutations
 * planifient `resolvePublicationShortlink` (scheduler.runAfter 0). Échec de
 * résolution (réseau, lien mort) → on CONSERVE l'URL d'origine (jamais de crash,
 * jamais de saisie bloquée) ; le post reste juste non-tracké jusqu'à correction.
 *
 * ⚠️ Réutilise resolveTikTokShortlink/isTikTokShortlink de modelVideoEmbeds.ts
 * (garde anti-SSRF : ne suit que les shortlinks TikTok, cible finale tiktok.com).
 * ⚠️ TS7022 — handlers appelés via runQuery/runMutation : types de retour annotés.
 */

/** URL + plateforme d'une publication (lecture ciblée pour la résolution). */
export const getPublicationUrl = internalQuery({
  args: { publicationId: v.id("publications") },
  handler: async (
    ctx,
    { publicationId },
  ): Promise<{ plateforme: string; postUrl: string | null } | null> => {
    const pub = await ctx.db.get(publicationId);
    if (!pub) return null;
    return { plateforme: pub.plateforme, postUrl: pub.postUrl ?? null };
  },
});

/**
 * Écrit l'URL canonique dans postUrl — UNIQUEMENT si la valeur courante est
 * encore un shortlink TikTok (idempotent : un re-run ou une URL déjà résolue ne
 * réécrit rien, et on n'écrase pas une URL changée entre-temps).
 */
export const patchPostUrl = internalMutation({
  args: { publicationId: v.id("publications"), canonicalUrl: v.string() },
  handler: async (ctx, { publicationId, canonicalUrl }): Promise<boolean> => {
    const pub = await ctx.db.get(publicationId);
    if (!pub || typeof pub.postUrl !== "string") return false;
    if (!isTikTokShortlink(pub.postUrl)) return false; // déjà résolu / changé
    await ctx.db.patch(publicationId, { postUrl: canonicalUrl });
    return true;
  },
});

/**
 * Résout le shortlink TikTok d'UNE publication et stocke la canonique. No-op si
 * la pub n'est pas TikTok, sans postUrl, ou déjà canonique. Planifié (runAfter 0)
 * par les mutations qui posent un postUrl TikTok shortlink.
 */
export const resolvePublicationShortlink = internalAction({
  args: { publicationId: v.id("publications") },
  handler: async (ctx, { publicationId }): Promise<null> => {
    const pub = await ctx.runQuery(
      internal.postUrlResolution.getPublicationUrl,
      { publicationId },
    );
    if (
      !pub ||
      pub.plateforme !== "TikTok" ||
      !pub.postUrl ||
      !isTikTokShortlink(pub.postUrl)
    ) {
      return null;
    }
    const canonical = await resolveTikTokShortlink(pub.postUrl);
    if (!canonical || canonical === pub.postUrl) {
      console.warn(
        `[shortlink] résolution échouée pour ${publicationId} (${pub.postUrl}) — URL d'origine conservée.`,
      );
      return null;
    }
    await ctx.runMutation(internal.postUrlResolution.patchPostUrl, {
      publicationId,
      canonicalUrl: canonical,
    });
    return null;
  },
});

export interface ShortlinkBackfillSummary {
  /** Publications TikTok scannées (toutes celles avec un postUrl). */
  scanned: number;
  /** Déjà canoniques (non shortlink) → ignorées. */
  skipped: number;
  /** Shortlinks résolus + postUrl mis à jour. */
  resolved: number;
  /** Shortlinks dont la résolution a échoué (URL d'origine conservée). */
  failed: number;
}

/**
 * BACKFILL ponctuel — résout tous les postUrl TikTok shortlink existants en
 * canonique. Idempotent (skip les URLs déjà canoniques). `projectId` optionnel :
 * absent = tous les projets ; présent = scopé. À lancer après merge :
 *   npx convex run postUrlResolution:backfillTikTokShortlinks --prod
 * Puis relancer une sync TikTok pour que ces posts remontent vues+likes+titre.
 */
export const backfillTikTokShortlinks = internalAction({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<ShortlinkBackfillSummary> => {
    // cutoff 0 → TOUTES les publications TikTok ayant un postUrl (pas seulement
    // la fenêtre active 90 j : on veut corriger l'historique).
    const pubs: { _id: Id<"publications">; postUrl: string }[] =
      await ctx.runQuery(internal.apifySync.listActiveApifyPublications, {
        cutoff: 0,
        plateforme: "TikTok",
        ...(projectId ? { projectId } : {}),
      });

    const summary: ShortlinkBackfillSummary = {
      scanned: pubs.length,
      skipped: 0,
      resolved: 0,
      failed: 0,
    };

    for (const p of pubs) {
      if (!isTikTokShortlink(p.postUrl)) {
        summary.skipped += 1;
        continue;
      }
      const canonical = await resolveTikTokShortlink(p.postUrl);
      if (!canonical || canonical === p.postUrl) {
        summary.failed += 1;
        console.warn(
          `[shortlink-backfill] échec ${p._id} (${p.postUrl}) — conservé.`,
        );
        continue;
      }
      const patched = await ctx.runMutation(
        internal.postUrlResolution.patchPostUrl,
        { publicationId: p._id, canonicalUrl: canonical },
      );
      if (patched) summary.resolved += 1;
      else summary.skipped += 1;
    }

    console.info(
      `[shortlink-backfill] Terminé — ${summary.resolved} résolu(s), ${summary.failed} échec(s), ${summary.skipped} ignoré(s) sur ${summary.scanned} TikTok.`,
    );
    return summary;
  },
});

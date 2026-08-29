import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { adminMutation } from "./functions";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  challengeWinsOf,
  computeChallengeRanking,
  requireChallenge,
} from "./challenges";
import { newWinnersAt, type WinnerRule } from "./challengeScore";
import { periodOf } from "./payments";
import { cycleIndexOf, cyclePeriodKey, cycleWindow } from "./payCycle";

/**
 * DÉFIS — l'ÉVALUATION, et elle a lieu au RELEVÉ. Nulle part ailleurs.
 *
 * ── Pourquoi ici et pas dans un cron à part ──────────────────────────────────
 * Un défi se joue sur des vues, et les vues n'existent dans l'app qu'au moment
 * où le relevé nocturne les écrit (23h30 Paris). Évaluer à un autre instant
 * produirait le MÊME résultat avec un horodatage trompeur : la victoire serait
 * datée d'une heure où personne n'a rien mesuré. C'est exactement le
 * raisonnement du recalcul de quadrant, branché au même endroit.
 *
 * Conséquence assumée, et annoncée à la créatrice : la victoire est constatée
 * une fois par jour. « La première à franchir » n'est pas décidable entre deux
 * relevés — le départage est donc le SCORE au relevé (cf challengeScore).
 *
 * ── Ce que cette action n'a pas le droit de faire ────────────────────────────
 * Elle n'écrit AUCUN euro. Elle acte des victoires (`challengeWins`), avec leur
 * récompense FIGÉE ; la mise en paiement est un chantier distinct, et la
 * séparation est délibérée — un job nocturne qui crédite des comptes est un job
 * qu'on n'ose plus rejouer.
 */

/**
 * Évalue TOUS les défis actifs de TOUS les projets et acte les victoires.
 *
 * `at` est l'instant du RELEVÉ (celui du run), pas `Date.now()` : c'est la date
 * qui sera écrite dans `wonAt` et qui fait foi pour la deadline. Passer
 * l'horloge du moment ferait dériver la victoire de quelques minutes à chaque
 * exécution, et un run rejoué manuellement daterait des victoires d'aujourd'hui.
 *
 * IDEMPOTENT : `newWinnersAt` reçoit les victoires déjà actées et ne les rend
 * jamais deux fois. Rejouer l'évaluation ne double aucune prime.
 */
export const runChallengeEvaluation = internalAction({
  args: { at: v.optional(v.number()) },
  handler: async (ctx, { at }): Promise<{ evaluated: number; won: number }> => {
    return ctx.runMutation(internal.challengeSync.evaluateChallenges, {
      at: at ?? Date.now(),
    });
  },
});

export const evaluateChallenges = internalMutation({
  args: { at: v.number() },
  handler: async (ctx, { at }): Promise<{ evaluated: number; won: number }> => {
    const actives = await ctx.db
      .query("challenges")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
    let won = 0;
    for (const c of actives) {
      const [ranking, wins] = await Promise.all([
        computeChallengeRanking(ctx, c),
        challengeWinsOf(ctx, c._id),
      ]);
      const live = wins.filter((w) => w.cancelledAt === undefined);
      const fresh = newWinnersAt({
        ranked: ranking,
        rule: c.winnerRule as WinnerRule,
        existingWins: wins.map((w) => ({
          creatorId: w.creatorId,
          cancelled: w.cancelledAt !== undefined,
        })),
        at,
        deadline: c.deadline,
      });
      // `position` reprend au-delà des places DÉJÀ tenues : deux gagnantes
      // actées à deux relevés différents portent 1 puis 2, pas 1 puis 1.
      let position = live.length;
      for (const w of fresh) {
        position += 1;
        await ctx.db.insert("challengeWins", {
          projectId: c.projectId,
          challengeId: c._id,
          creatorId: w.creatorId as Id<"creators">,
          wonAt: at,
          // Le score est FIGÉ : c'est la preuve du départage, et il aura bougé
          // dès le relevé suivant.
          scoreAtWin: w.score,
          position,
          // Récompense FIGÉE au moment de l'acte (patron `bonusUnlocks`) :
          // éditer le défi ensuite ne réécrit pas ce qui est dû.
          reward: c.reward,
          attributionPeriod: periodOf(at),
        });
        won += 1;
      }
      if (fresh.length > 0) {
        console.info(
          `[challenges] « ${c.name} » — ${fresh.length} victoire(s) actée(s) au relevé.`,
        );
      }
    }
    return { evaluated: actives.length, won };
  },
});

/**
 * ANNULATION d'une victoire — geste ADMIN, avec motif OBLIGATOIRE.
 *
 * ── Pourquoi ce geste existe ─────────────────────────────────────────────────
 * Une victoire acquise ne se dé-acquiert pas toute seule : c'est ce qui rend
 * l'annonce automatique sûre. Il faut donc une porte explicite pour les cas
 * réels (triche, vidéo hors sujet, erreur de saisie) — et une porte explicite
 * demande un motif, sinon l'historique ne dit plus pourquoi.
 *
 * ── Le verrou ────────────────────────────────────────────────────────────────
 * Plus annulable une fois la prime VERSÉE. Même règle que
 * `setPublicationWarmup`, et pour la même raison : le paiement lit ses lignes
 * gelées, donc annuler après coup ne reprendrait aucun euro mais ferait diverger
 * l'écran de ce qui a réellement été payé.
 *
 * Annuler LIBÈRE la place : la prochaine évaluation peut la réattribuer, y
 * compris à la même personne si elle est toujours en tête. C'est voulu — la
 * place appartient au défi, pas à la personne qu'on vient d'en écarter.
 */
export const cancelChallengeWin = adminMutation({
  args: { winId: v.id("challengeWins"), reason: v.string() },
  handler: async (ctx, { winId, reason }): Promise<{ ok: true }> => {
    const win = await ctx.db.get(winId);
    if (!win || win.projectId !== ctx.projectId) {
      throw new ConvexError("Victoire introuvable.");
    }
    if (win.cancelledAt !== undefined) return { ok: true }; // idempotent
    const motif = reason.trim();
    if (motif.length === 0) {
      throw new ConvexError("Un motif d'annulation est requis.");
    }
    // ── VERROU DE PAIE — la prime est-elle déjà partie ? ─────────────────────
    //
    // ⚠️ DEUX MODES DE PAIE COHABITENT, et c'est le piège : `attributionPeriod`
    // est un mois calendaire (« 2026-08 ») alors qu'un cycle J+30 payé écrit une
    // row dont la période est une DATE (« 2026-08-14 », cf cyclePeriodKey). Ne
    // comparer que la première laisse passer toutes les primes payées en cycle —
    // le verrou existait et ne verrouillait rien. Constaté par la contre-épreuve
    // chiffrée, pas à la relecture.
    //
    // C'est exactement la précaution que prend déjà `unlockIsFrozen` pour les
    // paliers, et pour la même raison. On teste donc les DEUX fenêtres.
    const paidRows = (
      await ctx.db
        .query("payments")
        .withIndex("by_creator", (q) => q.eq("creatorId", win.creatorId))
        .collect()
    ).filter((p) => p.projectId === ctx.projectId && p.status === "paid");
    const creator = await ctx.db.get(win.creatorId);
    const anchor = creator?.payAnchorAt ?? creator?.firstPostAt;
    const paid = paidRows.filter((p) => {
      if (p.period === win.attributionPeriod) return true; // mode mensuel
      if (anchor === undefined) return false;
      // Mode cycles : le cycle qui CONTIENT la victoire est-il payé ?
      const k = cycleIndexOf(anchor, win.wonAt);
      return p.period === cyclePeriodKey(cycleWindow(anchor, k).cycleStart);
    });
    if (paid.length > 0) {
      throw new ConvexError(
        "Cette victoire n'est plus annulable : sa prime a déjà été versée " +
          `(période ${win.attributionPeriod}). Annuler ici ferait diverger ` +
          "l'écran de ce qui a réellement été payé.",
      );
    }
    await ctx.db.patch(winId, {
      cancelledAt: Date.now(),
      cancelReason: motif,
    });
    return { ok: true };
  },
});

/**
 * Force une évaluation depuis l'écran admin (« évaluer maintenant »).
 *
 * Utile pour ne pas attendre 23h30 quand on vient d'ouvrir un défi ou de
 * corriger un score. Passe par le MÊME chemin que le relevé nocturne — un
 * second chemin d'écriture des victoires divergerait, et ce sont des primes.
 *
 * `at` = maintenant : c'est bien l'instant où l'on constate. Les vues, elles,
 * datent du dernier relevé — l'écran le dit.
 */
export const evaluateChallengeNow = adminMutation({
  args: { id: v.id("challenges") },
  handler: async (ctx, { id }): Promise<{ won: number }> => {
    await requireChallenge(ctx, id, ctx.projectId);
    const res = await ctx.runMutation(
      internal.challengeSync.evaluateChallenges,
      { at: Date.now() },
    );
    return { won: res.won };
  },
});

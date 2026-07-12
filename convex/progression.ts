import { creatorQuery, adminViewAsQuery, creatorMutation } from "./functions";
import {
  creatorCumulViews,
  creatorBonusTiers,
  type BonusTier,
} from "./pricing";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Progression créatrice — READ sécurisé (paliers DU PROJET, scopé créateur).
 *
 * UN SEUL query de progression (`getMyProgression`) + son jumeau view-as admin,
 * qui partagent le MÊME helper de collecte → aucune fuite cross-projet (garanti
 * par creatorQuery/adminViewAsQuery : membership + creator∈projet côté serveur).
 *
 * On ne fait ici que COLLECTER (cumul de vues, grille de paliers du créateur,
 * unlocks persistés, nb de posts). Toute la MISE EN FORME (échelle, prochain
 * palier, progression, victoires, emoji) vit dans lib/progression.ts (pur, testé
 * Vitest, réutilisé côté client) — règle A6 : convex/ ne peut pas importer lib/.
 *
 * ARGENT : ce module ne crédite RIEN. Le cash dû vient des `bonusUnlocks`
 * persistés lus par le moteur de paie (convex/pricing, convex/payments) —
 * inchangé. Une récompense NATURE n'est jamais un euro.
 */

/** Fenêtre de célébration : au-delà, un unlock non vu n'est plus « nouveau »
 *  (évite de rejouer tout l'historique à la 1re ouverture après déploiement). */
const CELEBRATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Unlock brut exposé au client (récompense figée au déblocage). */
type ProgressionUnlockDTO = {
  seuilVues: number;
  rewardType: "cash" | "nature";
  montant?: number;
  libelle?: string;
  unlockedAt: number;
};

/** Payload brut de progression — mis en forme côté client (lib/progression). */
export type ProgressionData = {
  cumulViews: number;
  tiers: BonusTier[];
  unlocks: ProgressionUnlockDTO[];
  publishedPostsCount: number;
  /** Unlocks non encore vus ET récents → overlay de célébration (montré 1×). */
  pendingCelebrations: ProgressionUnlockDTO[];
};

const toDTO = (u: Doc<"bonusUnlocks">): ProgressionUnlockDTO => ({
  seuilVues: u.seuilVues,
  rewardType: u.rewardType,
  montant: u.montant,
  libelle: u.libelle,
  unlockedAt: u.unlockedAt,
});

/**
 * Collecte la progression d'UN créateur sur le projet. RÉUTILISE
 * `creatorCumulViews` (cumul à vie, même base que le CPM) et `creatorBonusTiers`
 * (grille du créateur, avec fallback legacy) — 0 duplication.
 */
async function progressionDataFor(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creator: Doc<"creators">,
): Promise<ProgressionData> {
  const cumulViews = await creatorCumulViews(ctx, projectId, creator._id);
  const tiers = await creatorBonusTiers(ctx, creator);

  const unlockRows = (
    await ctx.db
      .query("bonusUnlocks")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect()
  ).filter((u) => u.projectId === projectId);

  // Nb de posts publiés (published/paid) — source des victoires « vidéos ».
  const publishedPostsCount = (
    await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect()
  ).filter(
    (a) =>
      a.projectId === projectId &&
      (a.status === "published" || a.status === "paid"),
  ).length;

  const now = Date.now();
  const pendingCelebrations = unlockRows
    .filter(
      (u) =>
        u.celebrationSeenAt === undefined &&
        now - u.unlockedAt < CELEBRATION_MAX_AGE_MS,
    )
    .sort((a, b) => a.unlockedAt - b.unlockedAt)
    .map(toDTO);

  return {
    cumulViews,
    tiers,
    unlocks: unlockRows.map(toDTO),
    publishedPostsCount,
    pendingCelebrations,
  };
}

/** CRÉATEUR — sa progression sur le projet courant (échelle + célébrations). */
export const getMyProgression = creatorQuery({
  args: {},
  handler: async (ctx): Promise<ProgressionData | null> => {
    const creator = await ctx.db.get(ctx.creatorId);
    if (!creator) return null;
    return progressionDataFor(ctx, ctx.projectId, creator);
  },
});

/** ADMIN view-as (LECTURE SEULE) — même helper, créateur ciblé scopé projet. */
export const getProgressionAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx): Promise<ProgressionData | null> => {
    const creator = await ctx.db.get(ctx.creatorId);
    if (!creator) return null;
    return progressionDataFor(ctx, ctx.projectId, creator);
  },
});

/**
 * Marque VUES les célébrations en attente du créateur (overlay affiché 1×).
 * Idempotent, borné à la fenêtre de célébration. N'affecte AUCUN euro (le champ
 * `celebrationSeenAt` n'entre dans aucun calcul de paie). Pas de variante
 * view-as : la lecture admin ne déclenche jamais le marqueur du créateur.
 */
export const markCelebrationsSeen = creatorMutation({
  args: {},
  handler: async (ctx): Promise<{ marked: number }> => {
    const now = Date.now();
    const pending = (
      await ctx.db
        .query("bonusUnlocks")
        .withIndex("by_creator", (q) => q.eq("creatorId", ctx.creatorId))
        .collect()
    ).filter(
      (u) =>
        u.projectId === ctx.projectId &&
        u.celebrationSeenAt === undefined &&
        now - u.unlockedAt < CELEBRATION_MAX_AGE_MS,
    );
    for (const u of pending) await ctx.db.patch(u._id, { celebrationSeenAt: now });
    return { marked: pending.length };
  },
});

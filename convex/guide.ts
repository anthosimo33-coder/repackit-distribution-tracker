import {
  creatorQuery,
  permissionMutation,
  permissionQuery,
} from "./functions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * P7 — guide « Comment ça marche » du projet (markdown, éditable admin, lu par
 * les créateurs). Un seul row par projet (upsert). Si aucun row, on renvoie un
 * placeholder de départ (seed implicite) — le créateur voit toujours un guide.
 */

export const DEFAULT_GUIDE = `# Comment ça marche

Bienvenue dans ton espace créateur 👋

## Tes missions
Tu retrouves sur ton **tableau de bord** les briefs à produire (« À produire »),
triés par échéance. Ouvre un brief pour voir les consignes, les exemples vidéo,
les hooks à utiliser et ce que ça rapporte.

## Comment je suis payé
Chaque post validé est payé à l'unité selon la grille du brief : un **tarif de
base**, parfois un **bonus aux vues** et des **primes par paliers**. Le
calculateur du brief te donne une estimation selon les vues.

## Quand
Les paiements sont regroupés et versés une fois par mois (détails à venir dans
« Mes paiements »).

## Le warmup
Avant de publier sur un nouveau compte, suis le **protocole de warmup** indiqué
dans « Mes comptes » : recherches quotidiennes avec TES mots-clés, check du jour
à cocher chaque jour. Deux comptes ne doivent jamais taper les mêmes recherches.

## Si une vidéo est rejetée
Tu verras le motif du rejet sur la fiche du brief, et tu pourras **resoumettre**
une nouvelle URL. Tant qu'un post n'est pas validé, il n'est pas payé.
`;

async function readGuide(ctx: QueryCtx, projectId: Id<"projects">) {
  const row = await ctx.db
    .query("projectGuide")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first();
  return {
    content: row?.content ?? DEFAULT_GUIDE,
    updatedAt: row?.updatedAt ?? null,
    isDefault: row === null,
  };
}

/** Lecture créateur (isolé : ctx.projectId du creator courant). */
export const getMyGuide = creatorQuery({
  args: {},
  handler: async (ctx) => readGuide(ctx, ctx.projectId),
});

/** Lecture admin (page d'édition). */
export const getGuideForAdmin = permissionQuery("guide.manage")({
  args: {},
  handler: async (ctx) => readGuide(ctx, ctx.projectId),
});

/** Upsert du guide (admin). Au plus un row par projet. */
export const updateProjectGuide = permissionMutation("guide.manage")({
  args: { content: v.string() },
  handler: async (ctx, { content }) => {
    const existing = await ctx.db
      .query("projectGuide")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { content, updatedAt: now });
    } else {
      await ctx.db.insert("projectGuide", {
        projectId: ctx.projectId,
        content,
        updatedAt: now,
      });
    }
  },
});

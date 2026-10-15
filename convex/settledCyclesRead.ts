import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { payAnchorOf } from "./payCycle";
import { assignmentPublishedAt } from "./pricing";
import { settledVideoBonusResolver, settledViewsResolver } from "./settledCycles";

/**
 * L'ASSIETTE GELÉE d'une créatrice, prête à passer au moteur
 * (`computeLivePricingBreakdown`, arguments `settledViewsOf` / `settledVideoBonusOf`).
 *
 * UN SEUL ENDROIT pour tous les écrans qui re-simulent la paie d'un mois : la
 * Rentabilité l'avait, l'onglet Pays non — il recalculait le CPM des vidéos déjà
 * payées avec les vues du jour. Septembre 2026 ressortait à 2 297,68 $ dans
 * l'onglet Pays contre 2 255,80 $ dans la Rentabilité (prod du 2026-10-15) : les
 * 41,88 $ d'écart étaient des vues gagnées APRÈS le versement, chez Kelly et
 * Orlane, que personne ne paiera. Deux copies de ce câblage avaient divergé ;
 * celle-ci est la seule.
 *
 * Une lecture indexée par créatrice (ses rows `payments`), jamais par mois.
 * `creator` absent (fiche supprimée) ⇒ aucune ancre, donc rien de gelé : le
 * moteur calcule en live, comme `settledViewsResolver` le prévoit.
 */
export async function loadSettledResolvers(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  creator: Pick<Doc<"creators">, "firstPostAt"> | null | undefined,
): Promise<{
  settledViewsOf: (a: Doc<"assignments">) => number | null;
  settledVideoBonusOf: (a: Doc<"assignments">) => number | null;
}> {
  const paidRows = (
    await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter((p) => p.projectId === projectId);
  const anchor = creator ? payAnchorOf(creator) : undefined;
  const views = settledViewsResolver(anchor, paidRows);
  const videoBonus = settledVideoBonusResolver(anchor, paidRows);
  return {
    // Vidéo d'un cycle déjà réglé ⇒ l'assiette qu'on a payée.
    settledViewsOf: (a) => views(a._id, assignmentPublishedAt(a)),
    // … et le bonus par vidéo qu'on lui a versé (0 si aucun).
    settledVideoBonusOf: (a) => videoBonus(a._id, assignmentPublishedAt(a)),
  };
}

import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Libellé de mission RÉEXPOSÉ au créateur — le SEUL élément du `scriptCombo`
 * qu'il reçoit. Script → NOM DE CAMPAGNE (ex. « Format 3 - POV Demo ») ; format
 * → nom + type du format. La décomposition (bricks/comboKey) et les données
 * de perf restent STRICTEMENT côté admin : on ne lit ici que le `name` de la
 * campagne. `formatType` est null pour un script (le type de contenu est porté
 * par le nom de campagne, pas par un champ dédié). Fallback « Vidéo à tourner »
 * si la campagne a disparu → jamais de libellé vide.
 */
export async function missionLabelFor(
  ctx: QueryCtx,
  a: Doc<"assignments">,
): Promise<{
  formatName: string;
  formatType: string | null;
  origin: "script" | "format";
}> {
  if (a.scriptCombo) {
    const campaign = await ctx.db.get(a.scriptCombo.campaignId);
    return {
      // `displayName` d'abord : `name` est le nom INTERNE de production
      // (« Format Warmup LAB »), et il fuitait tel quel dans l'espace créatrice
      // ET clippeur — révélant la taxonomie de pilotage. Repli sur `name` quand
      // aucun nom d'affichage n'est défini : comportement actuel, 0 migration.
      // Côté ADMIN, c'est toujours `name` qui s'affiche (autre chemin de lecture).
      formatName:
        // `|| ` et non `?? ` : un displayName VIDÉ (chaîne vide) doit retomber
        // sur le nom interne, pas afficher une étiquette vide à la créatrice.
        campaign?.displayName?.trim() ||
        campaign?.name ||
        // i18n-exempt: repli d'une campagne SUPPRIMÉE, servi tel quel depuis toujours (déplacé d'assignments.ts, hors périmètre)
        "Vidéo à tourner",
      formatType: null,
      origin: "script",
    };
  }
  const format = a.formatId ? await ctx.db.get(a.formatId) : null;
  return {
    formatName: format?.name ?? "—",
    formatType: format?.type ?? "custom",
    origin: "format",
  };
}

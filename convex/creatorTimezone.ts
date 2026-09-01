import type { Id } from "./_generated/dataModel";
import {
  resolveCreatorTimezone,
  type CreatorZone,
  type TimezoneSource,
} from "./creatorDay";

/**
 * Résolution SERVEUR du fuseau d'une créatrice — le seul chemin autorisé.
 *
 * `convex/creatorDay.resolveCreatorTimezone` est pur (il reçoit déjà les pays) ;
 * ce module-ci est la couche qui va CHERCHER la donnée en base. Les deux sont
 * séparés pour que la règle de résolution reste testable sans base.
 *
 * ⚠️ Rend `{ timezone: null }` quand le fuseau est indéterminable, et c'est un
 * résultat LÉGITIME. Aucun appelant ne doit le remplacer par Europe/Paris :
 * `zoneOrNeutral` (UTC) est le seul repli, et il est neutre par construction.
 */

type Ctx = {
  db: {
    get: (id: Id<"creators">) => Promise<{
      _id: Id<"creators">;
      projectId: Id<"projects">;
      timezone?: string;
      timezoneSource?: string;
    } | null>;
    query: (table: "comptes") => {
      withIndex: (
        name: "by_project_creator",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fn: (q: any) => any,
      ) => { collect: () => Promise<{ targetCountry?: string }[]> };
    };
  };
};

export type ResolvedZone = {
  timezone: CreatorZone;
  source: TimezoneSource | null;
};

/**
 * Fuseau EFFECTIF d'une créatrice + provenance.
 *
 * La déduction depuis le pays ne lit les comptes QUE si la fiche ne porte pas
 * déjà un fuseau : dans le cas nominal (fuseau confirmé), aucune requête
 * supplémentaire n'est faite.
 */
export async function creatorZone(
  ctx: Ctx,
  creatorId: Id<"creators">,
): Promise<ResolvedZone> {
  const creator = await ctx.db.get(creatorId);
  if (!creator) return { timezone: null, source: null };

  // Chemin rapide : une valeur stockée n'est jamais écrasée par la déduction.
  const direct = resolveCreatorTimezone(creator, []);
  if (direct.timezone) return direct;

  // Sinon seulement, déduire depuis le pays CIBLÉ de ses comptes.
  const comptes = await ctx.db
    .query("comptes")
    .withIndex("by_project_creator", (q) =>
      q.eq("projectId", creator.projectId).eq("creatorId", creatorId),
    )
    .collect();
  const pays = comptes
    .map((c) => c.targetCountry)
    .filter((c): c is string => typeof c === "string" && c.length > 0);

  return resolveCreatorTimezone(creator, pays);
}

/** Raccourci : le fuseau seul, quand la provenance n'intéresse pas l'appelant. */
export async function creatorZoneOnly(
  ctx: Ctx,
  creatorId: Id<"creators">,
): Promise<CreatorZone> {
  return (await creatorZone(ctx, creatorId)).timezone;
}
